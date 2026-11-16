// full world snapshots for branching. the whole internal World (including every rng stream's state) is
// serialized to json, gzipped and base64 encoded. json round-trips doubles exactly, so a restored world
// continues bit-for-bit like the original.
import { brotliCompressSync, brotliDecompressSync, constants as Z, gunzipSync } from 'node:zlib'
import type { Snapshot } from '../types'
import { rngFromState } from './rng'
import { SEED_REGIONS, type World } from './state'
import { initRequirements } from './requirements'
import { ADMIN_SEEDS, CITY_SEEDS, COUNTRY_SEEDS } from './places'

// every 10 years: a branch replays at most 119 ticks from the nearest snapshot (~0.25 s), and records stay small
export const SNAPSHOT_EVERY = 120

type Plain = Omit<World, 'rng' | 'lessonsApplied' | 'regions' | 'lifeArchive' | 'countries'> & {
  countries: Omit<World['countries'][number], 'seed'>[]
  rng: Record<keyof World['rng'], number>
  lessonsApplied: string[]
  regions: (Omit<World['regions'][number], 'eduTargets'> & { eduTail: number[]; eduOffset: number })[]
}

export function snapshotWorld(w: World): Snapshot {
  // education reads its target from exactly 120 ticks back, so only the last 121 entries matter
  const offset = Math.max(0, w.tick - 121)
  const { lifeArchive: _lives, ...rest } = w
  void _lives
  const plain: Plain = {
    ...rest,
    rng: Object.fromEntries(Object.entries(w.rng).map(([k, f]) => [k, f.s])) as Plain['rng'],
    lessonsApplied: [...w.lessonsApplied],
    // real cities as compact rows (index order of CITY_SEEDS), static fields re-derived on restore
    realCities: w.realCities.map(c => [c.pop, c.damage, c.lastDiffPop]) as unknown as World['realCities'],
    // static country seed data is re-attached on restore (it never changes)
    countries: w.countries.map(k => { const { seed, ...c } = k; void seed; return c }),
    regions: w.regions.map(({ eduTargets, ...r }) => ({ ...r, r: { ...r.r, provenance: {} }, eduTail: eduTargets.slice(offset), eduOffset: offset })),
    // static requirement fields come back from NODES on restore; only the moving parts are stored
    requirements: w.requirements.map(q => ({ id: q.id, progress: q.progress, spend: q.spend, stall: q.stall, stallUntil: q.stallUntil, rolled: q.rolled, ...(q.unlockedTick !== undefined ? { unlockedTick: q.unlockedTick } : {}) })) as unknown as World['requirements'],
  }
  // brotli (prefix "br:"); older snapshots without the prefix are gzip
  return { tick: w.tick, state: 'br:' + brotliCompressSync(Buffer.from(JSON.stringify(plain)), { params: { [Z.BROTLI_PARAM_QUALITY]: 9, [Z.BROTLI_PARAM_LGWIN]: 22 } }).toString('base64') }
}

export function restoreWorld(s: Snapshot): World {
  const raw = s.state.startsWith('br:') ? brotliDecompressSync(Buffer.from(s.state.slice(3), 'base64')) : gunzipSync(Buffer.from(s.state, 'base64'))
  const plain = JSON.parse(raw.toString('utf8')) as Plain
  const rng = Object.fromEntries(Object.entries(plain.rng).map(([k, v]) => [k, rngFromState(v)])) as World['rng']
  const regions = plain.regions.map(({ eduTail, eduOffset, ...r }) => {
    const eduTargets: number[] = []
    eduTail.forEach((v, i) => { eduTargets[eduOffset + i] = v })
    const prov = SEED_REGIONS.find(x => x.id === r.r.id)?.provenance ?? {}
    return { ...r, r: { ...r.r, provenance: prov }, eduTargets }
  })
  const fresh = initRequirements()
  const requirements = (plain.requirements as unknown as { id: string }[]).map(q => ({ ...fresh.find(n => n.id === q.id)!, ...q })) as World['requirements']
  const countries = plain.countries.map(c => ({ ...c, seed: COUNTRY_SEEDS.find(x => x.id === c.id)! }))
  const rows = plain.realCities as unknown as [number, number, number][]
  const realCities = CITY_SEEDS.map((t, i) => ({ id: t.id, pop: rows[i][0], damage: rows[i][1], lastDiffPop: rows[i][2], adminIdx: ADMIN_SEEDS.findIndex(a => a.countryId === t.countryId && a.name === t.adminName) }))
  return { ...plain, rng, lessonsApplied: new Set(plain.lessonsApplied), regions, countries, requirements, realCities, lifeArchive: {} } as World
}
