'use client'
// draws everyone around her from ./population (who is where doing what, posed and solved), on the two-segment rig:
// torso, head, hair, eyes, legs, feet, arms, hands and props, all instanced. the population owns every rule (babies
// in arms, kids beside a grown-up, a seat under every sitter, nobody inside anyone); this file only draws, and fades
// anyone who would stand between the camera and her.
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { MONK, HAIR_HEX, C, toonGradient } from '@/components/world/lib'
import type { LiveState } from './ChosenPerson'
import type { WorldNow } from './Scene'
import { boneMatrix } from './rig'
import type { Placed, Population } from './population'

const SHOES = new THREE.Color('#2f2a26')
const C_INK = new THREE.Color('#1d1b19')
const BASIN = new THREE.Color('#D9483B')
const BROOM = new THREE.Color('#B59A5E')
const PHONE = new THREE.Color('#1d1b19')
const WRAP = new THREE.Color('#E8A13A')
const colorCache = new Map<string, THREE.Color>()
const col = (hex: string) => { let c = colorCache.get(hex); if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c) } return c }
export type FrameBodies = { list: Placed[]; vehicles: { x: number; z: number; w: number; l: number; heading: number }[] }

export default function Crowd({ pop, world, live, budget, bodies }: { pop: Population; world: React.RefObject<WorldNow>; live: React.RefObject<LiveState>; budget: React.RefObject<number>; bodies: React.RefObject<FrameBodies> }) {
  const MAX = pop.MAX + 30
  const { camera } = useThree()
  // softened limbs: rounded boxes read as bodies, not crates (still the chunky style)
  const box = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 2, 0.32), [])
  const plainBox = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const head = useMemo(() => { const g = new THREE.SphereGeometry(0.5, 14, 10); g.scale(1, 1.05, 1); return g }, [])
  const mat = useMemo(() => new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonGradient() }), [])
  const eyeMat = useMemo(() => new THREE.MeshToonMaterial({ color: C.ink, gradientMap: toonGradient() }), [])
  const R = {
    torso: useRef<THREE.InstancedMesh>(null), head: useRef<THREE.InstancedMesh>(null), hair: useRef<THREE.InstancedMesh>(null), eye: useRef<THREE.InstancedMesh>(null),
    leg: useRef<THREE.InstancedMesh>(null), foot: useRef<THREE.InstancedMesh>(null), arm: useRef<THREE.InstancedMesh>(null), hand: useRef<THREE.InstancedMesh>(null), prop: useRef<THREE.InstancedMesh>(null),
  }
  const T = useMemo(() => ({ root: new THREE.Matrix4(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), s: new THREE.Vector3(), ab: new THREE.Vector3(), ap: new THREE.Vector3(), pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scl: new THREE.Vector3() }), [])
  const fade = useRef(new Map<string, number>())

  // how clear the line from the camera to her is at (x, z): 0 right in it, 1 well out of it
  const clearOf = (x: number, z: number, L: LiveState) => {
    const cx = camera.position.x, cz = camera.position.z
    if (Math.hypot(x - cx, z - cz) < 0.8) return 0
    T.ab.set(L.head.x - cx, 0, L.head.z - cz); T.ap.set(x - cx, 0, z - cz)
    const len2 = T.ab.lengthSq(); if (len2 < 1e-6) return 1
    const k = T.ap.dot(T.ab) / len2; if (k < 0 || k > 0.92) return 1
    return Math.min(1, Math.max(0, (T.ap.addScaledVector(T.ab, -k).length() - 0.35) / 0.3))
  }

  useFrame(({ clock }, rawDt) => {
    const W = world.current, L = live.current
    const ims = [R.torso, R.head, R.hair, R.eye, R.leg, R.foot, R.arm, R.hand, R.prop].map(r => r.current)
    if (!W || !L || ims.some(x => !x)) return
    const [torso, headM, hair, eye, leg, foot, arm, hand, prop] = ims as THREE.InstancedMesh[]
    const dt = Math.min(rawDt, 0.05), t = clock.elapsedTime
    const list = pop.step(W, L, t, dt, Math.min(pop.MAX, budget.current ?? pop.MAX), bodies.current?.vehicles ?? [])
    if (bodies.current) bodies.current.list = list
    const counts = { torso: 0, head: 0, hair: 0, eye: 0, leg: 0, foot: 0, arm: 0, hand: 0, prop: 0 }
    const put = (im: THREE.InstancedMesh, which: keyof typeof counts, m: THREE.Matrix4, c: THREE.Color) => { const i = counts[which]++; im.setMatrixAt(i, m); im.setColorAt(i, c) }
    for (const b of list) {
      // the camera's line to her: anyone in it fades out of the shot (and back), never a cut through a body
      const f0 = fade.current.get(b.id) ?? 1
      const f = f0 + (clearOf(b.x, b.z, L) - f0) * (1 - Math.exp(-dt * 6))
      fade.current.set(b.id, f)
      const vis = b.presence * f
      if (vis < 0.02) continue
      const e = vis * vis * (3 - 2 * vis)
      b.root.decompose(T.pos, T.quat, T.scl)
      T.root.compose(T.pos, T.quat, T.scl.setScalar(e))
      const s = b.sol, body = b.body
      const skin = col(MONK[b.look.skin]), shirt = col(b.look.shirt), lower = col(b.look.lower), hairC = col(HAIR_HEX[b.look.hair])
      if (b.action === 'held') {
        // a baby in arms: swaddled, only the head showing
        put(torso, 'torso', boneMatrix(T.root, { ...s.torso, a: s.bones[2].b.clone(), b: s.neck.clone(), w: body.torsoW * 1.7, d: body.torsoD * 2.4 }, T.m), WRAP)
        T.m.compose(s.headPos, s.head, T.s.set(body.headW, body.headH, body.headW * 0.95)); put(headM, 'head', T.m.premultiply(T.root), skin)
        continue
      }
      put(torso, 'torso', boneMatrix(T.root, s.torso, T.m), shirt)
      if (b.look.wrap) { const w = { ...s.torso, a: s.torso.a.clone().add(new THREE.Vector3(0, -body.thigh * 0.9, 0)), b: s.torso.a.clone().add(new THREE.Vector3(0, body.torso * 0.2, 0)), w: body.torsoW * 1.05, d: body.torsoD * 1.15 }; put(torso, 'torso', boneMatrix(T.root, w, T.m), lower) } // a kanga / wrap skirt
      T.m.compose(s.headPos, s.head, T.s.set(body.headW, body.headH, body.headW * 0.95)); put(headM, 'head', T.m.premultiply(T.root), skin)
      T.m.compose(T.v.copy(s.headPos).add(new THREE.Vector3(0, body.headH * 0.2, -body.headW * 0.04).applyQuaternion(s.head)), s.head, T.s.set(body.headW * 1.04, body.headH * 0.62, body.headW)); put(hair, 'hair', T.m.premultiply(T.root), hairC)
      for (const sx of [1, -1]) { T.m.compose(T.v.copy(s.headPos).add(new THREE.Vector3(sx * body.headW * 0.2, body.headH * 0.05, body.headW * 0.47).applyQuaternion(s.head)), s.head, T.s.set(body.headW * 0.09, body.headH * 0.14, 0.01)); put(eye, 'eye', T.m.premultiply(T.root), C_INK) }
      for (let i = 0; i < 2; i++) {
        put(leg, 'leg', boneMatrix(T.root, s.bones[i * 3], T.m), lower)
        put(leg, 'leg', boneMatrix(T.root, s.bones[i * 3 + 1], T.m), b.look.wrap ? skin : lower)
        put(foot, 'foot', boneMatrix(T.root, s.bones[i * 3 + 2], T.m), SHOES)
      }
      for (let i = 0; i < 2; i++) {
        put(arm, 'arm', boneMatrix(T.root, s.bones[6 + i * 2], T.m), shirt)
        put(arm, 'arm', boneMatrix(T.root, s.bones[7 + i * 2], T.m), b.look.sleeves ? shirt : skin)
        T.m.compose(s.hands[i], T.q.identity(), T.s.setScalar(body.limb * 1.25)); put(hand, 'hand', T.m.premultiply(T.root), skin)
      }
      // props, all held where the hands are: a basin on the head (one hand up steadying it), a broom, a phone, a baby
      // tied on the back in a wrap
      if (b.props.basin) { T.m.compose(T.v.copy(s.headPos).add(new THREE.Vector3(0, body.headH * 0.62, 0)), T.q.identity(), T.s.set(body.headW * 1.9, body.headH * 0.32, body.headW * 1.9)); put(prop, 'prop', T.m.premultiply(T.root), BASIN) }
      if (b.props.broom) { const hnd = s.hands[1]; T.m.compose(T.v.set(hnd.x, hnd.y * 0.5, hnd.z + 0.05), T.q.setFromEuler(T.e.set(0.35, 0, 0)), T.s.set(0.03, Math.max(0.2, hnd.y), 0.03)); put(prop, 'prop', T.m.premultiply(T.root), BROOM) }
      if (b.props.phone) { T.m.compose(s.hands[1], T.q.identity(), T.s.set(0.05, 0.08, 0.015)); put(prop, 'prop', T.m.premultiply(T.root), PHONE) }
      if (b.props.babyOnBack) { T.m.compose(T.v.copy(s.chest).add(new THREE.Vector3(0, 0, -body.torsoD * 1.25)), s.spine, T.s.set(body.torsoW * 0.75, body.torso * 0.45, body.torsoD * 0.8)); put(prop, 'prop', T.m.premultiply(T.root), shirt) }
    }
    for (const [im, n] of [[torso, counts.torso], [headM, counts.head], [hair, counts.hair], [eye, counts.eye], [leg, counts.leg], [foot, counts.foot], [arm, counts.arm], [hand, counts.hand], [prop, counts.prop]] as const) {
      im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true
    }
    if (process.env.NODE_ENV === 'development') { const D = W as WorldNow & { _people?: number }; D._people = list.length; (window as unknown as { __crowd?: unknown }).__crowd = pop.agents }
  })
  return (
    <group>
      <instancedMesh ref={R.torso} args={[box, mat, MAX * 2]} castShadow frustumCulled={false} />
      <instancedMesh ref={R.head} args={[head, mat, MAX]} castShadow frustumCulled={false} />
      <instancedMesh ref={R.hair} args={[head, mat, MAX]} frustumCulled={false} />
      <instancedMesh ref={R.eye} args={[plainBox, eyeMat, MAX * 2]} frustumCulled={false} />
      <instancedMesh ref={R.leg} args={[box, mat, MAX * 4]} castShadow frustumCulled={false} />
      <instancedMesh ref={R.foot} args={[box, mat, MAX * 2]} frustumCulled={false} />
      <instancedMesh ref={R.arm} args={[box, mat, MAX * 4]} castShadow frustumCulled={false} />
      <instancedMesh ref={R.hand} args={[head, mat, MAX * 2]} frustumCulled={false} />
      <instancedMesh ref={R.prop} args={[box, mat, MAX * 2]} castShadow frustumCulled={false} />
    </group>
  )
}
