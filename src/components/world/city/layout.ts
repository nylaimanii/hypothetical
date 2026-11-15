// v4 city diorama layout: a 30x30 plate cut by a street grid into 25 blocks. lots sit in blocks,
// every lot has a door on a street, and pips path between doors along the streets (bfs over intersections).
import type { Workplace } from '@/lib/types'

export const STREETS = [-15, -9, -3, 3, 9, 15] // street centerlines, both axes
export const BLOCK = 5 // block interior width
const CENTERS = [-12, -6, 0, 6, 12]

export type LotKind = Exclude<Workplace, 'none' | 'shop'> | 'market' | 'home' | 'park' | 'square' | 'shrine'
export type V2 = { x: number; z: number }
export type Lot = {
  id: number
  kind: LotKind
  x: number; z: number // center
  w: number; d: number // footprint
  door: V2 // on a street
  floors: number
}

export type Layout = { lots: Lot[]; homes: Lot[]; byKind: Map<LotKind, Lot>; tramZ: number | null; exit: V2 }

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }
function rng(seed: number) { let a = seed || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

// the street a block faces: the one below it on z
const doorFor = (x: number, z: number, bz: number): V2 => ({ x, z: z <= bz ? bz - BLOCK / 2 - 0.5 : bz + BLOCK / 2 + 0.5 })

export function buildLayout(cityId: string, workplaces: Workplace[], homesNeeded: number, religious: boolean, tram: boolean): Layout {
  const r = rng(hash(cityId))
  const blocks: V2[] = []
  for (const x of CENTERS) for (const z of CENTERS) blocks.push({ x, z })
  const taken = new Set<string>()
  const key = (b: V2) => `${b.x},${b.z}`
  const lots: Lot[] = []
  const add = (kind: LotKind, b: V2, w = BLOCK - 0.6, d = BLOCK - 0.6, floors = 1, ox = 0, oz = 0) => {
    const x = b.x + ox, z = b.z + oz
    const lot: Lot = { id: lots.length, kind, x, z, w, d, door: doorFor(x, z + d / 2, b.z), floors }
    // doors face the street on the lot's own side
    lot.door = oz < 0 ? { x, z: b.z - BLOCK / 2 - 0.5 } : { x, z: b.z + BLOCK / 2 + 0.5 }
    lots.push(lot)
    return lot
  }
  const claim = (pick: (b: V2) => boolean) => {
    const free = blocks.filter((b) => !taken.has(key(b)) && pick(b))
    const b = free.length ? free[Math.floor(r() * free.length)] : blocks.find((x) => !taken.has(key(x)))
    if (b) taken.add(key(b))
    return b
  }
  const inner = (b: V2) => Math.abs(b.x) <= 6 && Math.abs(b.z) <= 6
  const outer = (b: V2) => Math.abs(b.x) === 12 || Math.abs(b.z) === 12
  // the square sits in the middle; civic lots ring it
  const sq = blocks.find((b) => b.x === 0 && b.z === 0)!
  taken.add(key(sq)); add('square', sq)
  add('market', claim(inner)!, BLOCK - 0.6, BLOCK - 0.6, 1)
  add('park', claim(inner)!)
  add('school', claim((b) => !outer(b))!, BLOCK - 1.2, BLOCK - 1.6, 2)
  add('clinic', claim((b) => !outer(b))!, BLOCK - 1.6, BLOCK - 1.6, 2)
  if (religious) add('shrine', claim(() => true)!, 2.4, 2.4, 1)
  const kinds = [...new Set(workplaces.filter((w) => w !== 'none' && w !== 'shop' && w !== 'school' && w !== 'clinic'))] as LotKind[]
  for (const k of kinds) {
    if (k === 'farm') { add('farm', claim(outer)!); continue }
    const floors = k === 'office' ? 4 : k === 'lab' ? 3 : k === 'factory' ? 2 : 1
    add(k, claim((b) => (k === 'launch_site' || k === 'power_plant' ? outer(b) : true))!, BLOCK - 1, BLOCK - 1, floors)
  }
  // homes: four to a block, until everyone has one
  const homes: Lot[] = []
  while (homes.length < homesNeeded) {
    const b = claim(() => true)
    if (!b) break
    for (const [ox, oz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      if (homes.length >= homesNeeded) break
      homes.push(add('home', b, 1.9, 1.9, 1 + Math.floor(r() * 2), ox, oz))
    }
  }
  const byKind = new Map<LotKind, Lot>()
  for (const l of lots) if (!byKind.has(l.kind)) byKind.set(l.kind, l)
  return { lots, homes, byKind, tramZ: tram ? 3 : null, exit: { x: 18, z: -3 } }
}

// ---- pathfinding: bfs over the 6x6 street intersections ----
const N = STREETS.length
const idx = (i: number, j: number) => i * N + j
const nearestI = (v: number) => STREETS.reduce((b, s, k) => (Math.abs(s - v) < Math.abs(STREETS[b] - v) ? k : b), 0)

function bfs(a: number, b: number): number[] {
  const prev = new Int32Array(N * N).fill(-1)
  const seen = new Uint8Array(N * N)
  const q = [a]; seen[a] = 1
  while (q.length) {
    const n = q.shift()!
    if (n === b) break
    const i = Math.floor(n / N), j = n % N
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue
      const m = idx(ni, nj)
      if (seen[m]) continue
      seen[m] = 1; prev[m] = n; q.push(m)
    }
  }
  const out: number[] = []
  for (let n = b; n !== -1; n = prev[n]) { out.push(n); if (n === a) break }
  return out.reverse()
}

// a door sits on a horizontal street (z on a street line); walk to the nearer end of that block side
const entryNode = (d: V2) => idx(nearestI(d.x), nearestI(d.z))

// from a spot, out the door, along the streets, in the other door, to the target spot
export function pathBetween(from: V2, fromDoor: V2, to: V2, toDoor: V2): V2[] {
  const a = entryNode(fromDoor), b = entryNode(toDoor)
  const nodes = a === b ? [] : bfs(a, b).map((n) => ({ x: STREETS[Math.floor(n / N)], z: STREETS[n % N] }))
  const pts: V2[] = [from, fromDoor]
  if (nodes.length) {
    pts.push({ x: nodes[0].x, z: fromDoor.z })
    for (const n of nodes) pts.push(n)
    pts.push({ x: nodes[nodes.length - 1].x, z: toDoor.z })
  }
  pts.push(toDoor, to)
  // drop zero-length hops
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 0.01)
}

// ---- where people stand inside a lot ----
export function spotIn(lot: Lot, k: number, n: number, kind: 'crowd' | 'queue' | 'rows' | 'ring' | 'line' = 'crowd'): V2 {
  if (kind === 'queue') {
    // a line on the street in front of the door
    return { x: lot.door.x + 0.9 + k * 0.85, z: lot.door.z }
  }
  if (kind === 'line') {
    // sitting along the front of the lot, beside the door
    const side = k % 2 ? 1 : -1
    return { x: lot.x + side * (0.8 + Math.floor(k / 2) * 0.8), z: lot.door.z + (lot.door.z > lot.z ? -0.75 : 0.75) }
  }
  if (kind === 'ring') {
    const a = (k / Math.max(1, n)) * Math.PI * 2
    const rr = Math.min(lot.w, lot.d) * 0.32 + (k % 2) * 0.5
    return { x: lot.x + Math.cos(a) * rr, z: lot.z + Math.sin(a) * rr }
  }
  if (kind === 'rows') {
    const cols = 4
    return { x: lot.x - lot.w * 0.35 + (k % cols) * (lot.w * 0.7 / (cols - 1)), z: lot.z - lot.d * 0.3 + Math.floor(k / cols) * 1.1 }
  }
  const cols = Math.max(2, Math.ceil(Math.sqrt(n)))
  const sx = lot.w * 0.7 / cols, sz = lot.d * 0.7 / cols
  return { x: lot.x - lot.w * 0.35 + (k % cols + 0.5) * sx, z: lot.z - lot.d * 0.35 + (Math.floor(k / cols) + 0.5) * sz }
}
