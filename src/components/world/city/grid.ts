// the city view's street grid at real scale: 1 unit = 3.1 m, so a 170 cm person is 0.55 units, a floor is 3 m,
// a car is 4.5 m. two-lane streets with sidewalks; people walk on the sidewalks and cross at corners or in front
// of their door, cars keep to their lane. every lot has a building footprint and a front yard, and the spots
// where people stand, sit or queue are in the yards, spaced for personal room and facing what they do there.
// (layout.ts is the older toy-scale grid; D's one-life site still reads it, so it stays as it is.)
import type { Workplace } from '@/lib/types'

export const U = 3.1 // meters per unit
export const m = (meters: number) => meters / U
export const PERSON = m(1.7) // an adult's height
export const FLOOR = m(3.0)
export const GROUND_FLOOR = m(4.0)

export const BLOCK = 5 // block interior width (15.5 m)
export const ROAD = m(5.6) // two lanes, curb to curb
export const CURB = ROAD / 2
export const SIDEWALK = m(2.5)
export const SPACING = BLOCK + ROAD + 2 * SIDEWALK
export const STREETS = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((k) => k * SPACING) // street centerlines, both axes
export const CENTERS = [-2, -1, 0, 1, 2].map((k) => k * SPACING)
export const LANE = ROAD / 4 // lane centers at +-LANE
export const FURNITURE = CURB + m(0.3) // lamps, poles, trees: at the curb edge of the sidewalk
export const WALK = CURB + SIDEWALK * 0.55 // where people walk
export const WALK_SPREAD = SIDEWALK * 0.3 // how far either side of WALK they may step to pass
export const EDGE = CURB + SIDEWALK // where the block starts
export const PLATE = STREETS[STREETS.length - 1] + EDGE + 0.6 // half-width of the plate
export const GROUND_Y = 0.22 // sidewalks, lots and yards
export const ROAD_Y = GROUND_Y - 0.15 / 3.1 // the road, a 15 cm curb below the sidewalk
export const SIDEWALK_Y = GROUND_Y

// furniture, at real sizes
export const SEAT = m(0.45) // bench and chair seat height
export const BENCH_LEN = m(1.6)
export const COUNTER = m(0.9) // a market stall counter
export const DOOR_W = m(1.0), DOOR_H = m(2.1)

export type LotKind = Exclude<Workplace, 'none' | 'shop'> | 'market' | 'home' | 'park' | 'square' | 'shrine'
export type V2 = { x: number; z: number }
export type Box = { x: number; z: number; w: number; d: number; h: number }
// a place someone can be: where, which way they face, and how (stand, sit on a seat, sit on the ground, kneel)
export type Spot = V2 & { heading: number; how: 'stand' | 'seat' | 'ground' | 'kneel' | 'work'; seatY?: number }
export type Lot = {
  id: number
  kind: LotKind
  x: number; z: number; w: number; d: number // the lot's pad
  face: 1 | -1 // +1: the lot's door faces the street on its +z side
  street: number // the z of that street's centerline
  door: V2 // the doorway, on the building's front wall
  building: Box | null // the main building (people inside are hidden)
  floors: number
  spots: Record<string, Spot[]> // by arrangement: 'crowd', 'queue', 'ring', 'rows', 'line', 'bench', 'stall', 'vendor'
  props: Box[] // things in the yard people must not walk into: stalls, benches, fountain, trees, crates
}
export type Grid = { lots: Lot[]; homes: Lot[]; byKind: Map<LotKind, Lot>; tramZ: number | null; exit: V2 }

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }
function rng(seed: number) { let a = seed || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const faceAngle = (from: V2, to: V2) => Math.atan2(to.x - from.x, to.z - from.z)

// personal room: people standing together keep at least this far apart, centre to centre (about 1.1 m)
export const PERSONAL = m(1.1)

export function buildGrid(cityId: string, workplaces: Workplace[], homesNeeded: number, religious: boolean, tram: boolean, homeFloors = 2): Grid {
  const r = rng(hash(cityId + 'grid'))
  const blocks: V2[] = []
  for (const x of CENTERS) for (const z of CENTERS) blocks.push({ x, z })
  const taken = new Set<string>()
  const key = (b: V2) => `${b.x},${b.z}`
  const lots: Lot[] = []
  const PAD = BLOCK - 0.4

  const add = (kind: LotKind, b: V2, opt: { w?: number; d?: number; ox?: number; oz?: number; face?: 1 | -1; floors?: number } = {}) => {
    const w = opt.w ?? PAD, d = opt.d ?? PAD
    const x = b.x + (opt.ox ?? 0), z = b.z + (opt.oz ?? 0)
    const face: 1 | -1 = opt.face ?? ((opt.oz ?? 0) > 0 ? 1 : (opt.oz ?? 0) < 0 ? -1 : r() < 0.5 ? 1 : -1)
    const street = b.z + face * (BLOCK / 2 + EDGE)
    const lot: Lot = { id: lots.length, kind, x, z, w, d, face, street, door: { x, z: z + face * d / 2 }, building: null, floors: opt.floors ?? 1, spots: {}, props: [] }
    furnish(lot, r, homeFloors)
    // no standing or kneeling spot inside a prop or a building (seats are on their benches by design)
    for (const k of Object.keys(lot.spots)) lot.spots[k] = lot.spots[k].filter((sp) => sp.how === 'seat' || ([...lot.props, ...(lot.building ? [lot.building] : [])].every((b) => !inBox(b, sp.x, sp.z, 0.16))))
    lots.push(lot)
    return lot
  }
  const claim = (pick: (b: V2) => boolean) => {
    const free = blocks.filter((b) => !taken.has(key(b)) && pick(b))
    const b = free.length ? free[Math.floor(r() * free.length)] : blocks.find((x) => !taken.has(key(x)))
    if (b) taken.add(key(b))
    return b
  }
  const S = SPACING
  const inner = (b: V2) => Math.abs(b.x) <= S && Math.abs(b.z) <= S
  const outer = (b: V2) => Math.abs(b.x) === 2 * S || Math.abs(b.z) === 2 * S
  const sq = blocks.find((b) => b.x === 0 && b.z === 0)!
  taken.add(key(sq)); add('square', sq, { face: 1 })
  add('market', claim(inner)!)
  add('park', claim(inner)!)
  add('school', claim((b) => !outer(b))!, { floors: 2 })
  add('clinic', claim((b) => !outer(b))!, { floors: 2 })
  if (religious) add('shrine', claim(() => true)!)
  const kinds = [...new Set(workplaces.filter((w) => w !== 'none' && w !== 'shop' && w !== 'school' && w !== 'clinic'))] as LotKind[]
  for (const k of kinds) {
    if (k === 'farm') { add('farm', claim(outer)!); continue }
    add(k, claim((b) => (k === 'launch_site' || k === 'power_plant' ? outer(b) : true))!, { floors: k === 'office' ? 6 : k === 'lab' ? 3 : 2 })
  }
  // homes: four to a block, each facing the street on its own side
  const homes: Lot[] = []
  const Q = PAD / 4
  while (homes.length < homesNeeded) {
    const b = claim(() => true)
    if (!b) break
    for (const [ox, oz] of [[-Q, -Q], [Q, -Q], [-Q, Q], [Q, Q]]) {
      if (homes.length >= homesNeeded) break
      homes.push(add('home', b, { w: PAD / 2 - 0.1, d: PAD / 2 - 0.1, ox, oz, floors: homeFloors }))
    }
  }
  const byKind = new Map<LotKind, Lot>()
  for (const l of lots) if (!byKind.has(l.kind)) byKind.set(l.kind, l)
  return { lots, homes, byKind, tramZ: tram ? STREETS[3] : null, exit: { x: PLATE + 30, z: STREETS[2] + WALK } }
}

// the building, the yard, and every spot in the yard, for one lot
function furnish(l: Lot, r: () => number, homeFloors: number) {
  const f = l.face
  const front = l.z + f * l.d / 2 // the front edge of the lot
  // a building set back from the front, leaving a yard of `yard` units
  const bld = (w: number, d: number, yard: number, floors: number): Box => {
    const z = front - f * (yard + d / 2)
    l.building = { x: l.x, z, w, d, h: floors * FLOOR + (GROUND_FLOOR - FLOOR) }
    l.door = { x: l.x, z: z + f * d / 2 }
    return l.building
  }
  const toward = (x: number, z: number, tx: number, tz: number) => faceAngle({ x, z }, { x: tx, z: tz })
  const streetward = f > 0 ? 0 : Math.PI // facing the street
  const spaced = (pts: Spot[]) => pts.filter((p, i) => pts.slice(0, i).every((q) => Math.hypot(p.x - q.x, p.z - q.z) >= PERSONAL))
  // a grid of standing spots over a rectangle, everyone facing `look` (or the rectangle's centre)
  const field = (cx: number, cz: number, w: number, d: number, look?: V2): Spot[] => {
    const out: Spot[] = []
    const nx = Math.max(1, Math.floor(w / PERSONAL)), nz = Math.max(1, Math.floor(d / PERSONAL))
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = cx - w / 2 + (i + 0.5) * (w / nx), z = cz - d / 2 + (j + 0.5) * (d / nz)
      out.push({ x, z, heading: look ? toward(x, z, look.x, look.z) : toward(x, z, cx, cz + 0.001), how: 'stand' })
    }
    return out
  }
  const bench = (x: number, z: number, heading: number, along: 'x' | 'z') => {
    l.props.push({ x, z, w: along === 'x' ? BENCH_LEN : m(0.5), d: along === 'x' ? m(0.5) : BENCH_LEN, h: SEAT + m(0.4) })
    // two seats on the bench, the sitter's hips over the seat, facing away from the backrest
    const dx = along === 'x' ? BENCH_LEN / 4 : 0, dz = along === 'z' ? BENCH_LEN / 4 : 0
    const bench2: Spot[] = [-1, 1].map((s) => ({ x: x + s * dx, z: z + s * dz, heading, how: 'seat', seatY: SEAT }))
    ;(l.spots.bench ??= []).push(...bench2)
  }
  switch (l.kind) {
    case 'home': {
      bld(l.w - 0.2, l.d - 0.75, 0.55, homeFloors)
      // a bench (a stoop) in the front yard, beside the door, facing the street
      bench(l.x + (l.w / 2 - 0.45) * (r() < 0.5 ? -1 : 1), front - f * 0.3, streetward, 'x')
      break
    }
    case 'school': {
      bld(l.w - 0.4, l.d * 0.45, l.d * 0.45, l.floors)
      // the playground in front: pupils at break stand in it
      l.spots.crowd = spaced(field(l.x, front - f * l.d * 0.24, l.w - 0.8, l.d * 0.32))
      break
    }
    case 'clinic': {
      bld(l.w - 0.6, l.d * 0.5, l.d * 0.4, l.floors)
      // the queue: a line along the yard toward the door, everyone facing the door
      // the first person stands just in front of the door facing it; the line runs along the yard, each facing the back of the one ahead
      const q: Spot[] = []
      const qz = l.door.z + f * m(1.2)
      for (let k = 0; k < 12; k++) { const x = l.door.x + m(0.4) + k * PERSONAL; if (x > l.x + l.w / 2 - 0.2) break; q.push({ x, z: qz, heading: k === 0 ? toward(x, qz, l.door.x, l.door.z) : -Math.PI / 2, how: 'stand' }) }
      l.spots.queue = q
      break
    }
    case 'office': bld(l.w - 0.6, l.d - 1.2, 0.8, l.floors); break
    case 'lab': bld(l.w - 0.8, l.d * 0.6, 0.9, l.floors); break
    case 'power_plant': bld(l.w * 0.45, l.d * 0.45, 0.6, 3); break
    case 'launch_site': { l.props.push({ x: l.x, z: l.z, w: m(9), d: m(9), h: m(1) }); break }
    case 'factory': {
      bld(l.w - 0.6, l.d * 0.55, l.d * 0.3, l.floors)
      // strikers sit on the ground along the front, facing the street
      l.spots.line = Array.from({ length: 7 }, (_, k) => ({ x: l.x - l.w / 2 + 0.4 + k * PERSONAL * 0.9, z: front - f * 0.45, heading: streetward, how: 'ground' as const }))
      break
    }
    case 'construction': {
      // the frame going up in the middle; builders work at its edges, facing it
      const fr = { x: l.x, z: l.z, w: m(8), d: m(8), h: m(9) }
      l.props.push(fr)
      const s: Spot[] = []
      for (const [ox, oz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const x = l.x + ox * (fr.w / 2 + m(0.7)), z = l.z + oz * (fr.d / 2 + m(0.7)); s.push({ x, z, heading: toward(x, z, l.x, l.z), how: 'work' }) }
      l.spots.crowd = s
      break
    }
    case 'farm': {
      // rows of crops run along x; workers stand between rows, facing the row in front of them
      const rows: Spot[] = []
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) rows.push({ x: l.x - l.w * 0.36 + i * (l.w * 0.72 / 3), z: l.z - l.d * 0.33 + j * (l.d * 0.66 / 3) + m(0.6), heading: Math.PI, how: 'work' })
      l.spots.rows = rows
      break
    }
    case 'market': {
      // two rows of stalls; vendors behind the counters, shoppers in front of them
      const st: Spot[] = [], ven: Spot[] = []
      for (let k = 0; k < 6; k++) {
        const x = l.x - l.w / 3 + (k % 3) * (l.w / 3), z = l.z + (k < 3 ? -1 : 1) * l.d * 0.2
        const facing = k < 3 ? -1 : 1 // stalls open toward the lot's edges, back to back
        l.props.push({ x, z, w: m(3), d: m(1.2), h: COUNTER })
        ven.push({ x, z: z - facing * m(1.1), heading: facing > 0 ? 0 : Math.PI, how: 'stand' })
        for (const ox of [-m(0.8), m(0.8)]) st.push({ x: x + ox, z: z + facing * m(1.4), heading: facing > 0 ? Math.PI : 0, how: 'stand' })
      }
      l.spots.crowd = st
      l.spots.vendor = ven
      break
    }
    case 'park': {
      // trees, two benches, and small rings of people talking, facing each other
      for (const [ox, oz] of [[-0.3, -0.3], [0.32, -0.15], [-0.1, 0.33], [0.3, 0.3]]) l.props.push({ x: l.x + ox * l.w, z: l.z + oz * l.d, w: m(0.5), d: m(0.5), h: m(6) })
      bench(l.x, l.z - l.d * 0.42, 0, 'x')
      bench(l.x, l.z + l.d * 0.42, Math.PI, 'x')
      // standing spots clear of the trees and benches (a person is about 0.12 wide, plus a little room)
      l.spots.ring = rings(l.x, l.z, 3, m(1.3), l.w * 0.22).filter((sp) => l.props.every((pr) => !inBox(pr, sp.x, sp.z, 0.2)))
      l.spots.crowd = l.spots.ring
      break
    }
    case 'square': {
      l.props.push({ x: l.x, z: l.z, w: m(3), d: m(3), h: m(1.2) }) // the fountain
      bench(l.x - l.w * 0.38, l.z, Math.PI / 2, 'z')
      bench(l.x + l.w * 0.38, l.z, -Math.PI / 2, 'z')
      // a ring around the fountain facing in (celebrations), and a crowd facing the fountain (protests)
      const ring: Spot[] = []
      for (const rad of [m(3.2), m(4.6), m(6)]) { const n = Math.floor((2 * Math.PI * rad) / PERSONAL); for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + rad; const x = l.x + Math.cos(a) * rad, z = l.z + Math.sin(a) * rad; ring.push({ x, z, heading: toward(x, z, l.x, l.z), how: 'stand' }) } }
      l.spots.ring = ring.filter((p) => Math.abs(p.x - l.x) < l.w / 2 - 0.3 && Math.abs(p.z - l.z) < l.d / 2 - 0.3)
      l.spots.crowd = l.spots.ring
      break
    }
    case 'shrine': {
      bld(m(5), m(5), (l.d - m(5)) / 2, 1)
      // kneeling in rows in the yard in front, facing the shrine
      const k: Spot[] = []
      for (let j = 0; j < 2; j++) for (let i = 0; i < 5; i++) { const x = l.x - m(4) + i * m(2), z = front - f * (0.4 + j * PERSONAL); k.push({ x, z, heading: toward(x, z, l.x, l.building!.z), how: 'kneel' }) }
      l.spots.ring = k
      break
    }
  }
}

// small conversation circles: n circles of people facing each other
function rings(cx: number, cz: number, n: number, rad: number, spread: number): Spot[] {
  const out: Spot[] = []
  for (let c = 0; c < n; c++) {
    const a0 = (c / n) * Math.PI * 2
    const ox = cx + Math.cos(a0) * spread, oz = cz + Math.sin(a0) * spread
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + c
      const x = ox + Math.cos(a) * rad, z = oz + Math.sin(a) * rad
      out.push({ x, z, heading: Math.atan2(ox - x, oz - z), how: 'stand' })
    }
  }
  return out
}

// ---- walking: through the door, along the sidewalk, across at corners, in the other door ----
const N = STREETS.length
const nearestI = (v: number) => STREETS.reduce((b, s, k) => (Math.abs(s - v) < Math.abs(STREETS[b] - v) ? k : b), 0)
function bfs(a: number, b: number): number[] {
  const prev = new Int32Array(N * N).fill(-1), seen = new Uint8Array(N * N)
  const q = [a]; seen[a] = 1
  while (q.length) {
    const n = q.shift()!
    if (n === b) break
    const i = Math.floor(n / N), j = n % N
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue
      const k = ni * N + nj
      if (seen[k]) continue
      seen[k] = 1; prev[k] = n; q.push(k)
    }
  }
  const out: number[] = []
  for (let n = b; n !== -1; n = prev[n]) { out.push(n); if (n === a) break }
  return out.reverse()
}

export type Place = { spot: V2; lot: Pick<Lot, 'door' | 'street' | 'face' | 'x'> }
// from a spot in one lot to a spot in another. walking lines are on the sidewalks (WALK from the centerline);
// a person crosses the road only at a corner or straight across in front of a door
export function walkPath(from: Place, to: Place): V2[] {
  const sideOf = (lot: Place['lot']) => -lot.face // the lot is on the -face side of its street
  const a = from.lot, b = to.lot
  const za = a.street + sideOf(a) * WALK, zb = b.street + sideOf(b) * WALK
  const out = (l: Place['lot']) => ({ x: l.door.x, z: l.door.z + l.face * m(0.8) }) // just outside the doorway
  const pts: V2[] = [from.spot, a.door, out(a), { x: a.door.x, z: za }]
  if (a.street === b.street && Math.abs(a.door.x - b.door.x) < SPACING * 3) {
    // same street: along the sidewalk, crossing over if the other door is across the road
    if (sideOf(a) !== sideOf(b)) { pts.push({ x: a.door.x, z: zb }) }
    pts.push({ x: b.door.x, z: zb })
  } else {
    // to the nearest corner on this side, then corner to corner on the +x/+z sidewalks, then to the other door
    const ia = nearestI(a.door.x), ib = nearestI(b.door.x)
    const ja = nearestI(a.street), jb = nearestI(b.street)
    const nodes = bfs(ia * N + ja, ib * N + jb).map((n) => ({ x: STREETS[Math.floor(n / N)], z: STREETS[n % N] }))
    const cx = (x: number) => x + WALK // the corner's walking point, on the +x/+z side
    pts.push({ x: cx(nodes[0].x), z: za })
    if (sideOf(a) < 0) pts.push({ x: cx(nodes[0].x), z: a.street + WALK })
    for (const n of nodes) pts.push({ x: cx(n.x), z: n.z + WALK })
    const last = nodes[nodes.length - 1]
    pts.push({ x: cx(last.x), z: b.street + WALK })
    if (sideOf(b) < 0) pts.push({ x: cx(last.x), z: zb })
    pts.push({ x: b.door.x, z: zb })
  }
  pts.push(out(b), { x: b.door.x, z: b.door.z }, to.spot)
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 0.01)
}

// is a point inside a box's footprint (grown by `pad`)
export const inBox = (b: Box, x: number, z: number, pad = 0) => Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad
