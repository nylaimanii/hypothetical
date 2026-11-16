// demography: 17 five-year age bands per region. deaths follow a Gompertz curve calibrated to the sourced
// crude death rate, split by cause (WHO GHE shares) so medicine can cut specific causes. births come from
// fertility x women 15-49, with fertility driven by income, education, housing, child costs and optimism.
// period life expectancy is computed from the age-specific mortality every month with a standard life table.
import { MAX_MORTALITY_DECLINE_YEAR, SURVIVAL_KCAL, TFR_DECLINE, TFR_FLOOR } from './constants'
import { reqProgress } from './requirements'
import { BAND_MID, CAUSE_SHARE, NBANDS, clamp, incomeIdx, regionPop, sum, why, type Cause, type RegionState, type World } from './state'
import type { LawEffects } from './society'
import { countriesOf, countryPop, syncRegion } from './places'

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
  for (const rs of w.regions) {
    // catch-up: up to +3%/yr extra for regions far below an 80 year life expectancy
    const maxDecline = (MAX_MORTALITY_DECLINE_YEAR + 0.03 * clamp((80 - (rs.periodLE || 70)) / 25) + 0.02 * specDone) / 12
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

export type MortalityParams = Pick<RegionState, 'gompertzA' | 'infantMort' | 'agingSlope' | 'causeMult' | 'oldAgeFloor'>
export function annualMortality(rs: MortalityParams, i: number, mult: number): number {
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
export function periodLifeExpectancy(rs: MortalityParams, mult: number, pandemic: number): number {
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

// one demographic unit: a country (or a region that has no country data)
type Unit = { bands: number[]; tfr: number; gompertzA: number; infantMort: number; kcal: number; monthsUnder: number; ple: number; pop: () => number; homeMort: number; homeTfr: number }

export function stepDemography(w: World, fx: Record<string, LawEffects>): { births: number; deaths: number } {
  let births = 0, deaths = 0
  for (const rs of w.regions) {
    const pop = regionPop(rs)
    if (pop <= 0) continue
    const welfarePC = rs.spend.welfare * 12 / pop
    // ESTIMATE: health and social spending cut mortality up to 15% at saturation, relative to 2026 levels
    const welfareMult = (1 - 0.15 * fWelfare(welfarePC)) / (1 - 0.15 * fWelfare(rs.pc0.welfare))
    // health laws: primary care and vaccination drives cut mortality as they are followed, most where health is poorest.
    // ESTIMATE up to -60% at full compliance in a region at 55 years of life expectancy, phased in over ~5 years;
    // china's rural health campaigns are the reference (life expectancy ~44 in 1960 to ~68 by 1985)
    // https://en.wikipedia.org/wiki/Barefoot_doctor
    const healthTarget = 0.6 * Math.sqrt(fx[rs.r.id]?.health ?? 0) * clamp((85 - (rs.periodLE || 70)) / 30)
    rs.healthLaw += (healthTarget - rs.healthLaw) / 60
    const lawMult = (1 - 0.02 * (fx[rs.r.id]?.redistributive ?? 0)) * (1 - rs.healthLaw)
    const pandemic = w.tick < rs.pandemicUntil ? rs.pandemicMort * (1 - 0.5 * reqProgress(w, 'pandemic_preparedness')) : 0
    // ---------- region-wide fertility drivers ----------
    const eduPull = 1 + 1.5 * Math.max(0, rs.r.education - rs.base.education)
    // pro-natal policy is a level shift calibrated to real results: Hungary ~+0.25, France ~+0.2, Korea ~0.
    // ESTIMATE: the strongest family law's precedent effect x its compliance, phased in over ~2 years
    let pn = 0
    for (const l of w.laws) {
      const meta = w.lawMeta[l.id]
      if (l.vetoed || !meta || !meta.tfrEffect) continue
      const e = meta.tfrEffect * (rs.lawCompliance[l.id] ?? 0) / Math.max(rs.r.compliance, 0.05)
      if (Math.abs(e) > Math.abs(pn)) pn = e
    }
    rs.pronatal += (clamp(pn, -1, 0.3) - rs.pronatal) / 24
    // housing and child costs: affordable housing and childcare progress, rising population pressure (ESTIMATE)
    const housing = -0.15 * clamp(rs.r.population / Math.max(rs.pop0, 1) - 1) * (1 - reqProgress(w, 'affordable_housing'))
      + 0.08 * reqProgress(w, 'universal_childcare')
    // optimism: hope above baseline raises births a little (starting_family behavior), fear lowers them
    const optimism = 0.4 * (rs.mood.hope - 0.4) - 0.3 * Math.max(0, rs.mood.fear - 0.3)
    const inc = incomeIdx(rs.r.gdpUsd / pop)
    const tfrShift = rs.pronatal + housing + optimism * (0.5 + 0.5 * (1 - inc))

    // the units: this region's countries, each with its own calibrated mortality, fertility and food supply
    const cs = countriesOf(w, rs.r.id)
    const units: Unit[] = cs.length
      ? cs.map(c => ({ bands: c.bands, tfr: c.tfr, gompertzA: c.gompertzA, infantMort: c.infantMort, kcal: c.kcal, monthsUnder: c.foodMonthsUnder, ple: c.ple, pop: () => countryPop(c), homeMort: (c.housing?.mortMult ?? 1) * (c.daily?.mortMult ?? 1), homeTfr: c.housing?.tfrMult ?? 1 }))
      : [{ bands: rs.bands, tfr: rs.tfr, gompertzA: rs.gompertzA, infantMort: rs.infantMort, kcal: rs.r.foodKcalPerCapita, monthsUnder: rs.foodMonthsUnder, ple: rs.periodLE, pop: () => regionPop(rs), homeMort: 1, homeTfr: 1 }]
    let rTotalDead = 0, rFamine = 0, rPandemicDead = 0, rBorn = 0, wTfr = 0, wPle = 0, wPop = 0
    units.forEach((u, ui) => {
      const params = { gompertzA: u.gompertzA, infantMort: u.infantMort, agingSlope: rs.agingSlope, causeMult: rs.causeMult, oldAgeFloor: rs.oldAgeFloor }
      const foodMult = foodMortality(u.kcal, u.monthsUnder)
      // housing (slums, camps) is part of the baseline, not famine; its excess over 2026 is counted on its own
      const mult = welfareMult * foodMult * lawMult * u.homeMort
      const dead = new Array(NBANDS).fill(0)
      let baseDead = 0, pandemicDead = 0
      for (let i = 0; i < NBANDS; i++) {
        const pw = pandemic * (0.2 + 1.6 * BAND_MID[i] / 85)
        const base = annualMortality(params, i, welfareMult * lawMult * u.homeMort)
        if (u.homeMort !== 1) { const hd = u.bands[i] * (annualMortality(params, i, welfareMult * lawMult * u.homeMort) - annualMortality(params, i, welfareMult * lawMult)) / 12; w.housingDeaths += hd; w.humanCost.deaths += Math.max(0, hd) }
        const annual = annualMortality(params, i, mult) + pw
        dead[i] = u.bands[i] * (1 - Math.exp(-annual / 12))
        baseDead += u.bands[i] * (1 - Math.exp(-base / 12))
        pandemicDead += u.bands[i] * pw / 12
      }
      const totalDead = sum(dead)
      const famine = Math.max(0, totalDead - baseDead - pandemicDead)
      rTotalDead += totalDead; rFamine += famine; rPandemicDead += pandemicDead
      w.humanCost.deaths += Math.max(0, totalDead - baseDead)
      // fertility: long-run decline toward a floor (UN WPP trend), plus the region's policy and mood shift
      u.tfr += (TFR_FLOOR - u.tfr) * TFR_DECLINE * eduPull / 12
      const effTfr = clamp((u.tfr + tfrShift) * u.homeTfr, 0.5, 7)
      const women = 0.5 * sum(u.bands.slice(3, 10))
      // ESTIMATE: hunger suppresses births (deficit below 2,100 kcal cuts conception proportionally)
      const born = effTfr / 35 * women * (1 - clamp((2100 - u.kcal) / 2100)) / 12
      rBorn += born
      // ageing: 1/60 of each band moves up each month
      const next = u.bands.map((b, i) => b - dead[i])
      const moved = next.map((b, i) => (i < NBANDS - 1 ? b / 60 : 0))
      for (let i = 0; i < NBANDS; i++) { next[i] -= moved[i]; if (i > 0) next[i] += moved[i - 1] }
      next[0] += born
      for (let i = 0; i < NBANDS; i++) u.bands[i] = Math.max(0, next[i])
      const ple = periodLifeExpectancy(params, mult, pandemic)
      const up = u.pop()
      wTfr += effTfr * up; wPle += ple * up; wPop += up
      if (cs.length) { const c = cs[ui]; c.tfr = u.tfr; c.ple = ple } else { rs.tfr = u.tfr }
    })
    if (cs.length) {
      syncRegion(w, rs)
      rs.tfr = sum(cs.map(c => c.tfr * countryPop(c))) / Math.max(wPop, 1)
    }
    const riotDeaths = pop * rs.behavior.rioting * 1e-4
    w.humanCost.unrestDeaths += riotDeaths
    w.humanCost.deaths += riotDeaths
    rs.famineDeaths += rFamine
    w.humanCost.famineDeaths += rFamine
    why(rs, 'population', 'deaths', -rTotalDead)
    if (rFamine > 1) why(rs, 'population', 'hunger deaths', -rFamine, 'https://www.fao.org/3/i4646e/i4646e.pdf')
    if (pandemic > 0) why(rs, 'population', 'pandemic deaths', -rPandemicDead, 'https://doi.org/10.1073/pnas.2105482118')
    why(rs, 'population', 'births', rBorn)
    rs.r.fertility = wTfr / Math.max(wPop, 1)
    why(rs, 'fertility', 'long-run decline', (TFR_FLOOR - rs.tfr) * TFR_DECLINE * eduPull / 12, 'https://population.un.org/wpp/')
    if (Math.abs(rs.pronatal) > 0.005) why(rs, 'fertility', 'family policy', rs.pronatal, 'https://en.wikipedia.org/wiki/Demographics_of_Hungary')
    if (Math.abs(housing) > 0.005) why(rs, 'fertility', 'housing and child costs', housing)
    if (Math.abs(optimism) > 0.01) why(rs, 'fertility', 'optimism', optimism)
    births += rBorn
    deaths += rTotalDead

    // ---------- life expectancy: population-weighted over the region's countries ----------
    const ple = wPle / Math.max(wPop, 1)
    const prev = rs.periodLE || ple
    rs.periodLE = ple
    rs.leTrend += ((ple - prev) * 12 - rs.leTrend) * 0.05
    // ESTIMATE: cohort life expectancy at birth ~ period LE plus ~25 years of continued improvement at the current trend
    rs.cohortLE = ple + 25 * Math.max(0, rs.leTrend)
    why(rs, 'periodLifeExpectancy', 'medicine and health systems', ple - prev, 'https://doi.org/10.1126/science.1069675')
    // disease burden: ESTIMATE index from infectious mortality and pandemics
    rs.diseaseBurden = clamp(0.5 * rs.causeMult.infectious * (rs.infantMort * 50) + 20 * pandemic)
  }
  return { births, deaths }
}

// one-off deaths (disasters, war) spread across ages
export function killShare(bands: number[], share: number): number[] {
  return bands.map(b => b * (1 - clamp(share)))
}
