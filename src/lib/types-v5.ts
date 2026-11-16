// v5 contract additions, owned by agent B (A imports from here; A's types.ts stays untouched).
// every number the sim produces from these is SOURCED or ESTIMATE, and every change feeds the cause chains.
import type { Provenance } from './types'

// ---------- cause chains (already emitted on frames since "cause chains + specific stories") ----------
export type ByWhom = 'core' | 'nature' | 'people' | 'market' | 'observer' | `faction:${string}` | `crowd:${string}`
export type CauseLink = {
  id: string; tick: number; placeId: string
  what: string; value: number; because: string; byWhom: ByWhom
  lawId?: string; eventId?: string; causeIds: string[]; nextIds: string[]; stat?: string; sig?: number
}
export type StatTrend = { stat: string; direction: 'rising' | 'declining' | 'stable'; change: number; text: string }
export type Story = { year: number; sentences: string[]; chainIds: string[][] }
export type Reasoning = { saw: string[]; chose: string[]; expected: string; outcome?: string }

// ---------- phase 1: the real world layer ----------
export type CommuteMode = 'walk' | 'bike' | 'transit' | 'car' | 'motorbike' | 'none'
export type Clothing = { layer: 'light' | 'medium' | 'warm' | 'heavy'; rain: boolean; work: 'none' | 'uniform' | 'hi_vis' | 'scrubs' | 'lab_coat' | 'farm' | 'suit' }
export type Weather = { tempC: number; precipMm: number; kind: 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'heat' }
// local life per country, sourced or estimated (see data/geo/sources.md)
export type LocalLife = {
  commuteShare: Record<Exclude<CommuteMode, 'none'>, number>
  jobMix: { agriculture: number; industry: number; services: number }
  carsPer1000: number; farmType: 'smallholder' | 'mixed' | 'industrial' | 'pastoral'; nightlife: number
  provenance: Record<string, Provenance>
}
// infrastructure that exists in 2026 and can change. diffs are recorded against the baked 2026 baseline
export type InfraKind = 'city' | 'plant' | 'rail' | 'road' | 'airport' | 'port' | 'datacenter' | 'chokepoint'
export type InfraDiff =
  | { tick: number; kind: 'plant'; op: 'built'; id: string; fuel: string; mw: number; lat: number; lon: number; countryId: string; because: string }
  // retired plants: look up fuel, size and location in data/geo/plants.json by id
  | { tick: number; kind: 'plant'; op: 'retired'; id: string; countryId: string; because: string }
  | { tick: number; kind: 'rail'; op: 'built'; id: string; from: string; to: string; because: string; lawId?: string }
  | { tick: number; kind: 'datacenter'; op: 'attacked' | 'built'; id: string; because: string }
  | { tick: number; kind: 'chokepoint'; op: 'closed'; id: string; severity: number; until: number; because: string }
  | { tick: number; kind: 'city'; op: 'grew' | 'shrank' | 'damaged' | 'founded' | 'abandoned'; id: string; population: number; damage?: number; because: string }
// relative traffic 0..1 for the baked segments and hubs, by hour of a typical day this year
export type TrafficFrame = { roads: number[]; rail: number[]; ports: number[]; airports: number[] }

// per-state stats live in a lazy file per run: data/runs/<runId>.places.json
export type PlaceStatKey = 'population' | 'happiness' | 'economy' | 'livability' | 'foodSecurity' | 'safety' | 'health' | 'jobs' | 'housingCost' | 'airQuality'
export type PlacesFile = {
  runId: string
  // admin-1 areas in a fixed order; per year, one row of numbers per area in `keys` order
  areas: { id: string; countryId: string; name: string }[]
  keys: PlaceStatKey[]
  years: { tick: number; rows: number[][]; trends: ('rising' | 'stable' | 'declining')[]; stories: (string | null)[] }[]
}

// why-driver sources by label: frames leave Why.drivers[].source out to stay small; look the url up here
export const WHY_SOURCES: Record<string, string> = {
  'crowd outrage': 'https://www.nationalaffairs.com/public_interest/detail/up-and-down-with-ecologythe-issue-attention-cycle',
  'family policy': 'https://en.wikipedia.org/wiki/Demographics_of_Hungary',
  'hunger deaths': 'https://www.fao.org/3/i4646e/i4646e.pdf',
  hunger: 'https://www.fao.org/3/i4646e/i4646e.pdf',
  'long-run decline': 'https://population.un.org/wpp/',
  'medicine and health systems': 'https://doi.org/10.1126/science.1069675',
  'pandemic deaths': 'https://doi.org/10.1073/pnas.2105482118',
  'people saying what is safe to say': 'https://en.wikipedia.org/wiki/Preference_falsification',
  'research and diffusion': 'https://uis.unesco.org/en/topic/research-and-development',
  'settling back': 'https://www.worldbank.org/en/publication/worldwide-governance-indicators',
}

// where a pip lives (phase 2 housing). rentShare: rent or mortgage as a share of the household's income
export type HomeKind = 'owned' | 'rented' | 'social' | 'informal' | 'camp' | 'family'
export type Home = { home: HomeKind; rentShare: number }
