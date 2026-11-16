import type { Clothing, CommuteMode, InfraDiff } from './types-v5'
// shared contract. only agent A edits this file.
// units: all 0..1 fields are fractions (education, faith, unrest, techLevel, compliance, share65plus, approval,
// law support/compliance, moonProgress, requirement progress, crowd intensity, event severity, emotion values).
// Citizen.opinionOfCore: -1 hates the core, 0 neutral, 1 loves it. Faction power/hostility 0..1.
// lifeExpectancy is cohort years at birth, periodLifeExpectancy is period years at birth.
// gdpUsd: total usd per year. energyTWh: per year. Budget values are fractions that sum to 1.
// dates are 'YYYY-MM'. launch events whose text contains 'fail' render as a failed launch.
// horizon: tick 1200 (2126). a run ends only on 'destroyed' or at the horizon ('complete'), or early on 'goal_achieved'.
// goal_achieved = frontier reaches mars_self_sustaining AND globalPeriodLifeExpectancy >= 200
//   AND global population not declining over the last 10 years (120 ticks).

export type Layer = 'physics'|'biology'|'government'|'economy'|'tech'|'religion'|'media'|'family'
export type Provenance = { kind: 'SOURCED'|'ESTIMATE'; url?: string }

// ---- people ----
export type Emotion = 'joy'|'fear'|'anger'|'hope'|'grief'|'pride'|'envy'|'boredom'|'awe'|'distrust'
export type Archetype = 'loud_uncle'|'true_believer'|'hustler'|'conspiracy_guy'|'bureaucrat'|'sharp_kid'|'influencer'|'quiet_worker'|'elder'|'activist'|'contrarian'|'scientist'|'worrier'|'gossip'
export type Behavior = 'working'|'protesting'|'striking'|'rioting'|'migrating'|'hoarding'|'panic_buying'|'celebrating'|'praying'|'gossiping'|'trend_following'|'conspiracy_posting'|'volunteering'|'moving_to_new_city'|'starting_family'|'idle'
export type GroupKey = { ageBand: 'kid'|'young'|'adult'|'elder'; jobSector: string; belief: 'religious'|'secular'|'spiritual'; incomeBand: 'low'|'mid'|'high'; regionId: string }
export type Mood = Record<Emotion, number>
export type CrowdState = { topic: string; phase: 'unaware'|'alarmed'|'outraged'|'realizing_cost'|'bored'; intensity: number; sinceTick: number }
export type LifeEvent = { tick: number; text: string }

// ---- explanations and evidence ----
export type Why = { stat: string; value: number; drivers: { label: string; delta: number; source?: string }[] }
export type Precedent = { id: string; event: string; year: number; country: string; policyKind: string; reaction: string; magnitude: number; durationMonths: number; url: string }

// ---- power, cost, progress ----
export type Faction = { id: string; name: string; kind: 'old_energy'|'religious'|'military'|'regional_nationalist'|'labor'|'business'|'science'; regionIds: string[]; power: number; hostility: number; wants: string }
export type HumanCost = { deaths: number; famineDeaths: number; unrestDeaths: number; displaced: number; approval: number }
export type Requirement = { id: string; name: string; track: 'mars'|'outer_planets'|'longevity'|'population'|'infrastructure'; progress: number; unlockedTick?: number; prereqs: string[]; realWorld2026: string; url?: string; tier: 'proven'|'emerging'|'speculative'; costUsd?: number }
export type City = {
  id: string; name: string; regionId: string; lat: number; lon: number; foundedTick: number; population: number; reason: string; offWorld?: 'moon'|'mars'
  // v4: real cities (natural earth / geonames) carry real tick 0 populations. optional until the sim fills them
  countryId?: string; adminId?: string; real?: boolean; stats?: PlaceStats
}
export type Company = { id: string; name: string; sector: 'energy'|'food'|'transit'|'medicine'|'longevity'|'launch'|'materials'|'housing'|'computing'; regionId: string; foundedTick: number; workers: number; purpose: string }
export type Frontier = 'none'|'moon_landing'|'moon_base'|'mars_crewed'|'mars_settlement'|'mars_self_sustaining'|'asteroid_mining'|'outer_system'
export type Lesson = { id: string; fromRunId: string; generation: number; mistake: string; consequence: string; rule: string; timesRelevant: number }
export type Usage = { llmCalls: number; tokens: number }

// ---- world ----
export type Region = {
  id: string; name: string; lat: number; lon: number; color: string; population: number; share65plus: number; gdpUsd: number; energyTWh: number
  foodKcalPerCapita: number; education: number; faith: number; unrest: number; techLevel: number; compliance: number
  crowds: CrowdState[]; approval: number; lifeExpectancy: number; periodLifeExpectancy: number; fertility: number; diseaseBurden: number; travelHoursToNearest: number; whys: Why[]
  provenance: Record<string, Provenance>
  // v3: what the region looks like and how it feels, by group. optional until the sim fills them; the ui normalizes
  visual?: RegionVisual; emotionMix?: Mood; emotionByGroup?: { group: string; mood: Mood }[]
  // cause chains (B): this year's specific story and the stat trends behind it
  story?: Story | null; trends?: ChainTrend[]
}
export type Citizen = {
  id: string; regionId: string; name: string; age: number; sex: 'female'|'male'; skinTone: number
  hair: 'bald'|'buzz'|'short_straight'|'short_wavy'|'short_coily'|'afro'|'locs'|'braids'|'long_straight'|'long_wavy'|'bun'|'ponytail'
  hairColor: 'black'|'dark_brown'|'brown'|'blonde'|'red'|'gray'|'white'
  heightCm: number; build: 'slim'|'average'|'broad'; personalitySeed: number; job: string; belief: 'religious'|'secular'|'spiritual'
  archetype: Archetype; group: GroupKey; mood: Mood; behavior: Behavior; lifeEvents: LifeEvent[]; opinionOfCore: number; family: { partnerId?: string; kids: number }
  thought: string
  // v4: where they live and work and what their day looks like. optional until the sim fills them
  countryId?: string; cityId?: string; workplace?: Workplace; employed?: boolean; income?: number; spending?: number; dayPlan?: { hour: number; activity: Activity }[]
  // v5 (B): how they get around and what they wear today
  commuteMode?: CommuteMode; clothing?: Clothing
}
export type Law = { id: string; title: string; text: string; layer: Layer; enactedTick: number; support: number; compliance: number; vetoed?: boolean; policyKind: string; precedentIds: string[]; lovedBy: string[]; hatedBy: string[] }
export type Migration = { from: string; to: string; people: number; reason: string }
export type Budget = { food: number; energy: number; education: number; space: number; security: number; welfare: number; research: number }
export type ReligionPolicy = 'free'|'state_neutral'|'state_faith'|'discouraged'
export type SchoolPolicy = { purpose: string; curriculum: string[]; yearsRequired: number }
export type Decision = {
  tick: number; laws: Law[]; repeal: string[]; migrations: Migration[]; budget: Budget; religionPolicy: ReligionPolicy; schoolPolicy: SchoolPolicy; rationale: string; respondedToOverrides: string[]
  foundCities: Omit<City, 'id'|'population'|'foundedTick'>[]; charterCompanies: Omit<Company, 'id'|'workers'|'foundedTick'>[]; researchFocus: string[]; publicStatement: string; lessonsApplied: string[]
  // the core's reasoning (B): what it saw, what it chose, what it expected, and (two years later) what happened
  reasoning?: Reasoning
}
// significance 0..1 drives the chronicle (>= 0.6), highlight reels and hall of history. headline is a short title for lists
export type WorldEvent = { tick: number; regionId?: string; kind: 'famine'|'revolt'|'war'|'disaster'|'pandemic'|'breakthrough'|'launch'|'migration'|'law'|'injected'|'override'; text: string; severity: number; significance: number; headline?: string }
export type Override = { id: string; tick?: number; kind: 'inject_event'|'veto_law'|'force_budget'; regionId?: string; eventKind?: WorldEvent['kind']; severity?: number; lawId?: string; budget?: Partial<Budget> }
export type WorldStatus = 'alive'|'destroyed'|'complete'|'goal_achieved'
export type MoonStage = 'none'|'orbital'|'heavy_lift'|'life_support'|'lander'|'crewed_landing'

// world level state carried by every frame (B's sim state should include these fields)
export type WorldState = {
  requirements: Requirement[]; cities: City[]; companies: Company[]; frontier: Frontier; factions: Faction[]
  humanCost: HumanCost; globalPopulation: number; globalPeriodLifeExpectancy: number; lessonsKnown: number
  // v3 (optional until the sim fills them; the ui normalizes)
  space?: SpaceAsset[]; atmosphere?: { tint: string; haze: number }; flows?: Flow[]
  // v4 (optional until the sim fills them)
  countries?: Country[]; adminAreas?: AdminArea[]
  // cause chains (B): every link created since the previous frame
  causes?: CauseLink[]
  // v5 real world layer (B, src/lib/sim/world-layer.ts): infrastructure changed since the previous frame,
  // relative 0..1 activity for the baked road/rail segments, ports and airports at this hour, and the climate
  infra?: InfraDiff[]
  traffic?: { countries?: string[]; road: number[]; rail: number[]; port: number[]; air: number[] }
  climate?: { anomalyC: number; gtCo2PerYear: number }
}
export type Frame = {
  tick: number; date: string; regions: Region[]; citizens: Citizen[]; laws: Law[]; budget: Budget; religionPolicy: ReligionPolicy; schoolPolicy: SchoolPolicy
  moonStage: MoonStage; moonProgress: number; status: WorldStatus; newEvents: WorldEvent[]; decision?: Decision
} & WorldState
export type BaselineFrame = { tick: number; regions: Pick<Region,'id'|'population'|'foodKcalPerCapita'|'unrest'|'techLevel'|'education'>[]; moonProgress: number; status: WorldStatus }
export type RunSummary = {
  runId: string; generation: number; status: WorldStatus; endDate: string; ticks: number; score: number; causeOfDeath?: string; constitution: string; peakPopulation: number
  moonStage: MoonStage; topEvents: WorldEvent[]; baselineStatus: WorldStatus; baselineEndDate: string
  frontier: Frontier; peakPeriodLifeExpectancy: number; finalPopulation: number; citiesFounded: number; diseasesEradicated: string[]; humanCost: HumanCost; lessonsLearned: Lesson[]; lessonsApplied: number; usage?: Usage
  agentId: string
  epitaph?: Epitaph
}
// precedents: the library this run's laws cite. lessons: what the governor knew at the start of this run
export type RunRecord = {
  runId: string; generation: number; seed: number; constitution: string; frames: Frame[]; baseline: BaselineFrame[]; summary: RunSummary; live?: boolean; precedents?: Precedent[]; lessons?: Lesson[]
  agentId: string; snapshots: Snapshot[]; branchedFrom?: { runId: string; tick: number; agentId: string }
}
export type RunOptions = {
  runId: string; generation: number; seed: number; constitution: string; onFrame?: (f: Frame) => void; overrideDir?: string; live?: { msPerTick: number }; frameEvery?: number
  // the governing agent. optional only because scripts/live.ts and scripts/run-one.ts still pass it as optional; make it required once they always set it
  agentId?: string
  // branch: start from another run's snapshot at that tick instead of tick 0
  startFrom?: { runId: string; tick: number }
  // stop early at this tick (inclusive) instead of the horizon
  untilTick?: number
}

// ---- agents, lineage, comparison, history ----
// every run belongs to an Agent (a governor with a constitution). names are original sci-fi names, never real people or brands
export type Agent = {
  id: string; name: string; emblemSeed: number; philosophy: string; constitution: string; parentIds: string[]; origin: 'seed'|'mutation'|'crossover'; generation: number; protected: boolean
  runIds: string[]; worlds: number; deaths: number; bestScore: number; avgScore: number; bestFrontier: Frontier; bestPeriodLifeExpectancy: number; champion: boolean; retired: boolean
  // v3: optional until evolve assigns one; the ui derives one from the id
  archStyle?: ArchStyle
}
export type Snapshot = { tick: number; state: string } // compressed full WorldState, for branching
export type Divergence = { runA: string; runB: string; tick: number; decisionDiff: string; consequence: string }
export type HallEntry = { id: string; title: string; runId: string; agentId: string; tick: number; kind: 'first'|'record'|'catastrophe'|'milestone'; text: string }

// ---- slim data for long runs: the ui loads frames lazily around the scrubber ----
// one row per year (every 12 ticks), enough for stat races and timelines without full frames
export type YearRow = {
  tick: number; date: string; globalPopulation: number; globalPeriodLifeExpectancy: number; frontier: Frontier; moonProgress: number; approval: number; deaths: number; displaced: number; status: WorldStatus
  // v3 look for that year (C sends these; regions only lists the ones that have them)
  regions?: { id: string; visual?: RegionVisual; emotionMix?: Mood }[]
  flows?: Flow[]; space?: SpaceAsset[]; atmosphere?: { tint: string; haze: number }
}
// one row per governor decision, enough for the side by side diff table
export type DecisionRow = { tick: number; date: string; religionPolicy: ReligionPolicy; schoolPurpose: string; budget: Budget; lawsEnacted: string[]; citiesFounded: string[] }
// a run without frames: GET /api/runs/[id]?slim=1 and each entry of GET /api/compare. firstTick/lastTick bound the frames endpoint
export type SlimRun = Omit<RunRecord, 'frames' | 'baseline' | 'snapshots'> & { firstTick: number; lastTick: number; years: YearRow[]; decisions: DecisionRow[] }
export type CompareResponse = { seed: number; runs: SlimRun[]; divergences: Divergence[]; pending?: string[]; note?: string }
// GET /api/runs/[id]/frames?from=<tick>&to=<tick> (inclusive)
export type FramesResponse = { runId: string; from: number; to: number; frames: Frame[] }

// ---- live evolution status, for mission control ----
// GET /api/evolve/now. evolve.ts writes data/evolve-now.json after every frame, at most every 2s. 404 when nothing is evolving
export type EvolveNow = {
  pid?: number
  generation: number
  agentId: string | null
  runId: string | null
  worldIndex: number // 1-based position of this world in the generation
  worldsInGen: number
  latestFrame: Frame | null
  queue: { runId: string; agentId: string; seed: number }[] // worlds still waiting to run this generation
  recent: RunSummary[] // last finished worlds, newest first
  newLessons: Lesson[] // lessons added during this generation
  stats: { worldsLost: number; lessonsKnown: number; bestScore: number; champion: string | null; avgMinutesPerWorld: number | null; estWorldsByMorning: number | null }
  updatedAt: string // iso time of the last write
  // iso time the runner last proved it was alive. also sent in the 404 body when the runner is gone,
  // so mission control can say how long it has been offline
  lastHeartbeat?: string
}

// ---- v3: the multiverse. every world looks like its decisions ----

// all fractions 0..1. energyMix sums to 1. railLinks are region ids this region has rail to
export type RegionVisual = {
  energyMix: { solar: number; wind: number; nuclear: number; fossil: number; hydro: number }
  railLinks: string[]; farmland: number; forest: number; pollution: number; urbanDensity: number; lightDensity: number
  damage: { kind: 'none'|'famine'|'revolt'|'war'|'collapse'|'disaster'; level: number }
  landmarks: { kind: string; label: string; tick: number; lawId?: string }[]
}
export type SpaceAsset = {
  id: string; kind: 'station'|'moon_base'|'mars_habitat'|'asteroid_mine'|'probe'|'ship'; body: 'earth_orbit'|'moon'|'mars'|'asteroid_belt'|'outer'
  label: string; builtTick: number; status: 'active'|'dark'|'destroyed'; population?: number
}
// accent is a hex color
export type ArchStyle = { towerShape: 'stepped'|'rounded'|'spire'|'stacked'|'dome'; accent: string; roofStyle: 'flat'|'peaked'|'garden' }
export type Epitaph = { line: string; causeKind: RegionVisual['damage']['kind'] }
// people moving this tick. from/to are region ids
export type Flow = { from: string; to: string; toCityId?: string; people: number; reason: string; forced: boolean }
// effect: score delta attributed to the step (+ helped). confidence 0..1
export type Step = { id: string; text: string; kind: 'law'|'budget'|'policy'|'city'|'research'; helpedWorlds: string[]; hurtWorlds: string[]; effect: number; confidence: number }

// ---- v4: real places, living people ----

export type Trend = 'rising'|'stable'|'declining'
// population is people; housingCost is a multiple of local median income; every other stat is 0..1, higher is better
export type PlaceStats = { population: number; happiness: number; economy: number; livability: number; trend: Trend; foodSecurity: number; safety: number; health: number; jobs: number; housingCost: number; airQuality: number }
// id is ISO 3166-1 alpha-3. regionId is the governor-brief region this country rolls up into
export type Country = { id: string; name: string; regionId: string; stats: PlaceStats; provenance: Record<string, Provenance> }
// admin-1: states, provinces. id is ISO 3166-2 where one exists
export type AdminArea = { id: string; countryId: string; name: string; stats: PlaceStats }
export type Activity = 'sleeping'|'commuting'|'working'|'school'|'eating'|'shopping'|'socializing'|'resting'|'protesting'|'striking'|'praying'|'aid_line'|'moving'|'celebrating'|'idle'
export type Workplace = 'farm'|'factory'|'office'|'lab'|'clinic'|'school'|'shop'|'launch_site'|'construction'|'power_plant'|'none'

// ---- cause chains (B, src/lib/sim/causes.ts) ----
// every meaningful change is a link: what changed (with the number), because of what, by whom. walk causeIds back
// and nextIds forward for a chain like drought -> food prices -> protests -> law -> result
export type ByWhom = 'core' | 'nature' | 'people' | 'market' | 'observer' | `faction:${string}` | `crowd:${string}`
export type CauseLink = {
  id: string; tick: number; placeId: string
  what: string; value: number
  because: string
  byWhom: ByWhom
  lawId?: string; eventId?: string
  causeIds: string[]; nextIds: string[]
  stat?: string // set on yearly stat-change links
}
export type ChainTrend = { stat: string; direction: 'rising' | 'declining' | 'stable'; change: number; text: string }
// sentences are written from the chains, with real names, dates and numbers; chainIds[i] are the link ids behind sentences[i]
export type Story = { year: number; sentences: string[]; chainIds: string[][] }
export type Reasoning = { saw: string[]; chose: string[]; expected: string; outcome?: string }
