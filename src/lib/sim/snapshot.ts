// full world snapshots for branching. the whole internal World (including every rng stream's state) is
// serialized to json, gzipped and base64 encoded. json round-trips doubles exactly, so a restored world
// continues bit-for-bit like the original.
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Snapshot } from '../types'
import { rngFromState } from './rng'
import type { World } from './state'

export const SNAPSHOT_EVERY = 60

type Plain = Omit<World, 'rng' | 'lessonsApplied' | 'regions' | 'lifeArchive'> & {
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
    regions: w.regions.map(({ eduTargets, ...r }) => ({ ...r, eduTail: eduTargets.slice(offset), eduOffset: offset })),
  }
  return { tick: w.tick, state: gzipSync(JSON.stringify(plain)).toString('base64') }
}

export function restoreWorld(s: Snapshot): World {
  const plain = JSON.parse(gunzipSync(Buffer.from(s.state, 'base64')).toString('utf8')) as Plain
  const rng = Object.fromEntries(Object.entries(plain.rng).map(([k, v]) => [k, rngFromState(v)])) as World['rng']
  const regions = plain.regions.map(({ eduTail, eduOffset, ...r }) => {
    const eduTargets: number[] = []
    eduTail.forEach((v, i) => { eduTargets[eduOffset + i] = v })
    return { ...r, eduTargets }
  })
  return { ...plain, rng, lessonsApplied: new Set(plain.lessonsApplied), regions, lifeArchive: {} } as World
}
