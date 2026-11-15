// demography: 17 five-year age bands per region. deaths follow a Gompertz curve calibrated to the sourced
// crude death rate, split by cause (WHO GHE shares) so medicine can cut specific causes. births come from
// fertility x women 15-49, with fertility driven by income, education, housing, child costs and optimism.
// period life expectancy is computed from the age-specific mortality every month with a standard life table.
import { MAX_MORTALITY_DECLINE_YEAR, SURVIVAL_KCAL, TFR_DECLINE, TFR_FLOOR } from './constants'
import { reqProgress } from './requirements'
import { BAND_MID, CAUSE_SHARE, NBANDS, clamp, incomeIdx, regionPop, sum, why, type Cause, type RegionState, type World } from './state'
import type { LawEffects } from './society'

// mortality multiplier from the food supply. ESTIMATE: below 2,300 kcal undernourishment adds up to 30%;
// under the 1,800 survival threshold mortality rises with the deficit and with how long it has lasted.
export function foodMortality(kcal: number, monthsUnder: number): number {
  let m = 1
  if (kcal < 2300) m += 0.3 * clamp((2300 - kcal) / 500)
  if (kcal < SURVIVAL_KCAL) {
    const deficit = (SURVIVAL_KCAL - kcal) / SURVIVAL_KCAL
    m += 6 * deficit * clamp(monthsUnder / 6)
  }
  return m
}

const fWelfare = (pc: number) => 1 - Math.exp(-pc / 3000)

// which requirement nodes cut which causes (ESTIMATE: max cut at full progress)
const CAUSE_NODES: Record<Cause, [string, number][]> = {
  cardio: [['cardio', 0.6], ['metabolic', 0.15]],
  cancer: [['cancer', 0.6], ['gene_therapy', 0.1]],
  neuro: [['neuro', 0.6]],
  metabolic: [['metabolic', 0.5]],
  infectious: [['vaccines_next', 0.2], ['malaria_eradication', 0.2], ['tb_eradication', 0.15], ['hiv_cure', 0.08], ['universal_primary_care', 0.15], ['clean_water_access', 0.1]],
  injury: [['universal_primary_care', 0.15]],
  other: [['organ_regen', 0.4], ['senescence', 0.2]],
}
const SPECULATIVE_LONGEVITY = ['senescence', 'immune_aging', 'reprogramming', 'organ_regen', 'lifespan_200']

// monthly update of medical progress per region. delivery depends on welfare (health systems) and medicine companies.
// historical cap: mortality may fall at most 2.5%/yr (+2%/yr per finished speculative longevity node).
export function stepMedicine(w: World, medicineStrength: number) {
  const specDone = SPECULATIVE_LONGEVITY.filter(id => reqProgress(w, id) >= 1).length
  const maxDecline = (MAX_MORTALITY_DECLINE_YEAR + 0.02 * specDone) / 12
  for (const rs of w.regions) {
    const pop = Math.max(regionPop(rs), 1)
    const delivery = clamp(0.3 + 0.6 * fWelfare(rs.spend.welfare * 12 / pop) + 0.2 * medicineStrength)
    for (const c of Object.keys(CAUSE_NODES) as Cause[]) {
      const cut = CAUSE_NODES[c].reduce((a, [id, m]) => a + m * reqProgress(w, id), 0)
      const target = Math.max(0.05, 1 - clamp(cut) * delivery)
      const cur = rs.causeMult[c]
      // can only fall at the capped rate, can rise back fast if health systems collapse
      rs.causeMult[c] = target < cur ? Math.max(target, cur * (1 - maxDecline)) : cur + (target - cur) * 0.05
    }
    // aging itself only slows through speculative tech. lifespan_200 can cut the Gompertz slope by up to 75%
    const slow = 0.15 * reqProgress(w, 'senescence') + 0.1 * reqProgress(w, 'immune_aging') + 0.2 * reqProgress(w, 'reprogramming') + 0.3 * reqProgress(w, 'lifespan_200')
    const targetSlope = 0.09 * (1 - clamp(slow, 0, 0.75) * delivery)
    rs.agingSlope += (targetSlope - rs.agingSlope) * 0.01
    // nobody has verifiably lived past 122: the open 80+ band keeps a mortality floor (mean remaining life
    // at 80 at most 20 years) until reprogramming and lifespan_200 remove it
    const floorRelax = clamp(reqProgress(w, 'reprogramming') * 0.5 + reqProgress(w, 'lifespan_200'))
    rs.oldAgeFloor = (1 / 20) * (1 - 0.95 * floorRelax)
  }
}

export function annualMortality(rs: RegionState, i: number, mult: number): number {
  const age = BAND_MID[i]
  const g = rs.gompertzA * Math.exp(rs.agingSlope * (age - 60))
  // cause mix: infectious and injury weigh more at young ages (ESTIMATE)
  const young = age < 40 ? 1 : 0
  let causeMix = 0
  let shareSum = 0
  for (const c of Object.keys(CAUSE_SHARE) as Cause[]) {
    const s = CAUSE_SHARE[c] * (young && (c === 'infectious' || c === 'injury') ? 3 : 1)
    causeMix += s * rs.causeMult[c]
    shareSum += s
  }
  let m = (g * causeMix / shareSum + (i === 0 ? rs.infantMort * rs.causeMult.infectious : 0)) * mult
  if (i === NBANDS - 1) m = Math.max(m, rs.oldAgeFloor)
  return m
}

// period life expectancy at birth from current age-specific mortality (5-year life table, open last band)
export function periodLifeExpectancy(rs: RegionState, mult: number, pandemic: number): number {
  let l = 1, e = 0
  for (let i = 0; i < NBANDS; i++) {
    const m = annualMortality(rs, i, mult) + pandemic * (0.2 + 1.6 * BAND_MID[i] / 85)
    if (i === NBANDS - 1) { e += l / Math.max(m, 1e-4); break }
    const n = 5
    const q = 1 - Math.exp(-n * m)
    const lNext = l * (1 - q)
    e += n * (l + lNext) / 2
    l = lNext
  }
  return e
}

export function stepDemography(w: World, fx: Record<string, LawEffects>): { births: number; deaths: number } {
  let births = 0, deaths = 0
  for (const rs of w.regions) {
    const pop = regionPop(rs)
    if (pop <= 0) continue
    const kcal = rs.r.foodKcalPerCapita
    const welfarePC = rs.spend.welfare * 12 / pop
    // ESTIMATE: health and social spending cut mortality up to 15% at saturation, relative to 2026 levels
    const welfareMult = (1 - 0.15 * fWelfare(welfarePC)) / (1 - 0.15 * fWelfare(rs.pc0.welfare))
    const foodMult = foodMortality(kcal, rs.foodMonthsUnder)
    const lawMult = 1 - 0.02 * (fx[rs.r.id]?.redistributive ?? 0)
    // riots and crackdowns kill (ESTIMATE: 1 in 10,000 rioters per month)
    const mult = welfareMult * foodMult * lawMult
    const pandemic = w.tick < rs.pandemicUntil ? rs.pandemicMort * (1 - 0.5 * reqProgress(w, 'pandemic_preparedness')) : 0
    const dead = new Array(NBANDS).fill(0)
    let baseDead = 0
    for (let i = 0; i < NBANDS; i++) {
      const pw = pandemic * (0.2 + 1.6 * BAND_MID[i] / 85)
      const base = annualMortality(rs, i, welfareMult * lawMult)
      const annual = annualMortality(rs, i, mult) + pw
      dead[i] = rs.bands[i] * (1 - Math.exp(-annual / 12))
      baseDead += rs.bands[i] * (1 - Math.exp(-base / 12))
    }
    const totalDead = sum(dead)
    const famine = Math.max(0, totalDead - baseDead - sum(rs.bands.map((b, i) => b * pandemic * (0.2 + 1.6 * BAND_MID[i] / 85) / 12)))
    rs.famineDeaths += famine
    w.humanCost.famineDeaths += famine
    w.humanCost.deaths += Math.max(0, totalDead - baseDead)
    const riotDeaths = pop * rs.behavior.rioting * 1e-4
    w.humanCost.unrestDeaths += riotDeaths
    w.humanCost.deaths += riotDeaths
    why(rs, 'population', 'deaths', -totalDead)
    if (famine > 1) why(rs, 'population', 'hunger deaths', -famine, 'https://www.fao.org/3/i4646e/i4646e.pdf')
    if (pandemic > 0) why(rs, 'population', 'pandemic deaths', -sum(rs.bands.map((b, i) => b * pandemic * (0.2 + 1.6 * BAND_MID[i] / 85) / 12)), 'https://doi.org/10.1073/pnas.2105482118')

    // ---------- fertility ----------
    // long-run decline toward a floor, faster with education (UN WPP trend)
    const eduPull = 1 + 1.5 * Math.max(0, rs.r.education - rs.base.education)
    rs.tfr += (TFR_FLOOR - rs.tfr) * TFR_DECLINE * eduPull / 12
    // pro-natal policy is a level shift calibrated to real results: Hungary ~+0.25, France ~+0.2, Korea ~0.
    // ESTIMATE: the strongest family law's precedent effect x its compliance, phased in over ~2 years
    let pn = 0
    for (const l of w.laws) {
      const meta = w.lawMeta[l.id]
      if (l.vetoed || !meta || !meta.tfrEffect) continue
      const e = meta.tfrEffect * (rs.lawCompliance[l.id] ?? 0) / Math.max(rs.r.compliance, 0.05)
      if (Math.abs(e) > Math.abs(pn)) pn = e
    }
    const target = clamp(pn, -1, 0.3)
    rs.pronatal += (target - rs.pronatal) / 24
    // housing and child costs: affordable housing and childcare progress, rising population pressure (ESTIMATE)
    const housing = -0.15 * clamp(rs.r.population / Math.max(rs.pop0, 1) - 1) * (1 - reqProgress(w, 'affordable_housing'))
      + 0.08 * reqProgress(w, 'universal_childcare')
    // optimism: hope above baseline raises births a little (starting_family behavior), fear lowers them
    const optimism = 0.4 * (rs.mood.hope - 0.4) - 0.3 * Math.max(0, rs.mood.fear - 0.3)
    const inc = incomeIdx(rs.r.gdpUsd / pop)
    const effTfr = clamp(rs.tfr + rs.pronatal + housing + optimism * (0.5 + 0.5 * (1 - inc)), 0.5, 7)
    rs.r.fertility = effTfr
    const women = 0.5 * sum(rs.bands.slice(3, 10))
    // ESTIMATE: hunger suppresses births (deficit below 2,100 kcal cuts conception proportionally)
    const hunger = clamp((2100 - kcal) / 2100)
    const born = effTfr / 35 * women * (1 - hunger) / 12
    why(rs, 'population', 'births', born)
    why(rs, 'fertility', 'long-run decline', (TFR_FLOOR - rs.tfr) * TFR_DECLINE * eduPull / 12, 'https://population.un.org/wpp/')
    if (Math.abs(rs.pronatal) > 0.005) why(rs, 'fertility', 'family policy', rs.pronatal, 'https://en.wikipedia.org/wiki/Demographics_of_Hungary')
    if (Math.abs(housing) > 0.005) why(rs, 'fertility', 'housing and child costs', housing)
    if (Math.abs(optimism) > 0.01) why(rs, 'fertility', 'optimism', optimism)

    // ageing: 1/60 of each band moves up each month
    const next = rs.bands.map((b, i) => b - dead[i])
    const moved = next.map((b, i) => (i < NBANDS - 1 ? b / 60 : 0))
    for (let i = 0; i < NBANDS; i++) {
      next[i] -= moved[i]
      if (i > 0) next[i] += moved[i - 1]
    }
    next[0] += born
    rs.bands = next.map(b => Math.max(0, b))
    births += born
    deaths += totalDead

    // ---------- life expectancy ----------
    const ple = periodLifeExpectancy(rs, mult, pandemic)
    const prev = rs.periodLE || ple
    rs.periodLE = ple
    rs.leTrend += ((ple - prev) * 12 - rs.leTrend) * 0.05
    // ESTIMATE: cohort life expectancy at birth ~ period LE plus ~25 years of continued improvement at the current trend
    rs.cohortLE = ple + 25 * Math.max(0, rs.leTrend)
    why(rs, 'periodLifeExpectancy', 'medicine and health systems', (ple - prev) - 0, 'https://doi.org/10.1126/science.1069675')
    // disease burden: ESTIMATE index from infectious mortality and pandemics
    rs.diseaseBurden = clamp(0.5 * rs.causeMult.infectious * (rs.infantMort * 50) + 20 * pandemic)
  }
  return { births, deaths }
}

// one-off deaths (disasters, war) spread across ages
export function killShare(bands: number[], share: number): number[] {
  return bands.map(b => b * (1 - clamp(share)))
}
