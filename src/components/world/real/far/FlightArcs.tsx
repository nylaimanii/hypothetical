'use client'
// far zoom: soft flight arcs between busy airports with tiny planes, and slow shipping lanes between big ports.
// density follows the sim's traffic (frame.traffic.air / .port, per country, 0..1). two draw calls each,
// past-the-horizon planes and ships hidden, nothing drawn once the camera is down at mid zoom
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Frame } from '@/lib/types'
import { LAND_TOP, OCEAN_TOP, ZOOM_FAR, latLonToVec3, sceneRefs, toonGradient } from '../../lib'
import { useHubs, type Hubs } from './useFar'

type Traffic = { countries?: string[]; road: number[]; rail: number[]; port: number[]; air: number[] }
type Arc = { a: THREE.Vector3; b: THREE.Vector3; lift: number; base: number; vol: number }

const SEG = 32
// a point along the arc: slerp between the ends, lifted in the middle
function arcPoint(arc: Arc, t: number, out: THREE.Vector3) {
  out.copy(arc.a).lerp(arc.b, t).normalize()
  return out.multiplyScalar(arc.base + Math.sin(Math.PI * t) * arc.lift)
}

// per-hub volume: that country's share of the mode, else the world average, else a calm default
function volumeOf(traffic: Traffic | undefined, order: string[] | undefined, mode: 'air' | 'port', country?: string) {
  const arr = traffic?.[mode]
  if (!arr?.length) return 0.5
  if (country && order) { const i = order.indexOf(country); if (i >= 0 && arr[i] !== undefined) return arr[i] }
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

// fade in at far zoom, gone by mid
const farFade = () => THREE.MathUtils.smoothstep(sceneRefs.camDist, ZOOM_FAR - 8, ZOOM_FAR + 2) * (sceneRefs.camDist > 85 ? 0 : 1)

function useArcLines(arcs: Arc[]) {
  return useMemo(() => {
    const pos = new Float32Array(arcs.length * SEG * 6)
    const p = new THREE.Vector3(), q = new THREE.Vector3()
    let k = 0
    for (const arc of arcs) for (let s = 0; s < SEG; s++) {
      arcPoint(arc, s / SEG, p); arcPoint(arc, (s + 1) / SEG, q)
      pos.set([p.x, p.y, p.z, q.x, q.y, q.z], k); k += 6
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.computeBoundingSphere()
    return g
  }, [arcs])
}

// movers (planes or ships) along arcs, packed into the first slots, past-the-horizon ones skipped
function useMovers(mesh: React.RefObject<THREE.InstancedMesh | null>, arcs: Arc[], speed: number, perArc: (vol: number) => number, scale: number, lineMat: THREE.LineBasicMaterial, maxOpacity: number, group: React.RefObject<THREE.Group | null>) {
  useFrame(({ camera }) => {
    const m = mesh.current, g = group.current
    if (!m || !g) return
    const fade = farFade()
    g.visible = fade > 0.01
    if (!g.visible) return
    lineMat.opacity = maxOpacity * fade
    const t0 = sceneRefs.wt
    const camDir = camera.position.clone().normalize()
    const horizon = Math.cos(Math.acos(Math.min(1, LAND_TOP / camera.position.length())) + 0.05)
    const p = new THREE.Vector3(), ahead = new THREE.Vector3(), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(scale * fade, scale * fade, scale * fade)
    const look = new THREE.Matrix4(), up = new THREE.Vector3()
    let n = 0
    arcs.forEach((arc, i) => {
      const count = perArc(arc.vol)
      for (let c = 0; c < count; c++) {
        const t = ((t0 * speed) / (0.6 + arc.lift) + c / count + i * 0.137) % 1
        arcPoint(arc, t, p)
        if (p.clone().normalize().dot(camDir) < horizon) continue
        arcPoint(arc, Math.min(1, t + 0.01), ahead)
        up.copy(p).normalize()
        look.lookAt(p, ahead, up)
        q.setFromRotationMatrix(look)
        m.setMatrixAt(n++, mtx.compose(p, q, s))
      }
    })
    m.count = n
    m.instanceMatrix.needsUpdate = true
  })
}

export default function FlightArcs({ frame, countryOrder }: { frame: Frame; countryOrder?: string[] }) {
  const hubs = useHubs()
  const traffic = (frame as Frame & { traffic?: Traffic }).traffic
  const order = countryOrder ?? traffic?.countries
  const volKey = traffic?.air ? Math.round((traffic.air.reduce((a, b) => a + b, 0) / traffic.air.length) * 10) : 5
  const arcs = useMemo(() => (hubs ? airArcs(hubs, traffic, order) : []), [hubs, volKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useArcLines(arcs)
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#F4EFE6', transparent: true, opacity: 0.11, depthWrite: false, toneMapped: false }), [])
  const plane = useMemo(() => { const g = new THREE.ConeGeometry(0.035, 0.12, 5); g.rotateX(Math.PI / 2); return g }, [])
  const planeMat = useMemo(() => new THREE.MeshToonMaterial({ color: '#F7F3EA', gradientMap: toonGradient() }), [])
  const mesh = useRef<THREE.InstancedMesh>(null)
  const group = useRef<THREE.Group>(null)
  useMovers(mesh, arcs, 0.05, (v) => (v > 0.66 ? 2 : v > 0.2 ? 1 : 0), 1, lineMat, 0.22, group)
  if (!arcs.length) return null
  return (
    <group ref={group} visible={false}>
      <lineSegments geometry={lines} material={lineMat} raycast={() => null} renderOrder={2} />
      <instancedMesh ref={mesh} args={[plane, planeMat, arcs.length * 2]} frustumCulled={false} raycast={() => null} />
    </group>
  )
}

export function ShippingLanes({ frame, countryOrder }: { frame: Frame; countryOrder?: string[] }) {
  const hubs = useHubs()
  const traffic = (frame as Frame & { traffic?: Traffic }).traffic
  const order = countryOrder ?? traffic?.countries
  const volKey = traffic?.port ? Math.round((traffic.port.reduce((a, b) => a + b, 0) / traffic.port.length) * 10) : 5
  const arcs = useMemo(() => (hubs ? seaArcs(hubs, traffic, order) : []), [hubs, volKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useArcLines(arcs)
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#D9E8EE', transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false }), [])
  const ship = useMemo(() => new THREE.BoxGeometry(0.05, 0.022, 0.12), [])
  const shipMat = useMemo(() => new THREE.MeshToonMaterial({ color: '#3E4A52', gradientMap: toonGradient() }), [])
  const mesh = useRef<THREE.InstancedMesh>(null)
  const group = useRef<THREE.Group>(null)
  useMovers(mesh, arcs, 0.012, (v) => (v > 0.6 ? 3 : v > 0.25 ? 2 : 1), 1, lineMat, 0.18, group)
  if (!arcs.length) return null
  return (
    <group ref={group} visible={false}>
      <lineSegments geometry={lines} material={lineMat} raycast={() => null} renderOrder={2} />
      <instancedMesh ref={mesh} args={[ship, shipMat, arcs.length * 3]} frustumCulled={false} raycast={() => null} />
    </group>
  )
}

function airArcs(h: Hubs, traffic: Traffic | undefined, order: string[] | undefined): Arc[] {
  return h.air.map(([i, j]) => {
    const A = h.airports[i], B = h.airports[j]
    const a = latLonToVec3(A[2], A[3], 1).normalize(), b = latLonToVec3(B[2], B[3], 1).normalize()
    const ang = a.angleTo(b)
    const vol = (volumeOf(traffic, order, 'air', A[1]) + volumeOf(traffic, order, 'air', B[1])) / 2
    // calm, low arcs: long-haul flights hug the globe instead of looping off it
    return { a, b, base: LAND_TOP + 0.05, lift: 0.12 + ang * 0.45, vol }
  })
}

function seaArcs(h: Hubs, traffic: Traffic | undefined, order: string[] | undefined): Arc[] {
  // ports carry no country in the bake, so they use the world's port volume
  return h.sea.map(([i, j]) => {
    const A = h.ports[i], B = h.ports[j]
    return { a: latLonToVec3(A[1], A[2], 1).normalize(), b: latLonToVec3(B[1], B[2], 1).normalize(), base: OCEAN_TOP + 0.03, lift: 0.02, vol: volumeOf(traffic, order, 'port') }
  })
}
