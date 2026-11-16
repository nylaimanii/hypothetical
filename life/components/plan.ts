// a day, planned like a person would live it. stops happen at a station (a bed, a table, a desk, a stall, a bench),
// and between stops they really travel: out the door, along the streets (bfs over the street grid, the main
// site's city layout), or to a bus stop, a wait, a ride, and the walk from the stop. legs are timed by distance, so
// people leave early enough to arrive on time. the same planner moves the chosen person, her family, her
// coworkers and the city's crowd.
import type { Layout, Lot, V2 } from '@/components/world/city/layout'
import { pathBetween } from '@/components/world/city/layout'
import type { LifeActivity, Workplace } from '@/lib/life/types'

export const WALK_UNITS_PER_H = 55 // sim walking speed (the diorama is small, so this is a stylized pace)
export const BUS_UNITS_PER_H = 220
export const BUS_Z = -3 // the bus runs along this street
const BUS_STOPS = [-12, -6, 0, 6, 12]

export type Act = 'sleep' | 'eat' | 'cook' | 'work' | 'learn' | 'play' | 'rest' | 'shop' | 'care' | 'sit' | 'pray'
export type Pose = 'stand' | 'sit' | 'lie' | 'walk' | 'ride' | 'wait' | 'busy'
export type PlaceKind = 'home' | 'work' | 'school' | 'market' | 'park' | 'clinic' | 'square' | 'shrine' | 'visit'
export type Station = { pos: V2; facing: number; pose: Pose; label: string }
type StopDef = { hour: number; at: PlaceKind; act: Act }
export type Stop = StopDef & { lot: Lot; station: Station }
export type Leg = { kind: 'walk' | 'wait' | 'bus'; start: number; end: number; path: V2[]; lens: number[]; total: number; why?: string }
export type DayPlan = { stops: Stop[]; legs: Leg[][] } // legs[i]: how they got to stops[i]

// ---------- schedules ----------
export function schedule(a: LifeActivity, o: { kids: boolean; weekend: boolean; religious: boolean; night?: boolean; visit?: boolean }): StopDef[] {
  const home = (hour: number, act: Act): StopDef => ({ hour, at: 'home', act })
  if (a === 'working' && o.night) return [home(0, 'sleep'), home(11, 'eat'), { hour: 13, at: 'market', act: 'shop' }, home(14.5, 'cook'), home(16, 'rest'), { hour: 19, at: 'work', act: 'work' }, home(23.99, 'sleep')]
  if (o.weekend && (a === 'working' || a === 'school' || a === 'studying')) return [home(0, 'sleep'), home(8, 'eat'), ...(o.religious ? [{ hour: 9.5, at: 'shrine' as const, act: 'pray' as const }] : []), { hour: 11, at: 'market', act: 'shop' }, home(13, 'cook'), ...(o.visit ? [{ hour: 15, at: 'visit' as const, act: 'eat' as const }] : [{ hour: 16, at: (o.kids ? 'park' : 'square') as PlaceKind, act: 'play' as const }]), home(18.5, 'eat'), home(22, 'sleep')]
  switch (a) {
    case 'working': return [home(0, 'sleep'), home(6.3, 'cook'), home(6.8, 'eat'), { hour: 8, at: 'work', act: 'work' }, { hour: 12.3, at: 'market', act: 'eat' }, { hour: 13.2, at: 'work', act: 'work' }, { hour: 17.6, at: 'market', act: 'shop' }, home(18.6, 'cook'), home(19.3, 'eat'), ...(o.kids ? [{ hour: 20, at: 'park' as const, act: 'play' as const }, home(21, 'rest')] : [home(20.5, 'rest')]), home(22.3, 'sleep')]
    case 'school': return [home(0, 'sleep'), home(6.8, 'eat'), { hour: 7.6, at: 'school', act: 'learn' }, { hour: 14.5, at: 'park', act: 'play' }, home(17.5, 'rest'), home(18.5, 'eat'), home(21, 'sleep')]
    case 'studying': return [home(0, 'sleep'), home(7, 'eat'), { hour: 8.2, at: 'school', act: 'learn' }, { hour: 13, at: 'market', act: 'eat' }, { hour: 14, at: 'school', act: 'learn' }, home(18.5, 'eat'), home(19.5, 'rest'), home(23, 'sleep')]
    case 'infant': return [home(0, 'sleep'), home(7, 'eat'), home(8, 'play'), home(12, 'sleep'), home(14.5, 'play'), home(17.5, 'eat'), home(19, 'sleep')]
    case 'retired': return [home(0, 'sleep'), home(6.5, 'cook'), home(7, 'eat'), { hour: 8.5, at: 'park', act: 'sit' }, { hour: 10.5, at: 'market', act: 'shop' }, home(12, 'cook'), home(13, 'rest'), { hour: 16, at: 'square', act: 'sit' }, home(18, 'eat'), home(21.5, 'sleep')]
    case 'unemployed': return [home(0, 'sleep'), home(7.5, 'eat'), { hour: 8.5, at: 'market', act: 'shop' }, { hour: 11, at: 'square', act: 'sit' }, home(14, 'cook'), home(15, 'rest'), home(22.5, 'sleep')]
    case 'caregiving': return [home(0, 'sleep'), home(6, 'cook'), home(7, 'care'), { hour: 10, at: 'clinic', act: 'care' }, { hour: 11.5, at: 'market', act: 'shop' }, home(12.5, 'cook'), home(13.5, 'care'), home(19, 'eat'), home(22, 'sleep')]
    case 'sick': return [home(0, 'sleep'), home(9, 'rest'), { hour: 10.5, at: 'clinic', act: 'sit' }, home(12.5, 'rest'), home(14, 'sleep'), home(17, 'eat'), home(20, 'sleep')]
    case 'grieving': return [home(0, 'sleep'), home(9, 'sit'), ...(o.religious ? [{ hour: 11, at: 'shrine' as const, act: 'pray' as const }] : []), { hour: 16, at: 'park', act: 'sit' }, home(18, 'eat'), home(19, 'sit'), home(23, 'sleep')]
    case 'protesting': return [home(0, 'sleep'), home(7, 'eat'), { hour: 9, at: 'square', act: 'play' }, home(18, 'eat'), home(22, 'sleep')]
    default: return [home(0, 'sleep'), home(8, 'eat'), { hour: 9, at: 'market', act: 'shop' }, home(13, 'rest'), home(22, 'sleep')]
  }
}

// ---------- stations inside a lot ----------
// homes are small (1.9 x 1.9): bed, table, stove. bigger lots get a row of workstations; slot picks one per person
export function stationFor(lot: Lot, act: Act, slot: number, workplace?: Workplace): Station {
  const { x, z } = lot
  const s = (dx: number, dz: number, facing: number, pose: Pose, label: string): Station => ({ pos: { x: x + dx, z: z + dz }, facing, pose, label })
  if (lot.kind === 'home') {
    const k = slot % 4
    if (act === 'sleep') return s(-0.38 + (k % 2) * 0.12, -0.35 + Math.floor(k / 2) * 0.12, 0, 'lie', 'bed')
    if (act === 'cook') return s(0.42, -0.42, Math.PI, 'busy', 'stove')
    // around the table: up to 8 seats on a ring, each facing the table, so a family of six never shares a chair
    if (act === 'eat') { const ang = (slot % 8) / 8 * Math.PI * 2 + 0.4, tx = 0.0, tz = 0.25; return s(tx + Math.sin(ang) * 0.42, tz + Math.cos(ang) * 0.42, ang + Math.PI, 'sit', 'table') }
    if (act === 'care') return s(-0.2, -0.3, Math.PI / 4, 'busy', 'bedside')
    // resting: on the bench outside the front door, on the street (where neighbors see each other)
    return { pos: { x: lot.door.x + (k % 2 ? 0.35 : -0.35), z: lot.door.z + (lot.door.z > lot.z ? -0.35 : 0.35) }, facing: lot.door.z > lot.z ? 0 : Math.PI, pose: 'sit', label: 'bench by the door' }
  }
  const cols = 4, r = slot % 8
  const gx = (r % cols - 1.5) * Math.min(0.9, lot.w * 0.22), gz = (Math.floor(r / cols) - 0.5) * Math.min(1.1, lot.d * 0.3)
  switch (lot.kind) {
    case 'clinic': return s(gx, gz, 0, act === 'sit' ? 'sit' : 'busy', act === 'sit' ? 'waiting bench' : 'a patient bed')
    case 'school': return s(gx, gz, Math.PI, act === 'learn' ? 'sit' : 'stand', 'a desk')
    case 'office': case 'lab': return s(gx, gz, Math.PI, 'sit', workplace === 'lab' ? 'a bench in the lab' : 'a desk')
    case 'factory': case 'power_plant': return s(gx, gz, 0, 'busy', 'a machine')
    case 'construction': return s(gx, gz, 0, 'busy', 'the site')
    case 'farm': return s(gx * 1.5, gz * 1.5, 0, 'busy', 'the field')
    case 'market': return act === 'work' ? s(-1.5 + (r % 4) * 1.0, -0.6, Math.PI, 'busy', 'a stall') : s(-1.5 + (r % 4) * 1.0, -0.15 + (r > 3 ? 1.1 : 0), 0, act === 'eat' ? 'sit' : 'stand', act === 'eat' ? 'a food stall' : 'the stalls')
    case 'park': return s(gx * 1.3, gz * 1.3, slot * 1.7, act === 'play' ? 'stand' : 'sit', act === 'play' ? 'the grass' : 'a bench')
    case 'square': return s(gx * 1.3, gz * 1.3, slot * 2.1, act === 'play' ? 'stand' : 'sit', 'the square')
    case 'shrine': return s(gx * 0.4, gz * 0.4, Math.PI, 'sit', 'the prayer hall')
    default: return s(gx, gz, 0, 'stand', lot.kind)
  }
}

const WORK_LOT: Partial<Record<Workplace, string>> = { shop: 'market', none: 'market' }
export function lotFor(layout: Layout, at: PlaceKind, workplace: Workplace, home: Lot): Lot {
  if (at === 'home') return home
  if (at === 'visit') return layout.homes[1] ?? home // her parents' house
  if (at === 'work') return layout.byKind.get((WORK_LOT[workplace] ?? workplace) as never) ?? layout.byKind.get('market')!
  return layout.byKind.get(at as never) ?? layout.byKind.get('square') ?? home
}

const lens = (p: V2[]) => p.slice(1).map((q, i) => Math.hypot(q.x - p[i].x, q.z - p[i].z))
const leg = (kind: Leg['kind'], path: V2[], start: number, end: number, why?: string): Leg => { const l = lens(path); return { kind, start, end, path, lens: l, total: l.reduce((a, b) => a + b, 0), why } }

// travel from one station to another, arriving at `arrive`. takes the bus when the walk is long and they can pay
export function travel(from: Lot, fromSt: Station, to: Lot, toSt: Station, arrive: number, canBus: boolean): Leg[] {
  const walk = pathBetween(fromSt.pos, from.door, toSt.pos, to.door)
  const wl = lens(walk).reduce((a, b) => a + b, 0)
  if (!canBus || wl < 24) {
    const h = wl / WALK_UNITS_PER_H
    return [leg('walk', walk, arrive - h, arrive)]
  }
  const stopNear = (x: number) => ({ x: BUS_STOPS.reduce((b, s) => (Math.abs(s - x) < Math.abs(b - x) ? s : b)), z: BUS_Z + 0.75 })
  const a = stopNear(from.door.x), b = stopNear(to.door.x)
  const w1 = pathBetween(fromSt.pos, from.door, a, a), w2 = pathBetween(b, b, toSt.pos, to.door)
  const h1 = lens(w1).reduce((s, x) => s + x, 0) / WALK_UNITS_PER_H, h2 = lens(w2).reduce((s, x) => s + x, 0) / WALK_UNITS_PER_H
  const ride = Math.abs(b.x - a.x) / BUS_UNITS_PER_H + 0.03
  const t3 = arrive - h2, t2 = t3 - ride, t1 = t2 - 0.12, t0 = t1 - h1
  return [leg('walk', w1, t0, t1, 'to the bus stop'), leg('wait', [a, a], t1, t2, 'waiting for the bus'), leg('bus', [{ x: a.x, z: BUS_Z }, { x: b.x, z: BUS_Z }], t2, t3, 'on the bus'), leg('walk', w2, t3, arrive, 'from the bus stop')]
}

export function planDay(layout: Layout, home: Lot, defs: StopDef[], workplace: Workplace, slot: number, canBus: boolean): DayPlan {
  const stops: Stop[] = defs.map(d => { const lot = lotFor(layout, d.at, workplace, home); return { ...d, lot, station: stationFor(lot, d.act, slot, workplace) } })
  const legs: Leg[][] = stops.map(() => [])
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i]
    if (a.lot.id === b.lot.id) {
      // moving inside the same building: a few steps between stations
      const d = Math.hypot(a.station.pos.x - b.station.pos.x, a.station.pos.z - b.station.pos.z)
      if (d > 0.05) legs[i] = [leg('walk', [a.station.pos, b.station.pos], b.hour - d / WALK_UNITS_PER_H * 2, b.hour)]
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
  stop: Stop; next: Stop | null; indoors: boolean; arrivedAgoH: number; onBus: boolean; busX: number | null
}
const OPEN = new Set(['park', 'square', 'market', 'farm'])

export function whereIn(plan: DayPlan, hour: number): Where {
  const { stops, legs } = plan
  // a travel leg in progress wins
  for (let i = 0; i < stops.length; i++) for (const l of legs[i]) if (hour >= l.start && hour < l.end) {
    const f = (hour - l.start) / Math.max(1e-6, l.end - l.start)
    const p = along(l, f)
    const onBus = l.kind === 'bus'
    return { pos: p.pos, heading: p.heading, pose: l.kind === 'wait' ? 'wait' : onBus ? 'ride' : 'walk', moving: l.kind === 'walk' || onBus, traveling: l.path.length > 2 || onBus || l.kind === 'wait', leg: l, legFrac: f, stop: stops[i], next: stops[i], indoors: false, arrivedAgoH: -1, onBus, busX: onBus ? p.pos.x : null }
  }
  let i = 0
  for (let k = 0; k < stops.length; k++) if (stops[k].hour <= hour) i = k
  const s = stops[i]
  return { pos: s.station.pos, heading: s.station.facing, pose: s.station.pose, moving: false, traveling: false, leg: null, legFrac: 0, stop: s, next: stops[i + 1] ?? null, indoors: !OPEN.has(s.lot.kind) && s.station.label !== 'bench by the door', arrivedAgoH: hour - s.hour, onBus: false, busX: null }
}

function along(l: Leg, f: number): { pos: V2; heading: number } {
  let d = f * l.total, k = 0
  while (k < l.lens.length - 1 && d > l.lens[k]) { d -= l.lens[k]; k++ }
  const a = l.path[k], b = l.path[k + 1] ?? a
  const t = l.lens[k] ? Math.min(1, d / l.lens[k]) : 0
  const heading = Math.atan2(b.x - a.x, b.z - a.z)
  // on foot, keep to the sidewalk on the right of the street (the path itself runs down the street's center line);
  // short hops (out a door, between stations) and the bus stay where they are
  const side = l.kind === 'walk' && l.lens[k] > 1.5 ? 0.78 * Math.min(1, Math.min(d, l.lens[k] - d) / 0.6) : 0
  return { pos: { x: a.x + (b.x - a.x) * t - Math.cos(heading) * side, z: a.z + (b.z - a.z) * t + Math.sin(heading) * side }, heading }
}

// a small deterministic hash for per-day choices (weekday bus or not, night shifts)
export const hash01 = (n: number) => (((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1) + 1) % 1
