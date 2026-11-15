// every tunable number in the sim lives here with its source or an ESTIMATE note.
import type { Budget, ReligionPolicy, SchoolPolicy } from '../types'

export const START_YEAR = 2026
export const START_MONTH = 11 // tick 0 = 2026-11
export const MAX_TICKS = 600
export const GOVERNOR_EVERY = 12

export function dateOf(tick: number): string {
  const m = START_MONTH - 1 + tick
  return `${START_YEAR + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`
}

// ---------- economy ----------
// ESTIMATE: world government revenue = 30% of world GDP. general government revenue averages roughly
// 30 to 36% of GDP worldwide (IMF Fiscal Monitor, https://www.imf.org/en/Publications/FM)
export const REVENUE_SHARE = 0.3
export const REVENUE_SHARE_MAX = 0.42
// ESTIMATE: 2026 budget mix, IMF COFOG shares of world government spending
// (https://data.imf.org/?sk=5804C5E1-0502-4672-BDCD-671BCDC565A9) mapped onto 7 categories and renormalized.
// social protection + health -> welfare, defense + public order -> security, fuel and energy -> energy,
// agriculture -> food. space ~$45B/yr is crewed exploration (NASA + ESA + CNSA human spaceflight lines), not all space.
export const BASELINE_BUDGET: Budget = { food: 0.035, energy: 0.05, education: 0.15, space: 0.0013, security: 0.12, welfare: 0.6107, research: 0.033 }
export const BASELINE_RELIGION: ReligionPolicy = 'free'
export const BASELINE_SCHOOL: SchoolPolicy = { purpose: 'general literacy and workforce skills', curriculum: ['literacy', 'mathematics', 'science', 'history'], yearsRequired: 10 }
// ESTIMATE: spending is allocated to regions 70% by GDP share (what each region spends on itself today)
// and 30% by population share (a modest world-government equalization). applies to the ai world and the twin alike.
export const ALLOC_GDP_WEIGHT = 0.7

// ---------- energy ----------
// blended overnight capital cost of new generation, USD per GW. EIA "Capital Cost and Performance
// Characteristic Estimates" (2024): utility solar ~$1.5B/GW, onshore wind ~$2.1B/GW, combined cycle gas
// ~$1.3B/GW, advanced nuclear ~$7.8B/GW. ESTIMATE blend for a mostly solar/wind/gas buildout.
// https://www.eia.gov/analysis/studies/powerplants/capitalcost/
export const CAPEX_USD_PER_GW = 1.8e9
// ESTIMATE: blended capacity factor 0.35 -> 1 GW yields 0.35 * 8760 h = 3.07 TWh/yr
export const TWH_PER_GW_YEAR = 0.35 * 8760 / 1000
// ESTIMATE: 36 months from funding to grid (solar 1 to 2 yr, gas 3 yr, nuclear 7 to 10 yr)
export const BUILD_MONTHS = 36
// ESTIMATE: 40 year average asset life -> 2.5% of capacity retires per year
export const RETIRE_PER_YEAR = 1 / 40
// ESTIMATE: operations and maintenance ~$20 per MWh (Lazard LCOE+ 2024 fixed + variable O&M range)
// https://www.lazard.com/research-insights/levelized-cost-of-energyplus/
export const OM_USD_PER_TWH = 20e6
// ESTIMATE: 8% reserve margin at tick 0 (consumption is the sourced value; capacity is not)
export const START_RESERVE = 1.08
// ESTIMATE: income elasticity of electricity demand ~0.7 (IEA and academic panel estimates range 0.5 to 1)
export const ELEC_INCOME_ELASTICITY = 0.7

// ---------- food ----------
// survival threshold: FAO minimum dietary energy requirement, ~1,800 kcal/person/day global average
// https://www.fao.org/3/i4646e/i4646e.pdf (SOFI methodology, MDER). applied to per-capita food supply.
export const SURVIVAL_KCAL = 1800
// ESTIMATE: supply above 3,800 kcal/day adds nothing (saturation, waste)
export const KCAL_CAP = 3800
// ESTIMATE: baseline crop-yield growth ~0.4%/yr plus spending- and tech-driven gains. FAO reports
// long-run cereal yield growth near 1%/yr (https://www.fao.org/faostat/)
export const YIELD_BASE_GROWTH = 0.004

// ---------- demography ----------
// ESTIMATE: Gompertz mortality slope 0.09 per year of age (typical human range 0.08 to 0.1)
export const GOMPERTZ_B = 0.09
// ESTIMATE: TFR declines toward 1.3 at 1.2%/yr of the gap (UN WPP 2024 medium variant shows steady declines)
export const TFR_FLOOR = 1.3
export const TFR_DECLINE = 0.012

// ---------- migration ----------
// ESTIMATE: ~$12,000 per relocated person (transport, housing, first-year integration). OECD puts
// first-year refugee integration cost near EUR 10,000 per person: https://www.oecd.org/migration/
export const MIGRATION_USD_PER_PERSON = 12000
// ESTIMATE: 6 months from order to arrival
export const MIGRATION_MONTHS = 6
// ESTIMATE: at most 2% of a region can be moved per year, larger than any peacetime movement in history
export const MIGRATION_MAX_SHARE_YEAR = 0.02

// ---------- society ----------
export const REVOLT_UNREST = 0.65
export const REVOLT_END_UNREST = 0.45
export const REVOLT_ONSET_MONTHS = 6
export const SECESSION_MONTHS = 24
export const EDUCATION_LAG_TICKS = 120 // 10 years: a school change only reaches adults after a cohort passes through
export const EDUCATION_TURNOVER_MONTHS = 15 * 12

// ---------- tech ----------
// world R&D spending ~$2.5T/yr (UNESCO Institute for Statistics, https://uis.unesco.org/en/topic/research-and-development)
export const WORLD_RD_USD = 2.5e12
