// internal world state. the public Region/Frame shapes from types.ts are derived from this.
import type { Behavior, Budget, Citizen, City, Company, CrowdState, Faction, Flow, Frontier, HumanCost, Law, Mood, Region, ReligionPolicy, SchoolPolicy, SpaceAsset, WorldEvent, WorldStatus } from '../types'
import { LAND, initMix, initRail } from './visuals'
import { onEvent, type CauseInput, type CauseLink, type Story, type Trend } from './causes'
import { initCountries, type CountryState } from './places'
import { initCities, initClimate, initCountryMix, type CityState, type ClimateState } from './world-layer'
import type { InfraDiff } from '../types-v5'
import type { Mix } from './visuals'
import seedJson from '../../../data/seed.json'
import demoJson from '../../../data/demographics.json'
import { ALLOC_GDP_WEIGHT, BASELINE_BUDGET, BASELINE_RELIGION, BASELINE_SCHOOL, GOMPERTZ_B, REVENUE_SHARE, START_RESERVE } from './constants'
import { stream, type Rng } from './rng'
import { initSpace, type SpaceState } from './space'
import { initRequirements, type ReqState } from './requirements'
import { initFrontier, type FrontierState } from './frontier'
import type { LawMeta } from './precedents'
import { HEADLINE_MIN, headlineFor } from './headlines'
import { START_MONTH, START_YEAR } from './constants'

export const EMOTIONS = ['joy', 'fear', 'anger', 'hope', 'grief', 'pride', 'envy', 'boredom', 'awe', 'distrust'] as const
export const BEHAVIORS: Behavior[] = ['working', 'protesting', 'striking', 'rioting', 'migrating', 'hoarding', 'panic_buying', 'celebrating', 'praying', 'gossiping', 'trend_following', 'conspiracy_posting', 'volunteering', 'moving_to_new_city', 'starting_family', 'idle']
// ESTIMATE resting emotional baseline for a population in ordinary times
export const MOOD_BASELINE: Mood = { joy: 0.45, fear: 0.2, anger: 0.15, hope: 0.4, grief: 0.08, pride: 0.25, envy: 0.15, boredom: 0.3, awe: 0.08, distrust: 0.25 }
export type CrowdInternal = CrowdState & { peak: number; outrageMonths: number; lawId?: string; panic?: boolean; startTick: number; causeId?: string }
export type CompanyState = Company & { health: number; failed?: boolean }
export type WhyAcc = Record<string, Record<string, { delta: number; source?: string }>>
export type Cause = 'cardio' | 'cancer' | 'neuro' | 'metabolic' | 'infectious' | 'injury' | 'other'
// WHO Global Health Estimates 2019, share of deaths by broad cause (ESTIMATE grouping)
// https://www.who.int/data/gho/data/themes/mortality-and-global-health-estimates
export const CAUSE_SHARE: Record<Cause, number> = { cardio: 0.32, cancer: 0.17, neuro: 0.05, metabolic: 0.08, infectious: 0.18, injury: 0.08, other: 0.12 }

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
export type MixCap = { solar: number; wind: number; nuclear: number; fossil: number; hydro: number }

export type RegionState = {
  r: Region
  bands: number[]
  tfr: number
  gompertzA: number
  infantMort: number
  // energy
  capacityTWh: number
  pipeline: { readyTick: number; twh: number; mix?: MixCap }[]
  mixCap: MixCap // capacity by source, sums to capacityTWh
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
  // v2: behavior, longevity, cities
  mood: Mood
  prideShock: number
  aweShock: number
  griefShock: number
  fearShock: number
  behavior: Record<Behavior, number>
  crowds: CrowdInternal[]
  privateApproval: number
  falsificationGap: number
  flipped: boolean
  lastWellbeing: number
  periodLE: number
  cohortLE: number
  leTrend: number
  diseaseBurden: number
  travelHours: number
  causeMult: Record<Cause, number>
  agingSlope: number
  oldAgeFloor: number
  pronatal: number
  strikeBoost: number
  newCityPop: number
  whyAcc: WhyAcc
  famineDeaths: number
  excessDeathsTick: number
  pop0: number
  valence0: number // mood valence at tick 0 (happiness moves relative to it)
  investAvg: number // slow average of investment spending above 2026
  collectiveMult: number // harvest multiplier from collectivization
  healthLaw: number // mortality cut from health laws (phased)
  // cause chains
  yearAcc: Record<string, Record<string, number>> // why-drivers summed over the current year
  yearStart: Record<string, number> // stat values at the start of the year
  trends: Trend[]
  story?: Story
  priceIdx: number
  // v3 visuals
  farmland: number
  forest: number
  railLinks: string[]
  landmarks: { kind: string; label: string; tick: number; lawId?: string }[]
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
  rng: { events: Rng; space: Rng; society: Rng; citizens: Rng; research: Rng; factions: Rng; companies: Rng; behavior: Rng }
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
  // v2
  requirements: ReqState[]
  cities: City[]
  cityScores: Record<string, number>
  companies: CompanyState[]
  factions: Faction[]
  frontier: Frontier
  frontierState: FrontierState
  humanCost: HumanCost
  lessonsKnown: number
  researchFocus: string[]
  lawMeta: Record<string, LawMeta>
  lawsuits: Record<string, number>
  popHistory: number[]
  peakPLE: number
  diseasesEradicated: string[]
  lessonsApplied: Set<string>
  lawsProposed: number
  lawsRepeated: number
  lawsAmended: number
  lawsConverted: number
  lastConverted: string[]
  lastRepeated: string[] // titles the governor re-passed at its last decision (they did nothing)
  frameCursor: number
  eventSeq: number
  eventKinds: Record<string, number>
  topEvents: WorldEvent[]
  countries: CountryState[]
  // phase 1 world layer
  climate: ClimateState
  countryMix: Record<string, Mix>
  countryMix0: Record<string, Mix>
  retiredPlants: string[]
  builtPlants: Record<string, number>
  realCities: CityState[]
  recentRepeals: { tick: number; title: string; policyKind: string }[] // last 4 years
  housingDeaths: number // excess deaths from slum and camp growth since 2026 (negative when housing improves)
  railBuilt: string[] // cross-border rail lines built since 2026 ('a|b')
  citiesHitIdx: Record<string, number>
  infraAcc: InfraDiff[]
  causes: CauseLink[]
  // every pip's full life story, written to data/runs/<runId>.lives.json (not part of snapshots)
  lifeArchive: Record<string, { name: string; regionId: string; events: { tick: number; text: string }[] }>
  lastFrameTick: number
  provenanceSent?: boolean
  causeSeq: number
  spaceAssets: SpaceAsset[]
  flowAcc: Flow[] // migrations since the last frame // index into events at the last emitted frame (part of the snapshot so branches resume exactly)
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
    const r: Region = { ...JSON.parse(JSON.stringify(src)), crowds: [], approval: 0.5, lifeExpectancy: 0, periodLifeExpectancy: 0, fertility: 0, diseaseBurden: 0, travelHoursToNearest: 0, whys: [] }
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
      mood: { ...MOOD_BASELINE }, prideShock: 0, aweShock: 0, griefShock: 0, fearShock: 0,
      behavior: Object.fromEntries(BEHAVIORS.map(b => [b, b === 'working' ? 0.9 : 0.005])) as Record<Behavior, number>,
      crowds: [], privateApproval: 0.5, falsificationGap: 0.1, flipped: false, lastWellbeing: 0,
      periodLE: 0, cohortLE: 0, leTrend: 0.2, diseaseBurden: 0, travelHours: TRAVEL_HOURS[r.id] ?? 6,
      causeMult: { cardio: 1, cancer: 1, neuro: 1, metabolic: 1, infectious: 1, injury: 1, other: 1 },
      agingSlope: GOMPERTZ_B, oldAgeFloor: 1 / 20, pronatal: 0, strikeBoost: 0, newCityPop: 0, whyAcc: {}, famineDeaths: 0, excessDeathsTick: 0, pop0: r.population, valence0: 0.5, investAvg: 0, collectiveMult: 1, healthLaw: 0, yearAcc: {}, yearStart: {}, trends: [], priceIdx: 1,
      mixCap: initMix(r.id, r.energyTWh * START_RESERVE), farmland: LAND[r.id].farmland, forest: LAND[r.id].forest, railLinks: [], landmarks: [],
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
  const world: World = {
    seed, twin, tick: 0, regions, laws: [],
    budget: { ...BASELINE_BUDGET }, religionPolicy: BASELINE_RELIGION, schoolPolicy: { ...BASELINE_SCHOOL, curriculum: [...BASELINE_SCHOOL.curriculum] },
    space: initSpace(), events: [], transit: [], migrationCostMonthly: [],
    rng: {
      events: stream(seed, 'events'), space: stream(seed, twin ? 'space-twin' : 'space'), society: stream(seed, twin ? 'society-twin' : 'society'), citizens: stream(seed, 'citizens'),
      research: stream(seed, twin ? 'research-twin' : 'research'), factions: stream(seed, twin ? 'factions-twin' : 'factions'), companies: stream(seed, twin ? 'companies-twin' : 'companies'), behavior: stream(seed, twin ? 'behavior-twin' : 'behavior'),
    },
    peakPop: pop, globalFoodMonthsUnder: 0, revoltStreak: 0, warTension: 0, maxWarSeverity: 0,
    status: 'alive', wellbeingSum: 0, wellbeingN: 0, revenueShare: REVENUE_SHARE, citizens: [], crewDeaths: 0, citizenSeq: 0, citizenMeta: {},
    requirements: initRequirements(), cities: [], cityScores: {}, companies: [], factions: initFactions(), frontier: 'none', frontierState: initFrontier(),
    humanCost: { deaths: 0, famineDeaths: 0, unrestDeaths: 0, displaced: 0, approval: 0.5 }, lessonsKnown: 0, researchFocus: [], lawMeta: {}, lawsuits: {},
    popHistory: [pop], peakPLE: 0, diseasesEradicated: [], lessonsApplied: new Set(), lawsProposed: 0, lawsRepeated: 0, lawsAmended: 0, lawsConverted: 0, lastConverted: [], lastRepeated: [], frameCursor: 0, eventSeq: 0, eventKinds: {}, topEvents: [], spaceAssets: [], flowAcc: [], causes: [], causeSeq: 0, countries: initCountries(regions), climate: undefined as unknown as ClimateState, countryMix: {}, countryMix0: {}, retiredPlants: [], builtPlants: {}, realCities: [], railBuilt: [], housingDeaths: 0, recentRepeals: [], citiesHitIdx: {}, infraAcc: [], lifeArchive: {}, lastFrameTick: 0,
  }
  initRail(world)
  world.climate = initClimate(world)
  initCountryMix(world)
  initCities(world)
  return world
}

// ESTIMATE: hours by fastest common public transport from a region's main hub to the nearest other region's hub
export const TRAVEL_HOURS: Record<string, number> = { na: 4, latam: 6, europe: 2.5, rus_ca: 5, mideast: 3, nafrica: 3, ssa: 7, sasia: 4, easia: 3, seasia: 3.5, oceania: 8, carib_pac: 5 }

// ESTIMATE starting factions. power = organized influence, hostility = how opposed they are to the core.
function initFactions(): Faction[] {
  return [
    { id: 'old_energy', name: 'old energy compact', kind: 'old_energy', regionIds: ['mideast', 'rus_ca', 'na', 'nafrica'], power: 0.6, hostility: 0.3, wants: 'keep fossil revenue flowing while the grid changes' },
    { id: 'religious_faction', name: 'council of faiths', kind: 'religious', regionIds: ['mideast', 'nafrica', 'ssa', 'sasia', 'latam'], power: 0.5, hostility: 0.2, wants: 'freedom of worship and a voice in what schools teach' },
    { id: 'military', name: 'joint command', kind: 'military', regionIds: ['na', 'rus_ca', 'easia', 'sasia'], power: 0.5, hostility: 0.25, wants: 'security budget kept near today' },
    { id: 'regional_nationalist', name: 'home rule leagues', kind: 'regional_nationalist', regionIds: ['europe', 'sasia', 'latam', 'rus_ca'], power: 0.4, hostility: 0.35, wants: 'local control over land, language and taxes' },
    { id: 'labor', name: 'labor front', kind: 'labor', regionIds: ['europe', 'latam', 'sasia', 'easia', 'ssa'], power: 0.5, hostility: 0.25, wants: 'wages and food prices that move together' },
    { id: 'business', name: 'merchant chamber', kind: 'business', regionIds: ['na', 'europe', 'easia', 'oceania'], power: 0.6, hostility: 0.2, wants: 'stable rules, low taxes, contracts for the big builds' },
    { id: 'science', name: 'science guild', kind: 'science', regionIds: ['na', 'europe', 'easia', 'oceania'], power: 0.35, hostility: 0.1, wants: 'research budgets protected from politics' },
  ]
}

export function why(rs: RegionState, stat: string, label: string, delta: number, source?: string) {
  if (!Number.isFinite(delta) || delta === 0) return
  const acc = (rs.whyAcc[stat] ??= {})
  const e = (acc[label] ??= { delta: 0, source })
  e.delta += delta
  const y = (rs.yearAcc[stat] ??= {})
  y[label] = (y[label] ?? 0) + delta
}

export function worldPop(w: World): number {
  return sum(w.regions.map(regionPop)) + sum(w.transit.map(t => t.people))
}

export function popWeighted(w: World, f: (r: RegionState) => number): number {
  let s = 0, p = 0
  for (const r of w.regions) { const n = regionPop(r); s += f(r) * n; p += n }
  return p ? s / p : 0
}

export type EventInput = Omit<WorldEvent, 'tick' | 'significance'> & { significance?: number }

// significance 0..1: severity scaled by the share of humanity affected, mission impact and rarity (see significanceOf)
// cause: who did it and why. events above the noise floor also become CauseLinks (causes.ts)
export function event(w: World, e: EventInput, cause?: CauseInput): WorldEvent {
  const ev: WorldEvent = { tick: w.tick, ...e, severity: clamp(e.severity), significance: 0 }
  ;(ev as WorldEvent & { id: string }).id = `e${w.eventSeq++}`
  ev.significance = Math.round(clamp(e.significance ?? significanceOf(w, ev)) * 1000) / 1000
  if (ev.significance >= HEADLINE_MIN && !ev.headline) {
    const year = START_YEAR + Math.floor((START_MONTH - 1 + w.tick) / 12)
    ev.headline = headlineFor(ev, w.regions.find(r => r.r.id === ev.regionId)?.r.name, year)
  }
  w.events.push(ev)
  w.eventKinds[ev.kind] = (w.eventKinds[ev.kind] ?? 0) + 1
  // running top 8 for the run summary (the world only keeps two years of events)
  if (ev.kind !== 'law' && ev.kind !== 'override') {
    w.topEvents = [...w.topEvents, ev].sort((a, b) => b.significance - a.significance || b.severity - a.severity || a.tick - b.tick).slice(0, 8)
  }
  const l = onEvent(w, ev, cause)
  if (l) (ev as WorldEvent & { linkId?: string }).linkId = l.id
  return ev
}
export const linkIdOf = (e?: WorldEvent) => (e as (WorldEvent & { linkId?: string }) | undefined)?.linkId

export function significanceOf(w: World, e: WorldEvent): number {
  const total = Math.max(1, w.regions.reduce((a, r) => a + r.r.population, 0))
  const reach = e.regionId ? (w.regions.find(r => r.r.id === e.regionId)?.r.population ?? 0) / total : 1
  const mission = e.kind === 'launch' || e.kind === 'breakthrough' ? (/mars|moon|frontier|lifespan|self sustaining|outpost|asteroid/.test(e.text) ? 0.5 : 0.15) : e.kind === 'war' ? 0.3 : 0
  const sameKind = w.eventKinds[e.kind] ?? 0
  const rarity = 1 / (1 + sameKind / 5)
  return clamp(e.severity * (0.35 + 0.65 * Math.sqrt(reach)) * 0.7 + mission + 0.25 * rarity * e.severity)
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
