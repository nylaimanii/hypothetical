'use client'
// v4 living pips in the city diorama: each follows its day plan by local time, paths between doors on the
// street grid, and shows the day in its body (work motions, bags, signs, aid lines, strollers).
// instanced: one InstancedMesh per part, counts packed to the pips in view, one useFrame for everything.
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type { Activity, Citizen, City, Frame, Workplace } from '@/lib/types'
import { C, HAIR_HEX, MONK, sceneRefs, toonGradient } from '../lib'
import { localHour, utcHourOf, worldDate } from '../time'
import { useStore } from '../../state/store'
import { useCallouts, type Callout } from '../explain'
import { nextNonCommute, planOf, stepAt, workWords, fmtH, type PlanStep } from './day'
import { pathBetween, spotIn, type Layout, type Lot, type V2 } from './layout'

export const GROUND_Y = 0.25
const MAX = 150
const CLOTH = ['#7E9CB5', '#C9A46A', '#8FAE84', '#B98370', '#9C8CB8', '#D2B48C', '#6F8F95', '#B5A27E', '#A5788F', '#7FA39A']

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }
function rng(seed: number) { let a = seed || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

type Pose = 'walk' | 'ride' | 'stand' | 'sit' | 'kneel' | 'armsUp' | 'sign' | 'bob' | 'machine' | 'hammer'
type Pip = {
  // real: one of the world's recorded people (name and age from the record). the rest are unnamed passersby who
  // fill the street; they show no name or age and open no one's dossier
  idx: number; baseId: string; c: Citizen; real: boolean; name: string; age: number
  skin: THREE.Color; cloth: THREE.Color; legCol: THREE.Color; hair: THREE.Color | null
  size: number; kid: boolean; jitter: number; plan: PlanStep[]
  home: Lot; work: Lot | null; bike: boolean; tram: boolean
  // live
  stepKey: string; act: Activity; place: string; until: number
  path: V2[]; seg: number; pos: V2; heading: number
  arrived: boolean; hideOnArrive: boolean; hidden: boolean; pose: Pose
  bags: number; boxes: boolean; leaving: number; lot: Lot | null; slotKey: string; slot: number
}

const WORK_LOT: Partial<Record<Workplace, string>> = { shop: 'market' }

export function residentsOf(frame: Frame, city: City): Citizen[] {
  const own = frame.citizens.filter((c) => c.cityId === city.id)
  if (own.length) return own
  const region = frame.citizens.filter((c) => c.regionId === city.regionId)
  return region.length ? region.slice(0, 8) : frame.citizens.slice(0, 8)
}

export function crowdSize(city: City, residents: number) {
  return Math.max(residents, Math.min(MAX, Math.round(30 + 25 * Math.log10(Math.max(1e5, city.population) / 1e5))))
}

function makePips(city: City, base: Citizen[], layout: Layout, total: number): Pip[] {
  const r = rng(hash(city.id))
  const lotFor = (w: Workplace | undefined, kid: boolean): Lot | null => {
    if (kid) return layout.byKind.get('school') ?? null
    if (!w || w === 'none') return null
    return layout.byKind.get((WORK_LOT[w] ?? w) as never) ?? null
  }
  const out: Pip[] = []
  for (let k = 0; k < total; k++) {
    const real = k < base.length
    const c = base[k % base.length]
    const tone = Math.max(1, Math.min(10, c.skinTone + (real ? 0 : Math.round(r() * 2 - 1))))
    const age = real ? c.age : Math.max(6, Math.min(88, c.age + Math.round(r() * 20 - 10)))
    const kid = age < 14
    const heightCm = real ? c.heightCm : c.heightCm + (r() * 16 - 8)
    const hairColor = real ? c.hairColor : (['black', 'dark_brown', 'brown', 'blonde', 'red', 'gray'] as const)[Math.floor(r() * 6)]
    const bald = (real ? c.hair : (r() < 0.12 ? 'bald' : c.hair)) === 'bald'
    out.push({
      idx: k, baseId: c.id, c, real, name: real ? c.name : '', age,
      skin: new THREE.Color(MONK[tone - 1]), cloth: new THREE.Color(CLOTH[(c.personalitySeed + k * 7) % CLOTH.length]),
      legCol: new THREE.Color(CLOTH[(c.personalitySeed + k * 3 + 5) % CLOTH.length]).multiplyScalar(0.62),
      hair: bald ? null : new THREE.Color(HAIR_HEX[hairColor] ?? '#2a2420'),
      size: (kid ? 0.62 : 0.85) * (kid ? 1 : heightCm / 170), kid,
      jitter: real ? 0 : (r() * 2 - 1) * 0.67,
      plan: planOf(c),
      home: layout.homes[Math.floor(k / 3) % Math.max(1, layout.homes.length)],
      work: lotFor(c.workplace, kid), bike: !kid && r() < 0.22, tram: layout.tramZ !== null && !kid && r() < 0.2,
      stepKey: '', act: 'sleeping', place: 'home', until: 0,
      path: [], seg: 0, pos: { x: 0, z: 0 }, heading: 0, arrived: true, hideOnArrive: true, hidden: true, pose: 'stand',
      bags: 0, boxes: false, leaving: 0, lot: null, slotKey: '', slot: 0,
    })
    const p = out[out.length - 1]
    p.pos = { x: p.home.door.x, z: p.home.door.z }
    p.lot = p.home
  }
  return out
}

// where an activity happens, how to stand there, and whether the pip goes inside
type Plan = { lot: Lot | null; to: V2; door: V2; pose: Pose; hide: boolean; slotKey: string; slot: number; place: string }

export default function CityPips({ city, frame, layout, onLot }: { city: City; frame: Frame; layout: Layout; onLot: (occ: Map<number, { inside: number; awake: number }>) => void }) {
  const residents = useMemo(() => residentsOf(frame, city), [frame, city])
  const total = crowdSize(city, residents.length)
  const pips = useMemo(() => makePips(city, residents, layout, total), [city, residents, layout, total])

  // ---- geometry + materials ----
  const g = useMemo(() => ({
    torso: new THREE.CapsuleGeometry(0.24, 0.3, 4, 10),
    head: new THREE.SphereGeometry(0.3, 14, 10),
    hair: (() => { const h = new THREE.SphereGeometry(0.315, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.55); h.translate(0, 0.02, -0.02); return h })(),
    limb: (() => { const l = new THREE.CapsuleGeometry(0.09, 0.3, 3, 8); l.translate(0, -0.24, 0); return l })(),
    leg: (() => { const l = new THREE.CapsuleGeometry(0.1, 0.42, 3, 8); l.translate(0, -0.31, 0); return l })(),
    eye: new THREE.SphereGeometry(0.045, 6, 4),
    bag: new THREE.BoxGeometry(0.22, 0.26, 0.12),
    box: new THREE.BoxGeometry(0.42, 0.34, 0.34),
    sign: (() => { const pole = new THREE.CylinderGeometry(0.025, 0.025, 1.0, 5); pole.translate(0, 0.5, 0); const board = new THREE.BoxGeometry(0.62, 0.42, 0.04); board.translate(0, 1.15, 0); return mergeTwo(pole, board) })(),
    bike: (() => { const w1 = new THREE.TorusGeometry(0.22, 0.04, 5, 14); w1.rotateY(Math.PI / 2); w1.translate(0, 0.22, 0.36); const w2 = w1.clone(); w2.translate(0, 0, -0.72); const bar = new THREE.BoxGeometry(0.05, 0.05, 0.75); bar.translate(0, 0.42, 0); return mergeTwo(mergeTwo(w1, w2), bar) })(),
    stroller: (() => { const body = new THREE.BoxGeometry(0.42, 0.32, 0.55); body.translate(0, 0.42, 0); const hood = new THREE.SphereGeometry(0.22, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2); hood.translate(0, 0.58, -0.12); const wh = new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8); wh.rotateZ(Math.PI / 2); wh.translate(0, 0.1, 0); return mergeTwo(mergeTwo(body, hood), wh) })(),
  }), [])
  const m = useMemo(() => {
    const toon = (color?: string) => new THREE.MeshToonMaterial({ color: color ?? '#ffffff', gradientMap: toonGradient() })
    return { inst: toon(), eye: toon(C.ink), bag: toon('#C8A27A'), box: toon('#B08A5A'), sign: toon(C.bone), bike: toon('#3A3A3E'), stroller: toon('#D9CFC0') }
  }, [])
  const refs = {
    torso: useRef<THREE.InstancedMesh>(null), head: useRef<THREE.InstancedMesh>(null), hair: useRef<THREE.InstancedMesh>(null),
    arm: useRef<THREE.InstancedMesh>(null), leg: useRef<THREE.InstancedMesh>(null), eye: useRef<THREE.InstancedMesh>(null),
    bag: useRef<THREE.InstancedMesh>(null), box: useRef<THREE.InstancedMesh>(null), sign: useRef<THREE.InstancedMesh>(null),
    bike: useRef<THREE.InstancedMesh>(null), stroller: useRef<THREE.InstancedMesh>(null),
  }
  const slotPip = useRef(new Int32Array(MAX))

  // ---- spots: lowest free slot per (lot, arrangement) ----
  const slots = useRef(new Map<string, Set<number>>())
  const take = (key: string) => { let s = slots.current.get(key); if (!s) { s = new Set(); slots.current.set(key, s) } let k = 0; while (s.has(k)) k++; s.add(k); return k }
  const release = (key: string, k: number) => { slots.current.get(key)?.delete(k) }

  const exitLot: Lot = useMemo(() => ({ id: -1, kind: 'square', x: layout.exit.x, z: layout.exit.z, w: 1, d: 1, door: { x: 15, z: layout.exit.z }, floors: 0 }), [layout])

  const decide = (p: Pip, a: Activity, h: number, index: number): Plan => {
    const L = (k: Parameters<Layout['byKind']['get']>[0]) => layout.byKind.get(k) ?? null
    const home: Plan = { lot: p.home, to: { x: p.home.x, z: p.home.z }, door: p.home.door, pose: 'stand', hide: true, slotKey: '', slot: 0, place: 'home' }
    const at = (lot: Lot | null, kind: Parameters<typeof spotIn>[3], pose: Pose, place: string, hide = false): Plan => {
      if (!lot) return home
      const key = `${lot.id}:${kind}`
      const k = take(key)
      return { lot, to: spotIn(lot, k, 12, kind), door: lot.door, pose, hide, slotKey: key, slot: k, place }
    }
    const happy = p.c.mood.joy + p.c.mood.hope > 0.8
    switch (a) {
      case 'sleeping': return home
      case 'eating': return h >= 11 && h < 14 && p.work ? at(L('market'), 'crowd', 'stand', 'the market') : home
      case 'commuting': {
        const next = nextNonCommute(p.plan, index)
        const d = decide(p, next, h + 1, index + 1)
        return { ...d, pose: d.pose }
      }
      case 'working': {
        if (!p.work) return home
        const k = p.work.kind
        const pose: Pose = k === 'farm' ? 'bob' : k === 'factory' || k === 'lab' || k === 'power_plant' || k === 'launch_site' ? 'machine' : k === 'construction' ? 'hammer' : 'stand'
        if (k === 'office') return at(p.work, 'crowd', 'stand', 'the office', true)
        return at(p.work, k === 'farm' ? 'rows' : 'crowd', pose, workWords(p.c.workplace))
      }
      case 'school': return at(L('school'), 'crowd', 'stand', 'the school')
      case 'shopping': return at(L('market'), 'crowd', 'stand', 'the market')
      case 'socializing': return happy ? at(L('park'), 'ring', 'stand', 'the park') : home
      case 'resting': return p.idx % 2 ? home : { ...home, hide: false, pose: 'sit', to: { x: p.home.door.x + (p.home.door.z > p.home.z ? 0.4 : -0.4), z: p.home.door.z + (p.home.door.z > p.home.z ? -0.55 : 0.55) }, place: 'home' }
      case 'celebrating': return at(L('square'), 'ring', 'armsUp', 'the square')
      case 'protesting': return at(L('square'), 'crowd', 'sign', 'the square')
      case 'striking': return at(L('factory') ?? p.work ?? L('market'), 'line', 'sit', `outside ${workWords(p.c.workplace === 'none' ? 'factory' : p.c.workplace)}`)
      case 'praying': return L('shrine') ? at(L('shrine'), 'ring', 'kneel', 'the shrine') : home
      case 'aid_line': return at(L('clinic'), 'queue', 'stand', 'the aid line')
      case 'moving': return { lot: exitLot, to: layout.exit, door: exitLot.door, pose: 'stand', hide: true, slotKey: '', slot: 0, place: 'the road out of town' }
      case 'idle': return at(L('park'), 'crowd', 'stand', 'the park')
    }
  }

  // ---- callouts: what is notable in town right now ----
  const [notes, setNotes] = useState<Callout[]>([])
  useCallouts('city', notes)
  const lastNotes = useRef('')

  // ---- the frame loop ----
  const _M = useMemo(() => ({ base: new THREE.Matrix4(), t: new THREE.Matrix4(), a: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), s: new THREE.Vector3(), torso: new THREE.Matrix4(), head: new THREE.Matrix4(), arm: new THREE.Matrix4(), leg: new THREE.Matrix4(), out: new THREE.Matrix4() }), [])
  const occAcc = useRef(0)
  useFrame(() => {
    // the world clock: everyone stands still while paused
    const dt = sceneRefs.wdt
    const st = useStore.getState()
    const lh = localHour(utcHourOf(worldDate(st.playhead, st.hour, st.playing)), city.lon)
    const t = sceneRefs.wt
    const fastForward = st.playing
    let n = 0, nb = 0, nbox = 0, ns = 0, nbike = 0, nst = 0, nh = 0
    const R = refs
    const { base, a: tmp, q, e, s } = _M
    const T = (x: number, y: number, z: number) => tmp.makeTranslation(x, y, z)
    const RX = (ang: number) => _M.t.makeRotationX(ang)
    for (const p of pips) {
      // 1. what now
      const { step, index, until } = stepAt(p.plan, lh, p.jitter)
      const key = `${index}:${step.activity}`
      if (key !== p.stepKey) {
        p.stepKey = key
        if (p.slotKey) release(p.slotKey, p.slot)
        const d = decide(p, step.activity, lh, index)
        p.slotKey = d.slotKey
        p.slot = d.slot
        if (step.activity === 'shopping') { const ratio = (p.c.spending ?? 1) / Math.max(1, p.c.income ?? 1); p.boxes = p.c.behavior === 'hoarding' || p.c.behavior === 'panic_buying'; p.bags = Math.max(1, Math.min(3, Math.round(ratio * 2))) }
        else if (step.activity !== 'commuting') { p.bags = step.activity === 'moving' ? 2 : 0; if (step.activity !== 'moving') p.boxes = false }
        p.act = step.activity
        p.place = d.place
        p.until = until
        const from = p.lot ?? p.home
        p.path = pathBetween(p.hidden ? from.door : p.pos, from.door, d.to, d.door)
        p.seg = 0
        p.arrived = false
        p.hideOnArrive = d.hide
        p.pose = d.pose
        p.lot = d.lot
        p.leaving = 0
        if (p.hidden && step.activity !== 'sleeping') { p.pos = { ...from.door }; p.hidden = false }
        if (fastForward) { const last = p.path[p.path.length - 1]; p.pos = { ...last }; p.arrived = true; p.hidden = d.hide }
      }
      // 2. move
      if (!p.arrived && p.path.length) {
        const speed = (p.tram ? 7 : p.bike ? 4.6 : p.kid ? 2.4 : 2.9) * dt
        let left = speed
        while (left > 0 && p.seg < p.path.length - 1) {
          const b = p.path[p.seg + 1]
          const dx = b.x - p.pos.x, dz = b.z - p.pos.z, dist = Math.hypot(dx, dz)
          if (dist > 1e-4) p.heading = Math.atan2(dx, dz)
          if (dist <= left) { p.pos = { x: b.x, z: b.z }; p.seg++; left -= dist } else { p.pos = { x: p.pos.x + (dx / dist) * left, z: p.pos.z + (dz / dist) * left }; left = 0 }
        }
        if (p.seg >= p.path.length - 1) { p.arrived = true; if (p.hideOnArrive) p.hidden = true }
      }
      if (p.act === 'moving' && p.arrived) { p.leaving = Math.min(1, p.leaving + dt); p.hidden = p.leaving >= 1 }
      // 3. draw
      const riding = !p.arrived && (p.bike || p.tram)
      if (p.hidden || (p.tram && !p.arrived)) continue
      const slot = n++
      slotPip.current[slot] = p.idx
      const fade = p.act === 'moving' && p.arrived ? 1 - p.leaving : 1
      const sz = p.size * fade
      const walking = !p.arrived
      const pose: Pose = walking ? (riding ? 'ride' : 'walk') : p.pose
      const ph = t * (riding ? 9 : 7) + p.idx
      let hip = 0.62, pitch = 0, legL = 0, legR = 0, armL = 0.08, armR = 0.08, yOff = 0
      switch (pose) {
        case 'walk': legL = Math.sin(ph) * 0.6; legR = -legL; armL = -legL * 0.8; armR = legL * 0.8; yOff = Math.abs(Math.cos(ph)) * 0.04; break
        case 'ride': hip = 0.78; legL = -0.9 + Math.sin(ph) * 0.5; legR = -0.9 - Math.sin(ph) * 0.5; armL = armR = -1.1; pitch = 0.2; break
        case 'sit': hip = 0.3; legL = legR = -1.45; armL = armR = -0.3; break
        case 'kneel': hip = 0.36; legL = legR = 1.35; pitch = 0.22; armL = armR = -0.75; break
        case 'armsUp': armL = armR = -2.8 + Math.sin(t * 6 + p.idx) * 0.2; yOff = Math.abs(Math.sin(t * 6 + p.idx)) * 0.18; break
        case 'sign': armL = -2.7; armR = 0.1; yOff = Math.abs(Math.sin(t * 2 + p.idx)) * 0.04; break
        case 'bob': pitch = 0.55 + Math.sin(t * 2 + p.idx) * 0.3; armL = armR = -1.0; break
        case 'machine': armL = armR = -1.3 + Math.sin(t * 5 + p.idx) * 0.25; pitch = 0.1; break
        case 'hammer': armR = -1.4 + Math.sin(t * 6 + p.idx) * 0.9; armL = -0.4; break
        default: armL = 0.1 + Math.sin(t * 1.3 + p.idx) * 0.04; armR = -armL
      }
      if (p.boxes && (p.bags || p.act === 'shopping') && pose !== 'sign') { armL = armR = -1.2 }
      e.set(0, p.heading, 0)
      base.compose(s.set(p.pos.x, GROUND_Y + yOff, p.pos.z), q.setFromEuler(e), _M.v.set(sz, sz, sz))
      const torsoM = _M.torso.copy(base).multiply(T(0, hip, 0)).multiply(RX(pitch))
      R.torso.current!.setMatrixAt(slot, _M.out.copy(torsoM).multiply(T(0, 0.36, 0)))
      R.torso.current!.setColorAt(slot, p.cloth)
      const headM = _M.head.copy(torsoM).multiply(T(0, 0.98, 0))
      if (p.kid) headM.scale(_M.v.set(1.2, 1.2, 1.2))
      R.head.current!.setMatrixAt(slot, headM)
      R.head.current!.setColorAt(slot, p.skin)
      if (p.hair) { R.hair.current!.setMatrixAt(nh, headM); R.hair.current!.setColorAt(nh, p.hair); nh++ }
      for (const side of [0, 1]) {
        const sx = side ? -1 : 1
        R.eye.current!.setMatrixAt(slot * 2 + side, _M.out.copy(headM).multiply(T(sx * 0.1, 0.03, 0.27)))
        const arm = _M.arm.copy(torsoM).multiply(T(sx * 0.3, 0.6, 0)).multiply(RX(side ? armR : armL))
        R.arm.current!.setMatrixAt(slot * 2 + side, arm)
        R.arm.current!.setColorAt(slot * 2 + side, p.cloth)
        const leg = _M.leg.copy(base).multiply(T(sx * 0.13, hip, 0)).multiply(RX(side ? legR : legL))
        R.leg.current!.setMatrixAt(slot * 2 + side, leg)
        R.leg.current!.setColorAt(slot * 2 + side, p.legCol)
        // bags hang from the hands
        if (p.bags > side && !p.boxes && pose !== 'sign') R.bag.current!.setMatrixAt(nb++, _M.out.copy(arm).multiply(T(0, -0.62, 0.02)))
      }
      if (p.bags > 2 && !p.boxes) R.bag.current!.setMatrixAt(nb++, _M.out.copy(torsoM).multiply(T(0, 0.4, -0.3)))
      if (p.boxes && (p.bags || p.act === 'shopping')) R.box.current!.setMatrixAt(nbox++, _M.out.copy(torsoM).multiply(T(0, 0.42, 0.42)))
      if (pose === 'sign') R.sign.current!.setMatrixAt(ns++, _M.out.copy(base).multiply(T(0.36, hip + 0.55, 0.12)))
      if (riding && p.bike) R.bike.current!.setMatrixAt(nbike++, base)
      if (p.c.behavior === 'starting_family' && !p.kid && (pose === 'walk' || pose === 'stand')) R.stroller.current!.setMatrixAt(nst++, _M.out.copy(base).multiply(T(0, 0, 0.85)))
    }
    const done = (mesh: THREE.InstancedMesh | null, count: number) => {
      if (!mesh) return
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    done(R.torso.current, n); done(R.head.current, n); done(R.hair.current, nh)
    done(R.arm.current, n * 2); done(R.leg.current, n * 2); done(R.eye.current, n * 2)
    done(R.bag.current, nb); done(R.box.current, nbox); done(R.sign.current, ns); done(R.bike.current, nbike); done(R.stroller.current, nst)

    // 4. a few times a second: who is in which building, and what is notable
    occAcc.current += dt
    if (occAcc.current > 0.4) {
      occAcc.current = 0
      const occ = new Map<number, { inside: number; awake: number }>()
      for (const p of pips) {
        const lot = p.arrived ? p.lot : null
        if (!lot || lot.id < 0) continue
        const o = occ.get(lot.id) ?? { inside: 0, awake: 0 }
        o.inside++
        if (p.act !== 'sleeping') o.awake++
        occ.set(lot.id, o)
      }
      onLot(occ)
      const count = (act: Activity) => pips.filter((p) => p.act === act && !p.hidden).length
      const list: Callout[] = []
      const aid = count('aid_line'), prot = count('protesting'), cel = count('celebrating')
      const clinic = layout.byKind.get('clinic'), square = layout.byKind.get('square')
      if (aid && clinic) list.push({ id: 'city-aid', pos: new THREE.Vector3(clinic.door.x + 2, 2.2, clinic.door.z), title: 'aid line', text: 'people queueing for aid at the clinic', weight: 3, danger: true })
      if (prot && square) list.push({ id: 'city-protest', pos: new THREE.Vector3(square.x, 2.6, square.z), title: 'protest', text: 'people protesting in the square', weight: 3, danger: true })
      if (cel && square) list.push({ id: 'city-party', pos: new THREE.Vector3(square.x, 2.6, square.z + 1), title: 'celebration', text: 'people celebrating in the square', weight: 2 })
      const sig = list.map((x) => x.id + x.text).join('|')
      if (sig !== lastNotes.current) { lastNotes.current = sig; setNotes(list) }
    }
  })

  useEffect(() => () => { slots.current.clear() }, [pips])

  const pipAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId != null ? pips[slotPip.current[e.instanceId]] : undefined)
  const tipFor = (e: ThreeEvent<PointerEvent>) => {
    const p = pipAt(e)
    if (!p) return
    useStore.getState().setTip({ title: p.real ? `${p.name}, ${p.age}` : 'a passerby', text: `${p.place} until ${fmtH(p.until)}`, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
  }
  const events = {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); const p = pipAt(e); if (p?.real) useStore.getState().select({ kind: 'pip', id: p.baseId }) },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; tipFor(e) },
    onPointerMove: tipFor,
    onPointerOut: () => { document.body.style.cursor = ''; useStore.getState().setTip(null) },
  }
  const im = (ref: React.RefObject<THREE.InstancedMesh | null>, geo: THREE.BufferGeometry, mat: THREE.Material, count: number, pick = false) => (
    <instancedMesh ref={ref} args={[geo, mat, count]} frustumCulled={false} castShadow receiveShadow={false} {...(pick ? events : { raycast: () => null })} />
  )
  return (
    <group>
      {im(refs.torso, g.torso, m.inst, MAX, true)}
      {im(refs.head, g.head, m.inst, MAX, true)}
      {im(refs.hair, g.hair, m.inst, MAX)}
      {im(refs.arm, g.limb, m.inst, MAX * 2)}
      {im(refs.leg, g.leg, m.inst, MAX * 2)}
      {im(refs.eye, g.eye, m.eye, MAX * 2)}
      {im(refs.bag, g.bag, m.bag, MAX * 3)}
      {im(refs.box, g.box, m.box, MAX)}
      {im(refs.sign, g.sign, m.sign, MAX)}
      {im(refs.bike, g.bike, m.bike, MAX)}
      {im(refs.stroller, g.stroller, m.stroller, MAX)}
    </group>
  )
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  const strip = (x: THREE.BufferGeometry) => { const n = x.index ? x.toNonIndexed() : x; const o = new THREE.BufferGeometry(); o.setAttribute('position', n.getAttribute('position')); o.setAttribute('normal', n.getAttribute('normal')); return o }
  const A = strip(a), B = strip(b)
  const pos = new Float32Array(A.attributes.position.array.length + B.attributes.position.array.length)
  pos.set(A.attributes.position.array as Float32Array); pos.set(B.attributes.position.array as Float32Array, A.attributes.position.array.length)
  const nor = new Float32Array(pos.length)
  nor.set(A.attributes.normal.array as Float32Array); nor.set(B.attributes.normal.array as Float32Array, A.attributes.normal.array.length)
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return out
}
