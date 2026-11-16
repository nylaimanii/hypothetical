// traffic in her lane as pure state (./Vehicles draws it, the qa script checks it). the residential lanes in the
// reference photos (life/REFERENCE.md) carry motorbikes (boda) and tuk-tuks (bajaji) among people on foot; minibuses
// run on the main roads, and one appears here only when she is riding it. every vehicle drives at the speed it can:
// it keeps to its side of the lane, slows behind anyone or anything in its path and stops rather than hit them, and
// only enters or leaves the scene at the ends of the street, in the haze.
import { STREETS_W, hash01 } from './plan'
import { DIMS } from './dims'
import type { CityStyle } from './style'
import type { LiveState } from './ChosenPerson'
import type { WorldNow } from './Scene'

export type VehKind = 'bajaji' | 'boda' | 'minibus' | 'car'
export type Veh = { id: number; kind: VehKind; x: number; z: number; heading: number; w: number; l: number; presence: number; speed: number; carrying: boolean; parked: boolean }
type Obstacle = { x: number; z: number; r: number; crossing?: boolean }

const SPAN = 46 // the window of street around her; its ends are in the haze

export class Traffic {
  private v: { kind: VehKind; dir: 1 | -1; s: number; speed: number; cruise: number; presence: number; on: boolean; street: string; parked: boolean; parkAt: number }[]
  private leftHand: boolean
  constructor(style: CityStyle, seed: number) {
    this.leftHand = style.kind === 'swahili'
    const N = 14
    this.v = Array.from({ length: N }, (_, i) => {
      const u = hash01(i * 3.3 + seed)
      // lanes: mostly bodas, some bajaji (the city's own share between the two)
      const share = style.vehicles.bajaji / Math.max(0.01, style.vehicles.bajaji + style.vehicles.boda)
      const kind: VehKind = u < share * 0.8 ? 'bajaji' : 'boda'
      // nothing parks in a lane this narrow: a parked bajaji would block it (they wait on the main roads)
      const parked = false
      // spread evenly along the street per direction, so no two start on top of each other
      return { kind, dir: i % 2 ? 1 : -1, s: (Math.floor(i / 2) / Math.ceil(N / 2)) * SPAN + hash01(i * 7 + seed) * 1.5, speed: 0, cruise: kind === 'boda' ? 3.2 + hash01(i) * 1.2 : 2.4 + hash01(i) * 0.6, presence: 0, on: false, street: '', parked, parkAt: (hash01(i * 11 + seed) - 0.5) * SPAN }
    })
  }

  // a cut: the next moment is minutes later, so no vehicle may be sitting on top of anyone when it opens
  private cutPending = false
  private settle = false
  cut() { this.cutPending = true }
  // obstacles: every body this frame (and her). returns the vehicles to draw
  step(W: WorldNow, L: LiveState, bodies: Obstacle[], dt: number): Veh[] {
    const out: Veh[] = []
    const nearX = STREETS_W.reduce((b, s) => (Math.abs(s - L.pos.x) < Math.abs(b - L.pos.x) ? s : b))
    const nearZ = STREETS_W.reduce((b, s) => (Math.abs(s - L.pos.z) < Math.abs(b - L.pos.z) ? s : b))
    const key = Math.abs(nearX - L.pos.x) < Math.abs(nearZ - L.pos.z) ? `x${nearX}` : `z${nearZ}`
    const h = W.hour
    const rush = Math.exp(-((h - 8) ** 2) / 1.5) + Math.exp(-((h - 18) ** 2) / 1.5)
    const active = Math.round(this.v.length * Math.min(1, (0.1 + 0.6 * rush + (h > 6 && h < 21 ? 0.25 : 0)) * (0.55 + W.density * 0.6)))
    // positions first (for vehicle-vs-vehicle yielding)
    const placed = this.v.map((c, i) => {
      if (!c.street) c.street = key
      const onX = c.street.startsWith('x'), line = Number(c.street.slice(1))
      const d = DIMS[c.kind]
      const center = onX ? L.pos.z : L.pos.x
      // parked ones stay where they were parked (a fixed spot on the street), moving ones where they have driven to
      const along = c.parked ? c.parkAt : c.s
      const rel = ((((along - center) % SPAN) + SPAN) % SPAN) - SPAN / 2
      const heading = onX ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2)
      // keep to its own side of the lane, hugging the middle (left-hand traffic in east africa, right-hand in
      // madagascar and west/central africa); parked ones pulled over by the wall
      const lat = c.parked ? 1.05 : (d.w / 2 + 0.01) * (this.leftHand ? 1 : -1)
      const lx = Math.cos(heading), lz = -Math.sin(heading) // the driver's left
      const x = (onX ? line : center + rel) + lx * lat, z = (onX ? center + rel : line) + lz * lat
      return { c, i, x, z, heading, rel, onX, d }
    })
    if (this.cutPending) {
      this.cutPending = false
      this.settle = true
      const queued = [0, 0]
      for (const p of placed) {
        const fx = Math.sin(p.heading), fz = Math.cos(p.heading)
        const hits = (x: number, z: number) => [...bodies, { x: L.pos.x, z: L.pos.z, r: 0.25 }].some(b => { const al = (b.x - x) * fx + (b.z - z) * fz, sd = (b.x - x) * fz - (b.z - z) * fx; return Math.abs(al) < p.d.l / 2 + b.r + 0.3 && Math.abs(sd) < p.d.w / 2 + b.r })
        // not in this moment's shot: it comes back in from the end of the street, behind it
        if (hits(p.x, p.z)) { const center = p.onX ? L.pos.z : L.pos.x; queued[p.c.dir > 0 ? 0 : 1] += p.d.l + 0.8; p.c.s = center - p.c.dir * (SPAN / 2 - 0.5 + queued[p.c.dir > 0 ? 0 : 1]); p.c.presence = 0; p.c.on = false; p.c.speed = 0; p.rel = -p.c.dir * (SPAN / 2 - 0.5); p.x = 1e6; p.z = 1e6 }
      }
    }
    if (this.settle) {
      // after a cut nobody shares a spot: a vehicle overlapping the one ahead of it on its side drops back behind it
      this.settle = false
      for (let pass = 0; pass < 6; pass++) for (const p of placed) for (const q of placed) {
        if (p === q || p.c.dir !== q.c.dir || p.c.street !== q.c.street) continue
        const gap = ((((q.c.s - p.c.s) * p.c.dir) % SPAN) + SPAN) % SPAN
        const need = (p.d.l + q.d.l) / 2 + 0.5
        if (gap < need && (gap > 1e-6 || p.i > q.i)) {
          const back = need - gap, nx = p.x - Math.sin(p.heading) * back, nz = p.z - Math.cos(p.heading) * back
          // backing up onto someone is not an option: then it is not in this shot at all (it comes in from the end)
          const fx = Math.sin(p.heading), fz = Math.cos(p.heading)
          const onSomeone = [...bodies, { x: L.pos.x, z: L.pos.z, r: 0.25 }].some(b => { const al = (b.x - nx) * fx + (b.z - nz) * fz, sd = (b.x - nx) * fz - (b.z - nz) * fx; return Math.abs(al) < p.d.l / 2 + b.r + 0.3 && Math.abs(sd) < p.d.w / 2 + b.r })
          if (onSomeone) { const center = p.onX ? L.pos.z : L.pos.x; p.c.s = center - p.c.dir * (SPAN / 2 + 1 + p.i * 0.7); p.c.presence = 0; p.c.on = false; p.c.speed = 0; p.x = 1e6; p.z = 1e6; continue }
          p.c.s -= p.c.dir * back; p.rel -= p.c.dir * back; p.x = nx; p.z = nz; p.c.speed = 0
        }
      }
    }
    for (const p of placed) {
      const { c, d } = p
      // yield: anything whose footprint enters the strip ahead of the vehicle (its width, 2.5 units ahead) slows it
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading)
      let clear = 99
      const consider = (ox: number, oz: number, r: number) => {
        const ahead = (ox - p.x) * fx + (oz - p.z) * fz, side = Math.abs((ox - p.x) * fz - (oz - p.z) * fx)
        // only what is ahead slows it (something beside or behind it is not in its way)
        if (ahead > 0 && side < d.w / 2 + r) clear = Math.min(clear, ahead - d.l / 2 - r)
      }
      // someone walking across the lane gets room ahead of them too (drivers slow for a person about to cross)
      for (const b of bodies) consider(b.x, b.z, b.r + (b.crossing ? 0.45 : 0))
      consider(L.pos.x, L.pos.z, L.walking ? 0.6 : 0.25) // she gets a wide berth: drivers slow for a person about to step out
      // the vehicle in front in the same direction, measured around the ring of street (every vehicle is physical,
      // seen or not), so the queue holds across the ends of the window too
      for (const q of placed) if (q !== p && q.c.dir === c.dir && q.c.street === c.street) {
        let gap = ((((q.c.s - c.s) * c.dir) % SPAN) + SPAN) % SPAN
        if (gap < 1e-6) gap = q.i < p.i ? 0 : SPAN // two on the same spot: the lower one goes first
        clear = Math.min(clear, gap - (d.l + q.d.l) / 2)
      }
      // speed it can stop from in the clear distance it has (brakes at once, speeds up gently)
      const wantSpeed = clear < 0.25 ? 0 : Math.min(c.cruise, (clear - 0.25) * 2.2)
      c.speed = wantSpeed < c.speed ? wantSpeed : Math.min(wantSpeed, c.speed + 1.5 * dt)
      c.s += c.speed * c.dir * dt
      const wrong = c.street !== key
      const edge = Math.min(1, (SPAN / 2 - Math.abs(p.rel)) / 3)
      // a vehicle joins or leaves the traffic only at the ends of the street (in the haze), never mid-shot
      if (Math.abs(p.rel) > SPAN / 2 - 2.5) c.on = p.i < active
      const want = c.on && !wrong ? edge : 0
      // (a vehicle out of the shot only comes in at the ends of the street, never fading in mid-shot)
      if (c.presence < 0.05 && Math.abs(p.rel) < SPAN / 2 - 3) c.presence = 0
      else c.presence += (want - c.presence) * (1 - Math.exp(-dt * 4))
      if (wrong && c.presence < 0.02) {
        // onto her street at its far end behind it, after any vehicle already queued there
        c.street = key
        const center = key.startsWith('x') ? L.pos.z : L.pos.x
        let s = center - c.dir * (SPAN / 2 - 0.5)
        for (let tries = 0; tries < 12 && this.v.some(o => o !== c && o.street === key && o.dir === c.dir && Math.abs((((o.s - s) % SPAN) + SPAN * 1.5) % SPAN - SPAN / 2) < (DIMS[o.kind].l + d.l) / 2 + 0.4); tries++) s -= c.dir * (d.l + 0.6)
        c.s = s; c.speed = 0; c.on = false
      }
      if (c.presence > 0.02) out.push({ id: p.i, kind: c.kind, x: p.x, z: p.z, heading: p.heading, w: d.w, l: d.l, presence: c.presence, speed: c.speed, carrying: false, parked: c.parked })
    }
    // the daladala she is riding: around her, along the street
    if (W.busX !== null && L.pos.y > 0.2) {
      const d = DIMS.minibus
      out.push({ id: 99, kind: 'minibus', x: L.pos.x, z: L.pos.z, heading: L.heading, w: d.w, l: d.l, presence: 1, speed: 3, carrying: true, parked: false })
    }
    return out
  }
}
