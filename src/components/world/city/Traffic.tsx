'use client'
// draws the city view's traffic (trafficSim.ts steps it, inside CityPips' frame loop, so cars and people see each
// other): bodies in the region's colors, a cabin, canopy or rider on top, and a light strip at the front that
// comes on after dark. vehicles out of service are parked beyond the fog and aren't drawn.
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { toonGradient } from '../lib'
import { ROAD_Y } from './grid'
import { DIM, TOP_LIFT, vehiclePos, type Traffic as TrafficState } from './trafficSim'

export default function Traffic({ traffic, night }: { traffic: TrafficState; night: () => number }) {
  const body = useRef<THREE.InstancedMesh>(null)
  const top = useRef<THREE.InstancedMesh>(null)
  const lights = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(() => { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g }, [])
  const mats = useMemo(() => ({ body: new THREE.MeshToonMaterial({ gradientMap: toonGradient() }), top: new THREE.MeshToonMaterial({ gradientMap: toonGradient() }), lights: new THREE.MeshBasicMaterial({ toneMapped: false }) }), [])
  const colors = useMemo(() => traffic.vehicles.map((v) => ({ body: new THREE.Color(v.color), top: new THREE.Color(v.top) })), [traffic])
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), e: new THREE.Euler(), c: new THREE.Color() }), [])

  useFrame(() => {
    const B = body.current, T = top.current, L = lights.current
    if (!B || !T || !L) return
    const n = night()
    const { m, q, p, s, e, c } = tmp
    let k = 0
    traffic.vehicles.forEach((v, i) => {
      if (!v.active) return
      const d = DIM[v.kind], at = vehiclePos(v)
      const yaw = v.axis === 0 ? (v.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (v.dir > 0 ? 0 : Math.PI)
      q.setFromEuler(e.set(0, yaw, 0))
      // the boxes run along their local z (length), x is the width
      const wheel = v.kind === 'moto' || v.kind === 'tram' ? 0.02 : 0.05
      B.setMatrixAt(k, m.compose(p.set(at.x, ROAD_Y + wheel, at.z), q, s.set(d.w, d.h, d.l)))
      const fwd = d.top[3], fx = Math.sin(yaw) * fwd, fz = Math.cos(yaw) * fwd
      T.setMatrixAt(k, m.compose(p.set(at.x + fx, ROAD_Y + wheel + d.h + TOP_LIFT[v.kind], at.z + fz), q, s.set(d.top[1], d.top[2], d.top[0])))
      const hx = Math.sin(yaw) * (d.l / 2 + 0.005), hz = Math.cos(yaw) * (d.l / 2 + 0.005)
      L.setMatrixAt(k, m.compose(p.set(at.x + hx, ROAD_Y + wheel + d.h * 0.45, at.z + hz), q, s.set(d.w * 0.85, Math.max(0.02, d.h * 0.12), 0.01)))
      B.setColorAt(k, colors[i].body); T.setColorAt(k, colors[i].top)
      L.setColorAt(k, c.set(n > 0.3 ? '#FFF1C8' : '#B9B6AE').multiplyScalar(n > 0.3 ? 2.4 : 1))
      k++
    })
    for (const mm of [B, T, L]) { mm.count = k; mm.instanceMatrix.needsUpdate = true; if (mm.instanceColor) mm.instanceColor.needsUpdate = true }
  })

  const n = traffic.vehicles.length
  return (
    <group>
      <instancedMesh ref={body} args={[geo, mats.body, n]} castShadow frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={top} args={[geo, mats.top, n]} castShadow frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={lights} args={[geo, mats.lights, n]} frustumCulled={false} raycast={() => null} />
    </group>
  )
}
