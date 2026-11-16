// the ragdoll rules (CLAUDE.md) as checks. checkFrame runs every frame in dev (CityPips logs what it finds) and in
// the node qa run (qa-run.ts, 3 full days across cities and ages). each violation says who, where, and what.
import { DOOR_W, PERSON, PERSONAL, SEAT, DOOR_H, FLOOR, COUNTER, BENCH_LEN, inBox, m, type V2 } from './grid'
import { groundAt, groundUnder } from './fabricBuild'
import { DIM, vehicleBox, type Vehicle } from './trafficSim'
import { footRadius, type Person, type Rig, type Scene } from './pipSim'

export type Violation = { rule: string; who: string; where: string; what: string }
const fmt = (v: V2) => `(${v.x.toFixed(2)}, ${v.z.toFixed(2)})`
const whoOf = (p: Person) => `${p.name} #${p.idx} (${p.age}, ${p.act}${p.workKind !== 'none' ? `, works ${p.workKind}` : ''})`
const seen = (p: Person) => p.vis > 0.5 && !p.inside

export type QaState = { last: Map<number, { pos: V2; vis: number; heading: number; planted: [boolean, boolean] | null; feet: [V2, V2] | null }> }
export const newQaState = (): QaState => ({ last: new Map() })

// objects at the right size next to people: checked once per scene
export function checkSizes(): Violation[] {
  const out: Violation[] = []
  const ratio = (what: string, v: number, lo: number, hi: number) => { const k = v / PERSON; if (k < lo || k > hi) out.push({ rule: 'sizes', who: what, where: 'scene', what: `${what} is ${k.toFixed(2)} person heights (should be ${lo} to ${hi})` }) }
  ratio('car length', DIM.car.l, 2.3, 3.0)
  ratio('car width', DIM.car.w, 0.9, 1.2)
  ratio('bus length', DIM.bus.l, 6, 8)
  ratio('bench seat height', SEAT, 0.22, 0.32)
  ratio('bench length', BENCH_LEN, 0.7, 1.4)
  ratio('door height', DOOR_H, 1.1, 1.4)
  ratio('door width', DOOR_W, 0.45, 0.7)
  ratio('floor height', FLOOR, 1.5, 2.0)
  ratio('market counter', COUNTER, 0.45, 0.62)
  return out
}

export function checkFrame(sc: Scene, people: Person[], rigs: Map<number, Rig>, vehicles: Vehicle[], dt: number, hour: number, qs: QaState, playing = false): Violation[] {
  const out: Violation[] = []
  const add = (rule: string, p: Person, what: string) => out.push({ rule, who: whoOf(p), where: fmt(p.pos), what })
  const vis = people.filter((p) => seen(p) && !p.baby)
  const doorNear = (p: Person) => sc.grid.lots.some((l) => l.building && Math.hypot(l.door.x - p.pos.x, l.door.z - p.pos.z) < DOOR_W / 2 + p.r + 0.05)

  for (let i = 0; i < vis.length; i++) {
    const p = vis[i]
    // 1. bodies never clip into each other (a child holding a hand stands right beside, not inside)
    for (let k = i + 1; k < vis.length; k++) {
      const q = vis[k]
      const d = Math.hypot(p.pos.x - q.pos.x, p.pos.z - q.pos.z)
      // a child holding an adult's hand stands a little closer than strangers (their arms meet), never inside them
      const near = p.guardian === q.idx || q.guardian === p.idx ? 0.82 : 0.92
      if (d < (p.r + q.r) * near) add('bodies overlap', p, `${d.toFixed(3)} from ${whoOf(q)}, needs ${((p.r + q.r) * near).toFixed(3)}`)
      // crowds keep personal space: people standing still near each other
      else if (!p.moving && !q.moving && p.guardian !== q.idx && q.guardian !== p.idx && !(p.how === 'seat' && q.how === 'seat') && d < PERSONAL * 0.8) add('personal space', p, `standing ${(d * 3.1).toFixed(2)} m from ${whoOf(q)}`)
    }
    // 2. never into walls, props or posts (walking through one's own doorway is how people go in and out)
    for (const b of sc.boxes) {
      if (!inBox(b, p.pos.x, p.pos.z, p.r * 0.8)) continue
      // sitting down on (or getting up from) one's own bench
      const seat = p.seatAt ?? (p.target?.spot.how === 'seat' ? p.target.spot : null)
      if (seat && b.h < SEAT + m(0.6) && inBox(b, seat.x, seat.z) && Math.hypot(p.pos.x - seat.x, p.pos.z - seat.z) < 0.3) continue
      if (doorNear(p)) continue
      add('into a wall or prop', p, `inside a ${b.w.toFixed(2)}x${b.d.toFixed(2)} box at ${fmt(b)}`)
      break
    }
    for (const s of sc.posts) { const d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z); if (d < p.r + s.r - 0.01) { add('into a post', p, `${d.toFixed(3)} from a post at ${fmt(s)}`); break } }
    // 3. never under a car
    for (const v of vehicles) {
      if (!v.active) continue
      const b = vehicleBox(v)
      if (Math.abs(p.pos.x - b.x) < b.w / 2 + p.r * 0.8 && Math.abs(p.pos.z - b.z) < b.d / 2 + p.r * 0.8) { add('hit by a vehicle', p, `inside a ${v.kind} at ${fmt(b)}`); break }
    }
    const R = rigs.get(p.idx)
    if (R) {
      const g = groundAt(p.pos.x, p.pos.z)
      // 4. feet on the ground: no floating, no sinking (seated children's feet may dangle)
      // each foot against the ground under that foot (curbs: one foot can be on the sidewalk, one on the road)
      const fr = footRadius(p.size)
      const gap0 = R.feet[0].y - groundUnder(R.feet[0].x, R.feet[0].z, fr), gap1 = R.feet[1].y - groundUnder(R.feet[1].x, R.feet[1].z, fr)
      const low = g + Math.min(gap0, gap1)
      const pose = p.moving ? (p.bike ? 'ride' : 'walk') : p.pose
      // mid-way between two poses grounded differently (sitting down, kneeling, getting up) the feet are allowed off the ground
      const settling = (p.blend ?? 1) < 1 && !!p.jFrom && (p.jFrom.ground !== 'feet' || !!p.sitting)
      if (!settling && (pose === 'walk' || pose === 'stand' || pose === 'armsUp' || pose === 'sign' || pose === 'hammer' || pose === 'bob')) {
        if (Math.abs(low - g) > 0.012) add(low > g ? 'floating' : 'sinking', p, `lowest foot ${((low - g) * 3.1 * 100).toFixed(0)} cm from the ground`)
      }
      if (pose === 'seat' && !p.sitting && (p.blend ?? 1) >= 1) {
        if (Math.abs(R.hipsY - (g + p.seatY)) > 0.03) add('not on the seat', p, `hips ${((R.hipsY - g - p.seatY) * 310).toFixed(0)} cm from the seat`)
        if (!p.kid && Math.abs(low - g) > 0.03) add(low > g ? 'floating' : 'sinking', p, `seated, feet ${((low - g) * 310).toFixed(0)} cm from the ground`)
      }
      if (!settling && low < g - 0.015) add('sinking', p, `a foot ${((g - low) * 310).toFixed(0)} cm under the ground`)
      // 5. held things in the hands
      for (const it of R.items) {
        if (it.kind === 'bike') continue
        for (const grip of it.grip) {
          const h = Math.min(grip.distanceTo(R.hands[0]), grip.distanceTo(R.hands[1]))
          if (h > p.size * 0.16) add('not holding it', p, `${it.kind} grip ${(h * 310).toFixed(0)} cm from the nearest hand`)
        }
      }
      // 6. no sliding: a foot that's down stays exactly where it was put down
      const last = qs.last.get(p.idx)
      if (pose === 'walk' && last && last.planted && !playing) {
        for (const side of [0, 1] as const) {
          if (!R.planted[side] || !last.planted[side] || !last.feet) continue
          const f = R.feet[side], lf = last.feet[side]
          const slide = Math.hypot(f.x - lf.x, f.z - lf.z)
          if (slide > 0.004) add('sliding feet', p, `a planted foot slid ${(slide * 310).toFixed(1)} cm`)
        }
      }
      // 7. facing a wall while standing still
      if (!p.moving && pose !== 'seat') {
        const ahead = { x: p.pos.x + Math.sin(p.heading) * (p.r + m(0.5)), z: p.pos.z + Math.cos(p.heading) * (p.r + m(0.5)) }
        if (sc.grid.lots.some((l) => l.building && inBox(l.building, ahead.x, ahead.z))) add('facing a wall', p, `standing with a wall ${(m(0.5) * 310 / 3.1).toFixed(0)} cm in front`)
      }
    }
    // 8. children under 8 are never out alone; babies are always held or in a stroller
    if (p.age < 8) {
      const g = p.guardian >= 0 ? people[p.guardian] : null
      if (!g || !seen(g) || Math.hypot(g.pos.x - p.pos.x, g.pos.z - p.pos.z) > m(1.5)) add('child alone', p, g ? `guardian ${whoOf(g)} is ${seen(g) ? `${(Math.hypot(g.pos.x - p.pos.x, g.pos.z - p.pos.z) * 3.1).toFixed(1)} m away` : 'not out'}` : 'no guardian')
    }
    // 9. actions fit the time, place, age and job
    const lotKind = !p.moving && p.target?.lot ? p.target.lot.kind : null
    if (p.age < 14 && lotKind && ['factory', 'construction', 'power_plant', 'launch_site', 'lab'].includes(lotKind)) add('wrong place for a child', p, `at the ${lotKind}`)
    if (lotKind === 'farm' && p.workKind !== 'farm') add('wrong job', p, `working the fields but works ${p.workKind}`)
    if (!p.moving && p.target?.key.endsWith(':vendor') && p.workKind !== 'shop') add('wrong job', p, `behind a market stall but works ${p.workKind}`)
    if (hour >= 1.5 && hour < 5 && !p.moving && !['working', 'striking', 'protesting', 'moving'].includes(p.act)) add('wrong time', p, `${p.act} outside at ${hour.toFixed(1)}h`)
  }
  // babies: out only in arms or a stroller, with their guardian
  for (const b of people) if (b.baby && b.vis > 0.5) {
    const g = b.guardian >= 0 ? people[b.guardian] : null
    if (!g || !seen(g) || !b.attached) add('baby not held', b, g ? `guardian ${whoOf(g)} ${seen(g) ? 'is out but not holding them' : 'is not out'}` : 'no guardian')
  }
  // 10. nothing appears or vanishes suddenly, nobody jumps across the street
  for (const p of people) {
    const last = qs.last.get(p.idx)
    const R = rigs.get(p.idx)
    if (last) {
      const dv = Math.abs(p.vis - last.vis)
      if (dv > dt * 5 + 0.02 && !(p.guardian >= 0)) add('popped', p, `visibility jumped ${last.vis.toFixed(2)} to ${p.vis.toFixed(2)} in one frame`)
      const jump = Math.hypot(p.pos.x - last.pos.x, p.pos.z - last.pos.z)
      if (p.vis > 0.1 && last.vis > 0.1 && jump > Math.max(0.25, dt * 6)) add('teleported', p, `moved ${(jump * 3.1).toFixed(1)} m in one frame while visible`)
    }
    qs.last.set(p.idx, { pos: { ...p.pos }, vis: p.vis, heading: p.heading, planted: R ? [R.planted[0], R.planted[1]] : null, feet: R ? [{ x: R.feet[0].x, z: R.feet[0].z }, { x: R.feet[1].x, z: R.feet[1].z }] : null })
  }
  return out
}

// vehicles: never through each other, and only appear or leave out in the fog
export type TrafficQa = Map<number, { active: boolean; s: number }>
export function checkTraffic(vehicles: Vehicle[], far: number, tq: TrafficQa): Violation[] {
  const out: Violation[] = []
  const act = vehicles.filter((v) => v.active && Math.abs(v.s) < far)
  for (let i = 0; i < act.length; i++) for (let k = i + 1; k < act.length; k++) {
    const a = vehicleBox(act[i]), b = vehicleBox(act[k])
    if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.02 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.02) out.push({ rule: 'vehicles overlap', who: `${act[i].kind} #${act[i].id}`, where: fmt(a), what: `into ${act[k].kind} #${act[k].id}` })
  }
  for (const v of vehicles) {
    const last = tq.get(v.id)
    if (last && last.active !== v.active && Math.abs(v.s) < far - 1) out.push({ rule: 'vehicle popped', who: `${v.kind} #${v.id}`, where: `s=${v.s.toFixed(1)}`, what: v.active ? 'appeared in view' : 'vanished in view' })
    tq.set(v.id, { active: v.active, s: v.s })
  }
  return out
}
