// everyone on her street as pure state, no rendering: who they are, where they are, what their body is doing, and the
// furniture they use. the scene draws it (./Crowd, ./ChosenPerson, ./Furniture) and the qa script steps it in node,
// so the ragdoll rules (CLAUDE.md) are checked against exactly what is drawn.
//
// rules this module owns (each one is a cause, not a patch):
// - a baby under 1.5 is always in someone's arms: her carrier, or a kin baby's mother. a crowd baby rides on a back
// - a child under 8 is never alone in public: out of the house they walk beside their grown-up, hand in hand
// - talking means talking TO someone: a talker turns to the nearest person in front of them, or stops talking
// - sitting means a seat: every sitting station has a chair, bench, stoop or mat at its height, and stays there
// - passersby walk at the speed their feet move, step around anyone standing, and appear only where the street
//   leaves the frame (in the haze), never in the middle of the shot
import * as THREE from 'three'
import type { Layout, Lot } from '@/components/world/city/layout'
import type { LifeRecord, Workplace } from '@/lib/life/types'
import type { LiveState } from './ChosenPerson'
import type { WorldNow } from './Scene'
import { hash01, planDay, schedule, whereIn, withOccasion, spotsAt, STREETS_W, K, type Act, type DayPlan, type Where, type Stop } from './plan'
import { bodyFor, gait, poseFor, solve, makeSolved, blendInto, clonePose, reachArm, cradleFor, footOverlap, lockFeet, newFootLock, type FootLock, type Action, type Body, type Pose, type Solved } from './rig'
import type { CityStyle } from './style'
import { buildFabric, fabricSolids, LANE_HALF, FACADE_FROM_STREET, type Fabric, type Solid } from './fabric'

// ---------- look (pure data; Crowd turns it into colors) ----------
export type Look = { skin: number; shirt: string; lower: string; hair: 'black' | 'gray'; wrap: boolean; sleeves: boolean }
export type Role = 'kin' | 'coworker' | 'crowd' | 'neighbor' | 'passer'
export type Agent = {
  id: string; role: Role; kinId?: string; name: string; sex: 'female' | 'male'
  age: number; body: Body; look: Look
  home: Lot; workplace: Workplace; slot: number; lane: number; activity: 'working' | 'school' | 'retired' | 'infant' | 'unemployed' | 'caregiver'
  vendor: boolean; sweeper: boolean; babyOnBack: boolean; seed: number
  guardian?: string // id of the grown-up a small child goes out with
  workSlot?: number // their own place at work, unique among everyone working at the same kind of place
  plan?: { day: number; plan: DayPlan }
  pos: THREE.Vector3; heading: number; presence: number; phase: number; last: THREE.Vector3; started: boolean; pose: Pose | null
  sol: Solved
}
// a seat: where a sitting body's pelvis rests. heights in world units (1 unit = 1.7 m): a chair 46 cm, a bench 44 cm,
// a stoop 34 cm, a prayer mat on the floor
export type SeatKind = 'chair' | 'bench' | 'stoop' | 'mat' | 'stool'
export type Seat = { key: string; x: number; z: number; h: number; facing: number; kind: SeatKind; lotId: number; indoors: boolean }
export const SEAT_H: Record<SeatKind, number> = { chair: 0.27, bench: 0.26, stoop: 0.2, stool: 0.27, mat: 0.02 }

// one body as drawn this frame
export type Placed = {
  id: string; who: string; role: Role; age: number; kinId?: string
  root: THREE.Matrix4 // world transform of the body's ground point
  x: number; z: number; heading: number
  action: Action; walking: boolean; presence: number
  body: Body; sol: Solved; look: Look
  props: { basin: boolean; broom: boolean; phone: boolean; babyOnBack: boolean }
  holding: string | null // id of the baby in their arms
  heldBy: string | null // id of whoever holds this baby
  cradle: { center: THREE.Vector3; targets: [THREE.Vector3, THREE.Vector3] } | null // world space, while holding
  indoors: boolean; lotId: number; lotKind: string; seat: Seat | null; talkingTo: string | null
  guardian: string | null; door: THREE.Vector3 | null // the door they are at or came out of (appearing is fine there)
  note: string // what their plan says right now (for the qa log)
  handWith: string | null // holding hands with (a small child and their grown-up): arms meet, bodies do not
}

const WORKPLACES: Workplace[] = ['shop', 'office', 'factory', 'clinic', 'school', 'construction']
const CLOTHES_LOWER = ['#3E4A5E', '#2f3a4a', '#5E5A58', '#6b5f55', '#7E6E5A']

// what a person does at a stop, as a body action (talking is resolved later, against who is actually there)
function actionAt(a: { age: number; workplace: Workplace; seed: number }, w: Where, hour: number): Action {
  if (w.moving) return 'walk'
  if (w.leg) return 'stand' // waiting at a stop for a ride: standing there, not yet at the place they are going
  const act: Act = w.stop.act
  const label = w.stop.station.label
  switch (act) {
    case 'sleep': return 'lie'
    case 'eat': return w.stop.station.pose === 'sit' ? 'sit' : 'stand'
    case 'cook': return 'cook'
    case 'sweep': return 'sweep'
    case 'chat': return 'talk'
    case 'learn': return 'sit'
    case 'pray': return 'pray'
    case 'sit': case 'rest': return 'sit' // resting is sitting (a seat is there); a phone in hand is a prop, not standing up
    case 'play': return a.age < 13 ? 'play' : 'talk'
    case 'shop': return hash01(a.seed + Math.floor(hour * 4)) < 0.5 ? 'talk' : 'stand'
    case 'care': return 'work'
    case 'work': {
      if (a.workplace === 'office' || label.includes('desk')) return 'type'
      if (a.workplace === 'shop' || label.includes('stall')) return hash01(a.seed + Math.floor(hour * 5)) < 0.3 ? 'phone' : 'talk'
      if (a.workplace === 'school') return 'talk'
      return 'work'
    }
  }
  return 'stand'
}
const SITS = new Set<Action>(['sit', 'type', 'pray'])

// the seat under a sitting station: what kind of furniture a place has there
export function seatFor(stop: Stop, action: Action): Seat | null {
  if (!SITS.has(action) || stop.station.pose === 'lie') return null
  const label = stop.station.label
  const kind: SeatKind = action === 'pray' ? 'mat' : label.includes('bench by the door') ? 'stoop' : label.includes('bench') || stop.lot.kind === 'school' ? 'bench' : label.includes('stall') ? 'stool' : 'chair'
  const x = stop.station.pos.x * K, z = stop.station.pos.z * K
  return { key: `${stop.lot.id}:${x.toFixed(2)}:${z.toFixed(2)}`, x, z, h: SEAT_H[kind], facing: stop.station.facing, kind, lotId: stop.lot.id, indoors: stop.lot.kind !== 'home' || !label.includes('door') }
}

const V = () => new THREE.Vector3()
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _m = new THREE.Matrix4()
const yawRoot = (out: THREE.Matrix4, x: number, z: number, heading: number, y = 0) => out.compose(V().set(x, y, z), _q.setFromEuler(_e.set(0, heading, 0)), _s)

export class Population {
  agents: Agent[] = []
  key = ''
  seats = new Map<string, Seat>() // every seat anyone uses today (furniture stays when they stand up)
  private pass = Array.from({ length: 30 }, () => ({ presence: 0, phase: 0, street: '', last: V(), started: false, sol: makeSolved(), heading: undefined as number | undefined, s: undefined as number | undefined, lat: undefined as number | undefined, walkT: 0 as number | undefined, latV: 0 as number | undefined, pose: null as Pose | null, on: false, v: 0, wasMoving: false, cutCheck: false, stoodT: 0 as number | undefined, stoodPrev: 0 as number | undefined, feet: null as FootLock | null }))
  private stillBuf = new Float32Array(400)
  readonly MAX = 110
  readonly fabric: Fabric
  readonly solids: Solid[]
  private lots: Map<number, Lot>
  constructor(readonly record: LifeRecord, readonly layout: Layout, readonly style: CityStyle, cityId: string) {
    this.fabric = buildFabric(layout, style, cityId)
    this.solids = fabricSolids(this.fabric)
    // the crowd lives in the row houses around her (a household of about five per house, ESTIMATE near the
    // 4.8 average household in urban tanzania, nbs 2022), each house a lot of its own with its door on the lane
    const proto = layout.homes[0]
    const homeUnits = this.fabric.units.filter(u => u.lotId === null).sort((a, b) => hash01(a.id + record.seed) - hash01(b.id + record.seed))
    this.crowdHomes = homeUnits.map(u => ({ ...proto, id: u.id, kind: 'home' as const, x: u.x / K, z: u.z / K, w: u.w / K, d: u.d / K, floors: u.storeys, door: { x: u.x / K, z: (u.z + u.face * (u.d / 2 + FACADE_FROM_STREET)) / K } }))
    // next door to her: the house beside hers on the same side of the lane
    const mine = this.fabric.units.find(u => u.lotId === layout.homes[0].id)
    this.nextDoor = mine ? this.crowdHomes.filter(l => Math.abs(l.z - mine.z / K) < 0.05).sort((a, b) => Math.abs(a.x - mine.x / K) - Math.abs(b.x - mine.x / K))[0] ?? null : null
    this.lots = new Map([...layout.lots, ...this.crowdHomes].map(l => [l.id, l]))
  }
  private crowdHomes: Lot[] = []
  private booked = new Map<number, number>() // market half-hours -> people booked
  private bookDay = -1
  private lastHour: number | null = null
  private lastPass: { j: number; x: number; z: number; h: number; body: Body; cut: boolean }[] = []
  // a quarter of the standing spots at once: room to walk in, browse and walk out through one entrance
  private get marketCap() { const m = this.layout.byKind.get('market'); return m ? Math.floor((spotsAt(m, 'shop')?.length ?? 10) * 0.25) : 999 }
  private nextDoor: Lot | null = null

  private cast(W: WorldNow): Agent[] {
    const { record, layout, style } = this
    const r = (n: number) => hash01(n + record.seed)
    const pick = <T,>(xs: T[], n: number) => xs[Math.floor(r(n) * xs.length) % xs.length]
    const out: Agent[] = []
    const mk = (o: { id: string; role: Role; kinId?: string; name: string; age: number; sex: 'female' | 'male'; home: Lot; workplace: Workplace; slot: number; activity: Agent['activity'] }, k: number): Agent => {
      const female = o.sex === 'female', adult = o.age >= 16
      return {
        ...o, seed: k * 3.17, body: bodyFor(o.age, female ? 158 + r(k) * 10 : 167 + r(k) * 12, r(k + 1) < 0.25 ? 'slim' : r(k + 1) > 0.85 ? 'broad' : 'average'),
        look: {
          skin: Math.max(0, Math.min(9, record.look.skinTone - 1 + Math.round((r(k + 2) - 0.5) * 4))),
          shirt: pick(style.clothes, k + 3), lower: female && adult && r(k + 4) < 0.7 ? pick(style.clothes, k + 5) : pick(CLOTHES_LOWER, k + 6),
          hair: o.age > 62 ? 'gray' : 'black', wrap: female && adult && r(k + 7) < 0.6, sleeves: style.jackets || r(k + 8) < 0.3,
        },
        lane: (r(k + 9) - 0.5) * 0.025, vendor: adult && o.role === 'crowd' && r(k + 10) < (style.kind === 'tana' ? 0.08 : 0.22), sweeper: o.role === 'crowd' && female && adult && r(k + 11) < 0.35,
        babyOnBack: o.role === 'crowd' && female && adult && o.age < 40 && r(k + 12) < 0.15,
        pos: V().set(o.home.x * K, 0, o.home.z * K), heading: 0, presence: 0, phase: r(k + 13), last: V(), started: false, pose: null, sol: makeSolved(),
      }
    }
    const parentsHome = layout.homes[1] ?? layout.homes[0]
    const herAge = W.tick / 12
    W.kin.forEach((f, i) => {
      const together = f.relation === 'partner' || f.relation === 'child' || herAge < 20
      const home = f.relation === 'grandchild' ? (layout.homes[3] ?? parentsHome) : together ? layout.homes[0] : parentsHome
      const activity: Agent['activity'] = f.age < 5 ? 'infant' : f.age < 18 ? 'school' : f.age >= 63 ? 'retired' : 'working'
      out.push(mk({ id: f.id, role: 'kin', kinId: f.id, name: f.name, age: f.age, sex: f.sex, home, workplace: pick(WORKPLACES, i * 31), slot: i + 1, activity }, i + 1))
    })
    // a small child in her family goes out with the mother (or whoever is home in the day); while she has small kids
    // at home, that grown-up keeps a caregiver's day (home, market, the lane), not a job across town
    const kinKids = out.filter(a => a.role === 'kin' && a.age < 8)
    const herSmall = herAge < 8
    if (kinKids.length || herSmall) {
      // on an occasion day the child goes with a grown-up who is going (a newborn with the other parent at the clinic)
      const going = W.occasion ? out.find(a => a.role === 'kin' && a.age >= 16 && W.occasion!.who.includes(a.kinId ?? '')) : undefined
      const g = going ?? out.find(a => a.kinId === 'mother' && a.age >= 16) ?? out.find(a => a.role === 'kin' && a.age >= 16 && a.activity !== 'working') ?? out.find(a => a.role === 'kin' && a.age >= 16)
      if (g) { for (const k of kinKids) k.guardian = g.id; if (g.activity === 'working' && (kinKids.some(k => k.age < 5) || herAge < 5)) g.activity = 'caregiver' }
    }
    const herWork = layout.lots.find(l => l.id === W.workLotId)
    const herWp: Workplace | null = herWork ? (herWork.kind === 'market' ? 'shop' : (herWork.kind as Workplace)) : null
    if (herWork && herWp) for (let i = 0; i < 5; i++) out.push(mk({ id: `co${i}`, role: 'coworker', name: '', age: 24 + r(i * 7) * 30, sex: r(i * 5) < 0.5 ? 'female' : 'male', home: layout.homes[2 + (i % 8)] ?? layout.homes[0], workplace: herWp, slot: i + 1, activity: 'working' }, 50 + i))
    const others = WORKPLACES.filter(w => w !== herWp)
    const n = Math.round(34 + 70 * W.density)
    let lastCaregiver: Agent | null = null
    for (let i = 0; i < n; i++) {
      const kid = r(i * 13 + 100) < 0.32
      const age = kid ? 5 + r(i) * 12 : 18 + r(i * 3) * 55
      const homes = this.crowdHomes.length ? this.crowdHomes : layout.homes
      const home = i === 0 && this.nextDoor ? this.nextDoor : homes[Math.floor((i - 1 + homes.length * 5) / 5) % homes.length]
      let activity: Agent['activity'] = age < 18 ? 'school' : age > 63 ? 'retired' : r(i * 5) < 0.18 ? 'unemployed' : 'working'
      const a = mk({ id: `p${i}`, role: i === 0 ? 'neighbor' : 'crowd', name: '', age, sex: r(i * 29) < 0.52 ? 'female' : 'male', home, workplace: others[Math.floor(r(i * 17) * others.length)], slot: 8 + i, activity }, 200 + i)
      // a crowd child under 8 goes out with a grown-up from their own house (the last adult cast there, kept home
      // as a caregiver); if there is none, the child is a bit older (school age walks on their own)
      if (age < 8) {
        if (lastCaregiver && lastCaregiver.home.id === home.id) { a.guardian = lastCaregiver.id; lastCaregiver.activity = 'caregiver' }
        else { a.age = 8 + r(i * 19) * 6; a.body = bodyFor(a.age, a.sex === 'female' ? 158 : 167, 'average') }
      }
      if (age >= 18) lastCaregiver = a
      activity = a.activity
      out.push(a)
    }
    const sliced = out.slice(0, this.MAX)
    // everyone's own place at work: numbered in turn per kind of workplace (her coworkers after her, at 1..)
    const per = new Map<string, number>()
    for (const a of sliced) { if (a.activity !== 'working') continue; // (family who work there too: one numbering for everyone)
      const k = a.role === 'coworker' ? 'her' : a.workplace; const n = per.get(k) ?? (k === 'her' ? 1 : 0); a.workSlot = n; per.set(k, n + 1) }
    return sliced
  }

  // the caregiver's day: home, the market, the lane out front. the market trip is when a child sees the street
  private defsFor(a: Agent, W: WorldNow) {
    const defs = this.dayFor(a, W)
    // a first meeting, a birth, a funeral: the family who are there go, at the same hours (her own house is 'hers')
    const occ = W.occasion
    if (occ && a.kinId && occ.who.includes(a.kinId) && a.age >= 8) return withOccasion(defs, { ...occ, at: occ.at === 'home' && a.home.id !== this.layout.homes[0].id ? 'hers' : occ.at }, occ.who.indexOf(a.kinId) + 1)
    return defs
  }
  private dayFor(a: Agent, W: WorldNow) {
    const weekend = W.day % 7 >= 5
    if (a.activity === 'caregiver') return [{ hour: 0, at: 'home' as const, act: 'sleep' as Act }, { hour: 6.2, at: 'home' as const, act: 'cook' as Act }, { hour: 7.6, at: 'home' as const, act: 'chat' as Act }, { hour: 9.5, at: 'market' as const, act: 'shop' as Act }, { hour: 11.2, at: 'home' as const, act: 'cook' as Act }, { hour: 13, at: 'home' as const, act: 'rest' as Act }, { hour: 16.5, at: 'home' as const, act: 'chat' as Act }, { hour: 18, at: 'home' as const, act: 'cook' as Act }, { hour: 19.3, at: 'home' as const, act: 'eat' as Act }, { hour: 21.5, at: 'home' as const, act: 'sleep' as Act }]
    const hosts = a.role === 'kin' && a.home.id === (this.layout.homes[1] ?? this.layout.homes[0]).id && W.tick >= 240
    const sched = a.activity
    let defs = schedule(sched, { kids: false, weekend, religious: false, visit: weekend && hosts, age: a.age })
    // mornings in the lane: some sweep their doorstep, some stand out front talking before the day starts
    // a weekend market trip: about half the households go on a given weekend, at any time from early morning to late
    // afternoon (ESTIMATE); the others stay around the house
    if (weekend) defs = defs.map(d => {
      if (d.at !== 'market' || d.act !== 'shop') return d
      const hh = a.home.id * 7.13 + W.day
      return hash01(hh) < 0.5 ? { ...d, hour: 7.5 + hash01(hh + 3) * 9 } : { ...d, at: 'home' as const, act: 'rest' as Act }
    }).sort((x, y) => x.hour - y.hour)
    if (a.sweeper && !weekend) defs = [...defs.filter(d => d.hour < 6.6 || d.hour > 8.4), { hour: 6.7, at: 'home' as const, act: 'sweep' as Act }, { hour: 7.4, at: 'home' as const, act: 'chat' as Act }].sort((x, y) => x.hour - y.hour)
    return defs
  }

  private insideAny(x: number, z: number) { const pt = V().set(x, 0.3, z); return this.solids.some(s => (s.kind === 'wall' || s.kind === 'special') && s.box.containsPoint(pt)) }
  // a cut (a dip to the next moment, a seek, a new city): everyone is simply where they are in the new moment, no
  // walking over from where they were before the cut
  cut() {
    this.cutPending = true
    for (const a of this.agents) { a.started = false; (a as Agent & { feet?: FootLock }).feet = undefined }
    for (const P of this.pass) { P.started = false; P.cutCheck = true; P.feet = null }
  }
  private cutPending = false
  private blocked(x: number, z: number, r = 0.14) {
    for (const s of this.solids) if (s.kind !== 'eave' && x + r > s.box.min.x && x - r < s.box.max.x && z + r > s.box.min.z && z - r < s.box.max.z) return true
    return false
  }
  private nudge(p: { x: number; z: number }, dx: number, dz: number) {
    const x = p.x + dx, z = p.z + dz
    if (this.blocked(x, z)) return
    p.x = x; p.z = z
  }
  // one frame: every body placed, posed and solved. `inView(x, z)` is the renderer's own visibility (camera line);
  // the qa script passes () => 1
  step(W: WorldNow, L: LiveState, t: number, dt: number, cap = this.MAX, vehicles: { x: number; z: number; w: number; l: number; heading: number }[] = []): Placed[] {
    const { record, layout } = this
    const k = `${W.cityId}:${W.kin.map(f => f.id).join(',')}:${W.workLotId}:${W.tick < 96 ? 'small' : 'big'}:${W.occasion?.day ?? ''}`
    if (k !== this.key) {
      const prev = new Map(this.agents.map(a => [a.id, a]))
      this.key = k
      this.agents = this.cast(W).map(a => { const p = prev.get(a.id); return p ? { ...a, pos: p.pos, heading: p.heading, presence: p.presence, phase: p.phase, last: p.last, started: p.started, pose: p.pose, plan: p.plan && p.plan.day === W.day ? undefined : undefined } : a })
    }
    const out: Placed[] = []
    const byId = new Map<string, Agent>()
    for (const a of this.agents) byId.set(a.id, a)
    const isHeld = L.pose === 'held'
    const herBody = bodyFor(L.age, record.look.adultHeightCm, record.look.build)
    // first pass: where everyone is and what they are doing
    type Pre = { escort?: boolean; companion?: boolean; beside?: boolean; px: number; pz: number; a: Agent; w: Where; x: number; z: number; heading: number; action: Action; holding: string | null; heldBy: string | null; seat: Seat | null; door: THREE.Vector3 | null; shown: boolean }
    const pres: Pre[] = []
    let replans = 0
    for (const a of this.agents) {
      if (!a.plan || (a.plan.day !== W.day && replans++ < 12)) {
        let defs = this.defsFor(a, W)
        // the market holds so many at once: a trip planned for a full half hour moves to the nearest one with room
        // (people come earlier or later), or is skipped for a rest at home
        if (this.bookDay !== W.day) { this.bookDay = W.day; this.booked.clear() }
        defs = defs.map((d, i) => {
          if (d.at !== 'market' || (d.act !== 'shop' && d.act !== 'eat')) return d
          const end = defs[i + 1]?.hour ?? d.hour + 1
          const fits = (h: number) => { for (let b = Math.floor(h * 2); b < Math.ceil((h + end - d.hour) * 2); b++) if ((this.booked.get(b) ?? 0) >= this.marketCap) return false; return true }
          let h = d.hour
          if (!fits(h)) { const alt = [-0.5, 0.5, -1, 1, -1.5, 1.5].map(o => d.hour + o).find(x => x > (defs[i - 1]?.hour ?? 0) + 0.3 && x + (end - d.hour) < (defs[i + 1]?.hour ?? 24) + 2 && fits(x)); if (alt === undefined) return { ...d, at: 'home' as const, act: 'rest' as Act }; h = alt }
          for (let b = Math.floor(h * 2); b < Math.ceil((h + end - d.hour) * 2); b++) this.booked.set(b, (this.booked.get(b) ?? 0) + 1)
          return { ...d, hour: h }
        }).sort((x, y) => x.hour - y.hour)
        // (family at an occasion keep its hours and stand next to her: slots 1, 2, ... beside her slot 0)
        const at = W.occasion && a.kinId ? W.occasion.who.indexOf(a.kinId) : -1
        const jitter = at >= 0 ? 0 : (hash01(a.slot * 13 + W.day + a.seed) - 0.5) * 0.9
        const plan = planDay(layout, a.home, defs.map((d, i) => ({ ...d, hour: i ? Math.max(0.1, d.hour + jitter) : 0 })), a.workplace, a.slot, false, a.workSlot) // the crowd walks: the minibuses they would ride run on the main roads, out of this lane
        a.plan = { day: W.day, plan }
        ;(a as Agent & { lag?: number }).lag = 0 // a new day: on time again
        // the furniture of this day: a seat at every sitting station they will use
        for (const s of plan.stops) { const st = seatFor(s, actionAt(a, { moving: false, stop: s } as Where, s.hour)); if (st) this.seats.set(st.key, st) }
      }
      const w = whereIn(a.plan.plan, W.hour - ((a as Agent & { lag?: number }).lag ?? 0), a.lane)
      pres.push({ px: 0, pz: 0, a, w, x: w.pos.x, z: w.pos.z, heading: w.heading, action: actionAt(a, w, W.hour), holding: null, heldBy: null, seat: null, door: null, shown: !w.onBus })
    }
    const pre = new Map(pres.map(p => [p.a.id, p]))
    // she herself (2 to 7) standing out at a place (the market, the square): her grown-up is at the free spot nearest
    // to her (they are at the same place, doing the same thing, one spot over)
    if (!isHeld && L.age < 8 && !W.indoors && L.pos.y < 0.2 && !L.walking) {
      const gp = pres.find(q => q.a.kinId === 'mother') ?? pres.find(q => q.a.role === 'kin' && q.a.age >= 16)
      const lot = this.lots.get(W.lotId)
      if (gp && lot) { gp.w = { ...gp.w, moving: false, leg: null, indoors: false, stop: { ...gp.w.stop, hour: -1, act: L.act as Act, lot, station: { pos: { x: L.pos.x / K, z: L.pos.z / K }, facing: L.heading, pose: 'stand', label: 'beside her' } } }; gp.x = L.pos.x + 0.5; gp.z = L.pos.z; gp.action = 'stand'; gp.seat = null }
    }
    // taking a spot: on arrival at a place with many spots (a market, a classroom, the step by a door), everyone takes
    // a free one (their usual one when it is free, else the nearest free one) and keeps it until they leave
    const taken = new Map<string, string>() // `${lot}:${kind}:${index}` -> agent id
    for (const p of pres) { const sp = (p.a as Agent & { spot?: { key: string; i: number; stop: number } }).spot; if (sp && !p.w.moving && sp.stop === p.w.stop.hour) taken.set(`${sp.key}:${sp.i}`, p.a.id) }
    // her own place is taken too (where she stands, sits or plays)
    const herAt = (spots: { x: number; z: number }[], key: string) => { if (L.walking) return; for (let i = 0; i < spots.length; i++) if (Math.hypot(spots[i].x * K - (L.seat?.x ?? L.pos.x), spots[i].z * K - (L.seat?.z ?? L.pos.z)) < 0.4) taken.set(`${key}:${i}`, 'her') }
    for (const p of pres) {
      const a = p.a as Agent & { spot?: { key: string; i: number; stop: number } }
      if (p.w.moving || p.w.leg) { a.spot = undefined; continue }
      const spots = spotsAt(p.w.stop.lot, p.w.stop.act)
      if (!spots || !spots.length) { a.spot = undefined; continue }
      const key = `${p.w.stop.lot.id}:${p.w.stop.lot.kind === 'market' ? (p.w.stop.act === 'work' ? 'v' : 'a') : p.w.stop.lot.kind === 'home' ? `home-${p.w.stop.act}` : 'g'}`
      herAt(spots, key)
      // (a spot she has just come to stand on is hers now: whoever had it moves to another)
      if (a.spot && taken.get(`${a.spot.key}:${a.spot.i}`) === 'her') a.spot = undefined
      if (!a.spot || a.spot.key !== key || a.spot.stop !== p.w.stop.hour) {
        // their usual spot: the one their plan names (their own place at work), else by their number
        let want = a.slot % spots.length, wd = Infinity
        for (let i = 0; i < spots.length; i++) { const d = Math.hypot(spots[i].x - p.w.stop.station.pos.x, spots[i].z - p.w.stop.station.pos.z); if (d < wd) { wd = d; want = i } }
        let best = -1, bd = Infinity
        for (let i = 0; i < spots.length; i++) { if (taken.has(`${key}:${i}`)) continue; const d = Math.hypot(spots[i].x - spots[want].x, spots[i].z - spots[want].z); if (d < bd) { bd = d; best = i } }
        // full (more vendors than stall places, more shoppers than the aisle holds): they stand where there is room in
        // the rest of the place instead of on top of someone
        if (best < 0) {
          const extra = spotsAt({ ...p.w.stop.lot, kind: 'square' }, 'sit') ?? []
          const k2 = `${p.w.stop.lot.id}:x`
          let bi = -1, bd2 = Infinity
          const inside = p.w.stop.lot.kind === 'home' // (inside a house its own walls are around everything; only others' solids count)
          // (overflow spots can coincide with the place's own: anything within a shoulder of a taken spot is taken)
          // (and never on anyone's own place in the main list: a vendor walking back to their place still has it)
          const occupied = [...pres.filter(q => q !== p && !q.w.moving).map(q => ({ x: q.x / K, z: q.z / K })), ...spots]
          for (let i = 0; i < extra.length; i++) { if (taken.has(`${k2}:${i}`) || occupied.some(o => Math.hypot(o.x - extra[i].x, o.z - extra[i].z) < 0.42 / K) || (!inside && this.blocked(extra[i].x * K, extra[i].z * K, 0.32)) || (inside && !this.insideAny(extra[i].x * K, extra[i].z * K))) continue; const d = Math.hypot(extra[i].x - spots[want].x, extra[i].z - spots[want].z); if (d < bd2) { bd2 = d; bi = i } }
          if (bi >= 0) { a.spot = { key: k2, i: bi, stop: p.w.stop.hour }; taken.set(`${k2}:${bi}`, a.id); const s2 = extra[bi]; p.w = { ...p.w, pos: { x: s2.x * K, z: s2.z * K }, stop: { ...p.w.stop, station: { ...p.w.stop.station, pos: s2 } } }; p.x = s2.x * K; p.z = s2.z * K; continue }
          best = want
        }
        a.spot = { key, i: best, stop: p.w.stop.hour }
        taken.set(`${key}:${best}`, a.id)
      }
      const s = spots[a.spot.i]
      p.w = { ...p.w, pos: { x: s.x * K, z: s.z * K }, stop: { ...p.w.stop, station: { ...p.w.stop.station, pos: s } } }
      p.x = s.x * K; p.z = s.z * K
    }
    // nobody shares a place: two people holding spots within a shoulder of each other, the later one takes the nearest
    // free spot instead (whatever path got them both there)
    {
      // (people standing in a place of their own that isn't a spot, a coworker at the stalls, a vendor, are where they
      // are: the spot holders make room around them)
      const held: { p: Pre; x: number; z: number }[] = pres.filter(p => !p.w.moving && !(p.a as Agent & { spot?: unknown }).spot).map(p => ({ p, x: p.x, z: p.z }))
      for (const p of pres) {
        const a = p.a as Agent & { spot?: { key: string; i: number; stop: number } }
        if (!a.spot || p.w.moving) continue
        const clash = held.find(h => Math.hypot(h.x - p.x, h.z - p.z) < 0.4)
        if (clash) {
          const spots = spotsAt(p.w.stop.lot, p.w.stop.act) ?? []
          let best = -1, bd = Infinity
          for (let i = 0; i < spots.length; i++) {
            const sx = spots[i].x * K, sz = spots[i].z * K
            if (held.some(h => Math.hypot(h.x - sx, h.z - sz) < 0.4) || Math.hypot(sx - L.pos.x, sz - L.pos.z) < 0.4) continue
            const d = Math.hypot(sx - p.x, sz - p.z); if (d < bd) { bd = d; best = i }
          }
          if (best >= 0) { a.spot = { ...a.spot, i: best }; const s2 = spots[best]; p.w = { ...p.w, pos: { x: s2.x * K, z: s2.z * K }, stop: { ...p.w.stop, station: { ...p.w.stop.station, pos: s2 } } }; p.x = s2.x * K; p.z = s2.z * K }
        }
        held.push({ p, x: p.x, z: p.z })
      }
    }
    // a cut lands everyone where they are in the new moment; two walkers who would land on each other are not on the
    // same spot in life: the later one is a few steps behind on their own way (a small lag that stays with them today)
    if (this.cutPending) for (let i = 0; i < pres.length; i++) {
      const p = pres[i]
      if (!p.w.moving) continue
      const ag = p.a as Agent & { lag?: number }
      for (let tries = 0; tries < 12; tries++) {
        const hit = pres.some((q, j) => j !== i && Math.hypot(q.x - p.x, q.z - p.z) < 0.45 && q.w.indoors === p.w.indoors) || (!isHeld && Math.hypot(L.pos.x - p.x, L.pos.z - p.z) < 0.45)
        if (!hit) break
        ag.lag = (ag.lag ?? 0) + 0.004
        p.w = whereIn(p.a.plan!.plan, W.hour - ag.lag, p.a.lane); p.x = p.w.pos.x; p.z = p.w.pos.z; p.heading = p.w.heading
      }
    }
    // the chosen baby's carrier, and the neighbor she talks to out front
    for (const p of pres) {
      const a = p.a
      if (isHeld && a.kinId && a.kinId === L.carrier) { p.x = L.pos.x; p.z = L.pos.z; p.heading = L.heading; p.action = L.walking ? 'walk' : L.seat ? 'sit' : 'hold_baby'; p.holding = 'her'; if (L.seat && !L.walking) { p.seat = L.seat; p.x = L.seat.x; p.z = L.seat.z }; p.w = { ...p.w, moving: L.walking, indoors: W.indoors, stop: { ...p.w.stop, lot: layout.lots.find(l => l.id === W.lotId) ?? p.w.stop.lot } } }
      if (isHeld && a.role === 'neighbor' && L.act === 'chat' && !L.walking) { p.x = L.pos.x + Math.sin(L.heading) * 0.95; p.z = L.pos.z + Math.cos(L.heading) * 0.95; p.heading = L.heading + Math.PI; p.action = 'talk'; p.w = { ...p.w, moving: false, indoors: false } }
    }
    // seats and doors
    for (const p of pres) {
      if (SITS.has(p.action)) { p.seat = p.seat ?? seatFor(p.w.stop, p.action); if (p.seat) { this.seats.set(p.seat.key, p.seat); p.x = p.seat.x; p.z = p.seat.z } }
      // the door they are near: of the place they are leaving or going into (the doorway itself is where the threshold
      // is: the point straight in from the door at the building's front, between the door point and the inside)
      const doors = [p.w.stop.lot, p.w.from?.lot].filter(Boolean).map(l => V().set(l!.door.x * K, 0, l!.door.z * K))
      p.door = doors.sort((u, v) => Math.hypot(u.x - p.x, u.z - p.z) - Math.hypot(v.x - p.x, v.z - p.z))[0] ?? null
    }
    // kin babies (a little brother or sister under 1.5) are in their mother's arms
    for (const p of pres) {
      if (p.a.role !== 'kin' || p.a.age >= 1.5) continue
      // her own baby: the other parent (or whoever is at today's occasion with the baby); a little sibling: their mother
      const occ = W.occasion?.who.includes(p.a.kinId ?? '') ? W.occasion : null
      const rel = W.kin.find(k => k.id === p.a.kinId)?.relation
      const mom = (occ ? pres.find(q => q.a.role === 'kin' && q.a.age >= 16 && !q.holding && occ.who.includes(q.a.kinId ?? '')) : undefined)
        ?? (rel === 'child' ? pres.find(q => q.a.role === 'kin' && W.kin.find(k => k.id === q.a.kinId)?.relation === 'partner' && !q.holding) : undefined)
        ?? pres.find(q => q.a.kinId === 'mother' && !q.holding) ?? pres.find(q => q.a.role === 'kin' && q.a.age >= 16 && !q.holding)
      if (!mom) continue
      mom.holding = p.a.id; if (mom.action !== 'walk' && mom.action !== 'lie') mom.action = 'hold_baby'
      p.heldBy = mom.a.id; p.action = 'held'; p.x = mom.x; p.z = mom.z; p.heading = mom.heading; p.w = mom.w
    }
    // small children beside their grown-up whenever either of them is out of the house
    const childBeside = (p: Pre, g: { x: number; z: number; heading: number; walking: boolean; indoors: boolean; lot: Lot; seat?: Seat | null; id?: string }) => {
      // on whichever side is open (never pressed into a wall or onto a stoop)
      let lx = Math.cos(g.heading), lz = -Math.sin(g.heading)
      if (this.blocked(g.x + lx * 0.42, g.z + lz * 0.42, 0.22)) { lx = -lx; lz = -lz }
      p.x = g.x + lx * 0.42 - Math.sin(g.heading) * 0.08; p.z = g.z + lz * 0.42 - Math.cos(g.heading) * 0.08
      p.heading = g.heading; p.action = g.walking ? 'walk' : 'stand'; p.beside = true
      // (when the grown-up turns, the place at their side swings round: the child walks to it, never carried round)
      if (g.walking && p.a.started && !this.cutPending) {
        const dx = p.x - p.a.last.x, dz = p.z - p.a.last.z, d = Math.hypot(dx, dz), m = 1.9 * dt
        if (d > m * 1.4 && d < 2) { p.x = p.a.last.x + dx / d * m; p.z = p.a.last.z + dz / d * m }
      }
      // a grown-up sitting: the child sits beside them on the same bench or step
      if (g.seat) {
        // the free side of them on the bench or step; both taken, the child stands in front of them
        const taken = (x: number, z: number) => pres.some(q => q !== p && q.a.id !== g.id && Math.hypot(q.x - x, q.z - z) < 0.36)
        let sx = g.seat.x + lx * 0.4, sz = g.seat.z + lz * 0.4
        if (taken(sx, sz)) { sx = g.seat.x - lx * 0.4; sz = g.seat.z - lz * 0.4 }
        if (taken(sx, sz) || this.blocked(sx, sz, 0.05) && g.seat.kind !== 'stoop') { p.x = g.seat.x + Math.sin(g.seat.facing) * 0.45; p.z = g.seat.z + Math.cos(g.seat.facing) * 0.45; p.heading = g.seat.facing + Math.PI; p.action = 'stand' }
        else { p.x = sx; p.z = sz; p.action = 'sit'; p.seat = { ...g.seat, key: `${g.seat.key}+`, x: sx, z: sz } }
      }
      p.w = { ...p.w, moving: g.walking, indoors: g.indoors, stop: { ...p.w.stop, lot: g.lot } }
    }
    for (const p of pres) {
      if (p.a.age >= 8 || p.heldBy || !p.a.guardian) continue
      const g = pre.get(p.a.guardian)
      if (!g) continue
      // a small child goes where their grown-up goes: beside them when they are out, home with them when they are in
      // (and under five, right beside them indoors too: a toddler is not off at a station of their own)
      const childOut = !p.w.indoors, gOut = !g.w.indoors
      if ((gOut && !this.insideAny(g.x, g.z)) || p.a.age < 5) childBeside(p, { id: g.a.id, x: g.a.started ? g.a.last.x : g.x, z: g.a.started ? g.a.last.z : g.z, heading: g.heading, walking: g.action === 'walk', indoors: g.w.indoors, lot: g.w.stop.lot, seat: g.seat })
      else if (childOut || p.w.stop.lot.id !== g.w.stop.lot.id) { p.x = g.x + 0.45; p.z = g.z; p.heading = g.heading; p.action = 'stand'; p.seat = null; p.w = { ...p.w, moving: false, indoors: true, stop: { ...p.w.stop, lot: g.w.stop.lot } } }
    }
    // her siblings under 8 out front with the carrier stand at the carrier's side
    if (isHeld && (L.act === 'chat' || L.seat) && !L.walking && !W.indoors) for (const p of pres) if (p.a.role === 'kin' && p.a.age >= 1.5 && p.a.age < 8 && p.a.kinId !== L.carrier) childBeside(p, { x: L.pos.x, z: L.pos.z, heading: L.heading + 0.4, walking: false, indoors: false, lot: p.w.stop.lot, seat: L.seat })
    // she herself (2 to 7) walking out: her grown-up walks beside her
    // she herself (2 to 7) out of the house (walking, at the market, in the lane): her grown-up is right beside her
    if (!isHeld && L.age < 8 && !W.indoors && L.pos.y < 0.2 && L.walking) {
      const gp = pres.find(q => q.a.kinId === 'mother') ?? pres.find(q => q.a.role === 'kin' && q.a.age >= 16)
      if (gp) { gp.escort = true; const lx = Math.cos(L.heading), lz = -Math.sin(L.heading); gp.x = L.pos.x - lx * 0.5; gp.z = L.pos.z - lz * 0.5; gp.heading = L.heading; gp.action = L.walking ? 'walk' : 'stand'; gp.w = { ...gp.w, moving: L.walking, indoors: false }; gp.seat = null }
    }
    // family walking the same way as her, close by, walk with her: side by side (one each side of her), the rest just
    // behind. (siblings set off together; they do not walk in single file pressed into each other)
    if (!isHeld && L.walking && W.lotId >= 0) {
      const lx = Math.cos(L.heading), lz = -Math.sin(L.heading), fx = Math.sin(L.heading), fz = Math.cos(L.heading)
      const taken = pres.some(q => q.escort) ? [-1] : []
      const used: [number, number][] = []
      let k = 0
      for (const q of pres) {
        if (q.a.role !== 'kin' || q.escort || q.holding || q.heldBy || !q.w.moving || q.w.stop.lot.id !== W.lotId || Math.hypot(q.x - L.pos.x, q.z - L.pos.z) > 2.2) continue
        const slots: [number, number][] = [[1, 0], [-1, 0], [0.5, -0.6], [-0.5, -0.6], [0, -1.1]]
        // (a place beside her that is out in the middle of the lane, where the vehicles go, is not a place: behind instead)
        const inTraffic = (sx: number, sb: number) => { const x = L.pos.x + lx * sx * 0.62 + fx * sb, z = L.pos.z + lz * sx * 0.62 + fz * sb; const nx = STREETS_W.reduce((b, s) => (Math.abs(s - x) < Math.abs(b - x) ? s : b)), nz = STREETS_W.reduce((b, s) => (Math.abs(s - z) < Math.abs(b - z) ? s : b)); return Math.min(Math.abs(x - nx), Math.abs(z - nz)) < 0.85 }
        // (nor a place on someone's stoop or in a wall)
        const onSolid = (sx: number, sb: number) => this.blocked(L.pos.x + lx * sx * 0.62 + fx * sb, L.pos.z + lz * sx * 0.62 + fz * sb, 0.2)
        const ok = ([sx, sb]: [number, number]) => !(sb === 0 && taken.includes(sx)) && !inTraffic(sx, sb) && !onSolid(sx, sb) && !used.some(u => u[0] === sx && u[1] === sb)
        // each keeps the place they had while it is still a place (no swapping sides every few steps)
        const qa = q.a as Agent & { comp?: [number, number]; compT?: [number, number]; compBad?: number }
        // (a place that is only briefly near the lane, as she rounds a corner, is kept for a moment: switching sides on
        // every flicker sends them zigzagging behind her. a wall or a stoop in the place is never kept)
        const near = (sx: number, sb: number) => { const x = L.pos.x + lx * sx * 0.62 + fx * sb, z = L.pos.z + lz * sx * 0.62 + fz * sb; return pres.some(o => o !== q && !o.escort && Math.hypot(o.x - x, o.z - z) < 0.5) }
        const keep = (s: [number, number]) => ok(s) || (!onSolid(s[0], s[1]) && !near(s[0], s[1]) && !used.some(u => u[0] === s[0] && u[1] === s[1]) && (qa.compBad ?? 0) < 0.6)
        const cur = qa.compT ?? qa.comp
        qa.compBad = cur && !ok(cur) ? (qa.compBad ?? 0) + dt : 0
        const sl = qa.comp && keep(qa.comp) ? qa.comp : qa.compT && keep(qa.compT) ? qa.compT : slots.filter(ok)[0]
        if (!sl) { qa.comp = undefined; qa.compT = undefined; continue }
        used.push(sl); k++
        q.escort = true; q.companion = true; q.heading = L.heading; q.action = 'walk'
        const tx = L.pos.x + lx * sl[0] * 0.62 + fx * sl[1], tz = L.pos.z + lz * sl[0] * 0.62 + fz * sl[1]
        // (held in her frame only while that is a walking step: when she turns on a corner, a place beside her swings
        // round, and they walk to it instead of being carried through the turn)
        if (!q.a.started || (qa.comp && qa.comp === sl && Math.hypot(tx - q.a.last.x, tz - q.a.last.z) < 2.6 * dt)) { q.x = tx; q.z = tz }
        else {
          // into a new place at a walk, never a jump, and around behind her rather than through her
          const mx = (q.a.last.x + tx) / 2, mz = (q.a.last.z + tz) / 2
          const via = Math.hypot(mx - L.pos.x, mz - L.pos.z) < 0.45 ? { x: L.pos.x - fx * 0.7, z: L.pos.z - fz * 0.7 } : { x: tx, z: tz }
          let dx = via.x - q.a.last.x, dz = via.z - q.a.last.z
          // (a place further back than they are: nobody turns round and walks back to it. they let her go on ahead,
          // only stepping sideways into line, and the place comes to them)
          const back = Math.hypot(q.a.last.x - L.pos.x, q.a.last.z - L.pos.z) > 0.6 ? dx * fx + dz * fz : 0
          if (back < 0) { dx -= fx * back; dz -= fz * back }
          const d = Math.hypot(dx, dz), m = 1.9 * dt
          q.x = d > m ? q.a.last.x + dx / d * m : q.a.last.x + dx; q.z = d > m ? q.a.last.z + dz / d * m : q.a.last.z + dz
          if (back < 0 && d < 0.02) q.action = 'stand'
          qa.compT = sl
          if (Math.hypot(q.x - tx, q.z - tz) < 0.02) { qa.comp = sl; qa.compT = undefined }
          continue
        }
        qa.comp = sl
      }
    }
    // someone who was walking with her and now is not (she stopped, they went their own way) walks back onto their
    // own way; no jump
    for (const q of pres) {
      const qa = q.a as Agent & { comp?: [number, number]; compT?: [number, number]; wasComp?: boolean }
      if (q.companion) { qa.wasComp = true; continue }
      qa.comp = undefined; qa.compT = undefined
      if (!qa.wasComp || !q.a.started || q.seat || q.heldBy) { qa.wasComp = false; continue }
      const dx = q.x - q.a.last.x, dz = q.z - q.a.last.z, d = Math.hypot(dx, dz), m = 1.9 * dt
      if (d > m) { q.x = q.a.last.x + dx / d * m; q.z = q.a.last.z + dz / d * m } else qa.wasComp = false
    }
    // crossing a threshold: on the short walk between a door and a spot inside, they are inside their own building
    const pt = V()
    for (const p of pres) if (p.w.moving && !p.w.onBus && !p.heldBy) {
      const ids = [p.w.stop.lot.id, p.w.from?.lot.id]
      for (const s of this.solids) if ((s.kind === 'wall' || s.kind === 'special') && ids.includes(s.id) && s.box.containsPoint(pt.set(p.x, 0.3, p.z))) { p.w = { ...p.w, indoors: true, stop: { ...p.w.stop, lot: this.lots.get(s.id) ?? p.w.stop.lot } }; break }
    }
    // personal space: anyone outdoors on foot gives way to anyone else (and to her), a smooth push apart that grows as
    // they get close, never into a wall or onto a stoop. seated people, babies in arms and their carriers stay put
    // (walkers are never pushed: they keep their line and hold back instead, below)
    const free = (q: Pre) => !q.seat && !q.heldBy && !q.holding && !q.w.indoors && q.a.guardian === undefined && !q.w.moving
    const outdoor = pres.filter(q => !q.w.indoors && !q.heldBy && q.shown)
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < outdoor.length; i++) {
      const p = outdoor[i]
      for (let j = i + 1; j < outdoor.length; j++) {
        const q = outdoor[j]
        if (p.holding === q.a.id || q.holding === p.a.id || p.a.guardian === q.a.id || q.a.guardian === p.a.id) continue
        if (p.w.moving || q.w.moving) continue // anyone walking: they hold back or step around (below); nobody is pushed by a passer-by
        // the same footprints the checker uses (arm span by body depth, turned the way they face)
        const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz)
        const pen = d < 1e-4 ? 0 : footOverlap(p.x, p.z, p.heading, p.a.body, q.x, q.z, q.heading, q.a.body, 0.005)
        if (pen <= 0) continue
        const push = (pen + 0.03) / d
        const fp = free(p) ? (free(q) ? 0.5 : 1) : 0, fq = free(q) ? (free(p) ? 0.5 : 1) : 0
        p.px -= dx * push * fp; p.pz -= dz * push * fp; q.px += dx * push * fq; q.pz += dz * push * fq
      }
      if (free(p) && !(isHeld && p.holding === 'her')) {
        const dx = p.x - L.pos.x, dz = p.z - L.pos.z, d = Math.hypot(dx, dz), min = herBody.torsoW * 0.5 + p.a.body.torsoW * 0.5 + 0.12
        // (someone standing makes room for her as she walks by, as people do; she never gives way, she is living her day)
        const want2 = L.walking && !p.w.moving ? min + 0.25 : min
        if (d < want2 && d > 1e-4) { p.px += dx * (want2 - d) / d; p.pz += dz * (want2 - d) / d }
      }
    }
    // the give-way offset eases in and out over a moment (people drift aside, they do not twitch)
    for (const p of pres) {
      const a = p.a as Agent & { sep?: { x: number; z: number } }
      const sp = (a.sep ??= { x: 0, z: 0 }), k = this.cutPending ? 1 : 1 - Math.exp(-dt * 5) // (at a cut: already there)
      sp.x += (p.px - sp.x) * k; sp.z += (p.pz - sp.z) * k
      if (Math.abs(sp.x) + Math.abs(sp.z) > 1e-4 && free(p)) this.nudge(p, sp.x, sp.z)
    }
    // talking means talking to someone: turn to the nearest person within reach in front of them (and keep talking to
    // that same person while they are still there, no flicking between two), else stop talking
    const byPre = new Map(pres.map(q => [q.a.id, q]))
    for (const p of pres) {
      const a = p.a as Agent & { talkTo?: string }
      if (p.action !== 'talk') { a.talkTo = undefined; continue }
      const ok = (q: Pre) => q !== p && q.a.presence > 0.6 && !q.w.moving && !q.heldBy && q.w.indoors === p.w.indoors && (!q.w.indoors || q.w.stop.lot.id === p.w.stop.lot.id) && Math.hypot(q.x - p.x, q.z - p.z) > 0.3 && Math.hypot(q.x - p.x, q.z - p.z) < 1.8
      let to: { x: number; z: number } | null = null
      const kept = a.talkTo === 'her' ? null : a.talkTo ? byPre.get(a.talkTo) : undefined
      if (a.talkTo === 'her' && Math.hypot(L.pos.x - p.x, L.pos.z - p.z) < 1.8) to = L.pos
      else if (kept && ok(kept)) to = kept
      else {
        let bd = 1.8; a.talkTo = undefined
        for (const q of pres) if (ok(q)) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; to = q; a.talkTo = q.a.id } }
        const herOk = (!L.walking && !isHeld) || (isHeld && p.a.role === 'neighbor')
        if (herOk) { const d = Math.hypot(L.pos.x - p.x, L.pos.z - p.z); if (d > 0.3 && d < bd) { to = L.pos; a.talkTo = 'her' } }
      }
      if (to) p.heading = Math.atan2(to.x - p.x, to.z - p.z)
      else p.action = p.a.workplace === 'shop' || p.w.stop.station.label.includes('stall') ? 'stand' : 'phone'
    }
    // second pass: bodies
    const placed = new Set<string>() // (who is already placed this frame: a set, so the checks stay fast with a crowd)
    const still = this.stillBuf
    let nStill = 0
    if (!L.walking) { still[nStill++] = L.pos.x; still[nStill++] = L.pos.z }
    let drawn = 0
    for (const p of pres) {
      const a = p.a as Agent & { vel?: THREE.Vector3; det?: number; detSide?: number; holdT?: number; wasWalking?: boolean }
      if (this.cutPending) a.presence = (!p.w.indoors || p.w.stop.lot.id === W.lotId) && p.shown ? 1 : 0
      // steering: everyone moves like a person toward where their day (and every rule above) puts them: speeding up and
      // slowing down within human limits, facing where they go, feet advancing exactly with the ground covered. a jump
      // in where they should be becomes a walk; someone in the way means slowing to a stop, then stepping around; a
      // vehicle in the way means waiting. only a cut, a baby in arms and their carrier are placed directly
      const vel = (a.vel ??= V())
      const tx0 = p.x, tz0 = p.z
      const far = Math.hypot(tx0 - a.last.x, tz0 - a.last.z)
      // (her escort and anyone holding a baby are placed off her directly: she moves smoothly, so they do too)
      // (an escort or companion who is not beside her yet walks over first, then keeps step)
      const snap = !a.started || this.cutPending || !!p.heldBy || !!p.holding || (p.escort && far < 0.12) || a.presence < 0.05 || far > 14
      let moving = false, turning = false
      if (snap) vel.set(0, 0, 0)
      else {
        const wn = Math.hypot(tx0 - a.last.x, tz0 - a.last.z) || 1
        let tx = tx0, tz = tz0
        if (a.det) { tx += ((tz0 - a.last.z) / wn) * a.det; tz += (-(tx0 - a.last.x) / wn) * a.det }
        // (her escort keeps close beside her: a tighter follow)
        const tau = p.escort ? 0.1 : 0.2
        let dvx = (tx - a.last.x) / tau, dvz = (tz - a.last.z) / tau
        const dn = Math.hypot(dvx, dvz), vmax = 1.3
        if (dn > vmax) { dvx *= vmax / dn; dvz *= vmax / dn }
        // who is in the way of the next steps
        let held = false, heldBy: { x: number; z: number } | null = null
        const sp = Math.hypot(dvx, dvz)
        if (sp > 0.05) {
          const ux = dvx / sp, uz = dvz / sp, myH = Math.atan2(ux, uz)
          // look as far ahead as it takes to stop (v^2 / 2a at 3.5 u/s^2), plus a step
          const cur = Math.hypot(vel.x, vel.z), look = 0.12 + (cur * cur) / 7
          const others: { id: string; x: number; z: number; h: number; body: Body; indoors: boolean; still: boolean }[] = [
            ...out.filter(o => Math.abs(o.x - a.last.x) < 2 && Math.abs(o.z - a.last.z) < 2).map(o => ({ id: o.id, x: o.x, z: o.z, h: o.heading, body: o.body, indoors: o.indoors, still: !o.walking })),
            // passersby are placed after everyone else: where they were a frame ago
            ...this.lastPass.map(o => ({ id: `pass${o.j}`, x: o.x, z: o.z, h: o.h, body: o.body, indoors: false, still: false })),
            // and her (she never gives way: she is living her day)
            ...(isHeld || (p.escort && !p.companion) ? [] : [{ id: 'her', x: L.seat?.x ?? L.pos.x, z: L.seat?.z ?? L.pos.z, h: L.heading, body: herBody, indoors: W.indoors, still: !L.walking }]),
            ...pres.filter(q => q !== p && !placed.has(q.a.id) && Math.abs(q.a.last.x - a.last.x) < 2 && Math.abs(q.a.last.z - a.last.z) < 2 && q.a.presence > 0.2).map(q => ({ id: q.a.id, x: q.a.last.x, z: q.a.last.z, h: q.a.heading, body: q.a.body, indoors: q.w.indoors, still: !q.w.moving })),
          ]
          for (const o of others) {
            if (o.indoors !== p.w.indoors || o.id === p.a.guardian || o.id === p.holding || o.id === a.guardian) continue
            if (footOverlap(a.last.x + ux * look, a.last.z + uz * look, myH, a.body, o.x, o.z, o.h, o.body, 0.05) <= 0 && footOverlap(a.last.x + ux * 0.06, a.last.z + uz * 0.06, myH, a.body, o.x, o.z, o.h, o.body, 0.05) <= 0) continue
            const ox = o.x - a.last.x, oz = o.z - a.last.z, od = Math.hypot(ox, oz)
            const ahead = (ox * ux + oz * uz) / (od + 1e-6)
            // the one behind gives way; side by side (or on the same spot), exactly one of the two does
            if (ahead > 0.2 || (ahead > -0.2 && (a.id > o.id || o.id === 'her'))) { held = true; heldBy = o.still || o.id === 'her' ? o : null; break }
            // passing close alongside: drift a little away from them as you pass (shoulders do not brush)
            const away = ((o.x - a.last.x) * uz - (o.z - a.last.z) * ux) > 0 ? -1 : 1
            if (!this.blocked(a.last.x + uz * away * 0.25, a.last.z - ux * away * 0.25, 0.14)) { a.det = Math.max(-0.5, Math.min(0.5, (a.det ?? 0) + away * 0.9 * dt)); if (!a.detSide) a.detSide = away }
          }
          // already brushing someone who is standing still (they stopped right beside them): a small step away, so
          // two bodies never stay pressed together while one waits
          for (const o of others) {
            if (!o.still || o.indoors !== p.w.indoors || o.id === p.a.guardian || o.id === p.holding || o.id === a.guardian) continue
            const ov = footOverlap(a.last.x, a.last.z, myH, a.body, o.x, o.z, o.h, o.body, 0.02)
            if (ov <= 0) continue
            const ox = a.last.x - o.x, oz = a.last.z - o.z, od = Math.hypot(ox, oz) || 1
            const m = Math.min(ov + 0.02, 1.0 * dt) / dt
            if (!this.blocked(a.last.x + ox / od * 0.1, a.last.z + oz / od * 0.1, 0.12)) { dvx += ox / od * m; dvz += oz / od * m; held = false }
            break
          }
          // a pole in the way: like someone standing there (slow down, then step around it)
          // a stall table in the way: the same (slow down, step around it)
          if (!held && !p.w.indoors) for (const sl of this.solids) if (sl.kind === 'stall') { const qx = a.last.x + ux * look, qz = a.last.z + uz * look, r = a.body.torsoW * 0.5 + 0.08; if (qx + r > sl.box.min.x && qx - r < sl.box.max.x && qz + r > sl.box.min.z && qz - r < sl.box.max.z) { held = true; heldBy = { x: (sl.box.min.x + sl.box.max.x) / 2, z: (sl.box.min.z + sl.box.max.z) / 2 }; break } }
          if (!held && !p.w.indoors) for (const pl of this.fabric.poles) if (Math.hypot(pl.x - (a.last.x + ux * look), pl.z - (a.last.z + uz * look)) < a.body.torsoW * 0.5 + 0.12) { held = true; heldBy = pl; break }
          if (!held && !p.w.indoors) for (const v of vehicles) {
            const fx = Math.sin(v.heading), fz = Math.cos(v.heading), r = a.body.torsoW * 0.5 + 0.1
            const nx = a.last.x + ux * (look + 0.05), nz = a.last.z + uz * (look + 0.05)
            const al = (nx - v.x) * fx + (nz - v.z) * fz, sd = (nx - v.x) * fz - (nz - v.z) * fx
            if (Math.abs(al) < v.l / 2 + r && Math.abs(sd) < v.w / 2 + r) { held = true; break }
          }
          // she never gives way: someone she has walked right up against steps aside, away from her
          // (before they touch: a hand's width of room, and a quick step, not a slow drift into her)
          if (!isHeld && !p.escort && !p.w.indoors === !W.indoors && footOverlap(a.last.x, a.last.z, a.heading, a.body, L.pos.x, L.pos.z, L.heading, herBody, 0.12) > 0) {
            const side = ((L.pos.x - a.last.x) * uz - (L.pos.z - a.last.z) * ux) > 0 ? -1 : 1
            if (!this.blocked(a.last.x + uz * side * 0.35, a.last.z - ux * side * 0.35, 0.16)) { a.det = Math.max(-0.6, Math.min(0.6, (a.det ?? 0) + side * 1.6 * dt)); a.detSide = side }
          }
          a.holdT = held ? (a.holdT ?? 0) + dt : 0
          // held up by someone standing: after a moment, aim a little to the side of them (and drift back after)
          if (held && heldBy && a.holdT > 0.3) {
            if (!a.detSide) {
              // away from them, unless that side is a stoop or a wall (then the other side, or wait)
              const away = ((heldBy.x - a.last.x) * uz - (heldBy.z - a.last.z) * ux) > 0 ? -1 : 1
              const ok = (sd: number) => { const qx = a.last.x + uz * sd * 0.35, qz = a.last.z - ux * sd * 0.35; return !this.blocked(qx, qz, 0.16) && !vehicles.some(v => { const fx = Math.sin(v.heading), fz = Math.cos(v.heading), al = (qx - v.x) * fx + (qz - v.z) * fz, sd2 = (qx - v.x) * fz - (qz - v.z) * fx; return Math.abs(al) < v.l / 2 + 0.3 && Math.abs(sd2) < v.w / 2 + 0.3 }) }
              a.detSide = ok(away) ? away : ok(-away) ? -away : 0
            }
            const nd = Math.max(-0.6, Math.min(0.6, (a.det ?? 0) + a.detSide * 0.6 * dt))
            const sx = a.last.x + uz * (nd - (a.det ?? 0)), sz = a.last.z - ux * (nd - (a.det ?? 0))
            if (a.detSide && !this.blocked(sx, sz, 0.16)) { a.det = nd; dvx = uz * a.detSide * 0.5; dvz = -ux * a.detSide * 0.5; held = false }
          } else if (!held && a.det) { const back = Math.sign(a.det) * Math.min(Math.abs(a.det), 0.25 * dt); a.det -= back; if (Math.abs(a.det) < 1e-3) { a.det = 0; a.detSide = 0 } }
          if (held) { dvx = 0; dvz = 0 }
          // standing still and the way is off to the side: turn toward it first, then step off
          const stopped = Math.hypot(vel.x, vel.z) < 0.08
          if (!held && stopped) {
            const want = Math.atan2(dvx, dvz), diff = Math.atan2(Math.sin(want - a.heading), Math.cos(want - a.heading))
            if (Math.abs(diff) > 0.35) { a.heading += Math.sign(diff) * Math.min(Math.abs(diff), 5 * dt); dvx = 0; dvz = 0; turning = true }
          }
        }
        // accelerate toward that, within what a person can do
        let ax = dvx - vel.x, az = dvz - vel.z
        const an = Math.hypot(ax, az), amax = 3.5 * dt
        if (an > amax) { ax *= amax / an; az *= amax / an }
        vel.x += ax; vel.z += az
        // held up on the way: they are simply late, so their day waits for them (their own clock runs behind) and where
        // they are headed never runs ahead of them around a corner
        if (p.w.moving && Math.hypot(tx0 - a.last.x, tz0 - a.last.z) > 0.3 && this.lastHour !== null) {
          const ag = a as Agent & { lag?: number }
          ag.lag = (ag.lag ?? 0) + Math.max(0, Math.min(0.01, W.hour - this.lastHour))
        }
        p.x = a.last.x + vel.x * dt; p.z = a.last.z + vel.z * dt
        // a hard limit: no step that puts their body further into someone standing still (or her). they stop instead;
        // holding back and stepping around (above) take it from there
        if (Math.hypot(vel.x, vel.z) > 1e-4) {
          const hh = Math.atan2(vel.x, vel.z)
          const stillOnes = [...out.filter(o => !o.walking && o.indoors === p.w.indoors && Math.abs(o.x - p.x) < 1.5 && Math.abs(o.z - p.z) < 1.5).map(o => ({ x: o.x, z: o.z, h: o.heading, body: o.body, id: o.id })),
            ...pres.filter(q => q !== p && !q.w.moving && q.a.started && q.w.indoors === p.w.indoors && !placed.has(q.a.id) && Math.abs(q.a.last.x - a.last.x) < 2 && Math.abs(q.a.last.z - a.last.z) < 2).map(q => ({ x: q.a.last.x, z: q.a.last.z, h: q.a.heading, body: q.a.body, id: q.a.id })), ...(isHeld || p.escort || L.walking ? [] : [{ x: L.seat?.x ?? L.pos.x, z: L.seat?.z ?? L.pos.z, h: L.heading, body: herBody, id: 'her' }])]
          // her escort on the way over to her: her body (not her arms: they are about to hold hands) is in the way too
          if (p.escort && !p.companion && !isHeld) stillOnes.push({ x: L.pos.x, z: L.pos.z, h: L.heading, body: herBody, id: '__herhand' })
          for (const o of stillOnes) {
            // (their own grown-up: hands may meet, bodies may not; so only the torsos count)
            const own = o.id === a.guardian || o.id === '__herhand'
            const torso = (x: number, z: number) => Math.max(0, (a.body.torsoW + o.body.torsoW) * 0.5 - Math.hypot(o.x - x, o.z - z))
            // (the body is drawn turned to its own heading, which lags the direction of travel in a turn: check both)
            const fo = (x: number, z: number) => Math.max(footOverlap(x, z, hh, a.body, o.x, o.z, o.h, o.body), footOverlap(x, z, a.heading, a.body, o.x, o.z, o.h, o.body))
            const now = own ? torso(p.x, p.z) : fo(p.x, p.z), before = own ? torso(a.last.x, a.last.z) : fo(a.last.x, a.last.z)
            if (now > 0.005 && now >= before) { p.x = a.last.x; p.z = a.last.z; vel.set(0, 0, 0); break }
          }
        }
        moving = Math.hypot(vel.x, vel.z) > (a.wasWalking ? 0.03 : 0.1)
        // arriving at a seat: on it once there (a few cm), standing until then
        if (p.seat) { if (Math.hypot(p.seat.x - p.x, p.seat.z - p.z) < 0.06 && !moving) { p.x = p.seat.x; p.z = p.seat.z; vel.set(0, 0, 0) } else { p.seat = null; if (!moving) p.action = 'stand' } }
        if (moving) p.action = 'walk'
        else if (p.action === 'walk') p.action = 'stand'
      }
      // wherever they are now: inside a building's walls means inside that building
      // (only the building they are leaving or going into, or the one they are at: a path never passes through another)
      if (!p.w.indoors && !p.heldBy) { const ids = [p.w.stop.lot.id, p.w.from?.lot.id, p.a.home.id]; for (const s of this.solids) if ((s.kind === 'wall' || s.kind === 'special') && ids.includes(s.id) && s.box.containsPoint(pt.set(p.x, 0.3, p.z))) { p.w = { ...p.w, indoors: true, stop: { ...p.w.stop, lot: this.lots.get(s.id) ?? p.w.stop.lot } }; break } }
      // a sharp corner on the way (in through a door, then back toward a seat beside it): they stop and turn on the
      // spot, then walk on, a moment late. never a body that swings 150 degrees in one frame and drags a planted foot
      let pivot = 0
      const h0 = a.heading
      if (a.started && p.action === 'walk' && (p.companion || (!p.escort && !snap)) && !p.heldBy && !p.holding) {
        const dx = p.x - a.last.x, dz = p.z - a.last.z, d = Math.hypot(dx, dz)
        const diff = d > 1e-3 && d < 0.5 ? Math.atan2(Math.sin(Math.atan2(dx, dz) - a.heading), Math.cos(Math.atan2(dx, dz) - a.heading)) : 0
        if (Math.abs(diff) > 1.2) {
          p.x = a.last.x; p.z = a.last.z
          const ag = a as Agent & { lag?: number }
          if (this.lastHour !== null) ag.lag = (ag.lag ?? 0) + Math.max(0, Math.min(0.01, W.hour - this.lastHour))
          const turn = Math.min(Math.abs(diff), 7 * dt)
          a.heading += Math.sign(diff) * turn; turning = true
          // (stepping round on the spot: the feet keep stepping as the body turns, so the planted one lifts and comes
          // round instead of being twisted under it)
          pivot = turn * a.body.hipW * 5
        }
      }
      const mvx = p.x - a.last.x, mvz = p.z - a.last.z
      const step = a.started ? Math.hypot(mvx, mvz) : 0
      a.started = true; a.last.set(p.x, 0, p.z)
      // a first step after a real stop starts from standing feet
      const ast = a as Agent & { stoodT?: number }
      if (p.action === 'walk' && !a.wasWalking) a.phase = Math.floor(a.phase) + 0.3 // (from a standing pose: always)
      ast.stoodT = p.action === 'walk' ? 0 : (ast.stoodT ?? 0) + dt
      a.wasWalking = p.action === 'walk'
      if (step < 2 && p.action === 'walk') a.phase += (step + pivot) / a.body.stride
      if (step >= 2) a.presence = 0 // a jump (a new day's plan) happens only out of sight; qa flags it if not
      a.pos.set(p.x, 0, p.z)
      if (a.kinId) W.kinPos.set(a.kinId, a.pos.clone().setY(a.body.H * 0.9))
      const inView = (!p.w.indoors || p.w.stop.lot.id === W.lotId) && p.shown
      a.presence += ((inView ? 1 : 0) - a.presence) * (1 - Math.exp(-dt * 6))
      // the draw budget (adaptive quality) only ever drops people far out in the haze, never anyone near the shot
      if (a.presence < 0.02 || (drawn >= cap && Math.hypot(p.x - L.pos.x, p.z - L.pos.z) > 14)) continue
      // walkers face the way they move (their velocity turns smoothly, so no skate); everyone else turns smoothly
      if (p.action === 'walk' && Math.hypot(vel.x, vel.z) > 0.02 && !snap) {
        // a walker turns at most ~4 rad/s, and moves the way they face (the body carries the feet, no sideways skate)
        const want = Math.atan2(vel.x, vel.z), diff = Math.atan2(Math.sin(want - a.heading), Math.cos(want - a.heading))
        a.heading += Math.sign(diff) * Math.min(Math.abs(diff), 2.5 * dt)
        const sp = Math.hypot(vel.x, vel.z) * Math.max(0, Math.cos(diff))
        vel.set(Math.sin(a.heading) * sp, 0, Math.cos(a.heading) * sp)
      }
      // (placed directly, beside her: they face the way they actually move, so a turn of hers never skates their feet)
      else if (p.action === 'walk' && step > 1e-3 && step < 2) a.heading = Math.atan2(mvx, mvz)
      else if (!turning) a.heading += Math.atan2(Math.sin(p.heading - a.heading), Math.cos(p.heading - a.heading)) * (1 - Math.exp(-dt * 7))
      // (a child at a grown-up's side is carried round in an arc when the grown-up turns: the child keeps stepping as
      // they go round, so a planted foot never ends up behind a leg that can't reach it)
      if (p.beside && p.action === 'walk' && !pivot && step < 2) a.phase += Math.min(Math.abs(Math.atan2(Math.sin(a.heading - h0), Math.cos(a.heading - h0))), 0.5) * a.body.hipW * 5 / a.body.stride
      void moving
      const mood = { tired: W.hour > 20 ? 0.4 : 0, sad: 0, hurry: W.hour > 6.5 && W.hour < 8.6 ? 0.4 : 0 }
      const carrying = a.vendor && (p.action === 'walk' || p.action === 'stand') && W.hour > 6 && W.hour < 16
      const target = p.action === 'walk' ? gait(a.body, a.phase, mood, t, a.seed) : poseFor(a.body, p.action, t, a.seed, mood, p.seat ? p.seat.h : 0)
      if (carrying) target.armL = [Math.PI * 0.9, 0.25, 0, 0.6]
      // poses ease into each other (walking included: the ease also smooths the turns a walker makes)
      const aw = a as Agent & { walkT?: number }
      aw.walkT = p.action === 'walk' ? (aw.walkT ?? 0) + dt : 0
      if (!a.pose) a.pose = clonePose(target)
      else blendInto(a.pose, target, p.action === 'walk' ? 1 - Math.exp(-dt * 14) : 1 - Math.exp(-dt * 5))
      // planted feet stay put in the world (foot locking, ./rig): the root is where the body is this frame
      if (!p.heldBy) { const fl = (a as Agent & { feet?: FootLock }); fl.feet ??= newFootLock(); const st = lockFeet(a.pose, a.phase, yawRoot(_m, p.x, p.z, a.heading, (a as Agent & { gy?: number }).gy ?? 0), fl.feet, p.action === 'walk' && !this.cutPending && a.started, target, dt); if (st > 0.12 && p.action === 'walk' && step < 0.6 * dt) a.phase += Math.min(0.04, (st - 0.12) * 0.5) }
      solve(a.body, a.pose, a.sol)
      const root = new THREE.Matrix4()
      let cradle: Placed['cradle'] = null
      if (p.heldBy) {
        // a kin baby: laid across the holder's arms (the holder is placed first in this loop only if earlier; use the
        // holder's pre-pass position and heading, the arms are solved below when the holder is drawn)
        root.copy(babyRoot(V().set(p.x, 0, p.z), p.heading, a.body, null))
      } else {
        // the ground under them: the lane, or the top of a stoop when they stand on one (a step up, eased)
        const ag = a as Agent & { gy?: number }
        const fr = Math.max(a.body.torsoW, a.body.shoulderW * 2) * 0.33 + 0.02 // (any part of their footprint over the step: they are on it)
        const onStep = !p.seat && this.solids.some(s => s.kind === 'stoop' && p.x > s.box.min.x - fr && p.x < s.box.max.x + fr && p.z > s.box.min.z - fr && p.z < s.box.max.z + fr)
        const gy = onStep ? 0.2 : 0
        // (eased while walking; someone who stops on the step is standing on it, not halfway into it)
        ag.gy = snap || p.action !== 'walk' ? gy : (ag.gy ?? gy) + (gy - (ag.gy ?? gy)) * (1 - Math.exp(-dt * 30))
        yawRoot(root, p.x, p.z, a.heading, ag.gy)
      }
      if (p.holding) {
        const baby = p.holding === 'her' ? herBody : byId.get(p.holding)?.body
        if (baby) {
          const c = cradleFor(a.body, a.sol, baby)
          reachArm(a.body, a.sol, 0, c.hl); reachArm(a.body, a.sol, 1, c.hr)
          cradle = { center: c.center.clone().applyMatrix4(root), targets: [c.hl.clone().applyMatrix4(root), c.hr.clone().applyMatrix4(root)] }
          if (p.holding === 'her') { L.cradle.copy(cradle.center); L.cradleHeading = a.heading; L.cradleAt = t }
          else { const bp = pre.get(p.holding); if (bp) { bp.x = cradle.center.x; bp.z = cradle.center.z } (byId.get(p.holding) as Agent & { cradle?: THREE.Vector3; cradleH?: number }).cradle = cradle.center; (byId.get(p.holding) as Agent & { cradleH?: number }).cradleH = a.heading }
        }
      }
      const kidCradle = (a as Agent & { cradle?: THREE.Vector3; cradleH?: number })
      if (p.heldBy && kidCradle.cradle) root.copy(babyRoot(kidCradle.cradle, kidCradle.cradleH ?? p.heading, a.body, kidCradle.cradle))
      placed.add(a.id)
      out.push({
        id: a.id, who: a.role === 'kin' ? `${a.kinId} ${a.name}` : `${a.role} ${a.id} (${Math.round(a.age)})`, role: a.role, age: a.age, kinId: a.kinId,
        root, x: p.x, z: p.z, heading: a.heading, action: p.action, walking: p.action === 'walk', presence: a.presence,
        body: a.body, sol: a.sol, look: a.look,
        props: { basin: carrying, broom: p.action === 'sweep', phone: p.action === 'phone', babyOnBack: a.babyOnBack },
        holding: p.holding, heldBy: p.heldBy, cradle, indoors: p.w.indoors, lotId: p.w.stop.lot.id, lotKind: p.w.stop.lot.kind, seat: p.seat, talkingTo: p.action === 'talk' ? (a as Agent & { talkTo?: string }).talkTo ?? null : null,
        guardian: a.guardian ?? null, door: p.door,
        handWith: p.escort && !p.companion ? 'her' : a.guardian && (p.a.age < 8) && Math.hypot((pre.get(a.guardian)?.x ?? 1e9) - p.x, (pre.get(a.guardian)?.z ?? 1e9) - p.z) < 0.7 ? a.guardian : null,
        note: `lot ${p.w.stop.lot.id} ${a.activity} ${p.w.moving ? `walking to ${p.w.stop.act}@${p.w.stop.lot.kind}` : `${p.w.stop.act}@${p.w.stop.station.label}`}${p.holding ? ' holding ' + p.holding : ''}${a.guardian ? ' with ' + a.guardian : ''}`,
      })
      drawn++
      if (p.action !== 'walk' && nStill < still.length) { still[nStill++] = p.x; still[nStill++] = p.z }
    }
    // passersby along her lane at the real density and hour. each walks the street at their own pace (eased, never
    // stop-go), keeps to their direction's side, keeps a step behind anyone slower ahead, waits for a vehicle, and
    // swerves around people standing. they join and leave only at the ends of the street, in the haze; when she turns
    // a corner, the ones on the old street walk on out of the frame and new ones come in on hers
    const nearX = STREETS_W.reduce((b, s) => (Math.abs(s - L.pos.x) < Math.abs(b - L.pos.x) ? s : b))
    const nearZ = STREETS_W.reduce((b, s) => (Math.abs(s - L.pos.z) < Math.abs(b - L.pos.z) ? s : b))
    const alongZ = Math.abs(nearX - L.pos.x) < Math.abs(nearZ - L.pos.z)
    const streetKey = alongZ ? `x${nearX}` : `z${nearZ}`
    const h = W.hour
    const dayK = h > 6 && h < 21.5 ? (h > 6.5 && h < 9 ? 1 : h > 16 && h < 19.5 ? 0.95 : 0.6) : h > 5 && h < 23 ? 0.25 : 0.05
    const want = Math.round(dayK * (8 + 22 * W.density))
    const span = 46
    const lookers = this.agents.filter(a => a.age >= 16 && a.role === 'crowd')
    // phase 1: where everyone is now
    const PS = this.pass.map((P, j) => {
      const look = lookers[(j * 7 + 3) % Math.max(1, lookers.length)]
      if (!P.street) P.street = streetKey
      const dir = j % 2 ? 1 : -1
      const onX = P.street.startsWith('x'), line = Number(P.street.slice(1))
      const center = onX ? L.pos.z : L.pos.x
      if (P.s === undefined) P.s = (Math.floor(j / 2) / Math.ceil(this.pass.length / 2)) * span + hash01(j * 3) * 0.3
      const rel = (((P.s - center) % span) + span) % span - span / 2
      // everyone on foot keeps to their right (like the planned walkers in ./plan), so nobody meets anyone head-on
      if (P.lat === undefined) P.lat = dir * (onX ? -1 : 1) * (1.02 + (hash01(j * 11) - 0.5) * 0.06)
      const x = onX ? line + P.lat : center + rel, z = onX ? center + rel : line + P.lat
      return { P, j, look, dir, onX, line, center, rel, x, z }
    })
    for (const q of PS) {
      const { P, j, look, dir, onX, line } = q
      if (!look) continue
      // at a cut, a passerby who would be standing on someone is not in this shot: they come in from the end of the street
      if (P.cutCheck) {
        P.cutCheck = false
        // (nobody comes out of a cut standing under a vehicle either)
        if (out.some(b => !b.indoors && Math.hypot(b.x - q.x, b.z - q.z) < 0.5) || vehicles.some(v => { const fx = Math.sin(v.heading), fz = Math.cos(v.heading); return Math.abs((q.x - v.x) * fx + (q.z - v.z) * fz) < v.l / 2 + 0.4 && Math.abs((q.x - v.x) * fz - (q.z - v.z) * fx) < v.w / 2 + 0.4 }) || this.lastPass.some(o => o.j < j && Math.hypot(o.x - q.x, o.z - q.z) < 0.5 && o.cut)) { P.s = q.center - dir * (span / 2 - 0.5); P.presence = 0; P.on = false; P.started = false; continue }
      }
      let { x, z } = q
      const sp = (0.75 + hash01(j * 5 + record.seed) * 0.4) * (look.age > 65 ? 0.6 : 1)
      // swerve around anyone standing (and around vehicles), smooth in distance so it has no pop; inside the open lane
      let push = 0
      const avoid = (ox: number, oz: number, rr: number, ra = rr) => {
        const dA = onX ? z - oz : x - ox, dL = onX ? x - ox : z - oz
        const ad = Math.abs(dA), reach = rr + 0.55; if (ad > 1.4 + ra || Math.abs(dL) > reach) return
        const bump = ad < 0.5 + ra ? 1 : 1 - (ad - 0.5 - ra) / 0.9
        push += (dL >= 0 ? 1 : -1) * (reach - Math.abs(dL)) * bump * bump * (3 - 2 * bump)
      }
      for (let o = 0; o < nStill; o += 2) avoid(still[o], still[o + 1], 0)
      for (const v of vehicles) avoid(v.x, v.z, v.w / 2, v.l / 2)
      if (L.walking && !W.indoors) avoid(L.pos.x, L.pos.z, 0.1)
      const lat0 = P.lat!
      // the swerve has a sideways speed that eases in and out, and never more than a third of the walking pace (a turn of
      // ~18 degrees at most: people curve around someone, they do not side-step at full speed)
      const latWant = Math.sign(lat0) * Math.min(LANE_HALF - 0.17, Math.max(0.25, Math.abs(lat0 + push * 0.6 + (Math.sign(lat0) * 1.02 - lat0) * 0.3)))
      const maxLat = Math.max(0.2, Math.abs(P.v) * 0.33) // (standing, they can still step aside)
      P.latV = (P.latV ?? 0) + Math.max(-0.6 * dt, Math.min(0.6 * dt, Math.max(-maxLat, Math.min(maxLat, (latWant - lat0) * 2)) - (P.latV ?? 0)))
      let lat = lat0 + P.latV * dt
      const inVeh = (qx: number, qz: number) => vehicles.some(v => { const fx = Math.sin(v.heading), fz = Math.cos(v.heading), r = look.body.torsoW * 0.5 + 0.1; const al = (qx - v.x) * fx + (qz - v.z) * fz, sd = (qx - v.x) * fz - (qz - v.z) * fx; return Math.abs(al) < v.l / 2 + r && Math.abs(sd) < v.w / 2 + r })
      // never sideways into a vehicle or into someone
      const inPerson = (qx: number, qz: number) => out.some(b => !b.indoors && footOverlap(qx, qz, P.heading ?? 0, look.body, b.x, b.z, b.heading, b.body, 0.05) > 0) || (!W.indoors && footOverlap(qx, qz, P.heading ?? 0, look.body, L.pos.x, L.pos.z, L.heading, herBody, 0.05) > 0)
      if (inVeh(onX ? line + lat : x, onX ? z : line + lat) || (inPerson(onX ? line + lat : x, onX ? z : line + lat) && !inPerson(onX ? line + lat0 : x, onX ? z : line + lat0))) { lat = lat0; P.latV = 0 }
      P.lat = lat
      if (onX) x = line + lat; else z = line + lat
      // pace: their own, eased down behind anyone slower a step ahead on their side, to zero for a vehicle in the way
      let target = sp
      const ahead = (ox: number, oz: number, tie = false) => { const a = onX ? (oz - z) * dir : (ox - x) * dir, l = onX ? Math.abs(ox - x) : Math.abs(oz - z); return l < 0.34 && (a > 0.02 || (tie && a > -0.02)) ? Math.max(0, a) : 99 }
      let gap = 99
      // (two on the same spot: the higher-numbered one waits)
      // (seen or not: someone in the haze is still someone, and they come out of it in order)
      for (const o of PS) if (o !== q && o.P.street === P.street) gap = Math.min(gap, ahead(o.x, o.z, o.j < j))
      for (const b of out) if (!b.indoors) gap = Math.min(gap, ahead(b.x, b.z))
      if (!W.indoors && L.pos.y < 0.2) gap = Math.min(gap, ahead(L.pos.x, L.pos.z, true)) // and her: they give her the way
      if (gap < 1.2) target = Math.min(target, Math.max(0, (gap - 0.5) * 1.6))
      // (looking as far ahead as it takes them to stop, plus a step)
      const lookV = 0.3 + (P.v * P.v) / 4
      if (inVeh(onX ? x : x + dir * lookV, onX ? z + dir * lookV : z) || inVeh(x, z)) target = 0
      // anyone at all just ahead (someone crossing from a side street, someone standing): stop short of them
      const nx2 = onX ? x : x + dir * 0.18, nz2 = onX ? z + dir * 0.18 : z, hd2 = onX ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2)
      const ahead2 = (bx: number, bz: number) => ((bx - x) * (onX ? 0 : dir) + (bz - z) * (onX ? dir : 0)) > 0.02
      if (out.some(b => !b.indoors && b.id !== `pass${j}` && footOverlap(nx2, nz2, hd2, look.body, b.x, b.z, b.heading, b.body, 0.04) > 0 && ahead2(b.x, b.z))) target = 0
      // (and her)
      if (!W.indoors && L.pos.y < 0.2 && footOverlap(nx2, nz2, hd2, look.body, L.pos.x, L.pos.z, L.heading, herBody, 0.04) > 0 && ahead2(L.pos.x, L.pos.z)) target = 0
      // (and the passersby not placed yet this frame, where they were a frame ago)
      if (this.lastPass.some(o => o.j > j && footOverlap(nx2, nz2, hd2, look.body, o.x, o.z, o.h, o.body, 0.04) > 0 && ahead2(o.x, o.z))) target = 0
      P.v += (target - P.v) * (1 - Math.exp(-dt * (target < P.v ? 8 : 3)))
      P.s! += P.v * dir * dt
      if (onX) z += P.v * dir * dt; else x += P.v * dir * dt
      // joins and leaves only at the ends of the window; the window edges are faded to nothing (in the haze)
      const wrongStreet = P.street !== streetKey
      if (Math.abs(q.rel) > span / 2 - 2.5) P.on = j < want && !wrongStreet
      const edge = Math.max(0, Math.min(1, (span / 2 - Math.abs(q.rel)) / 3))
      P.presence += ((P.on ? edge : 0) - P.presence) * (this.cutPending ? 1 : 1 - Math.exp(-dt * 5)) // (a cut: as they are in the new moment)
      P.presence = Math.min(P.presence, edge)
      if (wrongStreet && P.presence < 0.02 && !P.on) { P.street = streetKey; P.started = false; P.lat = undefined; P.s = undefined }
      const pdx = x - P.last.x, pdz = z - P.last.z
      const stepD = P.started ? Math.hypot(pdx, pdz) : 0
      P.started = true; P.last.set(x, 0, z)
      if (stepD < 2) P.phase += stepD / look.body.stride
      // facing the way they move (no sideways skate), turning at most ~4 rad/s: a step off after standing aside never
      // swings the body round in one frame and drags the planted foot
      if (stepD > 1e-4 && stepD < 2) { const want = Math.atan2(pdx, pdz), df = P.heading === undefined ? 0 : Math.atan2(Math.sin(want - P.heading), Math.cos(want - P.heading)); P.heading = P.heading === undefined || this.cutPending ? want : P.heading + Math.sign(df) * Math.min(Math.abs(df), 4 * dt) }
      if (P.presence < 0.02 || (drawn >= cap && Math.hypot(x - L.pos.x, z - L.pos.z) > 14)) continue
      const heading = P.heading ?? (onX ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2))
      // walking or standing, with some give (a slow shuffle behind someone is still walking); a first step after a real
      // stop starts from the phase that matches standing feet, so it never skates
      const moving = P.wasMoving ? P.v > 0.03 : P.v > 0.1
      P.stoodT = moving ? 0 : (P.stoodT ?? 0) + dt
      if (moving && !P.wasMoving) P.phase = Math.floor(P.phase) + 0.3
      P.stoodPrev = P.stoodT
      P.wasMoving = moving
      const mood = { tired: 0, sad: 0, hurry: h > 6.5 && h < 8.6 ? 0.4 : 0 }
      const g = moving ? gait(look.body, P.phase, mood, t, j) : poseFor(look.body, 'stand', t, j, mood)
      const carry = look.vendor || j % 6 === 0
      if (carry) g.armL = [Math.PI * 0.9, 0.25, 0, 0.6]
      if (!P.pose) P.pose = clonePose(g)
      P.walkT = moving ? (P.walkT ?? 0) + dt : 0
      if (P.pose) blendInto(P.pose, g, moving ? 1 - Math.exp(-dt * 14) : 1 - Math.exp(-dt * 6))
      P.feet ??= newFootLock()
      lockFeet(P.pose, P.phase, yawRoot(_m, x, z, heading), P.feet, moving, g, dt)
      solve(look.body, P.pose, P.sol)
      out.push({
        id: `pass${j}`, who: `passerby ${j}`, role: 'passer', age: look.age, root: yawRoot(new THREE.Matrix4(), x, z, heading), x, z, heading, action: moving ? 'walk' : 'stand', walking: moving, presence: P.presence,
        body: look.body, sol: P.sol, look: look.look, props: { basin: carry, broom: false, phone: false, babyOnBack: false }, holding: null, heldBy: null, cradle: null,
        indoors: false, lotId: -1, lotKind: 'street', seat: null, talkingTo: null, guardian: null, door: null, note: `passerby on ${P.street}`, handWith: null,
      })
      drawn++
    }
    void _m
    this.lastPass = out.filter(b => b.role === 'passer').map(b => ({ j: Number(b.id.slice(4)), x: b.x, z: b.z, h: b.heading, body: b.body, cut: this.cutPending }))
    this.cutPending = false
    this.lastHour = W.hour
    return out
  }
}

// (a method on Population) move someone a little, unless that puts them in a wall or on a stoop
// a baby lying on her back across someone's forearms: head toward the holder's left elbow, face up and turned a
// little toward the holder. `center` is the cradle point (world); without one, a safe spot in front of the chest
export function babyRoot(holderPos: THREE.Vector3, holderHeading: number, baby: Body, center: THREE.Vector3 | null): THREE.Matrix4 {
  const left = V().set(Math.cos(holderHeading), 0, -Math.sin(holderHeading)), fwd = V().set(Math.sin(holderHeading), 0, Math.cos(holderHeading))
  const face = V().set(0, 1, 0).addScaledVector(fwd, -0.35).normalize()
  const side = V().crossVectors(left, face)
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, left, face))
  const c = center ?? V().copy(holderPos).addScaledVector(fwd, 0.3).setY(0.75)
  const pos = V().copy(c).addScaledVector(left, -baby.H * 0.5)
  return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1))
}

// ---------- her ----------
// her body each frame: the action from what she is doing, the pose blended into it, the skeleton solved, and the
// world transform (standing, lying in bed, or in someone's arms). ./ChosenPerson draws it; the qa script checks it
export type HerFrame = { body: Body; sol: Solved; action: Action; root: THREE.Matrix4; seat: Seat | null }
export class Her {
  private walkT = 0
  private feet: FootLock = newFootLock()
  private phase = 0; private lastX = 0; private lastZ = 0; private started = false; private pose: Pose | null = null
  readonly sol = makeSolved()
  readonly root = new THREE.Matrix4()
  step(L: LiveState, look: LifeRecord['look'], t: number, dt: number, seat: Seat | null): HerFrame {
    const age = L.age
    const body = bodyFor(age, look.adultHeightCm, look.build)
    const held = L.pose === 'held', lying = L.pose === 'lie'
    const step = this.started ? Math.hypot(L.pos.x - this.lastX, L.pos.z - this.lastZ) : 0
    this.started = true; this.lastX = L.pos.x; this.lastZ = L.pos.z
    if (L.walking && step < 1.5) this.phase += step / body.stride // the gait advances by distance: feet stay planted
    const mood = { tired: L.fatigue, sad: L.mood.grief ?? 0, hurry: 0 }
    const action: Action = held ? 'held' : L.walking ? 'walk' : lying ? 'lie'
      : L.pose === 'sit' || L.pose === 'ride' ? (L.act === 'work' ? 'type' : L.act === 'pray' ? 'pray' : 'sit')
      : L.pose === 'busy' ? (L.act === 'cook' ? 'cook' : L.act === 'sweep' ? 'sweep' : 'work')
      : L.act === 'chat' ? 'talk' : L.act === 'play' ? (age < 13 ? 'play' : 'talk') : L.hug > 0.4 ? 'hug' : 'stand'
    const target = action === 'walk' ? gait(body, this.phase, mood, t, 1.7) : poseFor(body, action, t, 1.7, mood, seat ? seat.h : 0)
    if (!this.pose) this.pose = clonePose(target)
    this.walkT = action === 'walk' ? this.walkT + dt : 0
    if (this.pose) blendInto(this.pose, target, action === 'walk' ? 1 - Math.exp(-dt * 14) : 1 - Math.exp(-dt * 5))
    lockFeet(this.pose, this.phase, yawRoot(_m, L.pos.x, L.pos.z, L.heading, L.pos.y), this.feet, action === 'walk', target, dt)
    solve(body, this.pose, this.sol)
    if (held) {
      const fresh = t - L.cradleAt < 0.5
      this.root.copy(babyRoot(L.pos, fresh ? L.cradleHeading : L.heading, body, fresh ? L.cradle : null))
    } else if (lying) {
      yawRoot(this.root, L.pos.x - Math.sin(L.heading) * body.H * 0.45, L.pos.z - Math.cos(L.heading) * body.H * 0.45, L.heading, L.pos.y)
    } else if (seat) yawRoot(this.root, seat.x, seat.z, L.heading, 0)
    else yawRoot(this.root, L.pos.x, L.pos.z, L.heading, L.pos.y)
    this.last = { body, sol: this.sol, action, root: this.root, seat }
    return this.last
  }
  last: HerFrame | null = null
}
