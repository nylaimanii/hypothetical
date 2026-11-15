// energy, food, economy, migration. hard limits: consumption never exceeds production, capacity costs
// money and takes years, migrants cost money and take months.
import type { Budget, Migration } from '../types'
import {
  BUILD_MONTHS, CAPEX_USD_PER_GW, ELEC_INCOME_ELASTICITY, KCAL_CAP, MIGRATION_MAX_SHARE_YEAR, MIGRATION_MONTHS,
  MIGRATION_USD_PER_PERSON, OM_USD_PER_TWH, RETIRE_PER_YEAR, SURVIVAL_KCAL, TWH_PER_GW_YEAR, YIELD_BASE_GROWTH,
} from './constants'
import { allocShares, clamp, effectiveBudget, event, incomeIdx, regionPop, sum, type RegionState, type World } from './state'
import type { LawEffects } from './society'

const KEYS: (keyof Budget)[] = ['food', 'energy', 'education', 'space', 'security', 'welfare', 'research']

export function monthlyRevenue(w: World): number {
  return w.revenueShare * sum(w.regions.filter(r => !r.seceded).map(r => r.r.gdpUsd)) / 12
}

// splits this month's revenue into per-region spending. space and research are central programs and
// are tracked on the world, the rest lands in regions.
export function allocate(w: World): { revenue: number; space: number; research: number } {
  const b = effectiveBudget(w)
  const revenue = monthlyRevenue(w)
  const shares = allocShares(w.regions)
  // migration bills come out of welfare
  w.migrationCostMonthly = w.migrationCostMonthly.filter(m => m.until > w.tick)
  const migBill = sum(w.migrationCostMonthly.map(m => m.usd))
  w.regions.forEach((rs, i) => {
    for (const k of KEYS) rs.spend[k] = b[k] * revenue * shares[i]
    rs.spend.welfare = Math.max(0, rs.spend.welfare - migBill * shares[i])
  })
  return { revenue, space: b.space * revenue, research: b.research * revenue }
}

export function stepEnergy(w: World, fx: Record<string, LawEffects>) {
  for (const rs of w.regions) {
    const pop = regionPop(rs)
    // retirement and maintenance
    rs.capacityTWh *= 1 - RETIRE_PER_YEAR / 12
    const om = rs.capacityTWh * OM_USD_PER_TWH / 12
    let capex = rs.spend.energy - om
    if (capex < 0) {
      // unfunded maintenance: plants fall out of service
      const unfunded = -capex / om
      rs.capacityTWh *= 1 - 0.005 * unfunded
      capex = 0
    }
    if (rs.seceded) capex = 0
    const costMult = 1 - 0.1 * (fx[rs.r.id]?.energy ?? 0)
    const gw = capex / (CAPEX_USD_PER_GW * costMult)
    if (gw > 0) rs.pipeline.push({ readyTick: w.tick + BUILD_MONTHS, twh: gw * TWH_PER_GW_YEAR })
    const ready = rs.pipeline.filter(p => p.readyTick <= w.tick)
    rs.capacityTWh += sum(ready.map(p => p.twh))
    rs.pipeline = rs.pipeline.filter(p => p.readyTick > w.tick)
    // demand grows with income per person; consumption can never exceed capacity
    const gdppc = rs.r.gdpUsd / Math.max(pop, 1)
    const demand = pop * rs.kwhpcBase * Math.pow(Math.max(gdppc, 1) / rs.gdppc0, ELEC_INCOME_ELASTICITY) / 1e9
    const consumption = Math.min(demand, rs.capacityTWh)
    rs.r.energyTWh = consumption
    rs.energyRatio = demand > 0 ? consumption / demand : 1
  }
}

export function stepFood(w: World, fx: Record<string, LawEffects>) {
  const b = effectiveBudget(w)
  const prod: number[] = []
  for (const rs of w.regions) {
    const pop = regionPop(rs)
    const spendPC = rs.spend.food * 12 / Math.max(pop, 1)
    // ESTIMATE: annual yield growth = base + spending (diminishing, ~$80/person/yr half-saturation)
    //   + tech + closing the yield gap where supply is low, minus unrest disruption
    const kcalNow = rs.r.foodKcalPerCapita
    const gy = YIELD_BASE_GROWTH + 0.01 * (1 - Math.exp(-spendPC / 80)) + 0.003 * rs.r.techLevel
      + 0.012 * Math.max(0, (2900 - kcalNow) / 1000) * rs.r.compliance
      + 0.003 * (fx[rs.r.id]?.food ?? 0) - 0.01 * Math.max(0, rs.r.unrest - 0.5)
    rs.yieldIdx *= 1 + gy / 12
    const drought = w.tick < rs.droughtUntil ? rs.droughtSev : 0
    // ESTIMATE: farm output scales with energy availability^0.25 (fertilizer, irrigation, transport)
    const p = rs.foodBase * rs.yieldIdx * Math.pow(rs.energyRatio, 0.25) * (1 - drought) * (rs.inRevolt ? 0.92 : 1)
    prod.push(Math.min(p, KCAL_CAP * pop))
  }
  // the world government pools part of every surplus above 2,700 kcal and ships it to regions under 2,400.
  // ESTIMATE: share pooled = 5% + 2 x food budget fraction, max 50%.
  const tau = clamp(0.05 + 2 * b.food, 0, 0.5)
  const pops = w.regions.map(regionPop)
  let pool = 0
  const avail = prod.slice()
  const contrib = prod.map(() => 0)
  w.regions.forEach((rs, i) => {
    if (rs.seceded) return
    const surplus = avail[i] - 2700 * pops[i]
    if (surplus > 0) { contrib[i] = surplus * tau; pool += contrib[i]; avail[i] -= contrib[i] }
  })
  const need = w.regions.map((rs, i) => (rs.seceded ? 0 : Math.max(0, 2400 * pops[i] - avail[i])))
  const needSum = sum(need)
  if (needSum > 0) {
    const give = Math.min(pool, needSum)
    w.regions.forEach((_, i) => { avail[i] += give * need[i] / needSum })
    pool -= give
  }
  // anything left in the pool goes back to donors pro rata
  const contribSum = sum(contrib)
  if (pool > 0 && contribSum > 0) w.regions.forEach((_, i) => { avail[i] += pool * contrib[i] / contribSum })
  w.regions.forEach((rs, i) => {
    const kcal = avail[i] / Math.max(pops[i], 1)
    rs.r.foodKcalPerCapita = kcal
    if (kcal < SURVIVAL_KCAL) rs.foodMonthsUnder++
    else rs.foodMonthsUnder = Math.max(0, rs.foodMonthsUnder - 2)
    if (kcal < SURVIVAL_KCAL && rs.foodMonthsUnder === 3) {
      event(w, { regionId: rs.r.id, kind: 'famine', text: `famine in ${rs.r.name}: food supply ${Math.round(kcal)} kcal per person per day`, severity: (SURVIVAL_KCAL - kcal) / SURVIVAL_KCAL * 3 })
    }
  })
}

// gdp per capita growth. called after demography so per-capita income is preserved through births and deaths.
export function stepEconomy(w: World, popBefore: number[]) {
  w.regions.forEach((rs, i) => {
    const pop = regionPop(rs)
    const gdppc = rs.r.gdpUsd / Math.max(popBefore[i], 1)
    const inc = incomeIdx(gdppc)
    const kcal = rs.r.foodKcalPerCapita
    // ESTIMATE: catch-up growth (poorer regions grow faster when institutions work) + tech, minus stress
    let g = 0.006 + 0.03 * (1 - inc) * rs.r.compliance + 0.012 * rs.r.techLevel
    g -= 0.1 * Math.max(0, rs.r.unrest - 0.4)
    g -= 0.5 * (1 - rs.energyRatio)
    g -= 0.6 * Math.max(0, (2100 - kcal) / 2100)
    if (rs.inRevolt) g -= 0.04
    g -= 0.1 * Math.max(0, w.revenueShare - 0.3)
    if (rs.seceded) g = Math.min(g, 0.005)
    rs.growth = g
    rs.r.gdpUsd = Math.max(gdppc * (1 + g / 12), 100) * pop
  })
}

// ---------- migration ----------

export type ScheduledMigration = { from: string; to: string; requested: number; actual: number; cost: number }

export function scheduleMigrations(w: World, list: Migration[], monthlyRevenue: number, welfareShare: number): ScheduledMigration[] {
  const out: ScheduledMigration[] = []
  // at most half of a year of welfare can be spent on relocation
  let budgetLeft = 0.5 * welfareShare * monthlyRevenue * 12
  for (const m of list) {
    const from = w.regions.find(r => r.r.id === m.from)
    const to = w.regions.find(r => r.r.id === m.to)
    if (!from || !to || from === to || from.seceded || to.seceded) continue
    const pop = regionPop(from)
    const requested = Math.max(0, Math.floor(m.people))
    let actual = Math.min(requested, pop * MIGRATION_MAX_SHARE_YEAR)
    // compliance caps who actually moves: people in low-compliance regions ignore relocation orders
    actual *= from.r.compliance
    actual = Math.min(actual, budgetLeft / MIGRATION_USD_PER_PERSON)
    actual = Math.floor(Math.max(0, actual))
    if (actual < 1) continue
    const cost = actual * MIGRATION_USD_PER_PERSON
    budgetLeft -= cost
    w.migrationCostMonthly.push({ until: w.tick + 12, usd: cost / 12 })
    // migrants skew working age (bands 15-49 weighted double)
    const wts = from.bands.map((b, i) => b * (i >= 3 && i <= 9 ? 2 : 1))
    const wsum = sum(wts)
    const bands = wts.map(x => actual * x / wsum)
    from.bands = from.bands.map((b, i) => Math.max(0, b - bands[i]))
    w.transit.push({ from: m.from, to: m.to, people: actual, bands, arriveTick: w.tick + MIGRATION_MONTHS })
    // ESTIMATE: unrest shock both sides, scaled by share of population moved plus a flat cost of forced relocation
    from.migrationShock += 3 * actual / pop + 0.02
    to.migrationShock += 2 * actual / regionPop(to) + 0.01
    event(w, { regionId: m.from, kind: 'migration', text: `relocation from ${from.r.name} to ${to.r.name}: ${fmt(actual)} of ${fmt(requested)} ordered are moving`, severity: clamp(actual / pop * 20) })
    out.push({ from: m.from, to: m.to, requested, actual, cost })
  }
  return out
}

export function stepArrivals(w: World) {
  const arriving = w.transit.filter(t => t.arriveTick <= w.tick)
  w.transit = w.transit.filter(t => t.arriveTick > w.tick)
  for (const t of arriving) {
    const to = w.regions.find(r => r.r.id === t.to)
    const from = w.regions.find(r => r.r.id === t.from)
    if (!to || !from) continue
    const before = regionPop(to)
    to.bands = to.bands.map((b, i) => b + t.bands[i])
    // arrivals bring their origin mix; regions mix over time
    const after = before + t.people
    for (const k of Object.keys(to.originMix)) to.originMix[k] *= before / after
    for (const [k, v] of Object.entries(from.originMix)) to.originMix[k] = (to.originMix[k] ?? 0) + v * t.people / after
  }
}

export function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`
  return String(Math.round(n))
}
