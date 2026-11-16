// the ragdoll rules (CLAUDE.md) as code. one function checks a frame of bodies against the neighborhood and returns
// every violation with who, where and what. /live runs it every frame in dev (and logs each new violation once);
// scripts/life-qa.ts runs it over 3 sim days across cities and ages and fails on any violation.
import * as THREE from 'three'
import type { Fabric, Solid } from './fabric'
import type { Placed, Seat } from './population'
import { footOverlap, type Body, type Solved } from './rig'

export type Violation = { rule: string; who: string; where: string; what: string }
export type QaBody = Partial<Pick<Placed, 'note' | 'handWith'>> & Pick<Placed, 'id' | 'who' | 'age' | 'root' | 'x' | 'z' | 'heading' | 'action' | 'walking' | 'presence' | 'body' | 'sol' | 'holding' | 'heldBy' | 'cradle' | 'indoors' | 'lotId' | 'lotKind' | 'seat' | 'door'> & { her?: boolean }
export type QaCtx = { hour: number; fabric: Fabric; solids: Solid[]; seats: Seat[]; herLot: number; herPos: THREE.Vector3 }

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3()
const fmt = (x: number, z: number) => `(${x.toFixed(1)}, ${z.toFixed(1)})`
const world = (b: QaBody, p: THREE.Vector3, out: THREE.Vector3) => out.copy(p).applyMatrix4(b.root)
// a body's footprint radius on the ground: half the shoulders plus an arm
export const radiusOf = (b: Body) => Math.max(b.torsoW, b.shoulderW * 2) * 0.5 + b.limb * 0.4

// lowest point of the feet (bottom of the foot boxes), world y
function feetY(b: QaBody, s: Solved) {
  let lo = Infinity
  for (const i of [2, 5]) { const f = s.bones[i]; lo = Math.min(lo, world(b, f.a, _v).y - b.body.footH * 0.55, world(b, f.b, _w).y - b.body.footH * 0.55) }
  return lo
}

export class Qa {
  private prev = new Map<string, { x: number; z: number; presence: number; stance: [THREE.Vector3, THREE.Vector3] | null; stanceFoot: number }>()
  private held = new Map<string, number>() // frames a soft rule has been true in a row
  check(bodies: QaBody[], ctx: QaCtx, dt: number): Violation[] {
    const out: Violation[] = []
    // bodies not drawn this frame have no "previous position" any more (they come back from wherever they went)

    // soft rules (turning to face someone, settling into a chair) count only after a second in a row
    const SOFT = new Set(['talking to nobody', 'facing a wall', 'not on the seat', 'seat not under them'])
    const hits = new Set<string>()
    const add = (rule: string, b: QaBody, what: string) => {
      if (!SOFT.has(rule)) return raw(rule, b, what)
      const k = `${rule}|${b.id}`; hits.add(k)
      const n = (this.held.get(k) ?? 0) + 1; this.held.set(k, n)
      if (n * Math.max(dt, 1 / 60) > 1) raw(rule, b, what)
    }
    const raw = (rule: string, b: QaBody, what: string) => out.push({ rule, who: b.who, where: `${fmt(b.x, b.z)} ${b.lotKind}${b.indoors ? ' indoors' : ''} ${ctx.hour.toFixed(2)}h`, what: b.note ? `${what} [${b.note}]` : what })
    // only what a viewer can see: bodies drawn, outdoors near her or inside the building she is in
    const seen = bodies.filter(b => b.presence > 0.5 && (b.indoors ? b.lotId === ctx.herLot : Math.hypot(b.x - ctx.herPos.x, b.z - ctx.herPos.z) < 22))
    const byId = new Map(seen.map(b => [b.id, b]))
    // (memory of the last frame only for bodies judged in both: one that dropped out and came back starts fresh)
    const ids = new Set(seen.map(b => b.id))
    for (const k of this.prev.keys()) if (!ids.has(k)) this.prev.delete(k)

    for (const b of seen) {
      const r = radiusOf(b.body)
      const lying = b.action === 'lie', held = b.action === 'held', sitting = b.action === 'sit' || b.action === 'type' || b.action === 'pray'

      // 1. bodies vs bodies: footprints may touch, never overlap (a held baby and its holder excepted)
      for (const o of seen) {
        if (o.id <= b.id || o.heldBy === b.id || b.heldBy === o.id || held || o.action === 'held' || lying || o.action === 'lie') continue
        // oriented footprints (arm span across, body depth front to back): clipping is any overlap over 1 cm
        // holding hands: the arms meet by design, so only the bodies (torsos) must stay apart
        const hands = b.handWith === o.id || o.handWith === b.id || (b.her && o.handWith === 'her') || (o.her && b.handWith === 'her')
        const pen = hands ? Math.max(0, (b.body.torsoW + o.body.torsoW) * 0.5 - Math.hypot(o.x - b.x, o.z - b.z)) : footOverlap(b.x, b.z, b.heading, b.body, o.x, o.z, o.heading, o.body)
        if (pen > 0.02) add('bodies overlap', b, `overlaps ${o.who} by ${pen.toFixed(3)} (${Math.hypot(o.x - b.x, o.z - b.z).toFixed(2)} apart)`)
      }

      // 2. bodies vs walls: standing inside a building that is not the one they are in
      if (!held) for (const s of ctx.solids) {
        if (s.kind === 'eave' || s.kind === 'pole') continue // (poles are checked on their own below)
        if (s.kind === 'stoop') {
          // standing in the stoop (a 34 cm step): feet would be inside it. sitting on it is what it is for
          // sitting on it is what it is for; walking means stepping over it; standing on top of it is fine
          if (sitting || lying || b.walking || b.root.elements[13] > s.box.max.y - 0.03) continue
          const rr = r * 0.6
          if (b.x + rr > s.box.min.x && b.x - rr < s.box.max.x && b.z + rr > s.box.min.z && b.z - rr < s.box.max.z) { add('standing in the stoop', b, `feet inside the stoop of ${s.id}`); break }
          continue
        }
        _v.set(b.x, 0.3, b.z)
        if (s.kind === 'stall') { const rr = r * 0.6; if (b.x + rr > s.box.min.x && b.x - rr < s.box.max.x && b.z + rr > s.box.min.z && b.z - rr < s.box.max.z) { add('through furniture', b, `market stall at ${fmt((s.box.min.x + s.box.max.x) / 2, (s.box.min.z + s.box.max.z) / 2)}`); break } continue }
        if (s.box.containsPoint(_v) && !(b.indoors && s.id === b.lotId)) { add('inside a wall', b, `inside ${s.kind} ${s.id} while ${b.indoors ? `indoors at lot ${b.lotId}` : 'outdoors'}`); break }
      }
      // poles
      if (!b.indoors) for (const p of ctx.fabric.poles) if (Math.hypot(p.x - b.x, p.z - b.z) < r * 0.8) { add('through a pole', b, `pole at ${fmt(p.x, p.z)}`); break }
      // chairs nobody is sitting on are still solid
      if (!sitting && !held && !lying) for (const c of ctx.fabric.chairs) if (Math.hypot(c.x - b.x, c.z - b.z) < r * 0.7) { add('through furniture', b, `stoop chair at ${fmt(c.x, c.z)}`); break }

      // 3. feet on the ground (standing, walking, talking...): the lowest foot touches the ground, nothing floats or sinks
      if (!held && !lying && !sitting && b.action !== 'play') {
        const y = feetY(b, b.sol)
        if (Math.abs(y - b.root.elements[13]) > 0.03 + b.body.H * 0.01) add('feet off the ground', b, `lowest foot at ${y.toFixed(3)} (ground ${b.root.elements[13].toFixed(2)})`)
      }
      // 4. no sliding: a walking body's planted foot stays put between frames
      const pv = this.prev.get(b.id)
      if (b.walking) {
        // a foot is planted when it is on the ground (its lowest point within 8 mm) this frame and the last; then
        // whichever end of it is down must stay put. a swinging foot about to land is not planted yet
        const ends = (i: number): [THREE.Vector3, THREE.Vector3] => [world(b, b.sol.bones[i].a, _a).clone(), world(b, b.sol.bones[i].b, _b).clone()]
        const gy = b.root.elements[13], fh = b.body.footH * 0.55
        const fl = ends(2), fr = ends(5)
        const down = (e: [THREE.Vector3, THREE.Vector3]) => Math.min(e[0].y, e[1].y) - fh - gy < 0.008
        const pos: [THREE.Vector3, THREE.Vector3] = [fl[0], fl[1]]
        const foot = down(fl) ? 0 : down(fr) ? 1 : -1
        if (foot >= 0) { const e = foot === 0 ? fl : fr; pos[0] = e[0]; pos[1] = e[1] }
        if (pv?.stance && pv.stanceFoot === foot && foot >= 0) {
          const slip = Math.min(Math.hypot(pos[0].x - pv.stance[0].x, pos[0].z - pv.stance[0].z), Math.hypot(pos[1].x - pv.stance[1].x, pos[1].z - pv.stance[1].z))
          if (slip > Math.max(0.025, Math.hypot(b.x - pv.x, b.z - pv.z) * 0.35)) add('feet sliding', b, `planted foot slid ${slip.toFixed(3)} in one frame`)
        }
        this.prev.set(b.id, { x: b.x, z: b.z, presence: b.presence, stance: pos, stanceFoot: foot })
      }

      // 5. sitting means a seat under them at the right height
      if (sitting) {
        const seat = b.seat ?? ctx.seats.find(s => Math.hypot(s.x - b.x, s.z - b.z) < 0.12)
        if (!seat) add('sitting on nothing', b, `${b.action} with no seat`)
        else {
          const pelvis = world(b, b.sol.pelvis, _v).y
          if (Math.abs(pelvis - (seat.h + b.body.thigh * 0.12)) > 0.08) add('not on the seat', b, `pelvis at ${pelvis.toFixed(2)}, ${seat.kind} top at ${seat.h.toFixed(2)}`)
          if (Math.hypot(seat.x - b.x, seat.z - b.z) > 0.12) add('seat not under them', b, `${seat.kind} ${Math.hypot(seat.x - b.x, seat.z - b.z).toFixed(2)} away`)
        }
      }

      // 6. held things: a baby is in the holder's arms, both hands under it, in front of the body (not in the chest)
      if (b.holding && b.cradle) {
        for (const i of [0, 1] as const) {
          const hand = world(b, b.sol.hands[i], _v)
          const d = hand.distanceTo(b.cradle.targets[i])
          if (d > 0.03) add('hands not on the baby', b, `${i ? 'right' : 'left'} hand ${d.toFixed(3)} from the baby`)
        }
        // the baby's center is in front of the chest by at least half its depth
        _a.set(0, 0, 1).applyQuaternion(_w.setFromMatrixPosition(b.root) && new THREE.Quaternion().setFromRotationMatrix(b.root))
        const chest = world(b, b.sol.chest, _b)
        const ahead = _v.copy(b.cradle.center).sub(chest).dot(_a)
        if (ahead < -b.body.torsoD * 0.1) add('baby inside the chest', b, `baby center ${ahead.toFixed(3)} in front of the chest surface`)
      }
      if (held) {
        const holder = b.heldBy === 'carrier' ? null : byId.get(b.heldBy ?? '')
        if (!b.her && !holder) add('baby alone', b, 'a baby with nobody holding it')
      }

      // 7. children under 8 never alone in public; babies never out of arms
      if (b.age < 1.5 && !held && !lying) add('baby not held', b, `a ${b.age.toFixed(1)} year old ${b.action}`)
      if (b.age < 8 && !b.indoors && !held) {
        const adult = bodies.some(o => o.id !== b.id && o.age >= 14 && o.presence > 0.3 && Math.hypot(o.x - b.x, o.z - b.z) < 2.5)
        if (!adult) add('child alone', b, `a ${b.age.toFixed(1)} year old in public with no grown-up within 2.5`)
      }

      // 8. facing what they do: nobody stands with their face to a wall unless they work at it
      if (!b.walking && (b.action === 'talk' || b.action === 'stand' || b.action === 'phone') && !b.indoors) {
        _a.set(Math.sin(b.heading), 0, Math.cos(b.heading))
        _v.set(b.x, 0.5, b.z).addScaledVector(_a, r + 0.12)
        if (ctx.solids.some(s => s.kind !== 'eave' && s.box.containsPoint(_v))) add('facing a wall', b, `${b.action} with the face to a wall`)
      }
      if (b.action === 'talk') {
        _a.set(Math.sin(b.heading), 0, Math.cos(b.heading))
        const partner = bodies.some(o => o.id !== b.id && o.presence > 0.5 && Math.hypot(o.x - b.x, o.z - b.z) < 1.9 && ((o.x - b.x) * _a.x + (o.z - b.z) * _a.z) / Math.max(0.01, Math.hypot(o.x - b.x, o.z - b.z)) > 0.5)
        if (!partner && process.env.QA_DEBUG_TALK === b.id) console.log('talk debug', b.id, b.heading.toFixed(2), bodies.filter(o => Math.hypot(o.x - b.x, o.z - b.z) < 2.2).map(o => `${o.id} (${o.x.toFixed(2)},${o.z.toFixed(2)}) p${o.presence.toFixed(2)} in:${o.indoors} seen:${seen.includes(o)}`).join(' | '))
        if (!partner) add('talking to nobody', b, 'talking with nobody in front of them')
      }

      // 9. actions fit the time, place and age
      if ((b.action === 'type' || b.action === 'work') && b.age < 15) add('child at work', b, `a ${Math.round(b.age)} year old doing ${b.action} at ${b.lotKind}`)
      if (b.action === 'cook' && !b.indoors && b.lotKind !== 'market') add('cooking in the street', b, 'cooking outside a home or stall')
      if (b.action === 'cook' && b.age < 12) add('child at the stove', b, `a ${b.age.toFixed(1)} year old cooking`)
      if (b.action === 'cook' && (ctx.hour < 4.5 || ctx.hour > 22.5)) add('cooking at night', b, `cooking at ${ctx.hour.toFixed(1)}h`)
      if (b.action === 'lie' && !b.indoors) add('sleeping in the street', b, 'lying down outdoors')

      // 10. nothing appears or vanishes mid-shot: fades happen at a door, or at the edge of the haze
      if (pv && Math.abs(b.presence - pv.presence) > 0.01 && !b.walking) {
        // (a door point is on the lane in front of the door; the doorway itself is up to ~2 units in from it)
        const atDoor = (b.door ? Math.hypot(b.door.x - b.x, b.door.z - b.z) < 2.5 : false)
          // or right at a building's wall (public buildings stand back from the lane: their doorway is at their front)
          || ctx.solids.some(sl => (sl.kind === 'wall' || sl.kind === 'special') && b.x > sl.box.min.x - 0.6 && b.x < sl.box.max.x + 0.6 && b.z > sl.box.min.z - 0.6 && b.z < sl.box.max.z + 0.6)
        if (!atDoor && !b.indoors) add('pops in or out', b, `fading ${pv.presence.toFixed(2)} -> ${b.presence.toFixed(2)} away from any door`)
      }
      if (pv && Math.hypot(b.x - pv.x, b.z - pv.z) > 1.0 && pv.presence > 0.5) add('teleports', b, `jumped ${Math.hypot(b.x - pv.x, b.z - pv.z).toFixed(2)} in one frame while visible`)
      if (!b.walking) this.prev.set(b.id, { x: b.x, z: b.z, presence: b.presence, stance: null, stanceFoot: -1 })
    }
    void dt
    for (const k of this.held.keys()) if (!hits.has(k)) this.held.delete(k)
    return out
  }
}

// object sizes against people (1 world unit = 1.7 m). real sizes in meters, SOURCED as ordinary standards: a door
// ~2.0 m, a chair seat ~0.45 m, a table ~0.75 m, a sedan ~4.3 m, a tuk-tuk ~2.6 m, a minibus ~5.4 m, a motorbike ~2.0 m
export const SIZES_M: Record<string, number> = { door: 2.0, chairSeat: 0.45, table: 0.75, car: 4.3, bajaji: 2.6, minibus: 5.4, boda: 2.0, adult: 1.65 }
export function checkSizes(actual: Record<string, number>): Violation[] {
  const out: Violation[] = []
  for (const [k, units] of Object.entries(actual)) {
    const want = (SIZES_M[k] ?? 0) / 1.7
    if (want && Math.abs(units - want) / want > 0.25) out.push({ rule: 'wrong size', who: k, where: 'scene', what: `${k} is ${(units * 1.7).toFixed(2)} m, should be about ${SIZES_M[k]} m` })
  }
  return out
}

// vehicles: never through a person or another vehicle (footprint rectangles, people as circles)
export function checkTraffic(bodies: QaBody[], vehs: { id: number; kind: string; x: number; z: number; heading: number; w: number; l: number; presence: number }[], hour: number, herPos: THREE.Vector3): Violation[] {
  const out: Violation[] = []
  const seen = vehs.filter(v => v.presence > 0.5 && Math.hypot(v.x - herPos.x, v.z - herPos.z) < 22)
  const box = (v: (typeof seen)[number]) => { const along = Math.abs(Math.sin(v.heading)) > 0.5; const hx = (along ? v.l : v.w) / 2, hz = (along ? v.w : v.l) / 2; return { x0: v.x - hx, x1: v.x + hx, z0: v.z - hz, z1: v.z + hz } }
  const inRect = (v: (typeof seen)[number], x: number, z: number, r: number) => {
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading)
    const a = (x - v.x) * fx + (z - v.z) * fz, s = (x - v.x) * fz - (z - v.z) * fx
    return Math.abs(a) < v.l / 2 + r && Math.abs(s) < v.w / 2 + r
  }
  for (const v of seen) {
    if (v.kind === 'minibus' && v.id === 99) continue // the one she rides: she is inside it
    for (const b of bodies) if (b.presence > 0.5 && !b.indoors && b.action !== 'held' && inRect(v, b.x, b.z, radiusOf(b.body) * 0.8)) out.push({ rule: 'vehicle through a person', who: b.who, where: `(${b.x.toFixed(1)}, ${b.z.toFixed(1)}) ${hour.toFixed(2)}h`, what: `${v.kind} ${v.id} (speed ${(v as { speed?: number }).speed?.toFixed(2)}) on top of them, ${b.action}${b.note ? ' [' + b.note + ']' : ''}` })
    const a = box(v)
    for (const o of seen) if (o.id > v.id && (() => { const c = box(o); return a.x0 < c.x1 - 0.02 && c.x0 < a.x1 - 0.02 && a.z0 < c.z1 - 0.02 && c.z0 < a.z1 - 0.02 })()) out.push({ rule: 'vehicles overlap', who: `${v.kind} ${v.id}`, where: `(${v.x.toFixed(1)}, ${v.z.toFixed(1)}) ${hour.toFixed(2)}h`, what: `overlaps ${o.kind} ${o.id}` })
  }
  return out
}
