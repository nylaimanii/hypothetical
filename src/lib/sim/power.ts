// power and the premise: the core is a machine that runs on data centers, and people may not accept it.
// - the core's body: real data center hubs draw real power; outages, sabotage or a region in revolt cut its compute,
//   and with it how well laws get administered
// - resistance to rule by a machine grows with unrest, coercion, jobs lost to automation and low legitimacy
// - corruption leaks spending (Transparency International CPI seed); audits and transparency recover it
// - legitimacy: approval, performance and fair process; citizens' assemblies, referendums and transparency raise it,
//   propaganda buys a little for a while
// - elites hold wealth (top 1% share from the gini) and move or hide it when taxed or scared
// - automation takes tasks as tech and compute grow; UBI, retraining, job guarantees, robot taxes, shorter weeks
// - inequality (gini) tracked per country, region and world
// numbers are SOURCED with a link or marked ESTIMATE with the reasoning.
import { A } from './assumptions'
import { link, recentLink } from './causes'
import { addCrowd } from './behavior'
import { countryPop, countriesOf, type CountryState } from './places'
import { hashString } from './rng'
import { clamp, incomeIdx, regionPop, sum, type RegionState, type World } from './state'
import type { InfraDiff } from '../types-v5'

// ---------- the core's body: data center hubs ----------
// IEA Energy and AI (2025, https://www.iea.org/reports/energy-and-ai): data centres used ~415 TWh in 2024, ~45% in
// the US, ~25% China, ~15% Europe; demand ~945 TWh by 2030. hubs and their share of their country's capacity are
// ESTIMATE from public market reports (northern virginia is the largest market in the world)
export const DC_HUBS = [
  { id: 'dc_nova', name: 'Northern Virginia', countryId: 'USA', lat: 39.04, lon: -77.49, share: 0.25 },
  { id: 'dc_dallas', name: 'Dallas', countryId: 'USA', lat: 32.9, lon: -96.9, share: 0.1 },
  { id: 'dc_phoenix', name: 'Phoenix', countryId: 'USA', lat: 33.45, lon: -112.07, share: 0.08 },
  { id: 'dc_svalley', name: 'Silicon Valley', countryId: 'USA', lat: 37.37, lon: -121.92, share: 0.08 },
  { id: 'dc_hebei', name: 'Zhangjiakou, Hebei', countryId: 'CHN', lat: 40.77, lon: 114.88, share: 0.2 },
  { id: 'dc_guizhou', name: 'Gui\'an, Guizhou', countryId: 'CHN', lat: 26.4, lon: 106.6, share: 0.15 },
  { id: 'dc_shanghai', name: 'Shanghai', countryId: 'CHN', lat: 31.23, lon: 121.47, share: 0.15 },
  { id: 'dc_dublin', name: 'Dublin', countryId: 'IRL', lat: 53.35, lon: -6.26, share: 0.9 },
  { id: 'dc_frankfurt', name: 'Frankfurt', countryId: 'DEU', lat: 50.11, lon: 8.68, share: 0.5 },
  { id: 'dc_amsterdam', name: 'Amsterdam', countryId: 'NLD', lat: 52.37, lon: 4.9, share: 0.7 },
  { id: 'dc_london', name: 'London', countryId: 'GBR', lat: 51.51, lon: -0.13, share: 0.7 },
  { id: 'dc_singapore', name: 'Singapore', countryId: 'SGP', lat: 1.35, lon: 103.82, share: 1 },
  { id: 'dc_tokyo', name: 'Tokyo', countryId: 'JPN', lat: 35.68, lon: 139.69, share: 0.6 },
  { id: 'dc_mumbai', name: 'Mumbai', countryId: 'IND', lat: 19.08, lon: 72.88, share: 0.5 },
  { id: 'dc_saopaulo', name: 'Sao Paulo', countryId: 'BRA', lat: -23.55, lon: -46.63, share: 0.6 },
  { id: 'dc_sydney', name: 'Sydney', countryId: 'AUS', lat: -33.87, lon: 151.21, share: 0.5 },
  { id: 'dc_johannesburg', name: 'Johannesburg', countryId: 'ZAF', lat: -26.2, lon: 28.05, share: 0.6 },
  { id: 'dc_seoul', name: 'Seoul', countryId: 'KOR', lat: 37.57, lon: 126.98, share: 0.6 },
  { id: 'dc_lagos', name: 'Lagos', countryId: 'NGA', lat: 6.52, lon: 3.38, share: 0.6 },
  { id: 'dc_riyadh', name: 'Riyadh', countryId: 'SAU', lat: 24.71, lon: 46.68, share: 0.6 },
]
const DC_TWH_2024 = 415
const DC_SHARE: Record<string, number> = { USA: 0.45, CHN: 0.25 }

export type Hub = { id: string; twh: number; online: number; attackedTick: number }
export type CoreBody = { hubs: Hub[]; needTwh: number; capacity: number; built: number }
// country-level power state
export type Power = {
  corruption: number // share of spending that leaks, from the CPI
  automation: number; auto0: number; autoUnemp: number; jobsLostYear: number
  top1: number; top10?: number; hidden: number; fledYear: number
  legit: number; legit0: number; resistance: number
  ple0?: number; gdppc0?: number; autoApplied: number; jobLink?: string; movementTick?: number
}

// ---------- init ----------
export function initPower(w: World) {
  const eur = new Set(w.countries.filter(c => c.regionId === 'europe').map(c => c.id))
  const gdp = (ids: (c: CountryState) => boolean) => sum(w.countries.filter(ids).map(c => c.gdpUsd)) || 1
  const nationalTwh = (c: CountryState) => DC_TWH_2024 * (DC_SHARE[c.id] ?? (eur.has(c.id) ? 0.15 * c.gdpUsd / gdp(k => eur.has(k.id)) : 0.15 * c.gdpUsd / gdp(k => !eur.has(k.id) && !DC_SHARE[k.id])))
  // the core runs on ~10% of world data center capacity in 2026 (ESTIMATE: a world government's share), spread over hubs
  const hubs = DC_HUBS.map(h => { const c = w.countries.find(k => k.id === h.countryId); return { id: h.id, twh: c ? nationalTwh(c) * h.share : 1, online: 1, attackedTick: -999 } })
  const total = sum(hubs.map(h => h.twh))
  w.core = { hubs, needTwh: 0.1 * total, capacity: 1, built: 0 }
  for (const c of w.countries) {
    const inc = incomeIdx(c.gdpUsd / Math.max(countryPop(c), 1))
    // corruption ESTIMATE: leakage ~ 30% of spending at CPI 0, ~0 at CPI 100. reference points: Uganda's school grants
    // lost ~87% in 1991-95 (Reinikka & Svensson 2004, https://doi.org/10.1162/0033553041382120); Indonesian village
    // roads ~24% missing (Olken 2007, https://doi.org/10.1086/517935)
    const corruption = clamp(A(w, 'corruption_max_leak') * (100 - (c.seed.cpi || 40)) / 100, 0.01, 0.6)
    // automation ESTIMATE: share of tasks done by machines, ~12% in rich economies, ~3% where incomes are low
    // (IFR World Robotics robot densities, OECD Employment Outlook 2023)
    const automation = 0.03 + 0.1 * inc
    // top 1% income share ESTIMATE from the gini (World Inequality Database pattern: nordics ~9%, US ~19%, south africa ~20%+)
    const top1 = clamp(0.55 * (c.seed.gini || 0.38) - 0.06, 0.06, 0.35)
    const legit = clamp(0.3 + 0.4 * c.compliance + 0.2 * (c.happiness ?? 0.5))
    c.power = { corruption, automation, auto0: automation, autoUnemp: 0, jobsLostYear: 0, top1, hidden: 0.08, fledYear: 0, legit, legit0: legit, resistance: 0.05, autoApplied: 0 }
  }
  // 2026 outcomes already contain 2026 corruption and the 2026 pace of automation: the sim applies only changes from them
  for (const rs of w.regions) { rs.leak = regionAvg(w, rs, c => c.power.corruption); rs.leak0 = rs.leak; rs.powerMult = 1; rs.autoGrowth = 0; rs.flightDrag = 0; rs.tech0 = rs.r.techLevel }
}
const regionAvg = (w: World, rs: RegionState, f: (c: CountryState) => number) => {
  const cs = countriesOf(w, rs.r.id)
  const P = sum(cs.map(countryPop)) || 1
  return cs.length ? sum(cs.map(c => f(c) * countryPop(c))) / P : 0
}
const strongest = (w: World, rs: RegionState, kinds: string[]) => { let best = { c: 0, lawId: undefined as string | undefined }; for (const l of w.laws) if (!l.vetoed && kinds.includes(l.policyKind)) { const c = rs.lawCompliance[l.id] ?? 0; if (c > best.c) best = { c, lawId: l.id } } return best }
const pct = (x: number) => `${Math.round(x * 100)}%`
const fmt = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(0)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`
const u01 = (s: string) => (hashString(s) % 100000) / 100000

// ---------- yearly ----------
export function stepPower(w: World) {
  if (!w.core) return
  const year = Math.floor(w.tick / 12)
  // the core's need grows with what it governs (ESTIMATE ~+3%/yr like world compute demand, IEA) and is met by hubs
  w.core.needTwh *= 1.03
  const build = (w.laws.some(l => !l.vetoed && l.policyKind === 'data_center')) ? 0.15 : 0.05 // ESTIMATE: private buildout ~5%/yr, ~15% with a core buildout law
  for (const h of w.core.hubs) {
    const spec = DC_HUBS.find(x => x.id === h.id)!
    const c = w.countries.find(k => k.id === spec.countryId)
    const rs = c && w.regions.find(r => r.r.id === c.regionId)
    if (!c || !rs) continue
    const p = c.power
    // power: a hub needs its grid; shortages or a region in revolt take it offline
    let online = clamp(Math.min(1, rs.energyRatio) * (rs.inRevolt ? 0.3 : 1) * (rs.seceded ? 0 : 1) * (1 - 0.5 * c.damage))
    // sabotage: where resistance is strong, some hub is attacked in a year (anti-5G arson in the UK, 2020: ~80 masts
    // burned in months, https://en.wikipedia.org/wiki/5G_misinformation#Arson_attacks ; ESTIMATE odds = resistance^2)
    if (p.resistance > 0.3 && u01(`sab${h.id}${year}`) < p.resistance * p.resistance) {
      h.attackedTick = w.tick
      online *= 0.6
      const why = recentLink(w, rs.r.id, k => /protested.*(machine|core)|resistance/.test(k.what), 36) ?? recentLink(w, c.id, k => /rule by a machine took hold/.test(k.what), 120)
      const k = link(w, { placeId: c.id, what: `saboteurs hit the ${spec.name} data center, the core lost ${Math.round(h.twh * 0.4)} TWh of compute`, value: 0.6, because: why ? why.what : `resistance to rule by a machine at ${pct(p.resistance)} in ${c.name}`, byWhom: 'people', causeIds: why ? [why.id] : [] })
      w.infraAcc.push({ tick: w.tick, kind: 'datacenter', op: 'attacked', id: h.id, because: k.what } as InfraDiff)
    }
    h.online = online
    h.twh *= 1 + build * (1 - rs.r.unrest)
  }
  const avail = sum(w.core.hubs.map(h => h.twh * h.online)) * 0.1
  const cap = clamp(avail / Math.max(w.core.needTwh, 1e-6), 0, 1.5)
  if (cap < 0.85 && w.core.capacity >= 0.85) link(w, { placeId: 'world', what: `the core is running on ${pct(cap)} of the compute it needs`, value: 0.7, because: 'data centers offline or attacked', byWhom: 'core' })
  w.core.capacity = cap

  for (const rs of w.regions) {
    const cs = countriesOf(w, rs.r.id)
    if (!cs.length) continue
    const audit = strongest(w, rs, ['anticorruption', 'transparency'])
    const fair = strongest(w, rs, ['citizens_assembly', 'referendum', 'transparency'])
    const prop = strongest(w, rs, ['propaganda'])
    const ubi = strongest(w, rs, ['basic_income']), retrain = strongest(w, rs, ['retraining', 'job_guarantee']), robotTax = strongest(w, rs, ['robot_tax', 'automation_limit'])
    const shortWeek = strongest(w, rs, ['shorter_week'])
    const wtax = strongest(w, rs, ['wealth_tax', 'expropriation']), controls = strongest(w, rs, ['capital_controls'])
    const secRatio = clamp(rs.spend.security * 12 / Math.max(regionPop(rs), 1) / Math.max(rs.pc0.security, 1), 0.3, 4)
    let lostR = 0
    for (const c of cs) {
      const p = c.power, pop = countryPop(c)
      if (!p || pop <= 0) continue
      const inc = incomeIdx(c.gdpUsd / pop)
      // corruption: audits and transparency cut leakage up to ~70% (Uganda's newspaper campaign cut grant capture from
      // ~80% to ~20%; Olken's audits cut missing road funds by ~8 points); it creeps back ~2%/yr without them
      const c0 = clamp(A(w, 'corruption_max_leak') * (100 - (c.seed.cpi || 40)) / 100, 0.01, 0.6)
      const prevC = p.corruption
      p.corruption = clamp(p.corruption + (c0 * (1 - 0.7 * audit.c) - p.corruption) * 0.3, 0.005, 0.4)
      if (c0 - p.corruption > 0.05 && c0 - prevC <= 0.05) link(w, { placeId: c.id, what: `leakage from public spending in ${c.name} fell to ${pct(p.corruption)}`, value: 0.45, because: 'audits and published budgets', byWhom: 'core', lawId: audit.lawId })
      // automation: tasks shift to machines with tech, compute and labor costs (ESTIMATE ~+0.4 points a year in rich
      // economies at 2026 tech, faster as tech rises); robot taxes and limits slow it (South Korea cut its automation
      // tax credit in 2017)
      const dA = (0.002 + A(w, 'automation_pace') * rs.r.techLevel) * (0.3 + inc) * Math.min(1, w.core.capacity) * (1 - 0.6 * robotTax.c) * (1 - p.automation)
      // the 2026 pace (same formula at 2026 tech): its churn is already in 2026 unemployment and growth
      const dA0 = (0.002 + A(w, 'automation_pace') * (rs.tech0 ?? rs.r.techLevel)) * (0.3 + inc) * (1 - p.automation)
      p.automation = clamp(p.automation + dA, 0, 0.95)
      // jobs: each point of tasks automated displaces ~a point of the workforce (Acemoglu & Restrepo 2020: one robot per
      // thousand workers cut employment-to-population by ~0.2 points, https://doi.org/10.1086/705716); most are
      // re-absorbed within years, faster with retraining or a job guarantee (Denmark flexicurity)
      const mix = c.seed.local.jobMix
      const exposed = 0.3 * mix.agriculture + 0.6 * mix.industry + 0.45 * mix.services
      const workers = pop * 0.45
      const lost = workers * dA * exposed * 2
      p.jobsLostYear = lost; lostR += lost
      const excess = workers * (dA - dA0) * exposed * 2
      p.autoUnemp = clamp(p.autoUnemp + excess / workers - p.autoUnemp * (0.25 + 0.35 * retrain.c) - 0.02 * shortWeek.c, -0.03, 0.3)
      // jobs lost to machines show up in the country's unemployment
      c.unemployment = clamp(c.unemployment + p.autoUnemp - p.autoApplied, 0.01, 0.6)
      p.autoApplied = p.autoUnemp
      // a story only when displacement runs well above the 2026 pace (the normal churn is not news)
      if (excess > 0.003 * workers && lost > 5e5) {
        const k = link(w, { placeId: c.id, what: `machines took ${fmt(lost)} jobs in ${c.name} this year`, value: clamp(lost / workers * 80), because: `automation at ${pct(p.automation)} of tasks`, byWhom: 'market' })
        p.jobLink = k.id
        if (p.autoUnemp > 0.03 && ubi.c < 0.3) addCrowd(rs, w, { topic: 'machines taking jobs', peak: clamp(p.autoUnemp * 3), outrageMonths: 4, causeId: k.id })
      }
      // elites: the top 1% share rises with automation (capital earns what machines do) and falls with wealth taxes;
      // wealth taxes, expropriation and unrest make money leave or hide (Norway's 2022 wealth tax rise: ~30 of its
      // richest moved to Switzerland; Zucman 2013: ~8% of household financial wealth sits offshore,
      // https://doi.org/10.1093/qje/qjt012). capital controls slow it
      p.top1 = clamp(p.top1 + 0.3 * dA - 0.01 * wtax.c, 0.04, 0.5)
      const scare = 0.5 * wtax.c + Math.max(0, c.unrest - 0.45) + 0.3 * Math.max(0, p.resistance - 0.4)
      const flee = clamp(0.03 * scare * (1 - 0.7 * controls.c))
      p.hidden = clamp(p.hidden + flee - 0.05 * (p.hidden - 0.08) * (1 + controls.c), 0.02, 0.6)
      p.fledYear = flee * p.top1 * c.gdpUsd * 4 // ESTIMATE: elite wealth ~4x their income
      if (flee > 0.01 && p.fledYear > 5e9) link(w, { placeId: c.id, what: `${fmt(p.fledYear)} of private wealth left or went into hiding from ${c.name}`, value: clamp(flee * 20), because: wtax.c > 0.2 ? 'wealth tax' : 'fear of unrest', byWhom: 'faction:business', lawId: wtax.c > 0.2 ? wtax.lawId : undefined })
      // inequality: automation shifts income to capital (+), UBI and redistribution pull the gini down
      if (c.daily) c.daily.gini = clamp(c.daily.gini + 0.15 * dA - 0.01 * ubi.c, 0.18, 0.75)
      // legitimacy: approval and results, fair process raises it, coercion and corruption drain it; propaganda adds a
      // little that fades. ESTIMATE weights (procedural fairness matters as much as outcomes: Tyler, Why People Obey the Law)
      p.ple0 ??= c.ple || 70
      const perf = clamp(0.5 + 0.05 * ((c.ple || 70) - p.ple0) + 0.5 * Math.log(Math.max(c.gdpUsd / pop, 1) / Math.max(p.gdppc0 ??= c.gdpUsd / pop, 1)))
      const target = clamp(0.35 * rs.r.approval + 0.2 * perf + 0.2 * fair.c + 0.1 * prop.c - 0.15 * Math.max(0, secRatio - 1) - 0.5 * p.corruption + 0.2)
      p.legit += (target - p.legit) * 0.25
      // resistance to rule by a machine: Luddite-style when machines take jobs (the 1811-16 machine breakers; the
      // government sent ~12,000 troops), plus unrest, coercion and low legitimacy. ESTIMATE weights
      const resTarget = clamp(0.5 * Math.max(0, c.unrest - 0.25) + 3 * Math.max(0, p.autoUnemp) + 0.15 * Math.max(0, secRatio - 1.5) + 0.8 * Math.max(0, 0.5 - p.legit) + 0.05 * (c.seed.faith ?? 0.5) * (w.religionPolicy === 'discouraged' ? 1 : 0))
      const prevR = p.resistance
      p.resistance = clamp(p.resistance + (resTarget - p.resistance) * 0.4)
      if (p.resistance > 0.25 && prevR <= 0.25 && w.tick - (p.movementTick ?? -999) >= 120) {
        p.movementTick = w.tick
        const why = p.autoUnemp > 0.03 && p.jobLink ? p.jobLink : recentLink(w, rs.r.id, k => /protested|riot|crackdown|law/.test(k.what) && k.placeId !== 'world', 36)?.id
        const k = link(w, { placeId: c.id, what: `a movement against rule by a machine took hold in ${c.name}`, value: 0.55, because: p.autoUnemp > 0.03 ? 'jobs lost to automation' : p.legit < 0.4 ? `legitimacy down to ${pct(p.legit)}` : 'unrest', byWhom: 'people', causeIds: why ? [why] : [] })
        addCrowd(rs, w, { topic: 'rule by a machine', peak: clamp(p.resistance), outrageMonths: 6, causeId: k.id })
      }
    }
    // what the region gets from all this
    rs.leak = regionAvg(w, rs, c => c.power.corruption)
    const legit = regionAvg(w, rs, c => c.power.legit), legit0 = regionAvg(w, rs, c => c.power.legit0), resist = regionAvg(w, rs, c => c.power.resistance)
    // laws get administered by the core: compliance scales with its compute (down to 60% with none), legitimacy and resistance
    rs.powerMult = clamp((0.6 + 0.4 * Math.min(1, w.core.capacity)) * (1 + 0.4 * (legit - legit0)) * (1 - 0.3 * resist), 0.3, 1.2)
    // productivity from automation (Graetz & Michaels 2018: robots added ~0.37 points a year to labor productivity growth,
    // https://doi.org/10.1162/rest_a_00754), capital flight drags growth
    rs.autoGrowth = 0.4 * (0.008 * (rs.r.techLevel - (rs.tech0 ?? rs.r.techLevel))) * Math.min(1, w.core.capacity)
    rs.flightDrag = regionAvg(w, rs, c => 0.2 * Math.max(0, c.power.hidden - 0.08))
    void lostR
  }
  w.hiddenLoss = hiddenTaxLoss(w)
}

// share of the tax base hidden offshore beyond the 2026 ~8%: revenue lost
export function hiddenTaxLoss(w: World): number {
  if (!w.countries[0]?.power) return 0
  const G = sum(w.countries.map(c => c.gdpUsd)) || 1
  return clamp(sum(w.countries.map(c => c.gdpUsd * Math.max(0, c.power.hidden - 0.08))) / G, 0, 0.5)
}

// world inequality: gini over everyone, from each country's lognormal income (20 quantiles each)
export function worldGini(w: World): number {
  const pts: { y: number; p: number }[] = []
  for (const c of w.countries) {
    const pop = countryPop(c)
    if (pop <= 0) continue
    const g = c.daily?.gini ?? c.seed.gini ?? 0.38, mean = c.gdpUsd / pop
    const s = Math.SQRT2 * invPhi((clamp(g, 0.15, 0.75) + 1) / 2)
    for (let q = 0; q < 20; q++) { const z = invPhi((q + 0.5) / 20); pts.push({ y: mean * Math.exp(s * z - s * s / 2), p: pop / 20 }) }
  }
  pts.sort((a, b) => a.y - b.y)
  const P = sum(pts.map(x => x.p)), Y = sum(pts.map(x => x.y * x.p))
  let cp = 0, cy = 0, area = 0
  for (const x of pts) { const np = cp + x.p / P, ny = cy + x.y * x.p / Y; area += (np - cp) * (ny + cy); cp = np; cy = ny }
  return 1 - area
}
function invPhi(p: number): number {
  // Acklam's rational approximation
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const q = Math.min(p, 1 - p)
  if (q < 0.02425) { const t = Math.sqrt(-2 * Math.log(q)); const x = (((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1); return p < 0.5 ? x : -x }
  const t = p - 0.5, r = t * t
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

export function powerLines(w: World): string[] {
  if (!w.core || !w.countries[0]?.power) return []
  const cs = w.countries
  const P = sum(cs.map(countryPop)) || 1
  const avg = (f: (c: CountryState) => number) => sum(cs.map(c => f(c) * countryPop(c))) / P
  const big = cs.filter(c => countryPop(c) > 5e6)
  const resist = [...big].sort((a, b) => b.power.resistance - a.power.resistance)[0]
  const corrupt = [...big].sort((a, b) => b.power.corruption - a.power.corruption)[0]
  const down = w.core.hubs.filter(h => h.online < 0.7).map(h => DC_HUBS.find(x => x.id === h.id)!.name)
  const jobs = sum(cs.map(c => c.power.jobsLostYear))
  return [
    `core compute ${pct(w.core.capacity)} of need${down.length ? `, offline: ${down.slice(0, 3).join(', ')}` : ''}; resistance to machine rule ${pct(avg(c => c.power.resistance))} (highest ${resist.name} ${pct(resist.power.resistance)}), legitimacy ${pct(avg(c => c.power.legit))}`,
    `corruption leaks ${pct(avg(c => c.power.corruption))} of spending (worst ${corrupt.name}); automation ${pct(avg(c => c.power.automation))} of tasks, ${fmt(jobs)} jobs lost last year`,
    `inequality: world gini ${worldGini(w).toFixed(2)}, top 1% earn ${pct(avg(c => c.power.top1))}, wealth hidden offshore ${pct(avg(c => c.power.hidden))}`,
  ]
}
