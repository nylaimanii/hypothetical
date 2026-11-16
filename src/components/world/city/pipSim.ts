// the people in the city view, as plain data and math (no react, no rendering), so the same code runs in the
// browser and in the node qa run. each person follows their day plan (B's dayPlanOf: weekends, holidays, worship),
// walks the sidewalks around other people and street furniture, goes in and out through doors, and is posed from a
// small rig (hips, knees, shoulders) that keeps feet on the ground, hips on seats and hands on what they hold.
// ragdoll rules (CLAUDE.md): babies are carried or pushed in a stroller by an adult of their home, children under 8
// only go out holding an adult's hand, and nobody pops in or out: they fade through a door or into the distance.
import * as THREE from 'three'
import type { Activity, Citizen, Workplace } from '@/lib/types'
import { dayPlanOf, dayContextOf } from '@/lib/sim/replay-pure'
import { stepAt, nextNonCommute, workWords, type PlanStep } from './day'
import { inBox, walkPath, m, WALK, WALK_SPREAD, STREETS, U, type Box, type Grid, type Lot, type Spot, type V2 } from './grid'
import { groundAt, groundUnder } from './fabricBuild'

export const MAX_PEOPLE = 300
// how many people the street shows: more in bigger cities and in denser parts of them (population class 0..7 of
// the real cell at the core, GHSL)
export function crowdSize(population: number, density = 4) {
  return Math.min(200, Math.round((60 + 35 * Math.log10(Math.max(1e5, population) / 1e5)) * (0.7 + density / 14)))
}
// people passing through on the sidewalks: more where the real grid is denser
export const passersbyFor = (density = 4) => Math.round(30 + density * 14)
// the rig, in body units (a standing adult is 1.9 tall before scaling; feet at 0)
export const RIG = { hip: 0.62, thigh: 0.31, shin: 0.31, legR: 0.1, shinR: 0.09, arm: 0.48, armR: 0.09, shoulderX: 0.3, shoulderY: 0.6, hipX: 0.13, head: 0.98, headR: 0.3, torsoR: 0.24, height: 1.9 }
export const bodyRadius = (size: number) => (RIG.shoulderX + RIG.armR) * size
// a foot's half-length on the ground (the sole rests on the highest ground under it)
export const footRadius = (size: number) => RIG.shinR * 1.4 * size

export type Pose = 'walk' | 'ride' | 'stand' | 'seat' | 'ground' | 'kneel' | 'armsUp' | 'sign' | 'bob' | 'hammer'
type Target = { lot: Lot | null; spot: Spot; hide: boolean; pose: Pose; key: string; slot: number; place: string; exit?: boolean; kidSpot?: Spot; kidSlot?: number }

export type Person = {
  idx: number; baseId: string; c: Citizen; name: string; age: number; size: number; r: number
  kid: boolean; baby: boolean // baby: under 4, always carried or in a stroller
  guardian: number // -1, or the adult this child goes out with
  stroller: boolean // a guardian who pushes their baby in a stroller
  ward: number // -1, or the baby/child this adult is out with
  plan: PlanStep[]; jitter: number
  home: Lot; work: Lot | null; workKind: Workplace; bike: boolean
  // state
  stepKey: string; act: Activity; place: string; until: number
  target: Target | null
  path: V2[]; seg: number; segS: number; lat: number
  pos: V2; heading: number; turn: number
  moving: boolean; walked: number; speed: number
  lot: Lot | null // the lot they are in or heading out of
  inside: boolean; vis: number; visTo: number
  pose: Pose; how: Spot['how']; seatY: number
  bags: number; boxes: boolean; attached: boolean
  ffJump: V2 | null // fast-forward: where to reappear after fading out
  side?: number; ang?: number // a child's place beside their guardian
  wardBaby?: boolean
  seatAt?: V2 | null // the seat they're sitting on, or about to
  kidFor?: Spot // the spot a child is walking to (their own beside their adult)
  dodge?: number // which way they last stepped aside
  // sitting down onto a seat or getting up from it: the body moves between the seat and where the feet stand
  sitting?: { from: V2; to: V2; t: number; down: boolean } | null
  // pose blending: every change of pose eases over a moment from the last joints
  lastPose?: Pose; blend?: number; jFrom?: Joints; jLast?: Joints; liftFrom?: number; liftLast?: number
  // walking: each foot's spot on the ground; a planted foot stays exactly there, a swinging one arcs to the next
  fs?: ({ x: number; z: number; swing: boolean; fx: number; fz: number; t?: number } | null)[]
  baseY?: number
  vel?: V2 // smoothed direction of travel
  strain?: number // 0..1+: how far the planted leg is stretched toward its reach
  // a passerby: someone crossing the plate on the sidewalks from beyond its edge (not a resident here)
  through?: { active: boolean; wait: number; axis: 0 | 1; seed: number }
  curbWait?: number // seconds waiting at the curb to cross (drivers let people cross who've waited)
  latHome?: number // where across the walkway they keep to (a child holding hands: beside the adult)
  followSpeed?: number // a child walking with their adult: the pace that keeps them together
  goingIn?: boolean // a child following their adult in through a door
  homebound?: boolean // stays indoors in this view
  prevPos?: V2
}

// ---- making the town's people ----
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }
function rng(seed: number) { let a = seed || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const NAMES = ['ama', 'teo', 'rin', 'sol', 'iva', 'kofi', 'lena', 'omar', 'yuki', 'zara', 'ben', 'mei', 'ade', 'noor', 'ravi', 'ines', 'kai', 'luz', 'tomas', 'hana', 'eli', 'sade', 'jun', 'mira']

// height for age (WHO/CDC growth charts, rounded): used for children; adults keep their own height
function heightAt(age: number, adultCm: number) {
  if (age >= 18) return adultCm
  const pts: [number, number][] = [[0, 60], [1, 75], [2, 87], [4, 103], [6, 116], [8, 128], [10, 139], [12, 150], [14, 162], [16, 169], [18, 172]]
  let k = 0
  while (k < pts.length - 2 && pts[k + 1][0] < age) k++
  const [a0, h0] = pts[k], [a1, h1] = pts[k + 1]
  const h = h0 + ((age - a0) / (a1 - a0)) * (h1 - h0)
  return h * (adultCm / 172)
}
// workplaces that are no place for a small child: a guardian working there leaves them home
const NOT_FOR_KIDS = new Set<Workplace>(['factory', 'construction', 'power_plant', 'launch_site', 'lab', 'farm'])

export function makePeople(opts: { cityId: string; countryId?: string; tick: number; residents: Citizen[]; grid: Grid; total: number; nightlife?: number; passersby?: number }): Person[] {
  const { cityId, grid, residents, tick } = opts
  const r = rng(hash(cityId + 'people'))
  const base = residents.length ? residents : []
  if (!base.length) return []
  const ctx = dayContextOf(opts.countryId ?? residents[0].countryId, tick)
  const lotFor = (w: Workplace | undefined): Lot | null => {
    if (!w || w === 'none') return null
    const k = w === 'shop' ? 'market' : w
    return grid.byKind.get(k as never) ?? null
  }
  const out: Person[] = []
  const total = Math.min(MAX_PEOPLE, opts.total)
  for (let k = 0; k < total; k++) {
    const real = k < base.length
    const src = base[k % base.length]
    // a household of three per home: two adults and, often, a child (filler people only; real residents keep their age)
    const slot = k % 3
    let age = real ? src.age : slot < 2 ? Math.max(18, Math.min(88, src.age + Math.round(r() * 24 - 12))) : Math.floor(r() * (r() < 0.55 ? 14 : 70))
    if (!real && slot === 2 && age >= 14) age = Math.max(18, age)
    const kid = age < 14
    const c: Citizen = real ? src : { ...src, id: `${src.id}~${k}`, age, workplace: kid ? (age >= 6 ? 'school' : 'none') : src.workplace, employed: kid ? false : src.employed }
    const adultCm = real ? src.heightCm : src.heightCm + (r() * 16 - 8)
    const size = heightAt(age, adultCm) / 100 / U / RIG.height
    const plan = dayPlanOf(c, tick, opts.nightlife ?? 0.3, ctx).map((s) => ({ hour: s.hour, activity: s.activity })) as PlanStep[]
    const home = grid.homes[Math.floor(k / 3) % Math.max(1, grid.homes.length)]
    const workKind: Workplace = kid ? 'none' : (c.workplace ?? 'none')
    const pos = { x: home.building ? home.building.x : home.x, z: home.building ? home.building.z : home.z }
    out.push({
      idx: k, baseId: src.id, c, name: real ? src.name.split(' ')[0].toLowerCase() : NAMES[Math.floor(r() * NAMES.length)], age, size, r: bodyRadius(size),
      kid, baby: age < 4, guardian: -1, stroller: false, ward: -1,
      plan, jitter: real ? 0 : (r() * 2 - 1) * 0.5,
      home, work: kid ? null : lotFor(workKind), workKind, bike: !kid && age < 60 && r() < 0.15,
      stepKey: '', act: 'sleeping', place: 'home', until: 0, target: null,
      path: [], seg: 0, segS: 0, lat: 0, pos, heading: home.face > 0 ? 0 : Math.PI, turn: 0,
      moving: false, walked: 0, speed: 0, lot: home, inside: true, vis: 0, visTo: 0,
      pose: 'stand', how: 'stand', seatY: 0, bags: 0, boxes: false, attached: false, ffJump: null,
    })
  }
  // passersby: adults crossing the plate along the sidewalks (copies of the residents, their own ages and heights)
  for (let k = 0; k < (opts.passersby ?? 0) && out.length < MAX_PEOPLE; k++) {
    const src = base[k % base.length]
    const age = 18 + Math.floor(r() * 55)
    const c: Citizen = { ...src, id: `${src.id}~p${k}`, age }
    const size = heightAt(age, src.heightCm + (r() * 16 - 8)) / 100 / U / RIG.height
    const home = grid.homes[0]
    out.push({
      idx: out.length, baseId: src.id, c, name: NAMES[Math.floor(r() * NAMES.length)], age, size, r: bodyRadius(size), kid: false, baby: false, guardian: -1, stroller: false, ward: -1,
      plan: [], jitter: 0, home, work: null, workKind: 'none', bike: false, stepKey: 'through', act: 'commuting', place: 'passing through', until: 0, target: null,
      path: [], seg: 0, segS: 0, lat: 0, pos: { x: 0, z: 0 }, heading: 0, turn: 0, moving: false, walked: 0, speed: 0, lot: null, inside: false, vis: 0, visTo: 0,
      pose: 'stand', how: 'stand', seatY: 0, bags: r() < 0.3 ? 1 : 0, boxes: false, attached: false, ffJump: null,
      through: { active: false, wait: r() * 20, axis: r() < 0.5 ? 0 : 1, seed: Math.floor(r() * 1e9) },
    })
  }
  // guardians: each child under 8 goes out with an adult of the same home, preferring one whose work a child can
  // come along to; a home with no adult keeps its small children in
  // children 4 to 7 stay indoors in this view (at home, or in class): walking them through town hand in hand is
  // left for later, so they're never out alone. babies (under 4) go out in an adult's arms or a stroller
  for (const p of out) if (p.age >= 4 && p.age < 8) p.homebound = true
  for (const p of out) {
    if (p.age >= 4) continue
    const mates = out.filter((q) => q.home === p.home && q.age >= 18 && q.ward < 0)
    const g = mates.find((q) => !NOT_FOR_KIDS.has(q.workKind)) ?? mates[0]
    if (!g) continue
    p.guardian = g.idx
    g.ward = p.idx
    g.stroller = p.baby && r() < 0.45
    g.wardBaby = p.baby
    g.bike = false
  }
  return out
}

// ---- where each activity happens ----
export type Slots = Map<string, Set<number>>
function take(slots: Slots, key: string, n: number) {
  let s = slots.get(key)
  if (!s) { s = new Set(); slots.set(key, s) }
  for (let k = 0; k < n; k++) if (!s.has(k)) { s.add(k); return k }
  return -1
}
const release = (slots: Slots, key: string, k: number) => { if (k >= 0) slots.get(key)?.delete(k) }
// two free spots next to each other (k, k + 1), close enough for a child to be right beside their adult
function takePair(slots: Slots, key: string, list: Spot[]) {
  let s = slots.get(key)
  if (!s) { s = new Set(); slots.set(key, s) }
  for (let k = 0; k + 1 < list.length; k++) {
    if (s.has(k) || s.has(k + 1)) continue
    if (Math.hypot(list[k].x - list[k + 1].x, list[k].z - list[k + 1].z) > 0.45) continue
    s.add(k); s.add(k + 1)
    return k
  }
  return -1
}

const insideOf = (lot: Lot): Spot => ({ x: lot.building ? lot.building.x : lot.x, z: lot.building ? lot.building.z : lot.z, heading: 0, how: 'stand' })

function decide(p: Person, a: Activity, h: number, index: number, grid: Grid, slots: Slots, depth = 0): Target {
  const home: Target = { lot: p.home, spot: insideOf(p.home), hide: true, pose: 'stand', key: '', slot: -1, place: 'home' }
  const L = (k: Parameters<Grid['byKind']['get']>[0]) => grid.byKind.get(k) ?? null
  // a free spot in a lot's arrangement, or home if it's full or missing
  const at = (lot: Lot | null, arr: string, pose: Pose, place: string): Target => {
    const list = lot?.spots[arr]
    if (!lot || !list?.length) return home
    // out with a small child, nobody settles on a bench: they stay in (a stoop), or stand with them (a park)
    if (p.ward >= 0 && !p.wardBaby && list[0].how === 'seat') return arr === 'bench' && lot.kind === 'park' ? at(lot, 'ring', 'stand', place) : home
    const key = `${lot.id}:${arr}`
    // with a small child along: two neighbouring spots (two places in a ring, both seats of a bench)
    const child = p.ward >= 0 && !p.wardBaby
    const k = child ? takePair(slots, key, list) : take(slots, key, list.length)
    if (k < 0) return home
    const spot = list[k]
    const t: Target = { lot, spot, hide: false, pose: spot.how === 'seat' ? 'seat' : spot.how === 'ground' ? 'ground' : spot.how === 'kneel' ? 'kneel' : pose, key, slot: k, place }
    if (child) {
      const ks = list[k + 1]
      // a child stands right in front of the seat beside their adult's (no climbing on benches)
      t.kidSpot = ks.how === 'seat' ? { x: ks.x + Math.sin(ks.heading) * (m(0.25) + 0.2), z: ks.z + Math.cos(ks.heading) * (m(0.25) + 0.2), heading: ks.heading, how: 'stand' } : ks
      t.kidSlot = k + 1
    }
    return t
  }
  const inside = (lot: Lot | null, place: string): Target => (lot && lot.building ? { lot, spot: insideOf(lot), hide: true, pose: 'stand', key: '', slot: -1, place } : home)
  const kidAlong = p.ward >= 0 // an adult out with a small child stays where a child can be
  switch (a) {
    case 'sleeping': return home
    case 'eating': return h >= 11 && h < 14 && p.work ? at(L('market'), 'crowd', 'stand', 'the market') : home
    case 'commuting': {
      if (depth > 2) return home
      return decide(p, nextNonCommute(p.plan, index), h + 1, index + 1, grid, slots, depth + 1)
    }
    case 'working': {
      const w = p.work
      if (!w) return home
      if (w.kind === 'market') return at(w, 'vendor', 'stand', 'the market')
      if (w.kind === 'farm') return kidAlong ? home : at(w, 'rows', 'bob', 'the fields')
      if (w.kind === 'construction') return kidAlong ? home : at(w, 'crowd', 'hammer', 'the building site')
      return inside(w, workWords(p.c.workplace))
    }
    case 'school': return inside(L('school'), 'the school')
    case 'shopping': return at(L('market'), 'crowd', 'stand', 'the market')
    case 'socializing': return at(L('park'), 'ring', 'stand', 'the park')
    case 'idle': return at(L('park'), 'bench', 'seat', 'the park')
    case 'resting': {
      // out on the stoop in daylight and evening, inside late at night
      if (h >= 22 || h < 7) return home
      const t = at(p.home, 'bench', 'seat', 'home')
      return t.lot ? t : home
    }
    case 'celebrating': return at(L('square'), 'ring', 'armsUp', 'the square')
    case 'protesting': return p.kid ? home : at(L('square'), 'crowd', 'sign', 'the square')
    case 'striking': return at(L('factory'), 'line', 'ground', `outside ${workWords(p.c.workplace === 'none' ? 'factory' : p.c.workplace)}`)
    case 'praying': return L('shrine') ? at(L('shrine'), 'ring', 'kneel', 'the shrine') : home
    case 'aid_line': return at(L('clinic'), 'queue', 'stand', 'the aid line')
    case 'moving': return { lot: null, spot: { x: grid.exit.x, z: grid.exit.z, heading: Math.PI / 2, how: 'stand' }, hide: true, pose: 'stand', key: '', slot: -1, place: 'the road out of town', exit: true }
    default: return home
  }
}

// ---- the world the people move in: buildings, props, poles, and the cars (for avoidance and the qa) ----
export type Scene = {
  grid: Grid
  boxes: Box[] // buildings and yard props: never walked into (doors excepted)
  posts: { x: number; z: number; r: number }[] // lamps, poles, trees, umbrella poles on the sidewalks
}
export function sceneOf(grid: Grid, posts: Scene['posts'], extraBoxes: Box[] = []): Scene {
  const boxes: Box[] = []
  for (const l of grid.lots) { if (l.building) boxes.push(l.building); boxes.push(...l.props) }
  return { grid, boxes: [...boxes, ...extraBoxes], posts }
}
const buildingAt = (sc: Scene, x: number, z: number, pad = 0) => sc.grid.lots.some((l) => l.building && inBox(l.building, x, z, pad))

// ---- one step of everyone ----
const ANG = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const WALK_SPEED = 0.75 // units per second (2.3 m/s of time lapse: the city view's clock runs an hour every 40 s)
const BIKE_SPEED = 1.8

export function stepPeople(sc: Scene, people: Person[], slots: Slots, lh: number, dt: number, playing: boolean, cars: Car[] = []) {
  const grid = sc.grid
  for (const p of people) {
    if (p.homebound) { p.inside = true; p.vis = 0; p.visTo = 0; p.moving = false; p.act = 'sleeping'; continue }
    if (p.through) { stepThrough(p, people, sc, lh, dt, playing, cars); continue }
    if (p.guardian >= 0) continue // children and babies follow their guardian (below)
    // 1. what now
    const { step, index, until } = stepAt(p.plan, lh, p.jitter)
    const key = `${index}:${step.activity}`
    // a new part of the day begins once they get where they were going (in fast forward, right away: they fade)
    if (key !== p.stepKey && ((!p.moving && !p.sitting) || playing)) {
      if (playing) p.sitting = null
      p.stepKey = key
      if (p.target) { release(slots, p.target.key, p.target.slot); if (p.target.kidSlot !== undefined) release(slots, p.target.key, p.target.kidSlot) }
      const t = decide(p, step.activity, lh, index, grid, slots)
      p.target = t
      if (step.activity === 'shopping') { p.bags = 1 + (p.idx % 2); p.boxes = p.c.behavior === 'hoarding' || p.c.behavior === 'panic_buying' }
      else if (step.activity === 'moving') { p.bags = 2; p.boxes = false }
      else if (step.activity !== 'commuting' && !p.moving) { p.bags = 0; p.boxes = false }
      // a stroller or a baby in arms means no bags in the hands that push or hold
      if (p.ward >= 0 && people[p.ward]?.baby) { p.bags = 0; p.boxes = false }
      p.act = step.activity
      p.place = t.place
      p.until = until
      route(p, t, sc)
      if (playing) { p.ffJump = p.path[p.path.length - 1] ?? null; p.visTo = 0 }
    }
    // 2. fast forward: fade out where they are, reappear where they're going
    if (p.ffJump) {
      if (p.vis < 0.03) {
        p.pos = { ...p.ffJump }; p.seg = Math.max(0, p.path.length - 1); p.moving = false; p.ffJump = null; p.sitting = null; p.seatAt = null
        arrive(p)
      }
    } else if (p.sitting) {
      const st = p.sitting
      const want = p.target ? p.target.spot.heading : p.heading
      // sitting down waits until they've turned their back to the seat
      if (!st.down || Math.abs(ANG(want - p.heading)) < 0.05) {
        st.t = Math.min(1, st.t + dt / SIT_TIME)
        const e = st.t * st.t * (3 - 2 * st.t)
        p.pos = { x: st.from.x + (st.to.x - st.from.x) * e, z: st.from.z + (st.to.z - st.from.z) * e }
        p.pose = st.down ? 'seat' : 'stand'
        if (st.t >= 1) {
          p.sitting = null
          if (!st.down) { p.moving = p.path.length > 1; p.walked = 0; if (p.moving) p.pose = 'walk' }
        }
      }
    } else if (p.moving) {
      move(p, people, sc, dt, cars)
      // the seat they got up from stays theirs until they've stepped clear of the bench
      if (p.seatAt && Math.hypot(p.pos.x - p.seatAt.x, p.pos.z - p.seatAt.z) > 0.35 && !(p.target?.spot.how === 'seat' && p.target.spot.x === p.seatAt.x && p.target.spot.z === p.seatAt.z)) p.seatAt = null
    }
    // 3. visible? hidden inside buildings, and out past the edge of town
    p.inside = buildingAt(sc, p.pos.x, p.pos.z, -p.r * 0.5)
    const far = p.target?.exit ? Math.max(0, 1 - Math.max(0, p.pos.x - (grid.exit.x - 22)) / 18) : 1
    if (!p.ffJump) p.visTo = p.inside ? 0 : far
    p.vis += Math.sign(p.visTo - p.vis) * Math.min(Math.abs(p.visTo - p.vis), dt * (playing ? 4 : 2.5))
    // 4. turn smoothly toward where they face
    const want = p.moving || (p.sitting && !p.sitting.down) ? p.heading : (p.target && !p.target.hide ? p.target.spot.heading : p.heading)
    p.turn = ANG(want - p.heading)
    p.heading = ANG(p.heading + Math.sign(p.turn) * Math.min(Math.abs(p.turn), dt * 5))
  }
  // children walk beside their guardian, holding hands; babies ride in arms or in the stroller
  for (const k of people) {
    if (k.guardian < 0) continue
    const g = people[k.guardian]
    // out together from the moment the guardian steps out of their own front door for something a child can join
    const joinable = !g.target?.hide || g.moving
    const off = g.r + k.r + 0.012
    const at = (ang: number) => ({ x: g.pos.x + Math.sin(g.heading + ang) * off, z: g.pos.z + Math.cos(g.heading + ang) * off })
    // a child joins at the moment their adult steps out of their own front door (or while faded in fast forward),
    // right beside them; an adult already off somewhere doesn't come back for them
    const atDoor = g.moving && g.lot === g.home && Math.hypot(g.pos.x - g.home.door.x, g.pos.z - g.home.door.z) < 0.4
    if (!k.attached && (atDoor || (g.vis < 0.08 && g.ffJump)) && joinable && !(g.work && g.target?.lot === g.work && NOT_FOR_KIDS.has(g.workKind))) { k.attached = true; k.ang = -Math.PI / 2; k.side = 0; k.path = []; if (g.vis < 0.08) k.pos = at(-Math.PI / 2) }
    k.act = k.attached ? g.act : 'sleeping'
    k.place = k.attached ? g.place : 'home'
    k.until = g.until
    if (k.baby) {
      if (k.attached && g.inside) k.attached = false
      k.inside = !k.attached || g.inside; k.vis = k.attached ? g.vis : 0; k.visTo = k.vis; k.moving = g.moving; k.pos = { ...g.pos }
      continue
    }
    if (!k.attached) { k.inside = true; k.vis = Math.max(0, k.vis - dt * 2.5); k.visTo = 0; k.moving = false; continue }
    k.inside = buildingAt(sc, k.pos.x, k.pos.z, -k.r * 0.5)
    // back indoors together: the adult went in, and the child has followed them through the door
    if (g.inside && k.inside) { k.attached = false; continue }
    k.visTo = k.inside ? 0 : 1
    k.vis += Math.sign(k.visTo - k.vis) * Math.min(Math.abs(k.visTo - k.vis), dt * (playing ? 4 : 2.5))
    // beside the guardian at hand's reach, on the side they keep unless it's blocked; to change sides they
    // walk around behind, never through
    const room = (q: V2) => {
      let mn = 9
      for (const o of people) { if (o === k || o === g || o.vis < 0.3 || o.inside || o.baby || o.guardian === g.idx) continue; mn = Math.min(mn, Math.hypot(o.pos.x - q.x, o.pos.z - q.z) - o.r - k.r) }
      for (const st of sc.posts) mn = Math.min(mn, Math.hypot(st.x - q.x, st.z - q.z) - st.r - k.r)
      for (const b of sc.boxes) mn = Math.min(mn, boxGap(b, q.x, q.z) - k.r)
      return mn
    }
    const sides = [-Math.PI / 2, Math.PI / 2, Math.PI] // right, left, behind (relative to the guardian's facing)
    if (k.side === undefined) k.side = 0
    if (room(at(sides[k.side])) < 0.01) { const best = sides.map((a, i) => ({ i, r: room(at(a)) })).sort((x, y) => y.r - x.r)[0]; if (best.r > 0.02) k.side = best.i }
    const wantA = sides[k.side]
    k.ang = k.ang === undefined ? wantA : k.ang + Math.sign(ANG(wantA - k.ang)) * Math.min(Math.abs(ANG(wantA - k.ang)), dt * 1.5)
    const before = k.pos
    if (g.vis < 0.08 && Math.hypot(k.pos.x - g.pos.x, k.pos.z - g.pos.z) > 0.5) { k.pos = g.target?.kidSpot && !g.moving ? { x: g.target.kidSpot.x, z: g.target.kidSpot.z } : at(k.ang ?? -Math.PI / 2) }
    // the adult is (nearly) at their spot: the child heads for their own, beside it
    const ks = g.target?.kidSpot && !g.target.hide && Math.hypot(g.pos.x - g.target.spot.x, g.pos.z - g.target.spot.z) < (g.target.spot.how === "seat" ? 1.2 : 0.35) ? g.target.kidSpot : null
    if (!ks) k.kidFor = undefined
    // fast forward: the child fades and jumps with the adult (indoors with them, or right beside them)
    if (playing && g.vis < 0.1) {
      if (g.inside || g.target?.hide) { k.attached = false; k.pos = { ...g.pos }; k.vis = 0; k.inside = true; k.path = []; continue }
      k.pos = at(k.ang ?? -Math.PI / 2); k.path = []; k.vis = g.vis
    }
    // the adult has gone indoors: the child walks to that door and in after them, on a path of its own
    if (g.inside && !k.inside && g.lot && g.lot.building) {
      if (!k.goingIn) {
        const L = g.lot, out = { x: L.door.x, z: L.door.z + L.face * 0.26 }
        k.path = tidy([...aroundBoxes([{ ...k.pos }, out], sc.boxes, k.r + 0.04), { ...L.door }, { x: L.building!.x, z: L.building!.z }], sc.boxes, k.r + 0.02)
        k.seg = 0; k.segS = 0; k.lat = 0; k.latHome = 0; k.goingIn = true
      }
      k.followSpeed = 2.2 * k.size
      k.moving = true
      k.pose = 'walk'
      move(k, people, sc, dt, cars)
      k.moving = true
      continue
    }
    k.goingIn = false
    // walking with the adult, or finishing the walk in through the door they've just gone through
    const following = (g.moving || (g.inside && k.path === g.path && k.path.length > 1)) && !ks && !g.ffJump
    if (following) {
      if (k.path !== g.path) {
        // start on the adult's path a little behind them (from inside the doorway when leaving home)
        k.path = g.path; k.seg = g.seg; k.segS = g.segS; k.lat = 0; k.walked = 0; k.fs = undefined; k.vel = undefined; k.prevPos = undefined
        backAlong(k, 0.3)
        k.pos = pointAt(k)
      }
      const onWalkG = walkSeg(g)
      k.latHome = onWalkG ? -(g.r + k.r + 0.03) : 0
      const lag = onWalkG ? 0 : 0.3
      const err = progressOf(g) - lag - progressOf(k)
      k.followSpeed = g.moving ? Math.max(0, Math.min(2.6 * k.size, g.speed + err * 3)) : 2.2 * k.size
      k.moving = true
      k.pose = 'walk'
      move(k, people, sc, dt, cars)
      k.moving = true
      continue
    }
    k.followSpeed = undefined
    if (ks) {
      k.seatAt = ks.how === 'seat' ? { x: ks.x, z: ks.z } : null
      // the guardian has arrived: step over to their own spot beside them, and stand or sit there
      if (k.kidFor !== ks) {
        // a short walk of their own to it, around anything in between (onto a seat from the front)
        const o = m(0.25) + k.r + 0.08
        const pre = ks.how === 'seat' ? [{ x: ks.x + Math.sin(ks.heading) * o, z: ks.z + Math.cos(ks.heading) * o }] : []
        const seatBox = ks.how === 'seat' ? sc.boxes.find((b) => inBox(b, ks.x, ks.z)) : undefined
        k.path = [...aroundBoxes([k.pos, ...pre], sc.boxes.filter((b) => b !== seatBox), k.r + 0.04), { x: ks.x, z: ks.z }]
        k.seg = 0; k.kidFor = ks
      }
      let stepL = WALK_SPEED * 0.9 * dt, dd = 0
      while (stepL > 0 && k.seg < k.path.length - 1) {
        const tgt = k.path[k.seg + 1], ex = tgt.x - k.pos.x, ez = tgt.z - k.pos.z, el = Math.hypot(ex, ez)
        if (el <= stepL) { k.pos = { ...tgt }; k.seg++; stepL -= el } else { k.pos = { x: k.pos.x + ex / el * stepL, z: k.pos.z + ez / el * stepL }; stepL = 0 }
      }
      const last = k.path[k.path.length - 1]
      dd = Math.hypot(last.x - k.pos.x, last.z - k.pos.z)
      const dx = (k.path[Math.min(k.seg + 1, k.path.length - 1)].x - k.pos.x), dz = (k.path[Math.min(k.seg + 1, k.path.length - 1)].z - k.pos.z)
      k.moving = dd > 0.01
      if (k.moving && Math.hypot(dx, dz) > 1e-4) k.heading = ANG(k.heading + Math.sign(ANG(Math.atan2(dx, dz) - k.heading)) * Math.min(Math.abs(ANG(Math.atan2(dx, dz) - k.heading)), dt * 5))
      else { k.heading = ks.heading; k.how = ks.how; k.seatY = ks.seatY ?? 0; k.pose = ks.how === 'seat' ? 'seat' : 'stand' }
      k.seatAt = ks.how === 'seat' ? { x: ks.x, z: ks.z } : null
      // never closer to their adult than hand's reach
      { const gx = k.pos.x - g.pos.x, gz = k.pos.z - g.pos.z, gd = Math.hypot(gx, gz), need = g.r + k.r + 0.012; if (gd < need && gd > 1e-6) k.pos = { x: g.pos.x + gx / gd * need, z: g.pos.z + gz / gd * need } }
      k.walked += Math.hypot(k.pos.x - before.x, k.pos.z - before.z)
      k.ang = Math.atan2(k.pos.x - g.pos.x, k.pos.z - g.pos.z) - g.heading
      if (k.moving) k.pose = 'walk'
      continue
    }
    k.how = 'stand'
    // to their place beside the adult at a child's walking pace (never a jump)
    // a small child's legs set the pace: no faster than they can step
    { const tg = at(k.ang), dx = tg.x - k.pos.x, dz = tg.z - k.pos.z, dd = Math.hypot(dx, dz), mx = Math.min(WALK_SPEED * 1.3, 2.6 * k.size) * dt
      k.pos = dd <= mx ? tg : { x: k.pos.x + dx / dd * mx, z: k.pos.z + dz / dd * mx } }
    const stepK = Math.hypot(k.pos.x - before.x, k.pos.z - before.z)
    k.walked += stepK
    const faceTo = stepK > 0.002 ? Math.atan2(k.pos.x - before.x, k.pos.z - before.z) : g.heading
    k.heading = ANG(k.heading + Math.sign(ANG(faceTo - k.heading)) * Math.min(Math.abs(ANG(faceTo - k.heading)), dt * 6))
    k.moving = stepK > 0.002
    k.pose = 'stand'
  }
}

// how many of the passersby are out at a local hour (ESTIMATE: busy by day, a few late at night)
export function streetLife(h: number) {
  const g = (c: number, w: number) => Math.exp(-((h - c) ** 2) / (2 * w * w))
  return Math.min(1, 0.06 + 0.7 * g(8.5, 1.6) + 0.8 * g(13, 3) + 0.85 * g(18, 2) + 0.4 * g(21, 1.5))
}
const FAR_WALK = 34 // passersby start and finish this far out (just past the plate, fading in and out)
function stepThrough(p: Person, people: Person[], sc: Scene, lh: number, dt: number, playing: boolean, cars: Car[]) {
  const th = p.through!
  const rand = (salt: number) => { let a = (th.seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  if (!th.active) {
    th.wait -= dt
    if (th.wait > 0 || playing) return
    // out on the street at this hour? otherwise check again in a while
    th.seed = (th.seed * 1103515245 + 12345) >>> 0
    if (rand(1) > streetLife(lh)) { th.wait = 5 + rand(2) * 10; return }
    // a sidewalk along one of the plate's streets, from one edge to the other
    const line = STREETS[Math.floor(rand(3) * STREETS.length)] + (rand(4) < 0.5 ? -1 : 1) * WALK
    const dir = rand(5) < 0.5 ? 1 : -1
    th.axis = rand(6) < 0.5 ? 0 : 1
    const a = th.axis === 0 ? { x: -dir * FAR_WALK, z: line } : { x: line, z: -dir * FAR_WALK }
    const b = th.axis === 0 ? { x: dir * FAR_WALK, z: line } : { x: line, z: dir * FAR_WALK }
    // don't start on top of anyone
    if (people.some((o) => o !== p && o.vis > 0 && Math.hypot(o.pos.x - a.x, o.pos.z - a.z) < 0.6)) { th.wait = 1; return }
    p.path = [a, b]; p.seg = 0; p.segS = 0; p.lat = 0; p.pos = { ...a }; p.heading = Math.atan2(b.x - a.x, b.z - a.z)
    p.moving = true; p.walked = 0; p.pose = 'walk'; p.fs = undefined; p.vel = undefined; p.prevPos = undefined
    th.active = true
  }
  if (p.moving) move(p, people, sc, dt, cars)
  // seen only within the city's near part: they fade in coming out of the distance, and fade out going into it
  const along = Math.abs(th.axis === 0 ? p.pos.x : p.pos.z)
  p.vis = Math.max(0, Math.min(1, (FAR_WALK - 2 - along) / 6))
  p.visTo = p.vis
  p.inside = false
  if (!p.moving || p.seg >= p.path.length - 1) { th.active = false; p.moving = false; p.vis = 0; th.wait = 2 + rand(7) * 8 }
}

// distance walked along the current path
function progressOf(p: Person) { let d = p.segS; for (let i = 0; i < p.seg && i < p.path.length - 1; i++) d += Math.hypot(p.path[i + 1].x - p.path[i].x, p.path[i + 1].z - p.path[i].z); return d }
function backAlong(p: Person, d: number) { while (d > 0) { if (p.segS >= d) { p.segS -= d; return } d -= p.segS; if (p.seg === 0) { p.segS = 0; return } p.seg--; p.segS = Math.hypot(p.path[p.seg + 1].x - p.path[p.seg].x, p.path[p.seg + 1].z - p.path[p.seg].z) } }
function pointAt(p: Person): V2 { const A = p.path[p.seg], B = p.path[Math.min(p.seg + 1, p.path.length - 1)], L = Math.hypot(B.x - A.x, B.z - A.z) || 1; return { x: A.x + (B.x - A.x) * p.segS / L, z: A.z + (B.z - A.z) * p.segS / L } }
// is this person's current stretch of path along a sidewalk
function walkSeg(p: Person) {
  const a = p.path[p.seg], b = p.path[p.seg + 1]
  if (!a || !b) return false
  return STREETS.some((s2) => Math.abs(Math.abs(a.z - s2) - WALK) < 0.02 && Math.abs(Math.abs(b.z - s2) - WALK) < 0.02) || STREETS.some((s2) => Math.abs(Math.abs(a.x - s2) - WALK) < 0.02 && Math.abs(Math.abs(b.x - s2) - WALK) < 0.02)
}

function route(p: Person, t: Target, sc: Scene) {
  const fromLot = p.lot ?? p.home
  // seated: get up first (to where the feet are), then step forward clear of the bench before walking off
  let standFrom: V2 | null = null
  if (!p.moving && p.pose === 'seat' && p.seatAt && p.target) {
    const seat = { x: p.seatAt.x, z: p.seatAt.z, heading: p.heading, how: 'seat' as const, seatY: p.seatY }
    standFrom = feetFor(p, seat)
    p.sitting = { from: { ...p.pos }, to: standFrom, t: 0, down: false }
    const off = m(0.25) + p.r + 0.08
    p.pos = { ...p.pos }
    p.path = []
    const front = { x: seat.x + Math.sin(seat.heading) * off, z: seat.z + Math.cos(seat.heading) * off }
    p.pos = front // plan from in front of the bench
  }
  const destLot = t.lot
  let path: V2[]
  if (t.exit) {
    // out of town: to the corner, then along the street past the edge of the plate
    path = walkPath({ spot: p.pos, lot: fromLot }, { spot: { x: STREETS[STREETS.length - 1] + WALK, z: t.spot.z }, lot: { door: { x: STREETS[STREETS.length - 1] + WALK, z: t.spot.z }, street: STREETS[2], face: -1, x: 0 } })
    path.push({ x: t.spot.x, z: t.spot.z })
  } else if (destLot === fromLot && t.hide && p.inside) {
    path = [p.pos] // already inside: stay
  } else if (destLot === fromLot) {
    const out = { x: destLot.door.x, z: destLot.door.z + destLot.face * 0.26 }
    path = p.inside ? [p.pos, destLot.door, out, t.spot] : destLot.building && t.hide ? [p.pos, out, destLot.door, t.spot] : [p.pos, t.spot]
  } else path = walkPath({ spot: p.pos, lot: fromLot }, { spot: t.spot, lot: destLot! })
  if (!t.hide && t.spot.how === 'seat') {
    // up to the front of the seat, then the last step to where the feet stand when seated
    const off = m(0.25) + p.r + 0.08 // clear of the bench by a body width
    const front = { x: t.spot.x + Math.sin(t.spot.heading) * off, z: t.spot.z + Math.cos(t.spot.heading) * off }
    path[path.length - 1] = front
    path = [...aroundBoxes(path, sc.boxes, p.r + 0.06), feetFor(p, t.spot)]
  } else path = aroundBoxes(path, sc.boxes, p.r + 0.06)
  if (standFrom) { path = [standFrom, ...path]; p.pos = { ...p.sitting!.from } }
  p.path = tidy(path, sc.boxes, p.r + 0.02)
  p.seg = 0; p.segS = 0
  if (standFrom) { p.moving = false; p.pose = 'stand'; return } // walks once up
  p.moving = p.path.length > 1
  p.walked = 0
  p.pose = p.moving ? 'walk' : t.pose
  if (!p.moving) arrive(p)
}

// drop hops shorter than a step, and any point the walk would go out to and straight back from
function tidy(path: V2[], boxes: Box[] = [], pad = 0): V2[] {
  let pts = path.filter((q, i) => i === 0 || Math.hypot(q.x - path[i - 1].x, q.z - path[i - 1].z) > 0.005)
  for (let pass = 0; pass < 3; pass++) {
    const out: V2[] = [pts[0]]
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1], b = pts[i], c = pts[i + 1]
      const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z)
      const cos = ((b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)) / Math.max(1e-9, ab * bc)
      if (ab < 0.06 || cos < -0.7) continue
      out.push(b)
    }
    out.push(pts[pts.length - 1])
    pts = out
  }
  // round each corner into a short arc, so the walk turns gradually and people face where they're going
  const round: V2[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1]
    const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z)
    const rad = Math.min(0.4, ab * 0.45, bc * 0.45)
    const u1 = { x: (b.x - a.x) / ab, z: (b.z - a.z) / ab }, u2 = { x: (c.x - b.x) / bc, z: (c.z - b.z) / bc }
    if (rad < 0.02 || u1.x * u2.x + u1.z * u2.z > 0.995) { round.push(b); continue }
    // the arc shrinks until it stays clear of every prop (or the corner stays sharp)
    let arc: V2[] | null = null
    for (let rr = rad; rr >= 0.02 && !arc; rr *= 0.5) {
      const p0 = { x: b.x - u1.x * rr, z: b.z - u1.z * rr }, p2 = { x: b.x + u2.x * rr, z: b.z + u2.z * rr }
      const pts2: V2[] = []
      for (let k = 0; k <= 4; k++) { const t = k / 4, m1 = (1 - t) * (1 - t), m2 = 2 * (1 - t) * t, m3 = t * t; pts2.push({ x: m1 * p0.x + m2 * b.x + m3 * p2.x, z: m1 * p0.z + m2 * b.z + m3 * p2.z }) }
      if (pts2.every((q) => boxes.every((bx) => inBox(bx, b.x, b.z, pad) || !inBox(bx, q.x, q.z, pad)))) arc = pts2
    }
    if (arc) round.push(...arc); else round.push(b)
  }
  round.push(pts[pts.length - 1])
  return round
}

// a straight walk that would cross a box goes around it by the nearer pair of corners (the box an end is in, like
// the building someone walks out of, doesn't count)
function segHits(a: V2, b: V2, x: Box, pad: number) {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05))
  for (let i = 1; i < n; i++) { const t = i / n; if (inBox(x, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, pad)) return true }
  return false
}
function aroundBoxes(path: V2[], boxes: Box[], pad: number): V2[] {
  const out: V2[] = [path[0]]
  for (let i = 1; i < path.length; i++) {
    const a = out[out.length - 1], b = path[i]
    const hit = boxes.find((x) => !inBox(x, a.x, a.z, 0.02) && !inBox(x, b.x, b.z, 0.02) && segHits(a, b, x, pad))
    if (hit) {
      const hx = hit.w / 2 + pad + 0.02, hz = hit.d / 2 + pad + 0.02
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({ x: hit.x + sx * hx, z: hit.z + sz * hz }))
      // the two corners on the side of the shorter detour
      const viaA = [corners[0], corners[1]], viaB = [corners[3], corners[2]], viaC = [corners[0], corners[3]], viaD = [corners[1], corners[2]]
      const cost = (via: V2[]) => { const [c1, c2] = Math.hypot(via[0].x - a.x, via[0].z - a.z) < Math.hypot(via[1].x - a.x, via[1].z - a.z) ? via : [via[1], via[0]]; return { pts: [c1, c2], d: Math.hypot(c1.x - a.x, c1.z - a.z) + Math.hypot(c2.x - c1.x, c2.z - c1.z) + Math.hypot(b.x - c2.x, b.z - c2.z) } }
      const best = [viaA, viaB, viaC, viaD].map(cost).filter((c) => !segHits(a, c.pts[0], hit, pad - 0.01) && !segHits(c.pts[1], b, hit, pad - 0.01)).sort((x, y) => x.d - y.d)[0]
      if (best) out.push(...best.pts)
    }
    out.push(b)
  }
  return out
}

// where someone's feet stand when they sit on a seat (shins straight down from the knees)
function feetFor(p: Person, seat: Spot): V2 {
  const hip = (seat.seatY ?? 0) / p.size
  const c = (hip - RIG.shin - RIG.shinR * 0.2) / RIG.thigh
  const reach = RIG.thigh * Math.sin(c >= 1 || c <= 0 ? Math.PI / 2 : Math.acos(c)) * p.size
  return { x: seat.x + Math.sin(seat.heading) * reach, z: seat.z + Math.cos(seat.heading) * reach }
}
const SIT_TIME = 0.6

function arrive(p: Person) {
  const t = p.target
  p.moving = false
  if (p.through) return
  p.lot = t?.lot ?? p.lot
  if (!t) return
  p.pose = t.pose
  p.how = t.spot.how
  p.seatY = t.spot.seatY ?? 0
  p.seatAt = t.spot.how === 'seat' ? { x: t.spot.x, z: t.spot.z } : null
  if (t.spot.how === 'seat' && !t.hide) {
    // they're standing where their feet go: turn round, then lower onto the seat
    p.pose = 'stand'
    p.sitting = { from: { ...p.pos }, to: { x: t.spot.x, z: t.spot.z }, t: 0, down: true }
    return
  }
  if (!t.hide && Math.hypot(p.pos.x - t.spot.x, p.pos.z - t.spot.z) < 0.05) p.pos = { x: t.spot.x, z: t.spot.z }
}

// walk along the path. each step, try a few positions across the sidewalk (nearest first) and take the first with
// room past everyone and everything ahead; with no room, slow down behind it. wait at the curb for cars.
type Car = { x: number; z: number; w: number; d: number; vx: number; vz: number }
const boxGap = (b: Box, x: number, z: number) => Math.hypot(Math.max(0, Math.abs(x - b.x) - b.w / 2), Math.max(0, Math.abs(z - b.z) - b.d / 2))
function move(p: Person, people: Person[], sc: Scene, dt: number, cars: Car[]) {
  const A0 = p.path[p.seg], B0 = p.path[p.seg + 1]
  if (!B0) { arrive(p); return }
  const len0 = Math.hypot(B0.x - A0.x, B0.z - A0.z) || 1e-6
  const d = { x: (B0.x - A0.x) / len0, z: (B0.z - A0.z) / len0 }, n = { x: d.z, z: -d.x }
  const onWalk = STREETS.some((s) => Math.abs(Math.abs(A0.z - s) - WALK) < 0.02 && Math.abs(Math.abs(B0.z - s) - WALK) < 0.02) || STREETS.some((s) => Math.abs(Math.abs(A0.x - s) - WALK) < 0.02 && Math.abs(Math.abs(B0.x - s) - WALK) < 0.02)
  const latMax = onWalk ? WALK_SPREAD : 0.1
  const speed = p.followSpeed ?? (p.bike ? BIKE_SPEED : (p.kid ? 0.9 : 1) * WALK_SPEED * (p.age > 70 ? 0.8 : 1))
  const ward = p.ward >= 0 && people[p.ward]?.attached && !people[p.ward].baby ? people[p.ward] : null
  // what's near: people, posts, yard props
  type Ob = { x: number; z: number; r: number; v: number; box?: Box }
  const obs: Ob[] = []
  for (const o of people) {
    if (o === p || o.vis < 0.2 || o.inside || o.guardian === p.idx || o.idx === p.guardian || o.baby) continue
    if (Math.abs(o.pos.x - p.pos.x) > 1.4 || Math.abs(o.pos.z - p.pos.z) > 1.4) continue
    const v = o.moving ? Math.max(0, Math.sin(o.heading) * d.x * o.speed + Math.cos(o.heading) * d.z * o.speed) : 0
    obs.push({ x: o.pos.x, z: o.pos.z, r: o.r, v })
  }
  for (const s of sc.posts) if (Math.abs(s.x - p.pos.x) < 1.4 && Math.abs(s.z - p.pos.z) < 1.4) obs.push({ x: s.x, z: s.z, r: s.r, v: 0 })
  for (const c of cars) if (Math.abs(c.x - p.pos.x) < 4 && Math.abs(c.z - p.pos.z) < 4) obs.push({ x: c.x, z: c.z, r: 0, v: 0, box: { x: c.x, z: c.z, w: c.w + 0.1, d: c.d + 0.1, h: 1 } })
  for (const b of sc.boxes) if (boxGap(b, p.pos.x, p.pos.z) < 1.2 && !inBox(b, p.path[p.path.length - 1].x, p.path[p.path.length - 1].z, 0.05) && !inBox(b, p.path[0].x, p.path[0].z, 0.05)) obs.push({ x: b.x, z: b.z, r: 0, v: 0, box: b })
  // clearance of a sideways position, looking a little way ahead along the path
  const posAt = (lat: number, ahead: number) => ({ x: p.pos.x + d.x * ahead + n.x * (lat - p.lat), z: p.pos.z + d.z * ahead + n.z * (lat - p.lat) })
  const overlapped = new Set(obs.filter((o) => (o.box ? boxGap(o.box, p.pos.x, p.pos.z) : Math.hypot(o.x - p.pos.x, o.z - p.pos.z) - o.r) - p.r < 0.005))
  const clear = (lat: number) => {
    let worst = 9, block = 9, blockV = 0
    for (const ah of [0.05, 0.25, 0.5]) {
      const q = posAt(lat, ah)
      const kq = ward && ward.ang !== undefined ? { x: q.x + Math.sin(p.heading + ward.ang) * (p.r + ward.r + 0.012), z: q.z + Math.cos(p.heading + ward.ang) * (p.r + ward.r + 0.012) } : null
      for (const o of obs) {
        if (overlapped.has(o)) continue
        const gk = kq ? (o.box ? boxGap(o.box, kq.x, kq.z) : Math.hypot(o.x - kq.x, o.z - kq.z) - o.r) - ward!.r - 0.02 : 9
        // a bicycle reaches further than its rider's shoulders: riders keep more room
        const gap = Math.min((o.box ? boxGap(o.box, q.x, q.z) : Math.hypot(o.x - q.x, o.z - q.z) - o.r) - p.r - (p.bike ? 0.1 : 0.02), gk)
        if (gap < worst) worst = gap
        if (gap < 0 && ah < block) { block = ah; blockV = o.v }
      }
    }
    return { worst, block, blockV }
  }
  let go = speed
  let latWant = p.lat
  const here = clear(p.lat)
  if (here.worst < 0) {
    // try nearby positions across the walkway, nearest first, then drifting back toward the walking line
    let found = false
    // keep to the side already chosen unless it's blocked (no dithering back and forth)
    const pref = (p.dodge ?? 1) >= 0 ? [1, -1] : [-1, 1]
    for (let k = 1; k <= 8 && !found; k++) for (const sgn of pref) {
      const cand = p.lat + sgn * k * 0.03
      if (Math.abs(cand) > latMax) continue
      if (clear(cand).worst >= 0) { latWant = cand; p.dodge = sgn; found = true; break }
    }
    // no room to pass: follow at their pace, or wait
    if (!found) go = here.block <= 0.05 ? Math.min(here.blockV, speed) * 0.9 : Math.min(speed, Math.max(here.blockV, here.block * 2))
  } else {
    const home = Math.max(-latMax, Math.min(latMax, p.latHome ?? 0))
    if (Math.abs(p.lat - home) > 0.01 && clear(p.lat + (home - p.lat) * 0.2).worst >= 0 && clear(p.lat + (home - p.lat) * 0.5).worst >= 0) latWant = p.lat + (home - p.lat) * 0.5
  }
  // coming out of a building: wait inside until the doorway is clear
  if (p.inside) {
    const nx = posAt(p.lat, 0.1)
    // anyone in the doorway, or about to step through it from inside ahead of this person, goes first
    if (!buildingAt(sc, nx.x, nx.z, -p.r * 0.5) && people.some((o) => o !== p && o.guardian < 0 && o.guardian !== p.idx && (o.vis > 0.05 || (o.moving && o.idx < p.idx)) && Math.hypot(o.pos.x - nx.x, o.pos.z - nx.z) < o.r + p.r + 0.04)) go = 0
  }
  // at the curb: wait for cars coming in either lane
  const g0 = groundAt(p.pos.x, p.pos.z), q1 = posAt(p.lat, 0.3), g1 = groundAt(q1.x, q1.z)
  if (g0 > g1 + 0.01) {
    // after a moment at the curb, drivers stop for them: they go once nothing close is still moving
    const waited = (p.curbWait ?? 0) > 1.5
    for (const c of cars) {
      const rx = q1.x - c.x, rz = q1.z - c.z
      const dist = Math.hypot(rx, rz)
      const sp = Math.hypot(c.vx, c.vz)
      const closing = -(rx * c.vx + rz * c.vz) / Math.max(dist, 1e-6) // speed toward the crossing
      const blocks = waited ? dist < 0.6 + Math.max(c.w, c.d) / 2 || (sp > 0.15 && closing > 0.1 && dist < 1.0 + closing * 1.2) : dist < 1.2 + Math.max(c.w, c.d) / 2 || (closing > 0.1 && dist < 1.2 + closing * 2.5)
      if (blocks) { go = 0; break }
    }
    p.curbWait = go === 0 ? (p.curbWait ?? 0) + dt : 0
  } else p.curbWait = 0
  const lat0 = p.lat
  let turnTo = p.heading
  {
    // where the path is a short way ahead (tight arcs are many small pieces: look past them)
    let ahead = 0.3, k = p.seg, from = p.pos
    let aim = p.path[Math.min(k + 1, p.path.length - 1)]
    while (k < p.path.length - 1) { const q = p.path[k + 1], dd = Math.hypot(q.x - from.x, q.z - from.z); aim = q; if (dd >= ahead) { aim = { x: from.x + (q.x - from.x) * ahead / dd, z: from.z + (q.z - from.z) * ahead / dd }; break } ahead -= dd; from = q; k++ }
    const dirNow = Math.hypot(aim.x - p.pos.x, aim.z - p.pos.z) > 0.02 ? Math.atan2(aim.x - p.pos.x, aim.z - p.pos.z) : Math.atan2(B0.x - A0.x, B0.z - A0.z)
    const off = Math.abs(ANG(dirNow - p.heading))
    turnTo = dirNow
    // a sharp turn ahead: stop and turn on the spot first (feet stay planted), then walk on
    go *= off > 0.6 ? 0 : 1 - (off / 0.6) * 0.5
  }
  // can't outwalk one's own feet: slow down while a planted leg is near full stretch (one's own, or the small
  // child's whose hand they hold; and with a small child, at the child's pace)
  if (ward) go = Math.min(go, 2.2 * ward.size)
  const wardGap = ward ? Math.hypot(ward.pos.x - p.pos.x, ward.pos.z - p.pos.z) : 0
  if (ward && ward.path === p.path && wardGap > 0.4 && progressOf(ward) < progressOf(p)) go = 0
  // and at a door: they go in together, the child right behind (never left on the step)
  if (ward && ward.path === p.path && !p.inside) { const nx = posAt(p.lat, 0.15); if (buildingAt(sc, nx.x, nx.z, -p.r * 0.5) && wardGap > (p.r + ward.r) * 1.6) go = 0 }
  const strain = Math.max(p.strain ?? 0, ward ? ward.strain ?? 0 : 0)
  if (strain > 0.75) go *= strain >= 0.95 ? 0 : Math.max(0.05, 1 - (strain - 0.75) * 5)
  // drift across gently, with the actual pace (none while stopped to turn or wait)
  p.lat += Math.sign(latWant - p.lat) * Math.min(Math.abs(latWant - p.lat), dt * go * 0.3)
  p.speed = go
  const before = p.pos, segBefore = p.seg, sBefore = p.segS
  let left = go * dt
  while (left > 0 && p.seg < p.path.length - 1) {
    const A = p.path[p.seg], B = p.path[p.seg + 1]
    const L = Math.hypot(B.x - A.x, B.z - A.z)
    if (p.segS + left >= L) { left -= L - p.segS; p.seg++; p.segS = 0 } else { p.segS += left; left = 0 }
  }
  if (p.seg >= p.path.length - 1) { p.pos = { ...p.path[p.path.length - 1] }; p.lat = 0; p.walked += Math.hypot(p.pos.x - before.x, p.pos.z - before.z); arrive(p); return }
  const A = p.path[p.seg], B = p.path[p.seg + 1]
  const L = Math.hypot(B.x - A.x, B.z - A.z) || 1e-6
  const u = { x: (B.x - A.x) / L, z: (B.z - A.z) / L }
  // the sideways offset eases out near the ends of a segment so corners stay on the sidewalk
  const edge = Math.min(1, p.segS / 0.3, (L - p.segS) / 0.3)
  p.pos = { x: A.x + u.x * p.segS + u.z * p.lat * edge, z: A.z + u.z * p.segS - u.x * p.lat * edge }
  // never a step into anyone (a child included: right behind or beside their adult, never inside them)
  const g0p = p.guardian >= 0 ? people[p.guardian] : null
  const tooClose = g0p && g0p.vis > 0.2 && !g0p.inside && Math.hypot(g0p.pos.x - p.pos.x, g0p.pos.z - p.pos.z) < (g0p.r + p.r) * 0.95 && Math.hypot(g0p.pos.x - p.pos.x, g0p.pos.z - p.pos.z) < Math.hypot(g0p.pos.x - before.x, g0p.pos.z - before.z)
  const worse = tooClose || obs.some((o) => !o.box && Math.hypot(o.x - p.pos.x, o.z - p.pos.z) - o.r - p.r < 0.005 && Math.hypot(o.x - p.pos.x, o.z - p.pos.z) < Math.hypot(o.x - before.x, o.z - before.z))
  if (worse) { p.pos = before; p.seg = segBefore; p.segS = sBefore; p.lat = lat0; p.speed = 0; return }
  // the legs move with how far the body actually moved, so the feet never slide
  p.walked += Math.hypot(p.pos.x - before.x, p.pos.z - before.z)
  void lat0
  const want = go > 0.01 ? Math.atan2(p.pos.x - before.x, p.pos.z - before.z) : turnTo
  const dh = Math.sign(ANG(want - p.heading)) * Math.min(Math.abs(ANG(want - p.heading)), dt * 5)
  p.heading = ANG(p.heading + dh)
}


// ---- the rig: every part's transform, in world space ----
export type Rig = {
  torso: THREE.Matrix4; head: THREE.Matrix4
  arms: [THREE.Matrix4, THREE.Matrix4]; thighs: [THREE.Matrix4, THREE.Matrix4]; shins: [THREE.Matrix4, THREE.Matrix4]
  hands: [THREE.Vector3, THREE.Vector3]; feet: [THREE.Vector3, THREE.Vector3] // lowest points of the feet
  knees: [THREE.Vector3, THREE.Vector3]; hipsY: number
  stance: -1 | 0 | 1 // walking: the planted foot
  planted: [boolean, boolean] // walking: which feet are down and locked to the ground
  items: { kind: 'bag' | 'box' | 'sign' | 'bike' | 'stroller' | 'baby'; m: THREE.Matrix4; grip: THREE.Vector3[] }[] // grip: where hands should be
  base: THREE.Matrix4
}
export function newRig(): Rig {
  const M = () => new THREE.Matrix4(), V = () => new THREE.Vector3()
  return { torso: M(), head: M(), arms: [M(), M()], thighs: [M(), M()], shins: [M(), M()], hands: [V(), V()], feet: [V(), V()], knees: [V(), V()], hipsY: 0, stance: -1, planted: [false, false], items: [], base: M() }
}
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4()
const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z)
const RX = (a: number) => new THREE.Matrix4().makeRotationX(a)
const RZ = (a: number) => new THREE.Matrix4().makeRotationZ(a)

// joint angles for a pose. thigh/arm angles: 0 hangs straight down, negative swings forward. knee: positive bends back
type Joints = { hip: number; pitch: number; thigh: [number, number]; knee: [number, number]; arm: [number, number]; roll: [number, number]; legRoll: [number, number]; ground: 'feet' | 'seat' | 'knees' | 'butt' | 'bike'; stance: -1 | 0 | 1 }
function joints(p: Person, t: number, carrying: 'none' | 'box' | 'baby' | 'stroller' | 'bike'): Joints {
  const j: Joints = { hip: RIG.hip, pitch: 0, thigh: [0, 0], knee: [0, 0], arm: [0.06, -0.06], roll: [0, 0], legRoll: [0, 0], ground: 'feet', stance: -1 }
  // the planted foot sweeps back at the body's speed: a linear (triangle wave) swing, one cycle per 0.922 body
  // units walked (two steps of 2 x 0.53, the hip-to-sole length, x sin 0.45), so feet do not slide
  const ph = (p.walked / (0.922 * p.size)) * Math.PI * 2
  const tri = (x: number) => (2 / Math.PI) * Math.asin(Math.sin(x))
  const pose: Pose = p.moving ? (p.bike ? 'ride' : 'walk') : p.pose
  switch (pose) {
    case 'walk': {
      // the left foot is planted while the left thigh sweeps back (cos > 0), the right one the other half;
      // the swinging knee bends most mid-swing
      const s = tri(ph), c = Math.cos(ph)
      j.thigh = [s * 0.45, -s * 0.45]
      j.stance = c > 0 ? 0 : 1
      j.knee = [c > 0 ? 0 : -c * 0.9, c > 0 ? c * 0.9 : 0]
      j.arm = [-s * 0.35, s * 0.35]
      break
    }
    case 'ride': {
      const c1 = Math.sin(ph * 0.6), c2 = -c1
      j.hip = 1.0; j.pitch = 0.3; j.ground = 'bike'
      j.thigh = [-1.0 + c1 * 0.35, -1.0 + c2 * 0.35]; j.knee = [1.2 - c1 * 0.4, 1.2 - c2 * 0.4]
      j.arm = [-1.15, -1.15]
      break
    }
    case 'seat': {
      // hips on the seat; thighs angle down just enough that the shins stand on the ground (children's feet dangle)
      j.hip = p.seatY / p.size; j.ground = 'seat'
      const c = (j.hip - RIG.shin - RIG.shinR * 0.2) / RIG.thigh
      const a = c >= 1 || c <= 0 ? Math.PI / 2 : Math.acos(c)
      j.thigh = [-a, -a]; j.knee = [a, a]; j.arm = [-0.35, -0.35]
      break
    }
    case 'ground': j.thigh = [-Math.PI / 2, -Math.PI / 2]; j.knee = [0, 0]; j.arm = [-0.25, -0.25]; j.ground = 'butt'; break
    case 'kneel': j.thigh = [0.05, 0.05]; j.knee = [Math.PI / 2, Math.PI / 2]; j.pitch = 0.2; j.arm = [-0.6, -0.6]; j.ground = 'knees'; break
    case 'armsUp': j.arm = [-2.8 + Math.sin(t * 5 + p.idx) * 0.15, -2.8 - Math.sin(t * 5 + p.idx) * 0.15]; break
    case 'sign': j.arm = [-2.65, 0.08]; break
    case 'bob': j.pitch = 0.6 + Math.sin(t * 1.6 + p.idx) * 0.15; j.thigh = [-0.2, -0.2]; j.knee = [0.35, 0.35]; j.arm = [-1.1, -0.9]; break
    case 'hammer': j.arm = [-0.5, -1.3 + Math.sin(t * 5 + p.idx) * 0.7]; break
    default: j.arm = [0.06 + Math.sin(t * 1.3 + p.idx) * 0.03, -0.06 - Math.sin(t * 1.3 + p.idx) * 0.03]
  }
  if (pose !== 'ride' && pose !== 'sign' && pose !== 'armsUp') {
    if (carrying === 'box') { j.arm = [-1.2, -1.2]; j.roll = [0, 0] }
    if (carrying === 'baby') { j.arm = [-1.05, -1.05]; j.roll = [0.55, -0.55] }
    if (carrying === 'stroller') { j.arm = [-1.0, -1.0]; j.roll = [0, 0] }
  }
  return j
}

const HAND = new THREE.Vector3(0, -RIG.arm, 0)
const BLEND = 0.4 // seconds for any change of pose
const cloneJ = (j: Joints): Joints => ({ ...j, thigh: [...j.thigh], knee: [...j.knee], arm: [...j.arm], roll: [...j.roll], legRoll: [...j.legRoll] })
function lerpJ(a: Joints, b: Joints, e: number): Joints {
  const L = (x: number, y: number) => x + (y - x) * e
  return { hip: L(a.hip, b.hip), pitch: L(a.pitch, b.pitch), thigh: [L(a.thigh[0], b.thigh[0]), L(a.thigh[1], b.thigh[1])], knee: [L(a.knee[0], b.knee[0]), L(a.knee[1], b.knee[1])], arm: [L(a.arm[0], b.arm[0]), L(a.arm[1], b.arm[1])], roll: [L(a.roll[0], b.roll[0]), L(a.roll[1], b.roll[1])], legRoll: [L(a.legRoll[0], b.legRoll[0]), L(a.legRoll[1], b.legRoll[1])], ground: b.ground, stance: b.stance }
}
// dt > 0 advances the pose blend (once per frame); dt = 0 only reads
export function rigOf(p: Person, people: Person[], t: number, R: Rig, dt = 0): Rig {
  const ward = p.ward >= 0 ? people[p.ward] : null
  const baby = ward && ward.baby && ward.attached ? ward : null
  const carrying: 'none' | 'box' | 'baby' | 'stroller' | 'bike' = baby ? (p.stroller ? 'stroller' : 'baby') : p.boxes && (p.bags || p.act === 'shopping') ? 'box' : p.moving && p.bike ? 'bike' : 'none'
  const target = joints(p, t, carrying)
  const pose: Pose = p.moving ? (p.bike ? 'ride' : 'walk') : p.pose
  if (dt > 0 && pose !== p.lastPose) {
    // starting to walk needs no blend: a stride from zero distance starts with straight legs, the same as standing
    if (p.jLast && pose !== 'walk' && pose !== 'ride') { p.jFrom = cloneJ(p.jLast); p.liftFrom = p.liftLast; p.blend = 0 } else p.blend = 1
    p.lastPose = pose
  }
  if (dt > 0) p.blend = Math.min(1, (p.blend ?? 1) + dt / BLEND)
  const bl = p.blend ?? 1, e = bl * bl * (3 - 2 * bl)
  const blending = bl < 1 && !!p.jFrom
  const j = blending ? lerpJ(p.jFrom!, target, e) : target
  // build the legs in body space first, to find how low the body must sit for the feet (or seat, knees) to touch
  const hipM = (side: number) => T(side ? -RIG.hipX : RIG.hipX, j.hip, 0).multiply(RZ(j.legRoll[side])).multiply(RX(j.thigh[side]))
  const thighOf = (side: number) => hipM(side)
  const shinOf = (side: number) => hipM(side).multiply(T(0, -RIG.thigh, 0)).multiply(RX(j.knee[side]))
  // walking: lock each planted foot to its spot on the ground and reach it with the leg (two-joint ik with a hip
  // roll); the swinging foot lifts off where it was and lands ahead of its hip along the way they're going
  const footLock = pose === 'walk' && !blending
  if (!footLock) { p.fs = undefined; if (dt > 0) { p.prevPos = undefined; p.vel = undefined } }
  else {
    j.hip = 0.48 // knees soft while walking: room for the legs to reach the planted feet through turns
    const cyc = 0.922 * p.size
    // land the swinging foot ahead along the way the body is actually going (on curves that's not quite where it faces)
    if (dt > 0) {
      if (p.prevPos) { const vx = (p.pos.x - p.prevPos.x) / dt, vz = (p.pos.z - p.prevPos.z) / dt, k = Math.min(1, dt * 12); p.vel = p.vel ? { x: p.vel.x + (vx - p.vel.x) * k, z: p.vel.z + (vz - p.vel.z) * k } : { x: vx, z: vz } }
      p.prevPos = { ...p.pos }
    }
    const vl = p.vel ? Math.hypot(p.vel.x, p.vel.z) : 0
    const fwd = vl > 0.05 ? { x: p.vel!.x / vl, z: p.vel!.z / vl } : { x: Math.sin(p.heading), z: Math.cos(p.heading) }
    const right = { x: Math.cos(p.heading), z: -Math.sin(p.heading) }
    const hipG = (side: number) => { const sx = side ? -1 : 1; return { x: p.pos.x + right.x * sx * RIG.hipX * p.size, z: p.pos.z + right.z * sx * RIG.hipX * p.size } }
    // procedural stepping: each foot stays planted until it falls too far behind its hip (or nears the edge of the
    // leg's reach), then takes a step, one foot at a time, landing ahead along the way the body is going
    const fs = dt > 0 ? (p.fs ??= [null, null]) : (p.fs ?? [null, null]).map((f) => (f ? { ...f } : null))
    const L1r = RIG.thigh, L2r = RIG.shin - RIG.shinR
    const reach = Math.sqrt(Math.max(0, (L1r + L2r) ** 2 - (j.hip - RIG.shinR) ** 2)) * p.size * 0.92 // horizontal reach
    const stride = cyc * 0.5
    const lead = Math.min(stride * 0.5, reach * 0.55)
    const moving = vl > 0.05
    const targetOf = (side: number) => { const h = hipG(side); return moving ? { x: h.x + fwd.x * lead, z: h.z + fwd.z * lead } : h }
    const lifts = [0, 0]
    for (const side of [0, 1] as const) { if (!fs[side]) { const h = hipG(side); fs[side] = { x: h.x, z: h.z, swing: false, fx: h.x, fz: h.z, t: 0 } } }
    const stepTime = Math.max(0.16, Math.min(0.4, (stride / Math.max(vl, 0.2)) * 0.5))
    if (dt > 0) {
      // the swinging foot moves on (and lands)
      for (const side of [0, 1] as const) {
        const f = fs[side]!
        if (!f.swing) continue
        f.t = Math.min(1, (f.t ?? 0) + dt / stepTime)
        const tg = targetOf(side), e = f.t * f.t * (3 - 2 * f.t)
        // never land straddling a curb edge
        let tx = tg.x, tz = tg.z
        const fr = footRadius(p.size) * 1.4 // a margin: the rendered sole sits a hair off the planned spot
        if (groundUnder(tx, tz, fr) !== groundAt(tx, tz)) {
          // the nearest spot that's fully on one level: ahead, behind, or to either side
          let best: V2 | null = null, bd = 9
          for (const [ox, oz] of [[fwd.x, fwd.z], [-fwd.x, -fwd.z], [right.x, right.z], [-right.x, -right.z]]) for (let k = 1; k <= 4; k++) {
            const qx = tx + ox * fr * 0.8 * k, qz = tz + oz * fr * 0.8 * k
            if (groundUnder(qx, qz, fr) === groundAt(qx, qz) && fr * 0.8 * k < bd) { best = { x: qx, z: qz }; bd = fr * 0.8 * k; break }
          }
          if (best) { tx = best.x; tz = best.z }
        }
        f.x = f.fx + (tx - f.fx) * e; f.z = f.fz + (tz - f.fz) * e
        if (f.t >= 1) f.swing = false
      }
      // a planted foot that's fallen behind (or is running out of reach) steps, if the other foot is down
      if (!fs[0]!.swing && !fs[1]!.swing) {
        const need = ([0, 1] as const).map((side) => {
          const f = fs[side]!, tg = targetOf(side), h = hipG(side)
          const off = Math.hypot(f.x - tg.x, f.z - tg.z), fromHip = Math.hypot(f.x - h.x, f.z - h.z)
          return { side, score: Math.max(off / Math.max(stride * 0.55, 0.004), fromHip / (reach * 0.8)) }
        }).sort((a2, b2) => b2.score - a2.score)[0]
        if (need.score > 1 || (!moving && need.score > 0.35)) { const f = fs[need.side]!; f.swing = true; f.t = 0; f.fx = f.x; f.fz = f.z }
      }
    }
    for (const side of [0, 1] as const) { const f = fs[side]!; if (f.swing) lifts[side] = Math.sin(Math.PI * Math.min(1, f.t ?? 0)) * 0.09 }
    j.stance = fs[0]!.swing ? 1 : fs[1]!.swing ? 0 : -1
    // how close a planted leg is to full reach: walking slows as it gets there, until the step lands
    if (dt > 0) p.strain = Math.max(...([0, 1] as const).map((side) => { const f = fs[side]!; if (f.swing) return 0; const h = hipG(side); return Math.hypot(f.x - h.x, f.z - h.z) / (reach / 0.92) }))
    // ik: from each hip (body space) to its foot (world, brought into body space)
    _e.set(0, p.heading, 0); _q.setFromEuler(_e)
    // stepping down a curb, the hips come down with the lower foot so both legs still reach
    const baseY = Math.min(groundAt(p.pos.x, p.pos.z), groundAt(fs[0]!.x, fs[0]!.z), groundAt(fs[1]!.x, fs[1]!.z))
    p.baseY = baseY
    const Wb = new THREE.Matrix4().compose(_v.set(p.pos.x, baseY, p.pos.z), _q, _s.set(p.size, p.size, p.size))
    const inv = Wb.clone().invert()
    const L1 = RIG.thigh, L2 = RIG.shin - RIG.shinR
    for (const side of [0, 1] as const) {
      const f = fs[side]!
      const loc = new THREE.Vector3(f.x, groundUnder(f.x, f.z, footRadius(p.size)), f.z).applyMatrix4(inv)
      loc.y += RIG.shinR + lifts[side]
      const hx = side ? -RIG.hipX : RIG.hipX
      const lx = loc.x - hx, ly = j.hip - loc.y, lz = loc.z
      const roll = Math.atan2(lx, ly)
      const lyp = Math.hypot(lx, ly)
      const D = Math.min(Math.hypot(lyp, lz), L1 + L2 - 1e-4)
      const cosK = (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2)
      const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosK)))
      const base = Math.atan2(lz, lyp)
      const alpha = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))))
      j.legRoll[side] = roll
      j.thigh[side] = -(base + alpha)
      j.knee[side] = knee
    }
  }
  const lowest = (m: THREE.Matrix4, len: number, rad: number) => { const a = _v.set(0, -rad, 0).applyMatrix4(m).y, b = _v.set(0, -(len - rad), 0).applyMatrix4(m).y; return Math.min(a, b) - rad }
  const modeLift = (mode: Joints['ground']) => mode === 'feet' ? -Math.min(lowest(shinOf(0), RIG.shin, RIG.shinR), lowest(shinOf(1), RIG.shin, RIG.shinR))
    : mode === 'knees' ? -Math.min(lowest(shinOf(0), RIG.shin, RIG.shinR), lowest(thighOf(0), RIG.thigh, RIG.legR))
    : mode === 'butt' ? -Math.min(j.hip - 0.03, lowest(shinOf(0), RIG.shin, RIG.shinR), lowest(thighOf(0), RIG.thigh, RIG.legR)) : 0
  let lift = 0
  if (blending) {
    // between two poses: grounded the way the old pose was, easing into how the new one is
    lift = modeLift(p.jFrom!.ground) + (modeLift(target.ground) - modeLift(p.jFrom!.ground)) * e
  } else if (footLock) {
    lift = 0
  } else if (j.ground === 'feet' && j.stance >= 0) {
    // walking: the planted foot is on the ground; the swinging one bends its knee until it clears the ground
    const st = j.stance as 0 | 1, sw = (1 - st) as 0 | 1
    lift = -lowest(shinOf(st), RIG.shin, RIG.shinR)
    for (let k = 0; k < 30 && lowest(shinOf(sw), RIG.shin, RIG.shinR) + lift < 0.005; k++) j.knee[sw] += 0.04
  } else if (j.ground === 'feet') lift = -Math.min(lowest(shinOf(0), RIG.shin, RIG.shinR), lowest(shinOf(1), RIG.shin, RIG.shinR))
  else if (j.ground === 'knees') lift = -Math.min(lowest(shinOf(0), RIG.shin, RIG.shinR), lowest(thighOf(0), RIG.thigh, RIG.legR))
  else if (j.ground === 'butt') lift = -Math.min(j.hip - 0.03, lowest(shinOf(0), RIG.shin, RIG.shinR), lowest(thighOf(0), RIG.thigh, RIG.legR))
  if (dt > 0) { p.jLast = cloneJ(j); p.liftLast = lift }
  R.stance = blending ? -1 : j.stance
  R.planted = footLock && p.fs ? [!p.fs[0]!.swing, !p.fs[1]!.swing] : [false, false]
  // the world placement: position, heading, size
  _e.set(0, p.heading, 0); _q.setFromEuler(_e)
  R.base.compose(_v.set(p.pos.x, (footLock ? p.baseY! : groundAt(p.pos.x, p.pos.z)) + lift * p.size, p.pos.z), _q, _s.set(p.size, p.size, p.size))
  const W = R.base
  const torso = T(0, j.hip, 0).multiply(RX(j.pitch))
  R.torso.copy(W).multiply(torso).multiply(T(0, 0.36, 0))
  R.head.copy(W).multiply(torso).multiply(T(0, RIG.head, 0))
  if (p.kid) R.head.scale(_v.set(1.15, 1.15, 1.15))
  for (const side of [0, 1] as const) {
    const sx = side ? -1 : 1
    const arm = _m.copy(W).multiply(torso).multiply(T(sx * RIG.shoulderX, RIG.shoulderY, 0)).multiply(RZ(j.roll[side] * sx)).multiply(RX(j.arm[side]))
    R.arms[side].copy(arm)
    R.hands[side].copy(HAND).applyMatrix4(arm)
    R.thighs[side].copy(W).multiply(thighOf(side))
    R.shins[side].copy(W).multiply(shinOf(side))
    const sh = shinOf(side)
    const foot = _m2.copy(W).multiply(sh)
    R.feet[side].set(0, -(RIG.shin - RIG.shinR), 0).applyMatrix4(foot); R.feet[side].y -= RIG.shinR * p.size
    R.knees[side].set(0, 0, 0).applyMatrix4(_m2.copy(W).multiply(sh))
  }
  R.hipsY = _v.set(0, j.hip, 0).applyMatrix4(W).y
  // held things
  R.items.length = 0
  const up = (at: THREE.Vector3) => new THREE.Matrix4().compose(at, _q, _s.set(p.size, p.size, p.size))
  if (carrying === 'none' || carrying === 'bike') {
    // bags hang straight down from the hand that holds them
    for (let k = 0; k < Math.min(2, p.bags); k++) {
      const h = R.hands[k]
      R.items.push({ kind: 'bag', m: up(h.clone().add(_v.set(0, -0.13 * p.size, 0))), grip: [h.clone()] })
    }
  }
  if (carrying === 'box') {
    const m = _m2.copy(W).multiply(torso).multiply(T(0, 0.42, 0.42))
    R.items.push({ kind: 'box', m: m.clone(), grip: [new THREE.Vector3(0.3, 0.42, 0.42).applyMatrix4(_m.copy(W).multiply(torso)), new THREE.Vector3(-0.3, 0.42, 0.42).applyMatrix4(_m.copy(W).multiply(torso))] })
  }
  if (carrying === 'baby') {
    // the baby lies across the forearms, against the chest
    const m = _m2.copy(W).multiply(torso).multiply(T(0, 0.34, 0.34))
    R.items.push({ kind: 'baby', m: m.clone(), grip: [R.hands[0].clone(), R.hands[1].clone()] })
  }
  if (carrying === 'stroller') {
    // the handle sits where the hands are; the stroller rolls on the ground in front
    const handle = R.hands[0].clone().add(R.hands[1]).multiplyScalar(0.5)
    const local = handle.clone().applyMatrix4(_m.copy(W).invert())
    const m = _m2.copy(W).multiply(T(0, local.y, local.z))
    R.items.push({ kind: 'stroller', m: m.clone(), grip: [R.hands[0].clone(), R.hands[1].clone()] })
  }
  if ((p.moving ? 'walk' : p.pose) === 'sign' && !p.moving) {
    // the sign's pole runs through the raised hand
    const h = R.hands[0]
    R.items.push({ kind: 'sign', m: up(h.clone().add(_v.set(0, -0.45 * p.size, 0))), grip: [h.clone()] })
  }
  if (carrying === 'bike') R.items.push({ kind: 'bike', m: W.clone(), grip: [R.hands[0].clone(), R.hands[1].clone()] })
  return R
}

// where the hands should be on each held thing, in its own space (for the qa: hand-to-grip distance)
export const GRIPS = {
  stroller: [new THREE.Vector3(0.25, 0, 0), new THREE.Vector3(-0.25, 0, 0)], // relative to the handle bar centre
  bike: [new THREE.Vector3(0.28, 1.12, 0.62), new THREE.Vector3(-0.28, 1.12, 0.62)],
}
