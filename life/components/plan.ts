// a day, planned like a person would live it. stops happen at a station (a bed, a table, a desk, a stall, a bench),
// and between stops they really travel: out the door, along the streets (bfs over the street grid, the main
// site's city layout), or to a bus stop, a wait, a ride, and the walk from the stop. legs are timed by distance, so
// people leave early enough to arrive on time. the same planner moves the chosen person, her family, her
// coworkers and the city's crowd.
import type { Layout, Lot, V2 } from '@/components/world/city/layout'
import { pathBetween, STREETS } from '@/components/world/city/layout'
const STREET_SET = new Set(STREETS)
import type { LifeActivity, Workplace } from '@/lib/life/types'

export const WALK_UNITS_PER_H = 55 // sim walking speed (the diorama is small, so this is a stylized pace)
export const BUS_UNITS_PER_H = 220
// the main site's city layout is a toy diorama (a street one person wide). real residential lanes in these cities are
// about two car widths (life/REFERENCE.md), so the life view scales the whole layout by K. plans are made in layout
// units; positions leave this module in world units
export const K = 2.4
export const STREETS_W = STREETS.map(s => s * K)
export const toWorld = (v: V2): V2 => ({ x: v.x * K, z: v.z * K })
export const BUS_Z = -3 // the bus runs along this street (layout units; world z = BUS_Z * K)
const BUS_STOPS = [-12, -6, 0, 6, 12]

export type Act = 'sleep' | 'eat' | 'cook' | 'work' | 'learn' | 'play' | 'rest' | 'shop' | 'care' | 'sit' | 'pray' | 'sweep' | 'chat'
export type Pose = 'stand' | 'sit' | 'lie' | 'walk' | 'ride' | 'wait' | 'busy'
export type PlaceKind = 'home' | 'work' | 'school' | 'market' | 'park' | 'clinic' | 'square' | 'shrine' | 'visit' | 'hers' // hers: the chosen person's own house (for family who live elsewhere)
export type Station = { pos: V2; facing: number; pose: Pose; label: string }
export type StopDef = { hour: number; at: PlaceKind; act: Act; slot?: number } // slot: this stop's own place (an occasion: next to her)
export type Stop = StopDef & { lot: Lot; station: Station }
export type Leg = { kind: 'walk' | 'wait' | 'bus'; start: number; end: number; path: V2[]; lens: number[]; total: number; why?: string }
export type DayPlan = { stops: Stop[]; legs: Leg[][] } // legs[i]: how they got to stops[i]

// ---------- schedules ----------
// a child under 12 is not at a charcoal stove: where the day says cook, they play out in front of the house instead.
// a baby under 2 doesn't sit at the table: at mealtimes she is fed in someone's arms (rest, held)
export function schedule(a: LifeActivity, o: { kids: boolean; weekend: boolean; religious: boolean; night?: boolean; visit?: boolean; age?: number }): StopDef[] {
  const defs = scheduleFor(a, o)
  if (o.age === undefined) return defs
  return defs.map(d => (o.age! < 12 && d.act === 'cook' ? { ...d, act: 'play' as Act } : o.age! < 2 && d.act === 'eat' ? { ...d, act: 'rest' as Act } : d))
}
function scheduleFor(a: LifeActivity, o: { kids: boolean; weekend: boolean; religious: boolean; night?: boolean; visit?: boolean }): StopDef[] {
  const home = (hour: number, act: Act): StopDef => ({ hour, at: 'home', act })
  if (a === 'working' && o.night) return [home(0, 'sleep'), home(11, 'eat'), { hour: 13, at: 'market', act: 'shop' }, home(14.5, 'cook'), home(16, 'rest'), { hour: 19, at: 'work', act: 'work' }, home(23.99, 'sleep')]
  if (o.weekend && (a === 'working' || a === 'school' || a === 'studying')) return [home(0, 'sleep'), home(8, 'eat'), ...(o.religious ? [{ hour: 9.5, at: 'shrine' as const, act: 'pray' as const }] : []), { hour: 11, at: 'market', act: 'shop' }, home(13, 'cook'), ...(o.visit ? [{ hour: 15, at: 'visit' as const, act: 'eat' as const }] : [{ hour: 16, at: (o.kids ? 'park' : 'square') as PlaceKind, act: 'play' as const }]), home(18.5, 'eat'), home(22, 'sleep')]
  switch (a) {
    case 'working': return [home(0, 'sleep'), home(6.3, 'cook'), home(6.8, 'eat'), { hour: 8, at: 'work', act: 'work' }, { hour: 12.3, at: 'market', act: 'eat' }, { hour: 13.2, at: 'work', act: 'work' }, { hour: 17.6, at: 'market', act: 'shop' }, home(18.6, 'cook'), home(19.3, 'eat'), ...(o.kids ? [{ hour: 20, at: 'park' as const, act: 'play' as const }, home(21, 'rest')] : [home(20.5, 'rest')]), home(22.3, 'sleep')]
    case 'school': return [home(0, 'sleep'), home(6.8, 'eat'), { hour: 7.6, at: 'school', act: 'learn' }, { hour: 14.5, at: 'park', act: 'play' }, home(17.5, 'rest'), home(18.5, 'eat'), home(21, 'sleep')]
    case 'studying': return [home(0, 'sleep'), home(7, 'eat'), { hour: 8.2, at: 'school', act: 'learn' }, { hour: 13, at: 'market', act: 'eat' }, { hour: 14, at: 'school', act: 'learn' }, home(18.5, 'eat'), home(19.5, 'rest'), home(23, 'sleep')]
    // babies go where their caregiver goes: mornings and late afternoons out front with the neighbors, naps inside
    case 'infant': return [home(0, 'sleep'), home(7, 'eat'), home(8, 'chat'), home(9.2, 'play'), home(12, 'sleep'), home(14.5, 'play'), home(16.5, 'chat'), home(17.5, 'eat'), home(19, 'sleep')]
    case 'retired': return [home(0, 'sleep'), home(6.5, 'cook'), home(7, 'eat'), { hour: 8.5, at: 'park', act: 'sit' }, { hour: 10.5, at: 'market', act: 'shop' }, home(12, 'cook'), home(13, 'rest'), { hour: 16, at: 'square', act: 'sit' }, home(18, 'eat'), home(21.5, 'sleep')]
    case 'unemployed': return [home(0, 'sleep'), home(7.5, 'eat'), { hour: 8.5, at: 'market', act: 'shop' }, { hour: 11, at: 'square', act: 'sit' }, home(14, 'cook'), home(15, 'rest'), home(22.5, 'sleep')]
    case 'caregiving': return [home(0, 'sleep'), home(6, 'cook'), home(7, 'care'), { hour: 10, at: 'clinic', act: 'care' }, { hour: 11.5, at: 'market', act: 'shop' }, home(12.5, 'cook'), home(13.5, 'care'), home(19, 'eat'), home(22, 'sleep')]
    case 'sick': return [home(0, 'sleep'), home(9, 'rest'), { hour: 10.5, at: 'clinic', act: 'sit' }, home(12.5, 'rest'), home(14, 'sleep'), home(17, 'eat'), home(20, 'sleep')]
    case 'grieving': return [home(0, 'sleep'), home(9, 'sit'), ...(o.religious ? [{ hour: 11, at: 'shrine' as const, act: 'pray' as const }] : []), { hour: 16, at: 'park', act: 'sit' }, home(18, 'eat'), home(19, 'sit'), home(23, 'sleep')]
    case 'protesting': return [home(0, 'sleep'), home(7, 'eat'), { hour: 9, at: 'square', act: 'play' }, home(18, 'eat'), home(22, 'sleep')]
    default: return [home(0, 'sleep'), home(8, 'eat'), { hour: 9, at: 'market', act: 'shop' }, home(13, 'rest'), home(22, 'sleep')]
  }
}

// an occasion (a first meeting, a birth, a funeral: src/lib/life/occasions.ts) takes over part of the day: whatever
// was planned for those hours gives way, and afterwards the day goes on from home
export function withOccasion(defs: StopDef[], o: { start: number; end: number; at: PlaceKind; act: Act }, slot?: number): StopDef[] {
  const before = defs.filter(d => d.hour < o.start - 0.8)
  const after = defs.filter(d => d.hour >= o.end + 0.4)
  return [...before, { hour: o.start, at: o.at, act: o.act, ...(slot !== undefined ? { slot } : {}) }, { hour: o.end, at: 'home', act: 'rest' }, ...after]
}

// ---------- stations inside a lot ----------
// homes are small (1.9 x 1.9): bed, table, stove. bigger lots get a row of workstations; slot picks one per person
// the market: two rows of stalls with an aisle between (layout units, relative to the lot center). each stall has two
// vendor places behind it; the aisle has spots a step apart for shoppers and stools for people eating
export type MarketPlan = { stalls: { x: number; z: number; facing: number }[]; vendors: { x: number; z: number; facing: number }[]; aisle: { x: number; z: number; facing: number }[] }
const marketCache = new Map<string, MarketPlan>()
export function marketPlan(lot: Lot): MarketPlan {
  const key = `${lot.id}:${lot.w}:${lot.d}`
  const hit = marketCache.get(key); if (hit) return hit
  // work in the lot's own frame: u runs along the street the door is on, v from the door into the lot
  const zDoor = Math.abs(lot.door.z - lot.z) >= Math.abs(lot.door.x - lot.x)
  const U = zDoor ? lot.w : lot.d, Vd = zDoor ? lot.d : lot.w
  const doorSide = Math.sign(zDoor ? lot.door.z - lot.z : lot.door.x - lot.x) || 1
  const doorU = zDoor ? lot.door.x - lot.x : lot.door.z - lot.z
  const toXZ = (u: number, v: number, f: number) => (zDoor ? { x: u, z: v, facing: f } : { x: v, z: u, facing: f + Math.PI / 2 })
  const rowV = Vd * 0.24, pitch = 1.25 / K, half = U * 0.4
  const stalls: MarketPlan['stalls'] = [], vendors: MarketPlan['vendors'] = [], aisle: MarketPlan['aisle'] = []
  for (const side of [-1, 1]) for (let u = -half; u <= half + 1e-6; u += pitch) {
    // the entrance: no stall in front of the door, so people walk straight in to the aisle
    if (Math.abs(u - doorU) < 0.75 / K) continue // (both rows: a straight walk from the door to the back)
    const f = side > 0 ? Math.PI : 0
    stalls.push(toXZ(u, side * rowV, f))
    for (const du of [-0.24 / K, 0.24 / K]) vendors.push(toXZ(u + du, side * (rowV + 0.5 / K), f))
  }
  const band = Math.max(0, rowV - 0.5 / K)
  // shoulder to shoulder (~0.75 m) across, a step (~0.55 m) front to back: a busy market aisle, nobody inside anyone
  // rows of standing places with a clear walking row between each (people get to their place without squeezing past)
  let row = 0
  for (let v = -band; v <= band + 1e-6; v += 0.42 / K, row++) { if (row % 2) continue; for (let u = -half; u <= half + 1e-6; u += 0.5 / K) aisle.push(toXZ(u, v, v > 0 ? 0 : Math.PI)) }
  aisle.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
  const plan = { stalls, vendors, aisle }
  marketCache.set(key, plan)
  return plan
}
// every spot a place has for an activity (layout units, absolute), for taking a free one on arrival (./population):
// market vendors and aisle, the step by a door, and the grid of spots in public places. null: a fixed station
export function spotsAt(lot: Lot, act: Act): { x: number; z: number }[] | null {
  if (lot.kind === 'home') {
    // the step by the door (sitting), the lane in front of the house (chatting, sweeping): spots a shoulder apart
    if (act === 'rest' || act === 'sit') { const st = stationFor(lot, 'rest', 0); return [0, 1, 2, 3, 4].map(i => ({ x: lot.door.x + (i - 2) * (0.44 / K), z: st.pos.z })) }
    // the kitchen: the stove, then places along the counter (more cooks than that: elsewhere in the room)
    if (act === 'cook') return [0, 1, 2].map(i => stationFor(lot, 'cook', i).pos)
    if (act === 'eat') return [0, 1, 2, 3, 4, 5, 6, 7].map(i => stationFor(lot, 'eat', i).pos)
    if (act === 'chat' || act === 'sweep' || act === 'play') { const st = stationFor(lot, act, 0); return [0, 1, 2, 3, 4, 5].map(i => ({ x: lot.door.x + (i - 2.5) * (0.5 / K), z: st.pos.z })) }
    return null
  }
  if (lot.kind === 'market') { const m = marketPlan(lot); return (act === 'work' ? m.vendors : m.aisle).map(p => ({ x: lot.x + p.x, z: lot.z + p.z })) }
  if (lot.kind === 'shrine') return null
  spotFor(lot, 0)
  return (spotCache.get(`${lot.w}:${lot.d}`) ?? []).map(p => ({ x: lot.x + p.x, z: lot.z + p.z }))
}
const spotCache = new Map<string, { x: number; z: number }[]>()
function spotFor(lot: Lot, slot: number): { x: number; z: number } {
  const key = `${lot.w}:${lot.d}`
  let cells = spotCache.get(key)
  if (!cells) {
    const step = 0.75 / K, hw = lot.w * 0.42, hd = lot.d * 0.42
    cells = []
    for (let x = -hw; x <= hw + 1e-6; x += step) for (let z = -hd; z <= hd + 1e-6; z += step) cells.push({ x, z })
    cells.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z) || a.x - b.x || a.z - b.z)
    spotCache.set(key, cells)
  }
  return cells[slot % cells.length]
}
export function stationFor(lot: Lot, act: Act, slot: number, workplace?: Workplace): Station {
  const { x, z } = lot
  const s = (dx: number, dz: number, facing: number, pose: Pose, label: string): Station => ({ pos: { x: x + dx, z: z + dz }, facing, pose, label })
  if (lot.kind === 'home') {
    const k = slot % 4
    // the house inside is ~2.1 x 4.2 world units (./fabric): everything fits in x within +-0.3 and z within +-0.55
    // layout units of the lot's center. the bed sleeps two side by side, a second bed behind it
    if (act === 'sleep') return s(-0.2 + (k % 2) * 0.1, -0.45 + Math.floor(k / 2) * 0.22, 0, 'lie', 'bed')
    // one person at the stove, anyone helping stands along the counter beside them
    if (act === 'cook') return s(0.2, -0.42 + (slot % 3) * 0.17, -Math.PI / 2, 'busy', slot % 3 ? 'the counter' : 'stove')
    // around the table: 8 places on a ring, each facing the table (a bigger family: the rest eat on a mat nearby)
    if (act === 'eat') { const ang = (slot % 8) / 8 * Math.PI * 2 + 0.4, tx = 0.0, tz = 0.25; return s(tx + Math.sin(ang) * 0.29, tz + Math.cos(ang) * 0.29, ang + Math.PI, 'sit', 'table') }
    if (act === 'care') return s(-0.05, -0.32, Math.PI / 4, 'busy', 'bedside')
    // out front: sweeping the doorstep, or standing in the lane talking with a neighbor (pairs face each other)
    const out = lot.door.z > lot.z ? 1 : -1
    // (distances from the lane's center line, where the door point is: sweeping in front of the stoop at 1.05 world
    // units, chatting at 1.0, sitting on the stoop at 1.45, see ./fabric)
    if (act === 'sweep') return { pos: { x: lot.door.x + ((slot % 3) - 1) * 0.25, z: lot.door.z - out * (1.05 / K) }, facing: out > 0 ? 0 : Math.PI, pose: 'busy', label: 'the doorstep' }
    // children playing at home play in the lane in front of the house
    if (act === 'play') return { pos: { x: lot.door.x + ((slot % 4) - 1.5) * (0.5 / K), z: lot.door.z - out * (0.95 / K) }, facing: out > 0 ? 0 : Math.PI, pose: 'stand', label: 'out front' }
    if (act === 'chat') return { pos: { x: lot.door.x + (slot % 2 ? 0.2 : -0.2), z: lot.door.z - out * (1.0 / K) }, facing: slot % 2 ? -Math.PI / 2 : Math.PI / 2, pose: 'stand', label: 'out front' }
    // resting: on the bench outside the front door, spread along the frontage so neighbors never sit in each other
    return { pos: { x: lot.door.x + ((slot % 5) - 2) * (0.44 / K), z: lot.door.z - out * (1.45 / K) }, facing: lot.door.z > lot.z ? 0 : Math.PI, pose: 'sit', label: 'bench by the door' } // (a shoulder apart: the same five places spotsAt gives)
  }
  // open places hold any number of people: a sunflower spiral of spots inside the lot, one per slot, never shared
  // every slot gets its own spot: a grid of cells ~0.75 world units apart inside the lot, filled from the middle out,
  // so two people never share a spot until the lot is genuinely full
  const spot = spotFor(lot, slot)
  const spiral = () => spot
  const r = slot % 8
  const gx = spot.x, gz = spot.z
  switch (lot.kind) {
    case 'clinic': return s(gx, gz, 0, act === 'sit' ? 'sit' : 'busy', act === 'sit' ? 'waiting bench' : 'a patient bed')
    case 'school': return s(gx, gz, Math.PI, act === 'learn' ? 'sit' : 'stand', 'a desk')
    case 'office': case 'lab': return s(gx, gz, Math.PI, 'sit', workplace === 'lab' ? 'a bench in the lab' : 'a desk')
    case 'factory': case 'power_plant': return s(gx, gz, 0, 'busy', 'a machine')
    case 'construction': return s(gx, gz, 0, 'busy', 'the site')
    case 'farm': return s(gx * 1.5, gz * 1.5, 0, 'busy', 'the field')
    case 'market': {
      const m = marketPlan(lot)
      // a vendor behind their own stall (two to a stall when the market is busy), facing the aisle
      if (act === 'work') { const v = m.vendors[slot % m.vendors.length]; return s(v.x, v.z, v.facing, 'busy', 'a stall') }
      // shoppers and people eating at a food stall: their own spot in the aisle, facing the nearest stall
      const a = m.aisle[slot % m.aisle.length]
      if (act === 'chat') { const o = m.aisle[(slot ^ 1) % m.aisle.length]; return s(a.x, a.z, Math.atan2(o.x - a.x, o.z - a.z), 'stand', 'the stalls') }
      return s(a.x, a.z, a.facing, act === 'eat' ? 'sit' : 'stand', act === 'eat' ? 'a food stall' : 'the stalls')
    }
    // two people talking in the open stand face to face (slot 0 with 1, 2 with 3: neighboring spots)
    case 'park': case 'square': {
      if (act === 'chat') { const o = spotFor(lot, slot ^ 1); return s(gx, gz, Math.atan2(o.x - gx, o.z - gz), 'stand', lot.kind === 'park' ? 'the path' : 'the square') }
      const p = spiral()
      return lot.kind === 'park' ? s(p.x, p.z, slot * 1.7, act === 'play' ? 'stand' : 'sit', act === 'play' ? 'the grass' : 'a bench') : s(p.x, p.z, slot * 2.1, act === 'play' ? 'stand' : 'sit', 'the square')
    }
    case 'shrine': return s(((slot % 5) - 2) * 0.4, Math.floor(slot / 5) * 0.45 - 0.4, Math.PI, 'sit', 'the prayer hall')
    default: return s(gx, gz, 0, 'stand', lot.kind)
  }
}

const WORK_LOT: Partial<Record<Workplace, string>> = { shop: 'market', none: 'market' }
export function lotFor(layout: Layout, at: PlaceKind, workplace: Workplace, home: Lot): Lot {
  if (at === 'home') return home
  if (at === 'visit') return layout.homes[1] ?? home // her parents' house
  if (at === 'hers') return layout.homes[0]
  if (at === 'work') return layout.byKind.get((WORK_LOT[workplace] ?? workplace) as never) ?? layout.byKind.get('market')!
  return layout.byKind.get(at as never) ?? layout.byKind.get('square') ?? home
}

const lens = (p: V2[]) => p.slice(1).map((q, i) => Math.hypot(q.x - p[i].x, q.z - p[i].z))
const leg = (kind: Leg['kind'], path: V2[], start: number, end: number, why?: string): Leg => { const l = lens(path); return { kind, start, end, path, lens: l, total: l.reduce((a, b) => a + b, 0), why } }

// travel from one station to another, arriving at `arrive`. takes the bus when the walk is long and they can pay
// in and out through the door: from a spot inside, first to the point just inside the door (straight in from the
// street), then out; never a diagonal through a wall, a stall or a stoop. (layout units)
// from a spot inside a place to the line straight in from its door (layout units): usually one corner point; for a
// vendor behind a stall, first back into the passage behind everyone standing at the stalls
export function wayIn(lot: Lot, st: Station): V2[] {
  const zDoor = Math.abs(lot.door.z - lot.z) >= Math.abs(lot.door.x - lot.x)
  // a shopper's place is in a row of standing places: their way in is the clear row beside it, then a step over
  if (lot.kind === 'market' && (st.label === 'the stalls' || st.label === 'a food stall')) {
    const sd = Math.sign(zDoor ? st.pos.z - lot.z : st.pos.x - lot.x) || 1, off = sd * (0.21 / K)
    const w = zDoor ? { x: st.pos.x, z: st.pos.z - off } : { x: st.pos.x - off, z: st.pos.z }
    return [w, zDoor ? { x: lot.door.x, z: w.z } : { x: w.x, z: lot.door.z }]
  }
  if (lot.kind !== 'market' || st.label !== 'a stall') return [zDoor ? { x: lot.door.x, z: st.pos.z } : { x: st.pos.x, z: lot.door.z }]
  const sd = Math.sign(zDoor ? st.pos.z - lot.z : st.pos.x - lot.x) || 1
  const b = zDoor ? { x: st.pos.x, z: st.pos.z + sd * (0.45 / K) } : { x: st.pos.x + sd * (0.45 / K), z: st.pos.z }
  return [b, zDoor ? { x: lot.door.x, z: b.z } : { x: b.x, z: lot.door.z }]
}
function viaDoor(path: V2[], from: Lot, fromSt: Station, to: Lot, toSt: Station): V2[] {
  // the point inside, straight in from the door: on the door's axis (doors face z on most lots, x on some)
  const back = wayIn
  const out = [...path]
  out.splice(1, 0, ...back(from, fromSt))
  out.splice(out.length - 1, 0, ...back(to, toSt).reverse())
  return unspike(out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1].x, p.z - out[i - 1].z) > 0.01))
}
// a corner that doubles back (in through a door, then back toward a seat beside it): nobody walks a step past and
// turns on the spot, and the gait can't plant a foot through a 150 degree turn. the corner goes when the way in and
// the way out turn by more than 120 degrees and the point is close (the chord then stays in the clear space both legs
// already run through)
export function unspike(path: V2[]): V2[] {
  const out = [...path]
  for (let i = 1; i < out.length - 1; i++) {
    const a = out[i - 1], b = out[i], c = out[i + 1]
    const ux = b.x - a.x, uz = b.z - a.z, vx = c.x - b.x, vz = c.z - b.z
    const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz)
    if (lu < 1e-6 || lv < 1e-6) continue
    const cos = (ux * vx + uz * vz) / (lu * lv)
    if (cos < -0.5 && Math.min(lu, lv) < 0.25) { out.splice(i, 1); i = Math.max(0, i - 2) }
  }
  return out
}
export function travel(from: Lot, fromSt: Station, to: Lot, toSt: Station, arrive: number, canBus: boolean): Leg[] {
  const walk = viaDoor(pathBetween(fromSt.pos, from.door, toSt.pos, to.door), from, fromSt, to, toSt)
  const wl = lens(walk).reduce((a, b) => a + b, 0)
  if (!canBus || wl < 24) {
    const h = wl / WALK_UNITS_PER_H
    return [leg('walk', walk, arrive - h, arrive)]
  }
  // the stop: at the curb, 0.4 out from the bus street's center line (the house fronts are 0.75 out and their stoops
  // reach to 0.52), so waiting there is never in a wall or on someone's step
  const stopNear = (x: number) => ({ x: BUS_STOPS.reduce((b, s) => (Math.abs(s - x) < Math.abs(b - x) ? s : b)), z: BUS_Z + 0.4 })
  const a = stopNear(from.door.x), b = stopNear(to.door.x)
  // out through the door and in through the door, like any walk (never diagonally through a wall)
  const w1 = pathBetween(fromSt.pos, from.door, a, a), w2 = pathBetween(b, b, toSt.pos, to.door)
  w1.splice(1, 0, ...wayIn(from, fromSt)); w2.splice(w2.length - 1, 0, ...wayIn(to, toSt).reverse())
  const h1 = lens(w1).reduce((s, x) => s + x, 0) / WALK_UNITS_PER_H, h2 = lens(w2).reduce((s, x) => s + x, 0) / WALK_UNITS_PER_H
  const ride = Math.abs(b.x - a.x) / BUS_UNITS_PER_H + 0.03
  const t3 = arrive - h2, t2 = t3 - ride, t1 = t2 - 0.12, t0 = t1 - h1
  return [leg('walk', w1, t0, t1, 'to the bus stop'), leg('wait', [a, a], t1, t2, 'waiting for the bus'), leg('bus', [{ x: a.x, z: BUS_Z }, { x: b.x, z: BUS_Z }], t2, t3, 'on the bus'), leg('walk', w2, t3, arrive, 'from the bus stop')]
}

// workSlot: their own place at work (a vendor's place at the stalls, a desk), so the day's walks start and end there
export function planDay(layout: Layout, home: Lot, defs: StopDef[], workplace: Workplace, slot: number, canBus: boolean, workSlot = slot): DayPlan {
  const stops: Stop[] = defs.map(d => { const lot = lotFor(layout, d.at, workplace, home); return { ...d, lot, station: stationFor(lot, d.act, d.slot ?? (d.act === 'work' ? workSlot : slot), workplace) } })
  const legs: Leg[][] = stops.map(() => [])
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i]
    if (a.lot.id === b.lot.id) {
      // moving inside the same building: a few steps between stations
      const d = Math.hypot(a.station.pos.x - b.station.pos.x, a.station.pos.z - b.station.pos.z)
      // (along the way in from the door, never straight across a stall row or a table)
      const wa = wayIn(a.lot, a.station), wb = wayIn(a.lot, b.station)
      // (two places off the same clear row, a stall and the food stall beside it: along the row, not out to the
      // door's line and back, which is a u-turn round the end of a stall)
      const zDoor = Math.abs(a.lot.door.z - a.lot.z) >= Math.abs(a.lot.door.x - a.lot.x)
      const sameRow = wa.length === 2 && wb.length === 2 && Math.abs(zDoor ? wa[0].z - wb[0].z : wa[0].x - wb[0].x) < 1e-6
      const via = sameRow ? [wa[0], wb[0]] : [...wa, ...wb.reverse()]
      const path = unspike([a.station.pos, ...via, b.station.pos].filter((p, k, arr) => k === 0 || Math.hypot(p.x - arr[k - 1].x, p.z - arr[k - 1].z) > 0.01))
      if (d > 0.05) legs[i] = [leg('walk', path, b.hour - lens(path).reduce((x, y) => x + y, 0) / WALK_UNITS_PER_H * 2, b.hour)]
      continue
    }
    const l = travel(a.lot, a.station, b.lot, b.station, b.hour, canBus)
    // never leave before the previous stop has started
    const earliest = a.hour + 0.15
    if (l[0].start < earliest) { const shift = earliest - l[0].start; for (const x of l) { x.start += shift; x.end += shift } }
    legs[i] = l
  }
  return { stops, legs }
}

export type Where = {
  pos: V2; heading: number; pose: Pose; moving: boolean; traveling: boolean; leg: Leg | null; legFrac: number
  stop: Stop; next: Stop | null; from: Stop | null; indoors: boolean; arrivedAgoH: number; onBus: boolean; busX: number | null
}
const OPEN = new Set(['park', 'square', 'market', 'farm'])

// lane: a small sideways offset per walker on the sidewalk, so people walking the same way never merge into one
export function whereIn(plan: DayPlan, hour: number, lane = 0): Where {
  const { stops, legs } = plan
  // a travel leg in progress wins
  for (let i = 0; i < stops.length; i++) for (const l of legs[i]) if (hour >= l.start && hour < l.end) {
    const f = (hour - l.start) / Math.max(1e-6, l.end - l.start)
    const p = along(l, f, lane)
    const onBus = l.kind === 'bus'
    return { pos: toWorld(p.pos), heading: p.heading, pose: l.kind === 'wait' ? 'wait' : onBus ? 'ride' : 'walk', moving: l.kind === 'walk' || onBus, traveling: l.path.length > 2 || onBus || l.kind === 'wait', leg: l, legFrac: f, stop: stops[i], next: stops[i], from: stops[i - 1] ?? null, indoors: false, arrivedAgoH: -1, onBus, busX: onBus ? p.pos.x * K : null }
  }
  let i = 0
  for (let k = 0; k < stops.length; k++) if (stops[k].hour <= hour) i = k
  const s = stops[i]
  return { pos: toWorld(s.station.pos), heading: s.station.facing, pose: s.station.pose, moving: false, traveling: false, leg: null, legFrac: 0, stop: s, next: stops[i + 1] ?? null, from: null, indoors: !OPEN.has(s.lot.kind) && !['bench by the door', 'the doorstep', 'out front'].includes(s.station.label), arrivedAgoH: hour - s.hour, onBus: false, busX: null }
}

// eases in and out with zero slope at both ends (a drift to the side of the lane has no kink)
const ease = (u: number) => u * u * (3 - 2 * u)
function along(l: Leg, f: number, lane = 0): { pos: V2; heading: number } {
  let d = f * l.total, k = 0
  while (k < l.lens.length - 1 && d > l.lens[k]) { d -= l.lens[k]; k++ }
  const a = l.path[k], b = l.path[k + 1] ?? a
  const t = l.lens[k] ? Math.min(1, d / l.lens[k]) : 0
  const heading = Math.atan2(b.x - a.x, b.z - a.z)
  // corners are walked as a short curve (a turn takes a step, not an instant): within R of a corner the position and
  // heading follow a quadratic curve from R before it to R after it
  const R = 0.18
  const corner = (v: V2, inDir: V2, outDir: V2, u: number) => {
    const p0 = { x: v.x - inDir.x * R, z: v.z - inDir.z * R }, p2 = { x: v.x + outDir.x * R, z: v.z + outDir.z * R }
    const pos = { x: (1 - u) ** 2 * p0.x + 2 * (1 - u) * u * v.x + u * u * p2.x, z: (1 - u) ** 2 * p0.z + 2 * (1 - u) * u * v.z + u * u * p2.z }
    const tx = 2 * (1 - u) * (v.x - p0.x) + 2 * u * (p2.x - v.x), tz = 2 * (1 - u) * (v.z - p0.z) + 2 * u * (p2.z - v.z)
    return { pos, heading: Math.atan2(tx, tz) }
  }
  const unit = (p: V2, q: V2) => { const n = Math.hypot(q.x - p.x, q.z - p.z) || 1; return { x: (q.x - p.x) / n, z: (q.z - p.z) / n } }
  const segIn = l.lens[k] ?? 0
  if (l.kind === 'walk' && segIn > 2 * R && k + 2 < l.path.length && segIn - d < R && (l.lens[k + 1] ?? 0) > 2 * R) {
    const c = l.path[k + 1], u = 0.5 * (1 - (segIn - d) / R)
    const r = corner(c, unit(a, c), unit(c, l.path[k + 2]), u)
    return { pos: r.pos, heading: r.heading }
  }
  if (l.kind === 'walk' && k > 0 && segIn > 2 * R && d < R && (l.lens[k - 1] ?? 0) > 2 * R) {
    const u = 0.5 + 0.5 * (d / R)
    const r = corner(a, unit(l.path[k - 1], a), unit(a, b), u)
    return { pos: r.pos, heading: r.heading }
  }
  void heading
  // on foot, keep to the sidewalk on the right of the street (the path itself runs down the street's center line);
  // short hops (out a door, between stations) and the bus stay where they are
  // only on real street segments (both ends on the same street line), never on the way in or out of a door
  const onStreet = (Math.abs(a.x - b.x) < 1e-6 && STREET_SET.has(Math.round(a.x))) || (Math.abs(a.z - b.z) < 1e-6 && STREET_SET.has(Math.round(a.z)))
  // walkers keep to the edge of the lane, clear of the stoops (vehicles use the middle): 0.95 world units (1.6 m) from
  // the center line, inside the 1.25 of open lane (./fabric LANE_HALF)
  // (on every street segment, however short: the middle of the lane is where the vehicles drive)
  const side = l.kind === 'walk' && onStreet && l.lens[k] > 0.05 ? (1.02 / K + lane) * ease(Math.max(0, Math.min(1, (Math.min(d, l.lens[k] - d) - 0.18) / 0.8))) : 0
  return { pos: { x: a.x + (b.x - a.x) * t - Math.cos(heading) * side, z: a.z + (b.z - a.z) * t + Math.sin(heading) * side }, heading }
}

// a small deterministic hash for per-day choices (weekday bus or not, night shifts)
export const hash01 = (n: number) => (((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1) + 1) % 1
