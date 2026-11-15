// MOCK: v3 look of each world. every world gets a profile so the four mock worlds read differently at a glance:
// a dense solar megacity world, a spread-out nuclear forest world, a fossil world under brown haze, and a collapsed one.
// all numbers here are ESTIMATE placeholders for the ui, never presented as real.
import type { ArchStyle, Epitaph, Flow, Frame, Mood, Region, RegionVisual, RunRecord, SpaceAsset } from '@/lib/types'
import { EMOTIONS } from './mood'

type Profile = {
  mix: RegionVisual['energyMix']; urban: number; light: number; forest: number; farm: number; pollution: number
  rail: number; tint: string; haze: number; damage?: { kind: RegionVisual['damage']['kind']; from: number }; space: number
  landmarks: { regionId: string; kind: string; label: string; year: number; lawId?: string }[]
  epitaph?: Epitaph
}

const P: Record<string, Profile> = {
  // meridian ii: megacities on solar
  solar: {
    mix: { solar: 0.58, wind: 0.14, nuclear: 0.08, fossil: 0.08, hydro: 0.12 }, urban: 0.9, light: 0.95, forest: 0.35, farm: 0.45, pollution: 0.08,
    rail: 3, tint: '#bfe3ff', haze: 0.05, space: 1,
    landmarks: [
      { regionId: 'mena', kind: 'solar_belt', label: 'the sahara array', year: 3, lawId: 'law-grid' },
      { regionId: 'sas', kind: 'arcology', label: 'new lagos stack', year: 6 },
      { regionId: 'nam', kind: 'launch_tower', label: 'gulf launch tower', year: 8, lawId: 'law-launch' },
    ],
  },
  // halcyon ii: towns spread through regrown forest, nuclear baseload
  nuclear: {
    mix: { solar: 0.12, wind: 0.16, nuclear: 0.52, fossil: 0.06, hydro: 0.14 }, urban: 0.3, light: 0.5, forest: 0.85, farm: 0.4, pollution: 0.05,
    rail: 2, tint: '#d6f5e3', haze: 0.08, space: 0.6,
    landmarks: [
      { regionId: 'weu', kind: 'reactor_park', label: 'the quiet reactors', year: 4, lawId: 'law-grid' },
      { regionId: 'sam', kind: 'forest_reserve', label: 'amazon regrowth line', year: 7 },
    ],
  },
  // meridian ii × solace: kept burning coal for the rocket schedule
  fossil: {
    mix: { solar: 0.08, wind: 0.05, nuclear: 0.05, fossil: 0.74, hydro: 0.08 }, urban: 0.65, light: 0.75, forest: 0.15, farm: 0.6, pollution: 0.8,
    rail: 1, tint: '#d9b98a', haze: 0.45, space: 0.8,
    landmarks: [
      { regionId: 'eas', kind: 'stack_field', label: 'the hundred stacks', year: 2 },
      { regionId: 'eeu', kind: 'pipeline', label: 'northern pipeline', year: 5 },
    ],
  },
  // kestrel: collapsed
  collapse: {
    mix: { solar: 0.1, wind: 0.08, nuclear: 0.12, fossil: 0.6, hydro: 0.1 }, urban: 0.55, light: 0.6, forest: 0.3, farm: 0.5, pollution: 0.5,
    rail: 1, tint: '#9a9a9a', haze: 0.55, space: 0.3, damage: { kind: 'collapse', from: 0.55 },
    landmarks: [{ regionId: 'wca', kind: 'monument', label: 'the unity pillar', year: 2 }],
    epitaph: { line: 'it built the pillar before it built the granaries.', causeKind: 'collapse' },
  },
  // vesper × atlas: one corridor, then revolt
  revolt: {
    mix: { solar: 0.3, wind: 0.1, nuclear: 0.1, fossil: 0.4, hydro: 0.1 }, urban: 0.7, light: 0.7, forest: 0.3, farm: 0.4, pollution: 0.35,
    rail: 2, tint: '#c9b6a4', haze: 0.3, space: 0.9, damage: { kind: 'revolt', from: 0.6 },
    landmarks: [{ regionId: 'sam', kind: 'launch_corridor', label: 'the single corridor', year: 3, lawId: 'law-launch' }],
    epitaph: { line: 'it reached for the moon with one hand and closed the other into a fist.', causeKind: 'revolt' },
  },
  // meridian iii: hydro and wind, middling density
  hydro: {
    mix: { solar: 0.22, wind: 0.3, nuclear: 0.1, fossil: 0.1, hydro: 0.28 }, urban: 0.6, light: 0.7, forest: 0.55, farm: 0.55, pollution: 0.12,
    rail: 2, tint: '#cfe8f7', haze: 0.08, space: 1,
    landmarks: [{ regionId: 'esa', kind: 'dam', label: 'great rift dam', year: 5 }],
  },
}

export const MOCK_LOOK: Record<string, keyof typeof P> = {
  'mock-g3-0007': 'solar', 'mock-g2-0012': 'nuclear', 'mock-g3-0015': 'fossil', 'mock-g2-0031': 'collapse', 'mock-g1-0009': 'revolt', 'mock-g3-0021': 'hydro',
}

const NEIGHBORS: Record<string, string[]> = {
  nam: ['mes'], mes: ['nam', 'sam'], sam: ['mes'], weu: ['eeu', 'mena'], eeu: ['weu', 'eas', 'mena'], mena: ['weu', 'wca', 'esa', 'sas'],
  wca: ['mena', 'esa'], esa: ['wca', 'mena'], sas: ['mena', 'sea', 'eas'], eas: ['eeu', 'sas', 'sea'], sea: ['sas', 'eas', 'oce'], oce: ['sea'],
}

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296 }
const clamp = (v: number) => Math.max(0, Math.min(1, v))
const r2 = (v: number) => Math.round(v * 100) / 100

function mixFor(base: RegionVisual['energyMix'], id: string, t: number): RegionVisual['energyMix'] {
  // regions start near a 2026 mix and drift toward the world's profile
  const start = { solar: 0.05, wind: 0.07, nuclear: 0.09, fossil: 0.62, hydro: 0.17 }
  const j = hash(id) * 0.2 - 0.1
  const raw = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, Math.max(0.01, start[k as keyof typeof start] + (v - start[k as keyof typeof start]) * clamp(t * 1.4) + (k === 'solar' ? j : k === 'fossil' ? -j : 0))])) as RegionVisual['energyMix']
  const sum = Object.values(raw).reduce((a, b) => a + b, 0)
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, r2(v / sum)])) as RegionVisual['energyMix']
}

function avgMood(moods: Mood[]): Mood {
  const m = Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as Mood
  if (!moods.length) return m
  for (const x of moods) for (const e of EMOTIONS) m[e] += x[e] / moods.length
  for (const e of EMOTIONS) m[e] = r2(m[e])
  return m
}

function regionV3(p: Profile, r: Region, f: Frame, t: number, last: boolean): Region {
  const j = hash(r.id)
  const dmgT = p.damage ? clamp((t - p.damage.from) / (1 - p.damage.from)) : 0
  const dmgLevel = p.damage ? r2(clamp(dmgT * (0.6 + j * 0.5) + (last ? 0.25 : 0))) : r.unrest > 0.6 ? r2(r.unrest - 0.4) : 0
  const ruin = p.damage ? dmgLevel : 0
  const visual: RegionVisual = {
    energyMix: mixFor(p.mix, r.id, t),
    railLinks: (NEIGHBORS[r.id] ?? []).slice(0, Math.max(0, Math.round(p.rail * clamp(t * 2) + j - 0.4))),
    farmland: r2(clamp(p.farm * (0.7 + j * 0.6) * (1 - ruin * 0.8))),
    forest: r2(clamp(0.3 + (p.forest - 0.3) * clamp(t * 1.2) + (j - 0.5) * 0.2)),
    pollution: r2(clamp(0.3 + (p.pollution - 0.3) * clamp(t * 1.3) + ruin * 0.2)),
    urbanDensity: r2(clamp(0.35 + (p.urban - 0.35) * clamp(t * 1.2) + (j - 0.5) * 0.2)),
    lightDensity: r2(clamp((0.45 + (p.light - 0.45) * clamp(t * 1.2)) * (1 - ruin))),
    damage: { kind: dmgLevel > 0 ? (p.damage?.kind ?? (r.unrest > 0.6 ? 'revolt' : 'none')) : 'none', level: dmgLevel },
    landmarks: p.landmarks.filter((l) => l.regionId === r.id && l.year * 12 <= f.tick).map((l) => ({ kind: l.kind, label: l.label, tick: l.year * 12, lawId: l.lawId })),
  }
  const here = f.citizens.filter((c) => c.regionId === r.id)
  const groups = new Map<string, Mood[]>()
  for (const c of here) { const k = c.group.ageBand; groups.set(k, [...(groups.get(k) ?? []), c.mood]) }
  return { ...r, visual, emotionMix: avgMood(here.map((c) => c.mood)), emotionByGroup: [...groups].map(([group, ms]) => ({ group, mood: avgMood(ms) })) }
}

const FRONTIER_ORDER = ['none', 'moon_landing', 'moon_base', 'mars_crewed', 'mars_settlement', 'mars_self_sustaining', 'asteroid_mining', 'outer_system']

function spaceFor(p: Profile, f: Frame, dead: boolean, deathTick: number): SpaceAsset[] {
  const fr = FRONTIER_ORDER.indexOf(f.frontier)
  const out: SpaceAsset[] = []
  const add = (a: Omit<SpaceAsset, 'status'>, ok: boolean) => { if (ok && a.builtTick <= f.tick) out.push({ ...a, status: dead && f.tick >= deathTick ? (a.kind === 'probe' ? 'dark' : 'destroyed') : 'active' }) }
  add({ id: 'st-1', kind: 'station', body: 'earth_orbit', label: 'orbital yard', builtTick: Math.round(30 / p.space), population: 40 }, f.moonProgress > 0.25)
  add({ id: 'pr-1', kind: 'probe', body: 'outer', label: 'long look probe', builtTick: Math.round(60 / p.space) }, f.moonProgress > 0.4)
  add({ id: 'sh-1', kind: 'ship', body: 'moon', label: 'cargo tug', builtTick: Math.round(70 / p.space) }, f.moonProgress > 0.6)
  add({ id: 'mb-1', kind: 'moon_base', body: 'moon', label: 'shackleton dome', builtTick: Math.round(96 / p.space), population: 120 }, fr >= 2 || f.moonProgress >= 1)
  add({ id: 'mh-1', kind: 'mars_habitat', body: 'mars', label: 'first mars habitat', builtTick: Math.round(150 / p.space), population: 30 }, fr >= 3)
  add({ id: 'am-1', kind: 'asteroid_mine', body: 'asteroid_belt', label: 'ceres claim', builtTick: Math.round(160 / p.space) }, fr >= 6)
  return out
}

function flowsFor(f: Frame, p: Profile, t: number): Flow[] {
  const out: Flow[] = (f.decision?.migrations ?? []).map((m) => ({ ...m, forced: true }))
  // voluntary moves toward the places that are working
  const byRegion = [...f.regions].sort((a, b) => b.approval - a.approval)
  const best = byRegion[0], worst = byRegion[byRegion.length - 1]
  if (best && worst && best.id !== worst.id) {
    const city = f.cities.filter((c) => c.regionId === best.id && !c.offWorld).sort((a, b) => b.population - a.population)[0]
    out.push({ from: worst.id, to: best.id, toCityId: city?.id, people: Math.round(worst.population * 0.004 * (0.5 + worst.unrest)), reason: worst.foodKcalPerCapita < 2300 ? 'food' : 'jobs', forced: false })
  }
  if (p.damage && t > p.damage.from) {
    const flee = byRegion[Math.floor(byRegion.length / 2)]
    if (flee && best && flee.id !== best.id) out.push({ from: flee.id, to: best.id, people: Math.round(flee.population * 0.01 * t), reason: p.damage.kind === 'collapse' ? 'fleeing the collapse' : 'fleeing the fighting', forced: false })
  }
  return out.filter((x) => x.people > 0)
}

export function applyV3(rec: RunRecord): RunRecord {
  const key = MOCK_LOOK[rec.runId]
  if (!key) return rec
  const p = P[key]
  const n = rec.frames.length
  const lastTick = rec.frames[n - 1]?.tick ?? 1
  const dead = rec.summary.status === 'destroyed'
  const frames = rec.frames.map((f, i) => {
    const t = f.tick / Math.max(1, lastTick)
    const last = dead && i === n - 1
    const pollution = p.pollution * clamp(t * 1.3)
    return {
      ...f,
      regions: f.regions.map((r) => regionV3(p, r, f, t, last)),
      space: spaceFor(p, f, dead, lastTick),
      atmosphere: { tint: p.damage && t > p.damage.from ? '#8f8f8f' : p.tint, haze: r2(clamp(p.haze * clamp(t * 1.3) + pollution * 0.2 + (last ? 0.3 : 0))) },
      flows: flowsFor(f, p, t),
    }
  })
  return { ...rec, frames, summary: { ...rec.summary, ...(p.epitaph && dead ? { epitaph: p.epitaph } : {}) } }
}

// every agent gets an architecture. seeds are fixed, offspring inherit the parent's shape with their own accent
const SEED_ARCH: Record<string, ArchStyle> = {
  'long-now': { towerShape: 'stepped', accent: '#c9a227', roofStyle: 'garden' },
  meridian: { towerShape: 'rounded', accent: '#e8a13a', roofStyle: 'garden' },
  halcyon: { towerShape: 'dome', accent: '#6fb3a0', roofStyle: 'peaked' },
  vesper: { towerShape: 'spire', accent: '#8a7bd1', roofStyle: 'flat' },
  atlas: { towerShape: 'stacked', accent: '#5b8bd9', roofStyle: 'flat' },
  solace: { towerShape: 'dome', accent: '#d98aa6', roofStyle: 'garden' },
  kestrel: { towerShape: 'spire', accent: '#b5653a', roofStyle: 'peaked' },
}
const ACCENTS = ['#e8a13a', '#6fb3a0', '#8a7bd1', '#5b8bd9', '#d98aa6', '#c9a227', '#7fae4e', '#4fa3c7']
export function archStyleFor(id: string): ArchStyle {
  const root = Object.keys(SEED_ARCH).find((k) => id === k || id.startsWith(`${k}-`))
  const base = root ? SEED_ARCH[root] : { towerShape: (['stepped', 'rounded', 'spire', 'stacked', 'dome'] as const)[Math.floor(hash(id) * 5)], accent: '#888888', roofStyle: 'flat' as const }
  if (root === id) return base
  return { ...base, accent: ACCENTS[Math.floor(hash(id) * ACCENTS.length)] }
}
