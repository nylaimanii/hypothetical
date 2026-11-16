'use client'
// draws ./traffic (pure state: who drives where, yielding to people). traffic from the reference photos: bajaji (three-wheel tuk-tuks), boda (motorbikes with a rider, sometimes a
// passenger), daladala / candongueiro / taxi-be minibuses, and old sedans, a few parked by the walls. the mix comes from
// the city's style; how many follows the hour (rush at 7-9 and 17-19) and the real density. they drive the middle of the
// lane, fade in and out at the ends of the street, and never cross between the camera and her.
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { toonGradient } from '@/components/world/lib'
import type { LiveState } from './ChosenPerson'
import type { WorldNow } from './Scene'
import { hash01 } from './plan'
import type { Traffic } from './traffic'
import type { FrameBodies } from './Crowd'
import { radiusOf } from './qa'
import { DIMS } from './dims'

export type Kind = 'bajaji' | 'boda' | 'minibus' | 'car'
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0) => { g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1))); g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g }
const wheel = (x: number, z: number, r = 0.16) => at(new THREE.CylinderGeometry(r, r, 0.1, 10).rotateZ(Math.PI / 2), x, r, z)
function geometry(k: Kind): THREE.BufferGeometry {
  switch (k) {
    case 'bajaji': return mergeGeometries([at(new THREE.BoxGeometry(0.85, 0.62, 1.25), 0, 0.55, -0.05), at(new THREE.BoxGeometry(0.9, 0.05, 1.1), 0, 1.12, -0.05), at(new THREE.BoxGeometry(0.05, 0.3, 0.05), 0.4, 0.95, 0.5), at(new THREE.BoxGeometry(0.05, 0.3, 0.05), -0.4, 0.95, 0.5), at(new THREE.BoxGeometry(0.4, 0.5, 0.35), 0, 0.5, 0.75), wheel(0.38, -0.45, 0.14), wheel(-0.38, -0.45, 0.14), wheel(0, 0.82, 0.14)])!
    case 'boda': return mergeGeometries([at(new THREE.BoxGeometry(0.16, 0.3, 0.95), 0, 0.42, 0), wheel(0, 0.42, 0.18), wheel(0, -0.42, 0.18), at(new THREE.BoxGeometry(0.34, 0.42, 0.24), 0, 0.85, -0.05), at(new THREE.SphereGeometry(0.14, 8, 6), 0, 1.2, -0.02), at(new THREE.BoxGeometry(0.3, 0.38, 0.22), 0, 0.8, -0.32)])!
    case 'minibus': return mergeGeometries([at(new THREE.BoxGeometry(1.15, 1.05, 2.9), 0, 0.72, 0), wheel(0.5, 0.95, 0.2), wheel(-0.5, 0.95, 0.2), wheel(0.5, -0.95, 0.2), wheel(-0.5, -0.95, 0.2)])!
    case 'car': return mergeGeometries([at(new THREE.BoxGeometry(0.9, 0.38, 1.7), 0, 0.4, 0), at(new THREE.BoxGeometry(0.8, 0.32, 0.9), 0, 0.74, -0.1), wheel(0.42, 0.55), wheel(-0.42, 0.55), wheel(0.42, -0.55), wheel(-0.42, -0.55)])!
  }
}
// every vehicle is scaled to its real size (./dims): width x height x length from its own bounding box
export function sized(k: Kind): THREE.BufferGeometry {
  const g = geometry(k)
  g.computeBoundingBox()
  const b = g.boundingBox!, d = DIMS[k === 'car' ? 'car' : k]
  g.scale(d.w / (b.max.x - b.min.x), d.h / (b.max.y - b.min.y), d.l / (b.max.z - b.min.z))
  g.computeBoundingBox(); g.translate(0, -g.boundingBox!.min.y, 0)
  return g
}
const COLORS: Record<Kind, string[]> = {
  bajaji: ['#2F6FA8', '#3E8C6A', '#C9483B', '#E8A13A', '#2f2d2b'],
  boda: ['#2f2d2b', '#C9483B', '#3E4A5E', '#5E5A58'],
  minibus: [],
  car: ['#E8E2D6', '#9A9690', '#2f2d2b', '#7E3B3B', '#3E5E7E', '#C9B79A'],
}

export default function Vehicles({ traffic, world, live, bodies }: { traffic: Traffic; world: React.RefObject<WorldNow>; live: React.RefObject<LiveState>; bodies: React.RefObject<FrameBodies> }) {
  const { camera } = useThree()
  const N = 24
  const geos = useMemo(() => ({ bajaji: sized('bajaji'), boda: sized('boda'), minibus: sized('minibus'), car: sized('car') }), [])
  const band = useMemo(() => { const d = DIMS.minibus; const g = new THREE.BoxGeometry(d.w + 0.02, d.h * 0.13, d.l + 0.02); g.translate(0, d.h * 0.42, 0); return g }, [])
  const glass = useMemo(() => { const d = DIMS.minibus; const g = new THREE.BoxGeometry(d.w + 0.02, d.h * 0.22, d.l * 0.9); g.translate(0, d.h * 0.72, 0); return g }, [])
  const mat = useMemo(() => new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonGradient() }), [])
  const glassMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#3a3f44' }), [])
  const refs = { bajaji: useRef<THREE.InstancedMesh>(null), boda: useRef<THREE.InstancedMesh>(null), minibus: useRef<THREE.InstancedMesh>(null), car: useRef<THREE.InstancedMesh>(null), band: useRef<THREE.InstancedMesh>(null), glass: useRef<THREE.InstancedMesh>(null) }
  const colors = useMemo(() => Array.from({ length: 100 }, (_, i) => new THREE.Color(COLORS.bajaji.concat(COLORS.boda)[Math.floor(hash01(i * 5) * 9) % 9])), [])
  const T = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), v: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), bus: new THREE.Color('#F2C230'), band: new THREE.Color('#2F6FA8') }), [])
  const fade = useRef(new Map<number, number>())
  useFrame((_, rawDt) => {
    const W = world.current, L = live.current
    if (!W || !L) return
    const dt = Math.min(rawDt, 0.05)
    // everyone on foot this frame is an obstacle (anyone crossing the lane gets room ahead of them)
    const obstacles = (bodies.current?.list ?? []).filter(b => b.presence > 0.3 && !b.indoors).map(b => ({ x: b.x, z: b.z, r: radiusOf(b.body), crossing: b.walking && b.role !== 'passer' }))
    const vehs = traffic.step(W, L, obstacles, dt)
    if (bodies.current) bodies.current.vehicles = vehs.filter(v => v.id !== 99).map(v => ({ x: v.x, z: v.z, w: v.w, l: v.l, heading: v.heading }))
    const counts: Record<string, number> = { bajaji: 0, boda: 0, minibus: 0, car: 0 }
    let nb = 0
    for (const v of vehs) {
      // the camera's line to her: a vehicle in it fades out of the shot and back
      const ax = camera.position.x, az = camera.position.z, bx = L.head.x - ax, bz = L.head.z - az, len2 = bx * bx + bz * bz
      const k = len2 > 1e-6 ? ((v.x - ax) * bx + (v.z - az) * bz) / len2 : -1
      const clear = v.id === 99 ? 1 : k > 0 && k < 1.05 ? Math.min(1, Math.max(0, (Math.hypot(v.x - (ax + bx * k), v.z - (az + bz * k)) - v.w / 2 - 0.4) / 0.6)) : 1
      const f0 = fade.current.get(v.id) ?? 1, f = f0 + (clear - f0) * (1 - Math.exp(-dt * 5))
      fade.current.set(v.id, f)
      const vis = v.presence * f
      const im = refs[v.kind].current
      if (!im || vis < 0.02) continue
      T.q.setFromAxisAngle(T.up, v.heading)
      T.m.compose(T.v.set(v.x, 0, v.z), T.q, T.s.setScalar(vis))
      const idx = counts[v.kind]++
      im.setMatrixAt(idx, T.m); im.setColorAt(idx, v.kind === 'minibus' ? T.bus : colors[v.id % colors.length])
      if (v.kind === 'minibus') { refs.band.current?.setMatrixAt(nb, T.m); refs.band.current?.setColorAt(nb, T.band); refs.glass.current?.setMatrixAt(nb, T.m); nb++ }
    }
    for (const key of ['bajaji', 'boda', 'minibus', 'car'] as const) { const im = refs[key].current; if (im) { im.count = counts[key]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true } }
    for (const im of [refs.band.current, refs.glass.current]) if (im) { im.count = nb; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true }
  })
  return (
    <group>
      {(['bajaji', 'boda', 'minibus', 'car'] as const).map(k => <instancedMesh key={k} ref={refs[k]} args={[geos[k], mat, N]} castShadow frustumCulled={false} />)}
      <instancedMesh ref={refs.band} args={[band, mat, 4]} frustumCulled={false} />
      <instancedMesh ref={refs.glass} args={[glass, glassMat, 4]} frustumCulled={false} />
    </group>
  )
}
