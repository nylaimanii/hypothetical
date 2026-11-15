// demography: 17 five-year age bands per region. births from fertility x women 15-49, deaths from a
// Gompertz curve calibrated to the sourced crude death rate, plus infant mortality. every band ages
// 1/60 per month, so a cohort takes real time to move through.
import { SURVIVAL_KCAL, TFR_DECLINE, TFR_FLOOR } from './constants'
import { BAND_MID, NBANDS, clamp, regionPop, sum, type World } from './state'
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

export function stepDemography(w: World, fx: Record<string, LawEffects>): { births: number; deaths: number } {
  let births = 0, deaths = 0
  for (const rs of w.regions) {
    const pop = regionPop(rs)
    if (pop <= 0) continue
    const kcal = rs.r.foodKcalPerCapita
    const welfarePC = rs.spend.welfare * 12 / pop
    // ESTIMATE: health and social spending cut mortality up to 15% at saturation, relative to 2026 levels
    const welfareMult = (1 - 0.15 * fWelfare(welfarePC)) / (1 - 0.15 * fWelfare(rs.pc0.welfare))
    // ESTIMATE: medical progress tracks tech: mortality falls ~1% per 0.01 tech above the start
    const techMult = Math.exp(-1.0 * (rs.r.techLevel - rs.base.techLevel))
    const foodMult = foodMortality(kcal, rs.foodMonthsUnder)
    const lawMult = 1 - 0.02 * (fx[rs.r.id]?.redistributive ?? 0)
    const mult = welfareMult * techMult * foodMult * lawMult
    const pandemic = w.tick < rs.pandemicUntil ? rs.pandemicMort : 0
    const dead = new Array(NBANDS).fill(0)
    for (let i = 0; i < NBANDS; i++) {
      // pandemic excess mortality concentrates on the old (ESTIMATE: weight rises with age)
      const pw = pandemic * (0.2 + 1.6 * BAND_MID[i] / 85)
      const annual = (rs.gompertzA * Math.exp(0.09 * (BAND_MID[i] - 60)) + (i === 0 ? rs.infantMort : 0)) * mult + pw
      dead[i] = rs.bands[i] * (1 - Math.exp(-annual / 12))
    }
    // fertility drifts down toward a floor, faster with education, slower with family policy and welfare
    const eduPull = 1 + 1.5 * Math.max(0, rs.r.education - rs.base.education)
    rs.tfr += (TFR_FLOOR - rs.tfr) * TFR_DECLINE * eduPull / 12
    rs.tfr += 0.15 * (fx[rs.r.id]?.family ?? 0) / 120
    rs.tfr = clamp(rs.tfr, 0.8, 7)
    const women = 0.5 * sum(rs.bands.slice(3, 10))
    // ESTIMATE: hunger suppresses births (deficit below 2,100 kcal cuts conception proportionally)
    const hunger = clamp((2100 - kcal) / 2100)
    const born = rs.tfr / 35 * women * (1 - hunger) / 12
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
    deaths += sum(dead)
  }
  return { births, deaths }
}

// one-off deaths (disasters, war) spread across ages
export function killShare(bands: number[], share: number): number[] {
  return bands.map(b => b * (1 - clamp(share)))
}
