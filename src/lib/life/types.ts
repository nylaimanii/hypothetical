// one life: the data model. agent D owns src/lib/life/**. the shared world contract (src/lib/types.ts) is
// read-only here; anything new about a single person lives in this file.
//
// a life is one chosen person born 2026-11 in a real city inside a finished world's recording. the world
// frames are the environment; the person's choices never write back into the world (one person barely
// moves it), so many lives can run inside one deterministic world.
import type { Emotion, Mood, Provenance } from '../types'

export type Sex = 'female' | 'male'
export type HomeType = 'family_home' | 'informal_settlement' | 'rented_room' | 'apartment' | 'house' | 'shelter' | 'care_home'
export type Stage = 'baby' | 'child' | 'teen' | 'adult' | 'elder'
// what they are doing this month, for the site to stage their day
export type LifeActivity = 'infant' | 'school' | 'working' | 'unemployed' | 'caregiving' | 'studying' | 'retired' | 'sick' | 'migrating' | 'protesting' | 'grieving'
export type Workplace = 'farm' | 'factory' | 'office' | 'lab' | 'clinic' | 'school' | 'shop' | 'launch_site' | 'construction' | 'power_plant' | 'none'

export type Look = {
  skinTone: number // monk 1-10
  hair: 'bald' | 'buzz' | 'short_straight' | 'short_wavy' | 'short_coily' | 'afro' | 'locs' | 'braids' | 'long_straight' | 'long_wavy' | 'bun' | 'ponytail'
  hairColor: 'black' | 'dark_brown' | 'brown' | 'blonde' | 'red' | 'gray' | 'white'
  adultHeightCm: number
  build: 'slim' | 'average' | 'broad'
}

// big five temperament, each 0..1 (0.5 = average), seeded per person. john & srivastava 1999,
// https://www.ocf.berkeley.edu/~johnlab/pdfs/john&srivastava1999.pdf . shapes choices (in the prompt and in the
// twin's defaults), mood set point, friendships and health (see person.ts for the cited effects)
export type Temperament = { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; neuroticism: number }

// what childhood left behind (felitti et al. 1998 adverse childhood experiences, https://doi.org/10.1016/S0749-3797(98)00017-8)
export type ChildhoodMarks = { hungerMonths: number; displaced: boolean; lostParent: boolean; famineYears: number; stableHome: number; schoolYearsBy16: number; trust: number }

export type Place = { cityId: string; city: string; countryId: string; country: string; regionId: string; lat: number; lon: number }

export type Kin = {
  id: string; name: string
  relation: 'mother' | 'father' | 'sibling' | 'partner' | 'child' | 'grandchild'
  sex: Sex
  bornTick: number // negative for people born before 2026-11
  diedTick?: number; diedOf?: string
  parentId?: string // for grandchildren: which child is their parent
  bond: number // 0..1 how close they are to the chosen person
  sinceTick?: number; untilTick?: number // partners: together from / apart since
}

export type Job = { title: string; workplace: Workplace; helping: boolean; sinceTick: number }

// one row per month. short keys would save bytes, but readable beats tiny here: a life is ~1200 rows, ~400 kB
export type MonthSnap = {
  tick: number; age: number // age in years, one decimal
  cityId: string; home: HomeType
  job: string | null; workplace: Workplace; activity: LifeActivity
  income: number // usd per month, nominal 2026 dollars
  savings: number // usd
  health: number // 0..1 physical health
  mood: Partial<Mood> // the three strongest emotions, 0..1
  valence: number // 0..1 how good the month felt
  relationships: number // 0..1 depth index this month
  kids: number; partner: boolean
  behavior: string[] // habits in effect: 'smokes', 'exercises', 'volunteers', 'saves', 'prays', ...
  hunger?: boolean // the market was short this month
}

export type MilestoneKind =
  | 'childhood' | 'schooling' | 'path' | 'habits' | 'friends' | 'first_job' | 'move' | 'partner' | 'children'
  | 'money' | 'health' | 'career' | 'help_others' | 'faith' | 'protest' | 'famine' | 'pandemic' | 'disaster'
  | 'law' | 'job_loss' | 'illness' | 'loss' | 'parents' | 'retirement' | 'late_life' | 'legacy'

export type MilestoneOption = { id: string; label: string; tags: string[] }

export type Milestone = {
  id: string; tick: number; age: number; kind: MilestoneKind
  question: string
  options: MilestoneOption[]
  choice: string // option id
  reasoning: string // their reason, in their voice
  thought: string // their journal line about it
  lessonIds: string[] // lessons from earlier lives the person was given
  lessonApplied: string | null // the lesson they say shaped this choice
  // parents: under ~16 the family decides by rule from its situation. rule: the llm failed (logged) or the twin
  decidedBy: 'llm' | 'rule' | 'parents'
  decider: 'self' | 'parents'
  outcome: string[] // what happened next, filled by the rules (deterministic + the life's luck stream)
  caption: string // one line for the site, "2031 · finished school. chose nursing over the factory, because ..."
  world?: string // the world event that triggered it, if any
}

export type LifeEventKind = 'birth' | 'personal' | 'world' | 'milestone' | 'family' | 'health' | 'death'
export type LifeEvent = {
  tick: number; kind: LifeEventKind; text: string; severity: number // 0..1
  worldKind?: 'famine' | 'revolt' | 'war' | 'disaster' | 'pandemic' | 'breakthrough' | 'launch' | 'migration' | 'law' | 'injected' | 'override'
  emotion?: Emotion // the flinch: the feeling it causes right away
}

export type ScoreParts = { healthyYears: number; relationships: number; contribution: number; meaning: number; wellbeing: number }
export type LifeScore = ScoreParts & { total: number; harm: number; healthyYearsLived: number }

export type LifeLesson = {
  id: string; fromLifeId: string; worldId: string; lifeNo: number; createdAt: string
  kind: MilestoneKind // which kind of milestone it is about
  choice: string; ledTo: string; rule: string
  tags: string[] // the situations it applies to: 'famine', 'poverty', 'migration', 'young_adult', 'new_parent', ...
  regionId: string
  lifeScore: number
  simVersion: string // the sim version of the world it was learned in
  verified: boolean // false when carried over from an older sim version, until a life on the current version gains with it
  timesGiven: number; timesApplied: number
  // running mean of (life score - its no-lessons twin's score) over lives that applied it. null until applied once
  meanGain: number | null
}

export type JournalLine = { year: number; age: number; text: string; byLlm: boolean }

// the environment the person lived in, per year, so the site never needs the 25 MB world recording
export type EnvYear = {
  tick: number; regionId: string
  food: number // 0..1 food security (kcal per head / 2500 capped)
  prices: number // food price index, 1 = normal
  unrest: number; economy: number // economy: region gdp per head relative to the 2026 world mean
  health: number // 1 - disease burden
  lifeExpectancy: number
  damage: 'none' | 'famine' | 'revolt' | 'war' | 'collapse' | 'disaster'
  damageLevel: number
  status: 'alive' | 'destroyed' | 'complete' | 'goal_achieved'
  frontier: string
}

export type LifeRecord = {
  lifeId: string // `${worldId}-life-${lifeNo}`
  worldId: string; worldSeed: number; worldScore: number; worldStatus: string
  lifeNo: number // 1-based: life #N in this world
  seed: number
  simVersion: string
  worldVersion: string // the world's sim version, or 'untagged' when the recording carries none
  name: string; sex: Sex; look: Look; temperament: Temperament
  childhood: ChildhoodMarks | null // filled at 16
  birthTick: 0; deathTick: number | null; deathAge: number | null; deathCause: string | null
  birthplace: Place; places: (Place & { fromTick: number })[]
  family: { quintile: number; story: string } // how lucky the start was: 1 poorest fifth .. 5 richest
  kin: Kin[]
  snaps: MonthSnap[]
  milestones: Milestone[]
  events: LifeEvent[]
  journal: JournalLine[]
  env: EnvYear[]
  laws: { tick: number; title: string; text: string }[]
  score: LifeScore | null
  twin: { score: LifeScore; deathAge: number; deathCause: string } | null // same person, same luck, default choices, no lessons
  lessonsGiven: string[] // every lesson id shown at any milestone
  lessonsLeft: LifeLesson[] // what they leave the next person
  epitaph: string | null // "amara okafor · 2026–2101 · lagos → new lagos · nurse, mother of 3"
  usage: { llmCalls: number; tokens: number; ruleFallbacks: number }
  provenance: Record<string, Provenance>
  createdAt: string
  status: 'running' | 'done'
}

// what the home page needs, one row per life, kept in data/lives/<worldId>/index.json
export type LifeSummary = Pick<LifeRecord, 'lifeId' | 'worldId' | 'lifeNo' | 'name' | 'sex' | 'look' | 'birthplace' | 'deathTick' | 'deathAge' | 'deathCause' | 'epitaph' | 'status'> & {
  score: number | null; twinScore: number | null; parts: ScoreParts | null; lastCity: string; job: string | null; kids: number; lessonsLeft: string[]
  createdAt: string
}
