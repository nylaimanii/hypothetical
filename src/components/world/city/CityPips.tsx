'use client'
// the people of the city view, drawn from pipSim (their day, their walk, their rig) and the traffic from trafficSim,
// stepped together each frame so cars stop for people and people wait for cars. everything here follows the ragdoll
// rules in CLAUDE.md; in dev, qa.ts checks every frame and logs who, where and what (window.__qa has the counts).
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type { Citizen, City, Frame } from '@/lib/types'
import { C, HAIR_HEX, MONK, toonGradient } from '../lib'
import { localHour, utcHourOf, worldDate } from '../time'
import { useStore } from '../../state/store'
import { useCallouts, type Callout } from '../explain'
import { fmtH } from './day'
import type { Grid } from './grid'
import { crowdSize, passersbyFor, makePeople, newRig, rigOf, stepPeople, MAX_PEOPLE, RIG, type Person, type Rig, type Scene, type Slots } from './pipSim'
import { driveLines, stepTraffic, vehicleBox, type Traffic } from './trafficSim'
import { checkFrame, checkSizes, checkTraffic, newQaState, type Violation } from './qa'

const CLOTH = ['#7E9CB5', '#C9A46A', '#8FAE84', '#B98370', '#9C8CB8', '#D2B48C', '#6F8F95', '#B5A27E', '#A5788F', '#7FA39A']
const MAXP = MAX_PEOPLE

export function residentsOf(frame: Frame, city: City): Citizen[] {
  const own = frame.citizens.filter((c) => (c as Citizen & { cityId?: string }).cityId === city.id)
  if (own.length >= 3) return own
  const country = frame.citizens.filter((c) => c.countryId && c.countryId === city.countryId)
  const pool = [...own, ...country]
  if (pool.length >= 3) return pool.slice(0, 10)
  const region = frame.citizens.filter((c) => c.regionId === city.regionId)
  return (region.length ? region : frame.citizens).slice(0, 8)
}

// a material that fades a body part by ordered dithering (no transparency sorting, no popping)
function fadeMat(color?: string) {
  const m = new THREE.MeshToonMaterial({ color: color ?? '#ffffff', gradientMap: toonGradient() })
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;')
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying float vFade;
      float bayer4(vec2 p) { ivec2 q = ivec2(mod(p, 4.0)); int i = q.x + q.y * 4;
        int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(b[i]) + 0.5) / 16.0; }`)
      .replace('void main() {', 'void main() {\n  if (vFade < bayer4(gl_FragCoord.xy)) discard;')
  }
  m.customProgramCacheKey = () => 'pipfade'
  return m
}

export default function CityPips({ city, frame, grid, scene, traffic, onLot, night, density }: { city: City; frame: Frame; grid: Grid; scene: Scene; traffic: Traffic; onLot: (occ: Map<number, { inside: number; awake: number }>) => void; night: () => number; density: number }) {
  // the people are made once per city, year and set of residents (frames get replaced often: rebuilding the crowd
  // each time would make everyone vanish and reappear)
  const residentsNow = residentsOf(frame, city)
  const resKey = residentsNow.map((c) => `${c.id}:${c.age}:${c.workplace ?? ''}:${(c as { home?: string }).home ?? ''}`).join('|')
  const year = Math.floor((frame.tick + 10) / 12)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const residents = useMemo(() => residentsNow, [resKey])
  const total = crowdSize(city.population, density)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const people = useMemo(() => makePeople({ cityId: city.id, countryId: city.countryId, tick: frame.tick, residents, grid, total, passersby: passersbyFor(density) }), [city.id, city.countryId, year, residents, grid, total, density])
  const slots = useRef<Slots>(new Map())
  useEffect(() => { slots.current = new Map() }, [people])
  const { cross } = useMemo(() => driveLines(grid.tramZ), [grid.tramZ])

  // ---- looks ----
  const look = useMemo(() => people.map((p) => {
    const tone = Math.max(1, Math.min(10, p.c.skinTone))
    const seed = p.c.personalitySeed + p.idx * 7
    return {
      skin: new THREE.Color(MONK[tone - 1]), cloth: new THREE.Color(CLOTH[seed % CLOTH.length]),
      legs: new THREE.Color(CLOTH[(seed + 5) % CLOTH.length]).multiplyScalar(0.62),
      hair: p.c.hair === 'bald' && p.idx < residents.length ? null : new THREE.Color(HAIR_HEX[p.c.hairColor] ?? '#2a2420'),
    }
  }), [people, residents.length])

  // ---- geometry ----
  const g = useMemo(() => {
    const cap = (r: number, total: number) => { const c = new THREE.CapsuleGeometry(r, Math.max(0.001, total - 2 * r), 3, 8); c.translate(0, -total / 2, 0); return c }
    const merge = (parts: THREE.BufferGeometry[]) => {
      const ps = parts.map((x) => (x.index ? x.toNonIndexed() : x))
      const len = ps.reduce((a, x) => a + x.attributes.position.array.length, 0)
      const pos = new Float32Array(len), nor = new Float32Array(len)
      let o = 0
      for (const x of ps) { pos.set(x.attributes.position.array as Float32Array, o); nor.set(x.attributes.normal.array as Float32Array, o); o += x.attributes.position.array.length }
      const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); return out
    }
    const at = (x: THREE.BufferGeometry, px: number, py: number, pz: number) => { x.translate(px, py, pz); return x }
    return {
      torso: new THREE.CapsuleGeometry(RIG.torsoR, 0.3, 4, 10),
      head: new THREE.SphereGeometry(RIG.headR, 14, 10),
      hair: (() => { const h = new THREE.SphereGeometry(0.315, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.55); h.translate(0, 0.02, -0.02); return h })(),
      arm: cap(RIG.armR, RIG.arm), thigh: cap(RIG.legR, RIG.thigh), shin: cap(RIG.shinR, RIG.shin),
      eye: new THREE.SphereGeometry(0.045, 6, 4),
      bag: new THREE.BoxGeometry(0.22, 0.26, 0.12),
      box: new THREE.BoxGeometry(0.42, 0.34, 0.34),
      sign: merge([at(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 5), 0, 0.5, 0), at(new THREE.BoxGeometry(0.62, 0.42, 0.04), 0, 1.15, 0)]),
      // a bicycle at real size for the rider (wheels 0.68 m), handlebar where the rider's hands are
      bike: merge([
        at(new THREE.TorusGeometry(0.36, 0.035, 5, 16).rotateY(Math.PI / 2), 0, 0.36, 0.62), at(new THREE.TorusGeometry(0.36, 0.035, 5, 16).rotateY(Math.PI / 2), 0, 0.36, -0.62),
        at(new THREE.BoxGeometry(0.05, 0.05, 1.0), 0, 0.72, 0), at(new THREE.BoxGeometry(0.05, 0.55, 0.05), 0, 0.68, -0.2), at(new THREE.BoxGeometry(0.16, 0.05, 0.28), 0, 0.97, -0.25),
        at(new THREE.BoxGeometry(0.05, 0.6, 0.05), 0, 0.95, 0.55), at(new THREE.BoxGeometry(0.56, 0.04, 0.04), 0, 1.25, 0.55),
      ]),
      // a stroller pushed from a handlebar at the adult's hands (handle at the origin), basket in front, wheels down
      stroller: merge([
        at(new THREE.BoxGeometry(0.6, 0.03, 0.03), 0, 0, 0), at(new THREE.BoxGeometry(0.03, 0.03, 0.42), 0.28, -0.12, 0.2), at(new THREE.BoxGeometry(0.03, 0.03, 0.42), -0.28, -0.12, 0.2),
        at(new THREE.BoxGeometry(0.5, 0.4, 0.62), 0, -0.36, 0.62), at(new THREE.SphereGeometry(0.27, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0, -0.16, 0.42),
        at(new THREE.CylinderGeometry(0.12, 0.12, 0.56, 10).rotateZ(Math.PI / 2), 0, -0.84, 0.36), at(new THREE.CylinderGeometry(0.12, 0.12, 0.56, 10).rotateZ(Math.PI / 2), 0, -0.84, 0.88),
      ]),
      // a baby: swaddled body across the arms, head at one end
      baby: merge([at(new THREE.CapsuleGeometry(0.14, 0.24, 3, 8).rotateZ(Math.PI / 2), 0, 0, 0), at(new THREE.SphereGeometry(0.12, 10, 8), 0.3, 0.04, 0)]),
    }
  }, [])
  const m = useMemo(() => ({ inst: fadeMat(), eye: fadeMat(C.ink), bag: fadeMat('#C8A27A'), box: fadeMat('#B08A5A'), sign: fadeMat(C.bone), bike: fadeMat('#3A3A3E'), stroller: fadeMat('#D9CFC0'), baby: fadeMat() }), [])
  const parts = {
    torso: useRef<THREE.InstancedMesh>(null), head: useRef<THREE.InstancedMesh>(null), hair: useRef<THREE.InstancedMesh>(null), eye: useRef<THREE.InstancedMesh>(null),
    arm: useRef<THREE.InstancedMesh>(null), thigh: useRef<THREE.InstancedMesh>(null), shin: useRef<THREE.InstancedMesh>(null),
    bag: useRef<THREE.InstancedMesh>(null), box: useRef<THREE.InstancedMesh>(null), sign: useRef<THREE.InstancedMesh>(null), bike: useRef<THREE.InstancedMesh>(null), stroller: useRef<THREE.InstancedMesh>(null), baby: useRef<THREE.InstancedMesh>(null),
  }
  const caps: Record<keyof typeof parts, number> = { torso: MAXP, head: MAXP, hair: MAXP, eye: MAXP * 2, arm: MAXP * 2, thigh: MAXP * 2, shin: MAXP * 2, bag: MAXP * 2, box: MAXP, sign: MAXP, bike: MAXP, stroller: MAXP, baby: MAXP }
  const fades = useMemo(() => Object.fromEntries(Object.entries(caps).map(([k, n]) => [k, new Float32Array(n)])) as Record<keyof typeof parts, Float32Array>, []) // eslint-disable-line react-hooks/exhaustive-deps
  // wire each instanced mesh's fade attribute once
  useEffect(() => {
    for (const k of Object.keys(parts) as (keyof typeof parts)[]) {
      const mesh = parts[k].current
      if (!mesh) continue
      mesh.geometry = mesh.geometry.clone()
      mesh.geometry.setAttribute('aFade', new THREE.InstancedBufferAttribute(fades[k], 1))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rigs = useRef(new Map<number, Rig>())
  const slotPip = useRef(new Int32Array(MAXP))
  const qa = useRef({ state: newQaState(), traffic: new Map(), seen: new Map<string, number>(), counts: new Map<string, number>(), frame: 0 })
  const DEV = process.env.NODE_ENV !== 'production'
  useEffect(() => { if (DEV) for (const v of checkSizes()) console.warn(`[ragdoll qa] ${v.rule}: ${v.what}`) }, [DEV])

  // ---- callouts ----
  const [notes, setNotes] = useState<Callout[]>([])
  useCallouts('city', notes)
  const lastNotes = useRef('')
  const occAcc = useRef(0)
  const _m = useMemo(() => ({ a: new THREE.Matrix4(), v: new THREE.Vector3() }), [])

  useFrame(({ clock }, dtRaw) => {
    // the simulation never steps more than 1/30 s at once (the qa runs at that step): below 30 fps the street runs a
    // little slower rather than letting a long frame carry a body past where its planted feet can reach
    const dt = Math.min(dtRaw, 1 / 30)
    const st = useStore.getState()
    const lh = localHour(utcHourOf(worldDate(st.playhead, st.hour, st.playing)), city.lon)
    const t = clock.elapsedTime
    // 1. traffic, then people (each sees the other)
    const out = people.filter((p) => p.vis > 0.3 && !p.inside && !p.baby).map((p) => ({ x: p.pos.x, z: p.pos.z, r: p.r, vx: p.moving ? Math.sin(p.heading) * p.speed : 0, vz: p.moving ? Math.cos(p.heading) * p.speed : 0, waiting: (p.curbWait ?? 0) > 0.8 }))
    stepTraffic(traffic, lh, dt, out, cross)
    const cars = traffic.vehicles.filter((v) => v.active).map((v) => ({ ...vehicleBox(v), vx: v.axis === 0 ? v.dir * v.v : 0, vz: v.axis === 1 ? v.dir * v.v : 0 }))
    stepPeople(scene, people, slots.current, lh, dt, st.playing, cars)

    // 2. draw
    const count: Record<keyof typeof parts, number> = { torso: 0, head: 0, hair: 0, eye: 0, arm: 0, thigh: 0, shin: 0, bag: 0, box: 0, sign: 0, bike: 0, stroller: 0, baby: 0 }
    const put = (k: keyof typeof parts, mtx: THREE.Matrix4, fade: number, color?: THREE.Color) => {
      const mesh = parts[k].current
      if (!mesh || count[k] >= caps[k]) return
      const i = count[k]++
      mesh.setMatrixAt(i, mtx)
      if (color) mesh.setColorAt(i, color)
      fades[k][i] = fade
    }
    for (const p of people) {
      if (p.baby || p.vis <= 0.01 || (p.inside && p.vis <= 0.01)) { rigs.current.delete(p.idx); continue }
      let R = rigs.current.get(p.idx)
      if (!R) { R = newRig(); rigs.current.set(p.idx, R) }
      rigOf(p, people, t, R, dt)
      const L = look[p.idx], f = p.vis
      slotPip.current[count.torso] = p.idx
      put('torso', R.torso, f, L.cloth)
      put('head', R.head, f, L.skin)
      if (L.hair) put('hair', R.head, f, L.hair)
      for (const side of [0, 1] as const) {
        put('eye', _m.a.copy(R.head).multiply(new THREE.Matrix4().makeTranslation(side ? -0.1 : 0.1, 0.03, 0.27)), f)
        put('arm', R.arms[side], f, L.cloth)
        put('thigh', R.thighs[side], f, L.legs)
        put('shin', R.shins[side], f, L.legs)
      }
      for (const it of R.items) {
        if (it.kind === 'baby') { const b = people[p.ward]; put('baby', it.m, f, b ? look[b.idx].skin : L.skin); continue }
        put(it.kind, it.m, f)
        if (it.kind === 'stroller') { const b = people[p.ward]; put('baby', _m.a.copy(it.m).multiply(new THREE.Matrix4().makeTranslation(0, -0.14, 0.62)), f, b ? look[b.idx].skin : L.skin) }
      }
    }
    for (const k of Object.keys(parts) as (keyof typeof parts)[]) {
      const mesh = parts[k].current
      if (!mesh) continue
      mesh.count = count[k]
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      const a = mesh.geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute | undefined
      if (a) a.needsUpdate = true
    }

    // 3. dev: the ragdoll rules, every frame
    if (DEV) {
      const Q = qa.current
      Q.frame++
      const vs: Violation[] = [...checkFrame(scene, people, rigs.current, traffic.vehicles, dt, lh, Q.state, st.playing), ...checkTraffic(traffic.vehicles, traffic.far, Q.traffic)]
      for (const v of vs) {
        Q.counts.set(v.rule, (Q.counts.get(v.rule) ?? 0) + 1)
        const key = `${v.rule}|${v.who}`
        const last = Q.seen.get(key)
        if (last === undefined || Q.frame - last > 60) console.warn(`[ragdoll qa] ${v.rule}: ${v.who} at ${v.where}: ${v.what}`)
        Q.seen.set(key, Q.frame)
      }
      ;(window as unknown as { __qa?: unknown }).__qa = { counts: Object.fromEntries(Q.counts), frames: Q.frame, people: people.length, live: { people, rigs: rigs.current } }
    }

    // 4. a few times a second: who is in which building (for lit windows), and what is notable
    occAcc.current += dt
    if (occAcc.current > 0.4) {
      occAcc.current = 0
      const occ = new Map<number, { inside: number; awake: number }>()
      for (const p of people) {
        const lot = p.inside ? p.lot : null
        if (!lot) continue
        const o = occ.get(lot.id) ?? { inside: 0, awake: 0 }
        o.inside++
        if (p.act !== 'sleeping') o.awake++
        occ.set(lot.id, o)
      }
      onLot(occ)
      const outside = (act: Person['act']) => people.filter((p) => p.act === act && p.vis > 0.5 && !p.inside).length
      const list: Callout[] = []
      const aid = outside('aid_line'), prot = outside('protesting'), cel = outside('celebrating')
      const clinic = grid.byKind.get('clinic'), square = grid.byKind.get('square')
      if (aid && clinic) list.push({ id: 'city-aid', pos: new THREE.Vector3(clinic.door.x + 1, 1.6, clinic.door.z), title: 'aid line', text: `${aid} people queueing at the clinic. they lost their jobs`, weight: 3, danger: true })
      if (prot && square) list.push({ id: 'city-protest', pos: new THREE.Vector3(square.x, 1.8, square.z), title: 'protest', text: `${prot} people in the square instead of at work`, weight: 3, danger: true })
      if (cel && square) list.push({ id: 'city-party', pos: new THREE.Vector3(square.x, 1.8, square.z + 0.8), title: 'celebration', text: `${cel} people celebrating in the square`, weight: 2 })
      const sig = list.map((x) => x.id + x.text).join('|')
      if (sig !== lastNotes.current) { lastNotes.current = sig; setNotes(list) }
    }
    void night
  })

  const pipAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId != null ? people[slotPip.current[e.instanceId]] : undefined)
  const tipFor = (e: ThreeEvent<PointerEvent>) => {
    const p = pipAt(e)
    if (!p) return
    useStore.getState().setTip({ title: `${p.name}, ${p.age}`, text: `${p.place} until ${fmtH(p.until)}`, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
  }
  const events = {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); const p = pipAt(e); if (p) useStore.getState().select({ kind: 'pip', id: p.baseId }) },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; tipFor(e) },
    onPointerMove: tipFor,
    onPointerOut: () => { document.body.style.cursor = ''; useStore.getState().setTip(null) },
  }
  const im = (k: keyof typeof parts, geo: THREE.BufferGeometry, mat: THREE.Material, pick = false) => (
    <instancedMesh ref={parts[k]} args={[geo, mat, caps[k]]} frustumCulled={false} castShadow receiveShadow={false} {...(pick ? events : { raycast: () => null })} />
  )
  return (
    <group>
      {im('torso', g.torso, m.inst, true)}
      {im('head', g.head, m.inst, true)}
      {im('hair', g.hair, m.inst)}
      {im('eye', g.eye, m.eye)}
      {im('arm', g.arm, m.inst)}
      {im('thigh', g.thigh, m.inst)}
      {im('shin', g.shin, m.inst)}
      {im('bag', g.bag, m.bag)}
      {im('box', g.box, m.box)}
      {im('sign', g.sign, m.sign)}
      {im('bike', g.bike, m.bike)}
      {im('stroller', g.stroller, m.stroller)}
      {im('baby', g.baby, m.baby)}
    </group>
  )
}
