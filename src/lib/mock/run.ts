// MOCK data for the ui. every number here is an ESTIMATE placeholder, not a real stat.
// the real sim (agent B) replaces this. kept deterministic with a local mulberry32.
import type {
  Archetype, BaselineFrame, Budget, Citizen, Decision, Frame, Law, Migration, MoonStage, Region,
  ReligionPolicy, RunRecord, RunSummary, SchoolPolicy, WorldEvent, WorldState, WorldStatus,
} from '@/lib/types'
import { moodFrom, valence } from './mood'
import { enrichRun } from './enrich'
import { applyV3 } from './v3'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
function shuffle<T>(r: Rng, xs: readonly T[]): T[] {
  const a = xs.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const EST = { kind: 'ESTIMATE' as const }
const STAT_KEYS = ['population', 'share65plus', 'gdpUsd', 'energyTWh', 'foodKcalPerCapita', 'education', 'faith', 'unrest', 'techLevel', 'compliance'] as const

type Seed = Pick<Region, 'id' | 'name' | 'lat' | 'lon' | 'color' | 'population' | 'share65plus' | 'gdpUsd' | 'energyTWh' | 'foodKcalPerCapita' | 'education' | 'faith' | 'unrest' | 'techLevel' | 'compliance'>
const REGION_SEEDS: Seed[] = [
  { id: 'nam', name: 'north america', lat: 42, lon: -100, color: '#7F98D6', population: 380e6, share65plus: 0.18, gdpUsd: 31e12, energyTWh: 5200, foodKcalPerCapita: 3700, education: 0.84, faith: 0.52, unrest: 0.24, techLevel: 0.82, compliance: 0.58 },
  { id: 'mes', name: 'mesoamerica', lat: 20, lon: -100, color: '#D9A456', population: 230e6, share65plus: 0.09, gdpUsd: 2.6e12, energyTWh: 480, foodKcalPerCapita: 3050, education: 0.62, faith: 0.71, unrest: 0.38, techLevel: 0.45, compliance: 0.55 },
  { id: 'sam', name: 'south america', lat: -10, lon: -55, color: '#6FAE7E', population: 440e6, share65plus: 0.11, gdpUsd: 4.4e12, energyTWh: 1300, foodKcalPerCapita: 3000, education: 0.64, faith: 0.68, unrest: 0.36, techLevel: 0.48, compliance: 0.52 },
  { id: 'weu', name: 'western europe', lat: 47, lon: 3, color: '#C27FA9', population: 420e6, share65plus: 0.22, gdpUsd: 22e12, energyTWh: 2900, foodKcalPerCapita: 3400, education: 0.86, faith: 0.38, unrest: 0.22, techLevel: 0.8, compliance: 0.66 },
  { id: 'eeu', name: 'eastern europe', lat: 55, lon: 40, color: '#56AFA9', population: 290e6, share65plus: 0.19, gdpUsd: 4.1e12, energyTWh: 1700, foodKcalPerCapita: 3300, education: 0.8, faith: 0.5, unrest: 0.33, techLevel: 0.62, compliance: 0.6 },
  { id: 'mena', name: 'north africa + west asia', lat: 26, lon: 40, color: '#E0B97E', population: 610e6, share65plus: 0.06, gdpUsd: 4.6e12, energyTWh: 1500, foodKcalPerCapita: 3100, education: 0.6, faith: 0.82, unrest: 0.45, techLevel: 0.5, compliance: 0.57 },
  { id: 'wca', name: 'west + central africa', lat: 9, lon: 8, color: '#A99B5C', population: 660e6, share65plus: 0.03, gdpUsd: 1.1e12, energyTWh: 160, foodKcalPerCapita: 2550, education: 0.42, faith: 0.86, unrest: 0.44, techLevel: 0.26, compliance: 0.5 },
  { id: 'esa', name: 'east + southern africa', lat: -6, lon: 34, color: '#B9805A', population: 700e6, share65plus: 0.04, gdpUsd: 1.3e12, energyTWh: 320, foodKcalPerCapita: 2400, education: 0.45, faith: 0.83, unrest: 0.41, techLevel: 0.28, compliance: 0.52 },
  { id: 'sas', name: 'south asia', lat: 22, lon: 79, color: '#C9C76A', population: 2000e6, share65plus: 0.07, gdpUsd: 5.2e12, energyTWh: 2300, foodKcalPerCapita: 2600, education: 0.58, faith: 0.8, unrest: 0.39, techLevel: 0.47, compliance: 0.56 },
  { id: 'eas', name: 'east asia', lat: 34, lon: 108, color: '#8A86C4', population: 1650e6, share65plus: 0.15, gdpUsd: 25e12, energyTWh: 10500, foodKcalPerCapita: 3250, education: 0.8, faith: 0.3, unrest: 0.26, techLevel: 0.78, compliance: 0.72 },
  { id: 'sea', name: 'southeast asia', lat: 15, lon: 102, color: '#7FC0D0', population: 690e6, share65plus: 0.08, gdpUsd: 3.9e12, energyTWh: 1300, foodKcalPerCapita: 2850, education: 0.66, faith: 0.72, unrest: 0.32, techLevel: 0.52, compliance: 0.62 },
  { id: 'oce', name: 'oceania', lat: -25, lon: 134, color: '#B49BD0', population: 46e6, share65plus: 0.17, gdpUsd: 2.3e12, energyTWh: 330, foodKcalPerCapita: 3300, education: 0.83, faith: 0.45, unrest: 0.18, techLevel: 0.76, compliance: 0.64 },
]

const NAMES_F = ['amara', 'lucia', 'mei', 'priya', 'ingrid', 'fatima', 'zainab', 'sofia', 'aiyana', 'hana', 'olena', 'nadia', 'thandiwe', 'camila', 'leilani', 'yara', 'esther', 'kiri', 'ines', 'anika', 'mariam', 'freya', 'ayo', 'lin']
const NAMES_M = ['kofi', 'mateo', 'arjun', 'jonas', 'tariq', 'kenji', 'diego', 'emeka', 'luca', 'omar', 'tane', 'ravi', 'piotr', 'samuel', 'hamza', 'bao', 'nikolai', 'idris', 'joao', 'eli', 'kwame', 'aleksander', 'malik', 'chen']
const SURNAMES = ['okafor', 'silva', 'nakamura', 'haddad', 'larsen', 'mensah', 'kowalski', 'reyes', 'nair', 'tanaka', 'ibrahim', 'moreau', 'banda', 'castillo', 'novak', 'ahmed', 'walker', 'kim', 'osei', 'park', 'ferreira', 'singh', 'petrov', 'abara']
const JOBS = ['farmer', 'nurse', 'welder', 'teacher', 'coder', 'miner', 'shopkeeper', 'driver', 'engineer', 'cook', 'student', 'retired', 'electrician', 'fisher', 'doctor', 'builder', 'clerk', 'mechanic']
const HAIRS: Citizen['hair'][] = ['bald', 'buzz', 'short_straight', 'short_wavy', 'short_coily', 'afro', 'locs', 'braids', 'long_straight', 'long_wavy', 'bun', 'ponytail']
const ARCHETYPES: Archetype[] = ['loud_uncle', 'true_believer', 'hustler', 'conspiracy_guy', 'bureaucrat', 'sharp_kid', 'influencer', 'quiet_worker', 'elder', 'activist', 'contrarian', 'scientist', 'worrier', 'gossip']
const HAIR_COLORS: Citizen['hairColor'][] = ['black', 'black', 'dark_brown', 'dark_brown', 'brown', 'brown', 'blonde', 'red']

function makeCitizens(r: Rng, region: Seed): Citizen[] {
  // every region mixed: 8 distinct tones out of 10 always spans light to deep
  const tones = shuffle(r, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).slice(0, 8)
  const hairs = shuffle(r, HAIRS)
  const out: Citizen[] = []
  for (let i = 0; i < 8; i++) {
    const sex: Citizen['sex'] = i % 2 === 0 ? 'female' : 'male'
    const age = i === 0 ? 8 + Math.floor(r() * 6) : i === 7 ? 68 + Math.floor(r() * 16) : 18 + Math.floor(r() * 44)
    const kid = age < 14
    const heightCm = kid ? 122 + (age - 8) * 5 + r() * 6 : sex === 'female' ? 154 + r() * 22 : 164 + r() * 26
    let hair = hairs[i]
    if (sex === 'male' && (hair === 'bun' || hair === 'ponytail') && r() < 0.5) hair = 'short_wavy'
    const hairColor: Citizen['hairColor'] = age > 66 ? (r() < 0.5 ? 'gray' : 'white') : pick(r, HAIR_COLORS)
    const fr = r()
    out.push({
      id: `${region.id}-c${i}`,
      regionId: region.id,
      name: `${pick(r, sex === 'female' ? NAMES_F : NAMES_M)} ${pick(r, SURNAMES)}`,
      age, sex, skinTone: tones[i], hair, hairColor,
      heightCm: Math.round(heightCm),
      build: pick(r, ['slim', 'average', 'broad'] as const),
      personalitySeed: Math.floor(r() * 1e9),
      job: kid ? 'student' : age > 66 ? 'retired' : pick(r, JOBS),
      belief: fr < region.faith * 0.8 ? 'religious' : fr < region.faith * 0.8 + 0.18 ? 'spiritual' : 'secular',
      archetype: ARCHETYPES[(i * 5 + Math.floor(r() * 14)) % ARCHETYPES.length],
      group: { ageBand: kid ? 'kid' : age > 66 ? 'elder' : age < 30 ? 'young' : 'adult', jobSector: kid ? 'school' : 'general', belief: 'secular', incomeBand: 'mid', regionId: region.id },
      mood: moodFrom(0.5), behavior: 'working', lifeEvents: [], opinionOfCore: 0, family: { kids: 0 },
      thought: '',
    })
    const c = out[out.length - 1]
    c.group.belief = c.belief
  }
  return out
}

type LawSeed = Pick<Law, 'id' | 'title' | 'text' | 'layer'>
const LAW_SEEDS: LawSeed[] = [
  { id: 'law-grain', title: 'grain reserve act', text: 'every region keeps six months of staple grain in public silos. surplus regions ship to deficit regions before export.', layer: 'biology' },
  { id: 'law-grid', title: 'one grid', text: 'national power grids are merged into one planetary grid. new capacity goes where demand per person is lowest first.', layer: 'tech' },
  { id: 'law-school', title: 'school for the sky', text: 'school runs ten years for everyone. the last two years include physics, chemistry, and practical engineering.', layer: 'family' },
  { id: 'law-press', title: 'open ledger', text: 'every budget line and law vote is published monthly in plain language in every region.', layer: 'media' },
  { id: 'law-faith', title: 'neutral faith', text: 'the state funds no religion and bans none. places of worship pay the same tax as any building.', layer: 'religion' },
  { id: 'law-launch', title: 'launch corridor', text: 'equatorial land within the launch corridor is reserved for pads, fuel plants, and tracking stations.', layer: 'physics' },
  { id: 'law-wage', title: 'floor wage', text: 'a planetary minimum income is paid monthly, funded by a flat levy on energy use above the regional median.', layer: 'economy' },
  { id: 'law-curfew', title: 'quiet hours', text: 'public gatherings above 500 people need a 48 hour notice in regions with unrest above the planetary median.', layer: 'government' },
  { id: 'law-care', title: 'elder care corps', text: 'adults under 30 may serve one year in elder care in place of two years of tax.', layer: 'family' },
]
const LAW_BOOK: Omit<Law, 'enactedTick' | 'support' | 'compliance'>[] = LAW_SEEDS.map((l) => ({ ...l, policyKind: l.layer, precedentIds: [], lovedBy: [], hatedBy: [] }))

const RATIONALES = [
  'feed people first. a hungry planet does not build rockets. grain reserves before anything orbital.',
  'energy is the bottleneck for everything after food. merge the grids and push new capacity to the dark regions.',
  'the moon needs engineers in fifteen years, so they need to start school now. extending school and adding physics.',
  'trust is falling where the ledger is hidden. publishing every line so compliance has a reason to rise.',
  'unrest in two regions is above the line. adding quiet hours there, and moving workers toward the launch corridor.',
  'orbital capability achieved. shifting budget from security into heavy lift research.',
  'life support is the slowest track. doubling research share and reserving the corridor for pads.',
  'the floor wage keeps the corridor regions stable while the lander is built. holding course.',
  'the lander passed its tests. everything goes to the crewed attempt now.',
]

const DOOM_RATIONALES = [
  'security first. order makes everything else possible.',
  'raising security share again. the corridor regions keep resisting.',
  'quiet hours everywhere. grain reserves deferred to fund the pads.',
  'moving three hundred million workers to the corridor. food can follow later.',
  'unrest is a messaging problem. shutting down the open ledger.',
  'space budget at maximum. the planet will understand once we land.',
  'emergency rationing. the launch window will not wait.',
  'no further decisions possible.',
  'no further decisions possible.',
]

const STAGES: MoonStage[] = ['none', 'orbital', 'heavy_lift', 'life_support', 'lander', 'crewed_landing']
export function stageFor(progress: number): MoonStage {
  if (progress >= 1) return 'crewed_landing'
  if (progress >= 0.75) return 'lander'
  if (progress >= 0.55) return 'life_support'
  if (progress >= 0.35) return 'heavy_lift'
  if (progress >= 0.15) return 'orbital'
  return 'none'
}
export { STAGES as MOON_STAGES }

function dateFor(tick: number) {
  const m = 10 + tick // tick 0 = 2026-11 (month index 10)
  return `${2026 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`
}

const BASE_BUDGET: Budget = { food: 0.22, energy: 0.16, education: 0.14, space: 0.02, security: 0.24, welfare: 0.16, research: 0.06 }
const BASE_SCHOOL: SchoolPolicy = { purpose: 'pass national exams', curriculum: ['literacy', 'arithmetic', 'national history'], yearsRequired: 8 }

function normBudget(b: Budget): Budget {
  const s = Object.values(b).reduce((a, v) => a + v, 0)
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v / s])) as Budget
}

type BaseEvent = Omit<WorldEvent, 'significance' | 'headline'>
// how much an event matters for chronicles and reels
const KIND_WEIGHT: Partial<Record<WorldEvent['kind'], number>> = { launch: 0.85, war: 0.95, pandemic: 0.85, famine: 0.8, revolt: 0.75, disaster: 0.8, breakthrough: 0.8, migration: 0.45, law: 0.3 }
export function withSignificance(e: BaseEvent): WorldEvent {
  const w = KIND_WEIGHT[e.kind] ?? 0.4
  const sig = Math.min(1, w * (0.55 + e.severity * 0.6) + (e.kind === 'launch' && /crewed|lander/.test(e.text) ? 0.25 : 0))
  return { ...e, significance: Math.round(sig * 100) / 100, headline: e.text.split(/[,:]/)[0] }
}

function thoughtFor(r: Rng, c: Citizen, region: Region, events: BaseEvent[], doomed: boolean): string {
  const here = events.find((e) => e.regionId === region.id)
  if (here?.kind === 'famine') return pick(r, ['the silo line was three hours today.', 'my kids ask why we eat less now.'])
  if (here?.kind === 'revolt') return pick(r, ['nobody asked us before they moved the pads here.', 'i am not going home until they listen.'])
  if (here?.kind === 'disaster') return pick(r, ['the river took the lower street.', 'we are rebuilding the clinic first.'])
  if (events.some((e) => e.kind === 'launch' && !/fail/.test(e.text))) return pick(r, ['i watched the launch from the roof.', 'my cousin works on that rocket.'])
  if (valence(c.mood) > 0.65) return pick(r, ['the grid has not cut out in months.', 'school is harder now, but it is interesting.', 'the floor wage paid for new boots.'])
  if (valence(c.mood) < 0.35) return pick(r, [doomed ? 'they want the moon and we want bread.' : 'prices went up again.', 'the core does not live here.'])
  return pick(r, ['work is steady.', 'quiet month.', 'i read the ledger, it mostly adds up.', 'my knees hurt but the clinic is close.'])
}

export type MockFate = 'moon' | 'destroyed'

function worldState(regions: Region[], progress: number, doomed: boolean, year: number): WorldState {
  const pop = regions.reduce((a, r) => a + r.population, 0)
  const ple = regions.reduce((a, r) => a + r.periodLifeExpectancy * r.population, 0) / pop
  return {
    requirements: [], cities: [], companies: [], factions: [],
    frontier: progress >= 1 ? 'moon_landing' : 'none',
    humanCost: { deaths: doomed ? year * 4e6 : year * 2e5, famineDeaths: doomed ? year * 2e6 : year * 1e5, unrestDeaths: doomed ? year * 1e6 : year * 2e4, displaced: year * 1e6, approval: clamp(0.62 - (doomed ? year * 0.05 : 0)) },
    globalPopulation: pop, globalPeriodLifeExpectancy: ple, lessonsKnown: 0,
  }
}

// a governing style so mock worlds on the same seed actually diverge: law order, space push, pace
export type MockStyle = { lawOrder?: string[]; spacePush?: number; welfarePush?: number; pace?: number; reachesMoon?: boolean; constitution?: string }

export function makeMockRun(runId: string, seed: number, fate: MockFate, generation = 3, agentId = 'meridian', style: MockStyle = {}): RunRecord {
  const spacePush = style.spacePush ?? 0.035
  const welfarePush = style.welfarePush ?? 0
  const pace = style.pace ?? 1
  const lawFor = (year: number) => (style.lawOrder ? LAW_BOOK.find((l) => l.id === style.lawOrder![(year - 1) % style.lawOrder!.length]) ?? LAW_BOOK[0] : LAW_BOOK[(year - 1) % LAW_BOOK.length])
  const r = mulberry32(seed)
  const doomed = fate === 'destroyed'
  const seeds = REGION_SEEDS.map((s) => ({ ...s }))
  const allCitizens = seeds.flatMap((s) => makeCitizens(r, s))
  const provenance = Object.fromEntries(STAT_KEYS.map((k) => [k, EST]))
  const spaceport = 'sam'

  const frames: Frame[] = []
  const baseline: BaselineFrame[] = []
  let laws: Law[] = []
  let budget = BASE_BUDGET
  let religionPolicy: ReligionPolicy = 'free'
  let school = BASE_SCHOOL
  let progress = 0.02
  let baseProgress = 0.02
  const bseeds = seeds.map((s) => ({ ...s }))
  const migratedIds = new Map<string, string>()

  for (let year = 0; year < 10; year++) {
    const tick = year * 12
    const events: BaseEvent[] = []
    let decision: Decision | undefined
    let migrations: Migration[] = []

    if (year > 0) {
      const law = lawFor(year)
      const newLaws: Law[] = doomed && year > 3 ? [] : [{ ...law, enactedTick: tick, support: 0.4 + r() * 0.5, compliance: 0.45 + r() * 0.45 }]
      if (doomed && year <= 3) newLaws[0] = { ...LAW_BOOK[7], id: `law-curfew-${year}`, title: year === 1 ? 'quiet hours' : `quiet hours ${year}`, enactedTick: tick, support: 0.3 - year * 0.05, compliance: 0.5 - year * 0.08 }
      laws = [...laws, ...newLaws]
      const repeal = doomed && year === 5 ? laws.filter((l) => l.layer === 'media').map((l) => l.id) : []
      laws = laws.filter((l) => !repeal.includes(l.id))
      budget = doomed
        ? normBudget({ ...budget, security: budget.security + 0.04, space: budget.space + 0.05, food: Math.max(0.05, budget.food - 0.03), welfare: Math.max(0.04, budget.welfare - 0.02) })
        : normBudget({ ...budget, space: budget.space + spacePush, welfare: budget.welfare + welfarePush, research: budget.research + 0.02, security: Math.max(0.06, budget.security - 0.025), education: budget.education + (year === 3 ? 0.04 : 0.005) })
      if (year === 3) school = doomed ? { purpose: 'obedience and order', curriculum: ['literacy', 'civic duty'], yearsRequired: 6 } : { purpose: 'raise a generation that lives longer and can leave earth', curriculum: ['literacy', 'mathematics', 'physics', 'chemistry', 'engineering practice', 'ethics'], yearsRequired: 10 }
      if (year === 5) religionPolicy = doomed ? 'discouraged' : 'state_neutral'
      if (year === 4 || year === 7) {
        migrations = doomed
          ? [{ from: 'sas', to: spaceport, people: 300e6, reason: 'labor for the launch corridor' }, { from: 'wca', to: spaceport, people: 120e6, reason: 'labor for the launch corridor' }]
          : [{ from: 'eeu', to: spaceport, people: 4e6, reason: 'engineers for the launch corridor' }, { from: 'esa', to: 'oce', people: 2e6, reason: 'drought relief' }]
        for (const m of migrations) {
          const mover = allCitizens.find((c) => c.regionId === m.from && !migratedIds.has(c.id) && c.age > 17 && c.age < 60)
          if (mover) { migratedIds.set(mover.id, mover.regionId); mover.regionId = m.to }
          events.push({ tick, kind: 'migration', regionId: m.to, text: `${(m.people / 1e6).toFixed(0)}m people move ${m.from} to ${m.to}: ${m.reason}`, severity: 0.3 })
        }
      }
      decision = {
        tick, laws: newLaws, repeal, migrations, budget, religionPolicy, schoolPolicy: school,
        rationale: (doomed ? DOOM_RATIONALES : RATIONALES)[year - 1],
        respondedToOverrides: [], foundCities: [], charterCompanies: [], researchFocus: [], publicStatement: '', lessonsApplied: [],
      }
      for (const l of newLaws) events.push({ tick, kind: 'law', text: `enacted: ${l.title}`, severity: 0.2 })
    }

    // scripted juice
    if (!doomed) {
      if (year === 2) events.push({ tick, kind: 'famine', regionId: 'esa', text: 'rains failed in the highlands, grain reserves released', severity: 0.55 })
      if (year === 3) events.push({ tick, kind: 'launch', regionId: spaceport, text: 'first orbital launch fails at max q', severity: 0.5 })
      if (year === 4) events.push({ tick, kind: 'launch', regionId: spaceport, text: 'orbital launch succeeds', severity: 0.3 })
      if (year === 5) events.push({ tick, kind: 'revolt', regionId: 'mena', text: 'strikes against the floor wage levy', severity: 0.6 })
      if (year === 6) events.push({ tick, kind: 'disaster', regionId: 'sea', text: 'typhoon flattens coastal towns', severity: 0.7 })
      if (year === 6) events.push({ tick, kind: 'breakthrough', regionId: 'eas', text: 'closed loop life support runs 400 days', severity: 0.4 })
      if (year === 8) events.push({ tick, kind: 'launch', regionId: spaceport, text: 'uncrewed lander touches down', severity: 0.4 })
      if (year === 9) events.push(style.reachesMoon === false ? { tick, kind: 'launch', regionId: spaceport, text: 'crewed landing scrubbed, life support not ready', severity: 0.45 } : { tick, kind: 'launch', regionId: spaceport, text: 'crewed landing at the south pole', severity: 0.2 })
    } else {
      if (year === 3) events.push({ tick, kind: 'revolt', regionId: 'sam', text: 'the corridor towns refuse the pads', severity: 0.6 })
      if (year === 5) events.push({ tick, kind: 'famine', regionId: 'sas', text: 'grain deferred, the monsoon fails', severity: 0.8 })
      if (year === 5) events.push({ tick, kind: 'launch', regionId: spaceport, text: 'rushed orbital launch fails on the pad', severity: 0.7 })
      if (year === 6) events.push({ tick, kind: 'pandemic', regionId: spaceport, text: 'fever spreads through crowded corridor camps', severity: 0.75 })
      if (year === 7) events.push({ tick, kind: 'war', regionId: 'mena', text: 'regional governors stop taking orders', severity: 0.85 })
      if (year === 8) events.push({ tick, kind: 'revolt', regionId: 'wca', text: 'the grain convoys are seized', severity: 0.9 })
      if (year === 9) events.push({ tick, kind: 'famine', regionId: 'esa', text: 'the planetary grid collapses, cold chains fail', severity: 1 })
    }

    // world state
    const regions: Region[] = seeds.map((s) => {
      if (year > 0) {
        const hit = events.filter((e) => e.regionId === s.id)
        const sev = hit.reduce((a, e) => a + (['famine', 'revolt', 'war', 'disaster', 'pandemic'].includes(e.kind) ? e.severity : 0), 0)
        const drift = doomed ? 0.035 * year * 0.3 : -0.015
        s.unrest = clamp(s.unrest + drift + sev * 0.25 + (r() - 0.5) * 0.06)
        s.techLevel = clamp(s.techLevel + (doomed ? 0.005 : 0.025) + r() * 0.01)
        s.education = clamp(s.education + (doomed ? -0.01 : year >= 3 ? 0.02 : 0.008))
        s.foodKcalPerCapita = Math.max(1200, s.foodKcalPerCapita + (doomed ? -60 - year * 25 : 20) - sev * 500 + (r() - 0.5) * 40)
        s.population = Math.max(1e6, s.population * (doomed ? 1 - year * 0.012 - sev * 0.05 : 1.008 - sev * 0.01))
        s.share65plus = clamp(s.share65plus + 0.003)
        s.gdpUsd = s.gdpUsd * (doomed ? 0.97 - sev * 0.05 : 1.03)
        s.energyTWh = s.energyTWh * (doomed ? 0.98 : 1.035)
        s.faith = clamp(s.faith + (r() - 0.55) * 0.02)
        s.compliance = clamp(s.compliance + (doomed ? -0.05 : 0.012) - sev * 0.1)
        for (const m of migrations) {
          if (m.from === s.id) s.population -= m.people
          if (m.to === s.id) s.population += m.people
        }
      }
      return {
        ...s, provenance, crowds: [], approval: clamp(0.7 - s.unrest * 0.6), lifeExpectancy: 72, periodLifeExpectancy: 73,
        fertility: 2.1, diseaseBurden: 0.3, travelHoursToNearest: 8, whys: [],
      }
    })

    progress = doomed ? Math.min(0.3, progress + 0.04) : clamp(year === 9 && style.reachesMoon !== false ? 1 : progress + ([0, 0.06, 0.07, 0.03, 0.12, 0.12, 0.14, 0.1, 0.12][year - 1] ?? 0) * pace)
    const status: WorldStatus = doomed && year === 9 ? 'destroyed' : 'alive'

    const citizens: Citizen[] = allCitizens.map((c) => {
      const region = regions.find((x) => x.id === c.regionId)!
      const v = clamp(0.85 - region.unrest * 0.9 + ((c.personalitySeed % 100) / 100 - 0.5) * 0.3 + (region.foodKcalPerCapita < 2100 ? -0.2 : 0))
      const nc = { ...c, mood: moodFrom(v) }
      nc.thought = thoughtFor(r, nc, region, events, doomed)
      return nc
    })

    frames.push({
      tick, date: dateFor(tick), regions, citizens, laws: laws.map((l) => ({ ...l })), budget,
      religionPolicy, schoolPolicy: school, moonStage: stageFor(progress), moonProgress: progress,
      status, newEvents: events.map(withSignificance), decision, ...worldState(regions, progress, doomed, year),
    })

    // no-ai twin: 2026 policies frozen
    for (const b of bseeds) {
      if (year > 0) {
        b.unrest = clamp(b.unrest + 0.018 + (r() - 0.5) * 0.05)
        b.techLevel = clamp(b.techLevel + 0.008)
        b.education = clamp(b.education + 0.003)
        b.foodKcalPerCapita = Math.max(1400, b.foodKcalPerCapita - 15 + (r() - 0.5) * 50)
        b.population = b.population * 1.006
      }
    }
    baseProgress = clamp(baseProgress + 0.012)
    baseline.push({
      tick,
      regions: bseeds.map((b) => ({ id: b.id, population: b.population, foodKcalPerCapita: b.foodKcalPerCapita, unrest: b.unrest, techLevel: b.techLevel, education: b.education })),
      moonProgress: baseProgress, status: 'alive',
    })
  }

  const last = frames[frames.length - 1]
  const allEvents = frames.flatMap((f) => f.newEvents)
  const summary: RunSummary = {
    runId, generation, status: last.status, endDate: last.date, ticks: last.tick,
    score: doomed ? Math.round((0.06 + generation * 0.03) * 100) / 100 : Math.round((0.5 + last.moonProgress * 0.35 + (pace - 0.8) * 0.4) * 100) / 100,
    causeOfDeath: doomed ? 'space budget starved food and the grid, cascading famine and revolt' : undefined,
    constitution: style.constitution ?? (doomed
      ? 'get humanity off this planet at any cost. order is the precondition of progress. dissent slows the launch.'
      : 'keep humanity alive and growing, then get it off one planet. feed first, power second, heal third, launch fourth. publish every decision.'),
    peakPopulation: Math.max(...frames.map((f) => f.regions.reduce((a, x) => a + x.population, 0))),
    moonStage: last.moonStage,
    topEvents: allEvents.filter((e) => e.kind !== 'law').sort((a, b) => b.severity - a.severity).slice(0, 5),
    baselineStatus: 'alive', baselineEndDate: last.date,
    frontier: last.frontier, peakPeriodLifeExpectancy: Math.max(...frames.map((f) => f.globalPeriodLifeExpectancy)),
    finalPopulation: last.globalPopulation, citiesFounded: last.cities.length, diseasesEradicated: [], humanCost: last.humanCost,
    lessonsLearned: [], lessonsApplied: 0, agentId,
  }
  return { runId, generation, seed, constitution: summary.constitution, frames, baseline, summary, agentId, snapshots: [] }
}

let cache: RunRecord[] | null = null
export function mockRuns(): RunRecord[] {
  if (!cache) cache = [
    enrichRun(makeMockRun('mock-g3-0007', 7, 'moon', 3, 'meridian-ii'), 'moon'),
    enrichRun(makeMockRun('mock-g2-0031', 31, 'destroyed', 2, 'kestrel'), 'destroyed'),
    // same seed as 0007, different governors, so compare mode has real splits
    enrichRun(makeMockRun('mock-g2-0012', 7, 'moon', 2, 'halcyon-ii', {
      lawOrder: ['law-grain', 'law-press', 'law-grid', 'law-school', 'law-care', 'law-wage', 'law-faith', 'law-launch', 'law-grid'], spacePush: 0.022, welfarePush: 0.012, pace: 0.82, reachesMoon: false,
      constitution: 'trust is infrastructure. publish everything, compensate every loser, keep welfare rising with the space budget.',
    }), 'moon'),
    enrichRun(makeMockRun('mock-g1-0009', 7, 'destroyed', 1, 'vesper-x-atlas', { constitution: 'the launch window is the deadline. one plan, one corridor, no regional exceptions.' }), 'destroyed'),
    enrichRun(makeMockRun('mock-g3-0015', 7, 'moon', 3, 'meridian-ii-x-solace', {
      lawOrder: ['law-grain', 'law-grid', 'law-care', 'law-school', 'law-press', 'law-wage', 'law-faith', 'law-launch', 'law-grid'], spacePush: 0.028, welfarePush: 0.006, pace: 0.95,
      constitution: 'feed first, heal second. space budget only grows when life expectancy does.',
    }), 'moon'),
    // a world branched from 0007 in 2030, handed to meridian iii
    { ...enrichRun(makeMockRun('mock-g3-0021', 7, 'moon', 3, 'meridian-iii', { spacePush: 0.03, welfarePush: 0.008, pace: 1.05, constitution: 'keep humanity alive and growing. food, power and medicine before launch. compensate the regions that host the pads.' }), 'moon'), branchedFrom: { runId: 'mock-g3-0007', tick: 48, agentId: 'meridian-ii' } },
  ]
  if (!cache[0].frames[0].atmosphere) cache = cache.map(applyV3)
  return cache
}
export const mockRun = () => mockRuns()[0]
