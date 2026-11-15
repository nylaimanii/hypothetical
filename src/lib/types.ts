// shared contract. only agent A edits this file.
// units: all 0..1 fields are fractions (education, faith, unrest, techLevel, compliance, share65plus,
// law support/compliance, moonProgress, event severity). Citizen.mood: 0 angry, 0.5 neutral, 1 happy.
// gdpUsd: total usd per year. energyTWh: per year. Budget values are fractions that sum to 1.
// dates are 'YYYY-MM'. launch events whose text contains 'fail' render as a failed launch.

export type Layer = 'physics'|'biology'|'government'|'economy'|'tech'|'religion'|'media'|'family'
export type Provenance = { kind: 'SOURCED'|'ESTIMATE'; url?: string }
export type Region = { id: string; name: string; lat: number; lon: number; color: string; population: number; share65plus: number; gdpUsd: number; energyTWh: number; foodKcalPerCapita: number; education: number; faith: number; unrest: number; techLevel: number; compliance: number; provenance: Record<string, Provenance> }
export type Citizen = { id: string; regionId: string; name: string; age: number; sex: 'female'|'male'; skinTone: number; hair: 'bald'|'buzz'|'short_straight'|'short_wavy'|'short_coily'|'afro'|'locs'|'braids'|'long_straight'|'long_wavy'|'bun'|'ponytail'; hairColor: 'black'|'dark_brown'|'brown'|'blonde'|'red'|'gray'|'white'; heightCm: number; build: 'slim'|'average'|'broad'; personalitySeed: number; job: string; belief: 'religious'|'secular'|'spiritual'; mood: number; thought: string }
export type Law = { id: string; title: string; text: string; layer: Layer; enactedTick: number; support: number; compliance: number; vetoed?: boolean }
export type Migration = { from: string; to: string; people: number; reason: string }
export type Budget = { food: number; energy: number; education: number; space: number; security: number; welfare: number; research: number }
export type ReligionPolicy = 'free'|'state_neutral'|'state_faith'|'discouraged'
export type SchoolPolicy = { purpose: string; curriculum: string[]; yearsRequired: number }
export type Decision = { tick: number; laws: Law[]; repeal: string[]; migrations: Migration[]; budget: Budget; religionPolicy: ReligionPolicy; schoolPolicy: SchoolPolicy; rationale: string; respondedToOverrides: string[] }
export type WorldEvent = { tick: number; regionId?: string; kind: 'famine'|'revolt'|'war'|'disaster'|'pandemic'|'breakthrough'|'launch'|'migration'|'law'|'injected'|'override'; text: string; severity: number }
export type Override = { id: string; tick?: number; kind: 'inject_event'|'veto_law'|'force_budget'; regionId?: string; eventKind?: WorldEvent['kind']; severity?: number; lawId?: string; budget?: Partial<Budget> }
export type WorldStatus = 'alive'|'destroyed'|'moon'|'stagnated'
export type MoonStage = 'none'|'orbital'|'heavy_lift'|'life_support'|'lander'|'crewed_landing'
export type Frame = { tick: number; date: string; regions: Region[]; citizens: Citizen[]; laws: Law[]; budget: Budget; religionPolicy: ReligionPolicy; schoolPolicy: SchoolPolicy; moonStage: MoonStage; moonProgress: number; status: WorldStatus; newEvents: WorldEvent[]; decision?: Decision }
export type BaselineFrame = { tick: number; regions: Pick<Region,'id'|'population'|'foodKcalPerCapita'|'unrest'|'techLevel'|'education'>[]; moonProgress: number; status: WorldStatus }
export type RunSummary = { runId: string; generation: number; status: WorldStatus; endDate: string; ticks: number; score: number; causeOfDeath?: string; constitution: string; peakPopulation: number; moonStage: MoonStage; topEvents: WorldEvent[]; baselineStatus: WorldStatus; baselineEndDate: string }
export type RunRecord = { runId: string; generation: number; seed: number; constitution: string; frames: Frame[]; baseline: BaselineFrame[]; summary: RunSummary; live?: boolean }
export type RunOptions = { runId: string; generation: number; seed: number; constitution: string; onFrame?: (f: Frame) => void; overrideDir?: string; live?: { msPerTick: number }; frameEvery?: number }
