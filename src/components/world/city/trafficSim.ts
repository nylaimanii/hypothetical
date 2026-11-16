// the city view's traffic as plain data: the region's vehicles (looks.ts) at real sizes in their lanes, on the side
// of the road the country drives on. cars keep their distance, stop for anyone on the road ahead, take turns at
// crossings, and only appear or leave far out in the fog (how many are out follows the hour, but the count only
// changes at the ends of the streets, never in view).
import type { Look, VehicleKind } from './looks'
import { LANE, ROAD, SPACING, STREETS, m } from './grid'

// countries that drive on the left (https://en.wikipedia.org/wiki/Left-_and_right-hand_traffic)
export const LEFT_HAND = new Set(['GBR', 'IRL', 'JPN', 'IND', 'PAK', 'BGD', 'LKA', 'NPL', 'BTN', 'IDN', 'THA', 'MYS', 'SGP', 'BRN', 'TLS', 'HKG', 'MAC', 'AUS', 'NZL', 'PNG', 'FJI', 'ZAF', 'KEN', 'TZA', 'UGA', 'ZMB', 'ZWE', 'MOZ', 'MWI', 'BWA', 'NAM', 'LSO', 'SWZ', 'MUS', 'SYC', 'JAM', 'TTO', 'BHS', 'BRB', 'GUY', 'SUR', 'CYP', 'MLT'])

export type Kind = VehicleKind | 'tram'
// real sizes: length, width, body height; the top box (cabin, canopy, rider): length, width, height, forward offset
export const DIM: Record<Kind, { l: number; w: number; h: number; top: [number, number, number, number]; speed: number }> = {
  car: { l: m(4.5), w: m(1.8), h: m(0.95), top: [m(2.4), m(1.65), m(0.5), -m(0.2)], speed: 2.4 },
  cab: { l: m(4.7), w: m(1.8), h: m(0.95), top: [m(2.4), m(1.65), m(0.5), -m(0.2)], speed: 2.4 },
  minibus: { l: m(5.4), w: m(1.9), h: m(1.7), top: [m(5.2), m(1.85), m(0.45), 0], speed: 2.1 },
  bus: { l: m(12), w: m(2.5), h: m(2.6), top: [m(11.8), m(2.45), m(0.5), 0], speed: 1.7 },
  tuktuk: { l: m(2.7), w: m(1.3), h: m(0.9), top: [m(2.5), m(1.3), m(0.15), -m(0.1)], speed: 1.9 },
  moto: { l: m(2.0), w: m(0.7), h: m(0.6), top: [m(0.5), m(0.5), m(0.75), -m(0.25)], speed: 2.7 },
  tram: { l: m(20), w: m(2.65), h: m(3.0), top: [m(19.5), m(2.6), m(0.3), 0], speed: 1.6 },
}
export const TOP_LIFT: Record<Kind, number> = { car: 0, cab: 0, minibus: -m(0.9), bus: -m(1.2), tuktuk: m(0.75), moto: 0, tram: -m(1.4) }

export type Vehicle = {
  id: number; kind: Kind; color: string; top: string
  axis: 0 | 1 // 0 runs along x, 1 along z
  line: number; dir: 1 | -1; lane: number
  s: number; len: number; speed: number; v: number
  active: boolean // out on the streets (false: parked out beyond the fog)
  gate: number // goes out when the hour's traffic share is above this
  lock: string | null // the crossing it holds
}
export type Traffic = { vehicles: Vehicle[]; locks: Map<string, { axis: 0 | 1; ids: Set<number> }>; far: number }

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }
function rng(seed: number) { let a = seed || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

// share of vehicles out at a local hour (ESTIMATE, the usual two-peak urban traffic curve)
export function trafficAt(h: number) {
  const peak = (c: number, w: number) => Math.exp(-((h - c) ** 2) / (2 * w * w))
  return Math.min(1, 0.12 + 0.85 * peak(8, 1.4) + 0.8 * peak(18, 1.8) + 0.45 * peak(13, 3) + 0.25 * peak(21, 1.5))
}

// every street line vehicles drive: the plate's streets, and every other line out to the edge of the surround
export const FAR = 92
export function driveLines(tramZ: number | null) {
  const lines: { axis: 0 | 1; line: number }[] = []
  const cross: number[] = [...STREETS]
  for (let k = 3.5; k * SPACING <= FAR; k += 2) cross.push(k * SPACING, -k * SPACING)
  for (const s of cross) for (const axis of [0, 1] as const) if (!(axis === 0 && tramZ !== null && s === tramZ)) lines.push({ axis, line: s })
  return { lines, cross: [...new Set(cross)] }
}

export function makeTraffic(cityId: string, look: Look, leftHand: boolean, tramZ: number | null): Traffic {
  const r = rng(hash(cityId + 'traffic'))
  const { lines, cross } = driveLines(tramZ)
  const vehicles: Vehicle[] = []
  for (const L of lines) {
    const n = Math.round(look.traffic * (Math.abs(L.line) > STREETS[STREETS.length - 1] ? 1.2 : 0.8))
    for (let k = 0; k < n; k++) {
      let u = r(), v = look.vehicles[0]
      for (const x of look.vehicles) { if ((u -= x.share) <= 0) { v = x; break } }
      const dir: 1 | -1 = k % 2 ? 1 : -1
      const color = v.colors[Math.floor(r() * v.colors.length) % v.colors.length]
      const top = v.kind === 'moto' ? ['#7E9CB5', '#C9A46A', '#8FAE84', '#B98370'][Math.floor(r() * 4)] : v.kind === 'tuktuk' ? color : '#2E3640'
      // spread along the lane, clear of every crossing (a vehicle never starts inside one)
      let s = -FAR + ((Math.floor(k / 2) + 0.5) / Math.ceil(n / 2)) * 2 * FAR + (r() - 0.5) * 2
      for (let tries = 0; tries < 20 && cross.some((c) => Math.abs(c - s) < DIM[v.kind].l / 2 + ROAD / 2 + 0.3); tries++) s += 0.5
      vehicles.push({ id: vehicles.length, kind: v.kind, color, top, axis: L.axis, line: L.line, dir, lane: (leftHand ? -1 : 1) * dir * LANE, s, len: FAR, speed: DIM[v.kind].speed * (0.85 + r() * 0.3), v: 0, active: true, gate: r(), lock: null })
    }
  }
  if (tramZ !== null) vehicles.push({ id: vehicles.length, kind: 'tram', color: '#D9CFB8', top: '#2E3640', axis: 0, line: tramZ, dir: 1, lane: 0, s: (STREETS[0] + STREETS[1]) / 2, len: FAR, speed: DIM.tram.speed, v: 0, active: true, gate: 0, lock: null })
  return { vehicles, locks: new Map(), far: FAR - 14 }
}

export const vehiclePos = (v: Vehicle) => (v.axis === 0 ? { x: v.s, z: v.line + v.lane } : { x: v.line + v.lane, z: v.s })
// the footprint, as an axis-aligned box (vehicles only run along x or z)
export function vehicleBox(v: Vehicle) {
  const d = DIM[v.kind], p = vehiclePos(v)
  return v.axis === 0 ? { x: p.x, z: p.z, w: d.l, d: d.w } : { x: p.x, z: p.z, w: d.w, d: d.l }
}

// one step. people: positions and radii of everyone visible (cars stop for anyone on the road in front of them)
export function stepTraffic(tr: Traffic, hour: number, dt: number, people: { x: number; z: number; r: number; vx?: number; vz?: number; waiting?: boolean }[], cross: number[]) {
  const share = trafficAt(hour)
  const { vehicles, locks } = tr
  for (const v of vehicles) {
    const d = DIM[v.kind]
    // in and out of service only far out in the fog
    if (Math.abs(v.s) > tr.far) {
      if (v.kind !== 'tram' && Math.abs(v.s) > tr.far + 1) v.active = v.gate <= share
    }
    // free run speed, then the constraints: the car ahead, people ahead, the next crossing
    let want = v.speed
    const front = v.s + v.dir * d.l / 2
    for (const o of vehicles) {
      if (o === v || o.axis !== v.axis || o.line !== v.line || o.lane !== v.lane) continue
      if ((o.s - v.s) * v.dir <= 0) continue
      const gap = (o.s - v.s) * v.dir - (d.l + DIM[o.kind].l) / 2
      if (gap < 3) want = Math.min(want, gap < m(2) ? 0 : Math.min(o.v + (gap - m(2)) * 1.2, v.speed))
    }
    if (v.active) {
      const lineAt = v.line + v.lane
      for (const p of people) {
        const across = v.axis === 0 ? p.z : p.x, along = v.axis === 0 ? p.x : p.z
        // in the lane, or about to step into it (where they'll be in 0.8 s)
        const soon = across + (v.axis === 0 ? (p.vz ?? 0) : (p.vx ?? 0)) * 0.8
        const band = d.w / 2 + p.r + m(0.6)
        // someone waiting at the curb beside the lane counts as crossing (drivers let them go)
        const waitBand = p.waiting ? d.w / 2 + p.r + m(4) : 0
        if (Math.abs(across - lineAt) > Math.max(band, waitBand) && Math.abs(soon - lineAt) > band && Math.sign(across - lineAt) === Math.sign(soon - lineAt)) continue
        const ahead = (along - front) * v.dir
        if (ahead > -d.l && ahead < 2.4 + p.r) want = Math.min(want, ahead < m(1.5) + p.r ? 0 : (ahead - m(1.5) - p.r) * 1.2)
      }
    }
    // crossings: hold the box while inside it, wait if a car on the other axis holds it
    let next: number | null = null
    for (const c of cross) { const a = (c - v.s) * v.dir; if (a > -d.l / 2 - ROAD / 2 && a < 1.2 + ROAD / 2 + d.l / 2 && (next === null || a < (next - v.s) * v.dir)) next = c }
    const keyOf = (c: number) => (v.axis === 0 ? `${c},${v.line}` : `${v.line},${c}`)
    const free = (k: string) => { const L = locks.get(k); if (L) { L.ids.delete(v.id); if (!L.ids.size) locks.delete(k) } }
    if (v.lock && (next === null || keyOf(next) !== v.lock)) { free(v.lock); v.lock = null }
    if (next !== null) {
      const k = keyOf(next)
      const L = locks.get(k)
      const into = (next - v.s) * v.dir - d.l / 2 - ROAD / 2 // distance to the crossing's near edge
      if (v.lock === k) { /* holding it */ }
      else if (!L || L.axis === v.axis) {
        // claim it once close enough to be committed (stopping distance at full speed is about 0.4)
        if (into < 1.0) { if (L) L.ids.add(v.id); else locks.set(k, { axis: v.axis, ids: new Set([v.id]) }); v.lock = k }
      } else want = Math.min(want, into < m(1) ? 0 : (into - m(1)) * 1.2)
    }
    // brake hard (about 0.8 g at this scale), pull away gently
    v.v += want < v.v ? -Math.min(v.v - want, dt * 8) : Math.min(want - v.v, dt * 2.5)
    v.s += v.dir * v.v * dt
    if (Math.abs(v.s) > v.len) { v.s -= Math.sign(v.s) * 2 * v.len; if (v.lock) { const L = locks.get(v.lock); L?.ids.delete(v.id); if (L && !L.ids.size) locks.delete(v.lock); v.lock = null } }
  }
}
