// internal world state. the public Region/Frame shapes from types.ts are derived from this.
import type { Budget, Citizen, Law, Region, ReligionPolicy, SchoolPolicy, WorldEvent, WorldStatus } from '../types'
import seedJson from '../../../data/seed.json'
import demoJson from '../../../data/demographics.json'
import { ALLOC_GDP_WEIGHT, BASELINE_BUDGET, BASELINE_RELIGION, BASELINE_SCHOOL, GOMPERTZ_B, REVENUE_SHARE, START_RESERVE } from './constants'
import { stream, type Rng } from './rng'
import { initSpace, type SpaceState } from './space'

export const BAND_MID = [2.5, 7.5, 12.5, 17.5, 22.5, 27.5, 32.5, 37.5, 42.5, 47.5, 52.5, 57.5, 62.5, 67.5, 72.5, 77.5, 85]
export const NBANDS = BAND_MID.length

export type Demographics = {
  skinTone: { weights: number[] }
  hairType: { weights: Record<string, number> }
  hairColor: { weights: Record<string, number> }
  heightCm: { female: number; male: number; sd: { female: number; male: number } }
  childHeightCm: { ages: number[]; female: number[]; male: number[] }
  ageStructure: { bands: string[]; share: number[] }
  vitalRates: { tfr: number; crudeDeathPer1000: number; under5MortalityPer1000: number }
}
export const DEMOGRAPHICS = (demoJson as unknown as { regions: Record<string, Demographics> }).regions
export const SEED_REGIONS = (seedJson as unknown as { regions: Region[] }).regions

export type Transit = { from: string; to: string; people: number; bands: number[]; arriveTick: number }

export type RegionState = {
  r: Region
  bands: number[]
  tfr: number
  gompertzA: number
  infantMort: number
  // energy
  capacityTWh: number
  pipeline: { readyTick: number; twh: number }[]
  kwhpcBase: number
  gdppc0: number
  energyRatio: number
  // food
  foodBase: number // kcal/day produced at tick 0
  yieldIdx: number
  droughtUntil: number
  droughtSev: number
  foodMonthsUnder: number
  // society
  base: { unrest: number; compliance: number; education: number; techLevel: number; faith: number }
  pc0: { welfare: number; education: number; security: number; food: number }
  shock: number
  revoltPressure: number
  inRevolt: boolean
  revoltMonths: number
  calmMonths: number
  seceded: boolean
  lastSecessionTick: number
  eduTargets: number[] // education target by tick, read back with a 10 year lag
  pandemicMort: number
  pandemicUntil: number
  growth: number // last annualized gdp per capita growth
  originMix: Record<string, number>
  spend: Budget // usd this month
  lawSupport: Record<string, number>
  lawCompliance: Record<string, number>
  migrationShock: number
}

export type World = {
  seed: number
  twin: boolean
  tick: number
  regions: RegionState[]
  laws: Law[]
  budget: Budget
  forcedBudget?: Partial<Budget>
  religionPolicy: ReligionPolicy
  schoolPolicy: SchoolPolicy
  space: SpaceState
  events: WorldEvent[]
  transit: Transit[]
  migrationCostMonthly: { until: number; usd: number }[]
  rng: { events: Rng; space: Rng; society: Rng; citizens: Rng }
  peakPop: number
  globalFoodMonthsUnder: number
  revoltStreak: number
  warTension: number
  maxWarSeverity: number
  status: WorldStatus
  causeOfDeath?: string
  wellbeingSum: number
  wellbeingN: number
  revenueShare: number
  citizens: Citizen[]
  crewDeaths: number
  citizenSeq: number
  citizenMeta: Record<string, { origin: string; baseHair: Citizen['hairColor']; affectedTick: number; prevMood: number }>
}

export const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x)
export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
export const incomeIdx = (gdppc: number) => clamp((Math.log10(Math.max(gdppc, 1)) - 2.5) / 2.5)
export const regionPop = (rs: RegionState) => sum(rs.bands)

// regional share of each budget line: ALLOC_GDP_WEIGHT by gdp, the rest by population. seceded regions get nothing.
export function allocShares(regions: RegionState[]): number[] {
  const live = regions.map(r => (r.seceded ? 0 : 1))
  const gdp = regions.map((r, i) => r.r.gdpUsd * live[i])
  const pop = regions.map((r, i) => r.r.population * live[i])
  const g = sum(gdp) || 1
  const p = sum(pop) || 1
  return regions.map((_, i) => ALLOC_GDP_WEIGHT * gdp[i] / g + (1 - ALLOC_GDP_WEIGHT) * pop[i] / p)
}

export function initWorld(seed: number, twin: boolean): World {
  const regions: RegionState[] = SEED_REGIONS.map(src => {
    const r: Region = JSON.parse(JSON.stringify(src))
    const d = DEMOGRAPHICS[r.id]
    const bands = d.ageStructure.share.map(s => s * r.population)
    const infantMort = d.vitalRates.under5MortalityPer1000 / 1000 / 5
    // calibrate the Gompertz level so tick-0 deaths match the sourced crude death rate
    const target = d.vitalRates.crudeDeathPer1000 / 1000 * r.population - bands[0] * infantMort
    const denom = sum(bands.map((b, i) => b * Math.exp(GOMPERTZ_B * (BAND_MID[i] - 60))))
    const gompertzA = Math.max(target / denom, 0.002)
    return {
      r, bands, tfr: d.vitalRates.tfr, gompertzA, infantMort,
      capacityTWh: r.energyTWh * START_RESERVE, pipeline: [], kwhpcBase: r.energyTWh * 1e9 / r.population,
      gdppc0: r.gdpUsd / r.population, energyRatio: 1,
      foodBase: r.foodKcalPerCapita * r.population, yieldIdx: 1, droughtUntil: -1, droughtSev: 0, foodMonthsUnder: 0,
      base: { unrest: r.unrest, compliance: r.compliance, education: r.education, techLevel: r.techLevel, faith: r.faith },
      pc0: { welfare: 0, education: 0, security: 0, food: 0 },
      shock: 0, revoltPressure: 0, inRevolt: false, revoltMonths: 0, calmMonths: 0, seceded: false, lastSecessionTick: -999,
      eduTargets: [], pandemicMort: 0, pandemicUntil: -1, growth: 0.02,
      originMix: { [r.id]: 1 },
      spend: { food: 0, energy: 0, education: 0, space: 0, security: 0, welfare: 0, research: 0 },
      lawSupport: {}, lawCompliance: {}, migrationShock: 0,
    }
  })
  // per-capita spending at the 2026 budget, the reference point for "more or less than today"
  const shares = allocShares(regions)
  const revenue = REVENUE_SHARE * sum(regions.map(r => r.r.gdpUsd))
  regions.forEach((rs, i) => {
    const pc = (k: keyof Budget) => BASELINE_BUDGET[k] * revenue * shares[i] / rs.r.population
    rs.pc0 = { welfare: pc('welfare'), education: pc('education'), security: pc('security'), food: pc('food') }
  })
  const pop = sum(regions.map(r => r.r.population))
  return {
    seed, twin, tick: 0, regions, laws: [],
    budget: { ...BASELINE_BUDGET }, religionPolicy: BASELINE_RELIGION, schoolPolicy: { ...BASELINE_SCHOOL, curriculum: [...BASELINE_SCHOOL.curriculum] },
    space: initSpace(), events: [], transit: [], migrationCostMonthly: [],
    rng: { events: stream(seed, 'events'), space: stream(seed, twin ? 'space-twin' : 'space'), society: stream(seed, twin ? 'society-twin' : 'society'), citizens: stream(seed, 'citizens') },
    peakPop: pop, globalFoodMonthsUnder: 0, revoltStreak: 0, warTension: 0, maxWarSeverity: 0,
    status: 'alive', wellbeingSum: 0, wellbeingN: 0, revenueShare: REVENUE_SHARE, citizens: [], crewDeaths: 0, citizenSeq: 0, citizenMeta: {},
  }
}

export function worldPop(w: World): number {
  return sum(w.regions.map(regionPop)) + sum(w.transit.map(t => t.people))
}

export function popWeighted(w: World, f: (r: RegionState) => number): number {
  let s = 0, p = 0
  for (const r of w.regions) { const n = regionPop(r); s += f(r) * n; p += n }
  return p ? s / p : 0
}

export function event(w: World, e: Omit<WorldEvent, 'tick'>): WorldEvent {
  const ev: WorldEvent = { tick: w.tick, ...e, severity: clamp(e.severity) }
  w.events.push(ev)
  return ev
}

export function effectiveBudget(w: World): Budget {
  if (!w.forcedBudget) return w.budget
  return normalizeBudget({ ...w.budget, ...w.forcedBudget }, Object.keys(w.forcedBudget) as (keyof Budget)[])
}

// normalize to sum 1. keys in `fixed` keep their value (clamped so they fit), the rest scale to fill the remainder.
export function normalizeBudget(b: Partial<Budget>, fixed: (keyof Budget)[] = []): Budget {
  const keys: (keyof Budget)[] = ['food', 'energy', 'education', 'space', 'security', 'welfare', 'research']
  const out = {} as Budget
  for (const k of keys) out[k] = Math.max(0, Number.isFinite(b[k] as number) ? (b[k] as number) : 0)
  const fixedSum = sum(fixed.map(k => out[k]))
  if (fixedSum >= 1) {
    for (const k of keys) out[k] = fixed.includes(k) ? out[k] / fixedSum : 0
    return out
  }
  const free = keys.filter(k => !fixed.includes(k))
  const freeSum = sum(free.map(k => out[k]))
  for (const k of free) out[k] = freeSum > 0 ? out[k] / freeSum * (1 - fixedSum) : (1 - fixedSum) / free.length
  return out
}
