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
export type City = { id: string; name: string; regionId: string; lat: number; lon: number; foundedTick: number; population: number; reason: string; offWorld?: 'moon'|'mars' }
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
}
export type Citizen = {
  id: string; regionId: string; name: string; age: number; sex: 'female'|'male'; skinTone: number
  hair: 'bald'|'buzz'|'short_straight'|'short_wavy'|'short_coily'|'afro'|'locs'|'braids'|'long_straight'|'long_wavy'|'bun'|'ponytail'
  hairColor: 'black'|'dark_brown'|'brown'|'blonde'|'red'|'gray'|'white'
  heightCm: number; build: 'slim'|'average'|'broad'; personalitySeed: number; job: string; belief: 'religious'|'secular'|'spiritual'
  archetype: Archetype; group: GroupKey; mood: Mood; behavior: Behavior; lifeEvents: LifeEvent[]; opinionOfCore: number; family: { partnerId?: string; kids: number }
  thought: string
}
export type Law = { id: string; title: string; text: string; layer: Layer; enactedTick: number; support: number; compliance: number; vetoed?: boolean; policyKind: string; precedentIds: string[]; lovedBy: string[]; hatedBy: string[] }
export type Migration = { from: string; to: string; people: number; reason: string }
export type Budget = { food: number; energy: number; education: number; space: number; security: number; welfare: number; research: number }
export type ReligionPolicy = 'free'|'state_neutral'|'state_faith'|'discouraged'
export type SchoolPolicy = { purpose: string; curriculum: string[]; yearsRequired: number }
export type Decision = {
  tick: number; laws: Law[]; repeal: string[]; migrations: Migration[]; budget: Budget; religionPolicy: ReligionPolicy; schoolPolicy: SchoolPolicy; rationale: string; respondedToOverrides: string[]
  foundCities: Omit<City, 'id'|'population'|'foundedTick'>[]; charterCompanies: Omit<Company, 'id'|'workers'|'foundedTick'>[]; researchFocus: string[]; publicStatement: string; lessonsApplied: string[]
}
export type WorldEvent = { tick: number; regionId?: string; kind: 'famine'|'revolt'|'war'|'disaster'|'pandemic'|'breakthrough'|'launch'|'migration'|'law'|'injected'|'override'; text: string; severity: number }
export type Override = { id: string; tick?: number; kind: 'inject_event'|'veto_law'|'force_budget'; regionId?: string; eventKind?: WorldEvent['kind']; severity?: number; lawId?: string; budget?: Partial<Budget> }
export type WorldStatus = 'alive'|'destroyed'|'complete'|'goal_achieved'
export type MoonStage = 'none'|'orbital'|'heavy_lift'|'life_support'|'lander'|'crewed_landing'

// world level state carried by every frame (B's sim state should include these fields)
export type WorldState = {
  requirements: Requirement[]; cities: City[]; companies: Company[]; frontier: Frontier; factions: Faction[]
  humanCost: HumanCost; globalPopulation: number; globalPeriodLifeExpectancy: number; lessonsKnown: number
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
}
// precedents: the library this run's laws cite. lessons: what the governor knew at the start of this run
export type RunRecord = { runId: string; generation: number; seed: number; constitution: string; frames: Frame[]; baseline: BaselineFrame[]; summary: RunSummary; live?: boolean; precedents?: Precedent[]; lessons?: Lesson[] }
export type RunOptions = { runId: string; generation: number; seed: number; constitution: string; onFrame?: (f: Frame) => void; overrideDir?: string; live?: { msPerTick: number }; frameEvery?: number }
