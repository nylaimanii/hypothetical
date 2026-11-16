'use client'
// mid zoom: every real city in view (over 1M people, plus capitals) as a cluster of rounded clay blocks on its real
// GHSL cells: block height from mean building height, density from built-up fraction. the sim's city diffs (frame
// `infra`, kind 'city') grow, shrink and damage them. regional cell files load only when a city there is in view.
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Agent, Frame } from '@/lib/types'
import type { InfraDiff } from '@/lib/types-v5'
import { archStyleFor } from '@/lib/mock/v3'
import { R, ZOOM_CLOSE, ZOOM_FAR, groundRadius, latLonToVec3, sceneRefs, surfacePoint, surfaceQuat, tangentBasis, toonGradient } from '../../lib'
import { useCurrentFrame, useStore } from '../../../state/store'
import { LabelPool, midFade, type LabelItem } from '../../geo/labels'
import { cellsOf, groupLoaded, indexLoaded, loadGroup, loadIndex, type CityRow } from './data'

const DEG = (R * Math.PI) / 180 // world units per degree on the surface
const K = 4 // footprint exaggeration: at true scale a whole city is smaller than one planet tile at mid zoom
const MAX_BLOCKS = 12000
const DAMAGED = new THREE.Color('#8A8782')
const LOW = new THREE.Color('#ECE5D6'), HIGH = new THREE.Color('#B7B3AC')

// the sim's word on each real city so far: population and damage from the city diffs up to the current frame
function useCityState(): Map<string, { pop: number; damage: number }> {
  const { record, idx } = useCurrentFrame()
  return useMemo(() => {
    const m = new Map<string, { pop: number; damage: number }>()
    for (let i = 0; i <= idx && i < record.frames.length; i++) {
      const infra = (record.frames[i] as Frame & { infra?: InfraDiff[] }).infra ?? []
      for (const d of infra) {
        if (d.kind !== 'city') continue
        const prev = m.get(d.id) ?? { pop: d.population, damage: 0 }
        m.set(d.id, { pop: d.population || prev.pop, damage: d.op === 'damaged' ? d.damage ?? prev.damage : prev.damage * 0.9 })
      }
    }
    return m
  }, [record, idx])
}

const fmtPop = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`)

export default function RealCities({ frame, agent }: { frame: Frame; agent?: Agent }) {
  void frame // same props as the other layers; city state comes from the record's diffs
  const camera = useThree((s) => s.camera)
  const recordAgent = useStore((s) => s.record.agentId)
  const style = useMemo(() => agent?.archStyle ?? archStyleFor(agent?.id ?? recordAgent), [agent, recordAgent])
  const sim = useCityState()
  const [index, setIndex] = useState<CityRow[] | null>(indexLoaded())
  const [visibleKey, setVisibleKey] = useState('')
  const [loadedTick, setLoadedTick] = useState(0)
  const group = useRef<THREE.Group>(null)
  const bodies = useRef<THREE.InstancedMesh>(null)
  const roofs = useRef<THREE.InstancedMesh>(null)
  const acc = useRef(1)
  const slotCity = useRef<CityRow[]>([])
  const wanted = useRef(false)

  // a unit block with its base at y = 0, so heights grow up from the ground; it grows in with the fade
  const geo = useMemo(() => { const g = new RoundedBoxGeometry(1, 1, 1, 1, 0.14); g.translate(0, 0.5, 0); return g }, [])
  const roofGeo = useMemo(() => { const g = new RoundedBoxGeometry(1, 0.18, 1, 1, 0.06); g.translate(0, 0.09, 0); return g }, [])
  const grow = useMemo(() => ({ value: 0 }), [])
  const mat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ gradientMap: toonGradient() })
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uGrow = grow
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uGrow;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y *= uGrow;')
    }
    m.customProgramCacheKey = () => 'realcity'
    return m
  }, [grow])
  const roofMat = useMemo(() => new THREE.MeshToonMaterial({ color: style.accent, gradientMap: toonGradient() }), [style.accent])

  // fetch the index the first time we reach mid zoom; afterwards, the regional files for cities in view
  useFrame((_, dt) => {
    const f = midFade(sceneRefs.camDist, ZOOM_CLOSE - 2, ZOOM_FAR)
    grow.value = f
    if (group.current) group.current.visible = f > 0.01
    if (f <= 0.01) return
    if (!index) { if (!wanted.current) { wanted.current = true; loadIndex().then(setIndex) } return }
    acc.current += dt
    if (acc.current < 0.35) return
    acc.current = 0
    const d = camera.position.length()
    const dir = camera.position.clone().divideScalar(d)
    const horizon = Math.cos(Math.acos(Math.min(1, R / d)) + 0.06)
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    // the 30 most populous cities in view get blocks; the rest stay quiet so the map reads
    const vis = index.filter((c) => { const n = latLonToVec3(c.lat, c.lon, 1); return n.dot(dir) > horizon && fr.intersectsSphere(new THREE.Sphere(n.multiplyScalar(R), 0.6)) }).sort((a, b) => b.pop - a.pop).slice(0, 30)
    for (const g of new Set(vis.map((c) => c.group))) if (!groupLoaded(g)) loadGroup(g).then(() => setLoadedTick((t) => t + 1))
    const key = vis.map((c) => c.id).join()
    if (key !== visibleKey) setVisibleKey(key)
  })

  const visible = useMemo(() => { const ids = new Set(visibleKey.split(',')); return index && visibleKey ? index.filter((c) => ids.has(c.id)) : [] }, [index, visibleKey])

  // lay the blocks out whenever the cities in view, their loaded cells or the sim's numbers change
  useEffect(() => {
    const B = bodies.current, Rf = roofs.current
    if (!B || !Rf) return
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color()
    const tilt = new THREE.Quaternion()
    let n = 0, r = 0
    slotCity.current = []
    for (const c of [...visible].sort((a, b) => b.pop - a.pop)) {
      const cs = cellsOf(c.id)
      if (!cs) continue
      const st = sim.get(c.id)
      const ratio = st ? Math.max(0.2, st.pop / c.pop) : 1
      const damage = st?.damage ?? 0
      // shrinking cities lose their thinnest cells; growing ones spread a little and rise
      const keep = ratio < 1 ? Math.max(3, Math.ceil(cs.length * ratio)) : cs.length
      const spread = K * Math.pow(Math.min(ratio, 3), 0.25)
      const rise = Math.pow(Math.min(ratio, 3), 0.35)
      const center = latLonToVec3(c.lat, c.lon, 1).normalize()
      const { north } = tangentBasis(center)
      const cl = Math.cos((c.lat * Math.PI) / 180)
      const cellW = 0.05 * DEG * spread
      for (let i = 0; i < keep && n < MAX_BLOCKS; i++) {
        const cell = cs[i]
        const u = (cell.lon - c.lon) * cl * DEG * spread, v = (cell.lat - c.lat) * DEG * spread
        // offsets are in world units, so lay them out on a sphere of radius R (at radius 1 they'd spread 10x too wide)
        surfacePoint(center, u, v, R, p)
        const normal = p.clone().normalize()
        p.copy(normal).multiplyScalar(groundRadius(normal) + 0.004)
        // taller where buildings are taller and the cell is denser: cores of the big cities stand out
        // readable at mid zoom: low suburbs, tall dense cores (manhattan, tokyo, shanghai)
        const h = (0.03 + Math.pow(cell.heightM / 12, 1.5) * 0.07 * (0.4 + cell.built)) * rise
        const w = cellW * (0.6 + 0.35 * cell.built)
        surfaceQuat(normal, north, q)
        const hit = damage > 0 && ((i * 2654435761) % 1000) / 1000 < damage * 0.8
        if (hit) q.multiply(tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.1 + (i % 3) * 0.2))
        B.setMatrixAt(n, mtx.compose(p, q, s.set(w, hit ? h * 0.45 : h, w)))
        if (hit) col.copy(DAMAGED)
        else col.copy(LOW).lerp(HIGH, Math.min(1, cell.heightM / 30)).multiplyScalar(0.94 + (i % 7) * 0.012)
        B.setColorAt(n, col)
        slotCity.current[n] = c
        // the agent's accent, sparingly: a roof cap on roughly one tall block in six
        if (!hit && cell.heightM >= 12 && i % 6 === 0) Rf.setMatrixAt(r++, mtx.compose(p.clone().addScaledVector(normal, h), q, s.set(w * 1.02, 1, w * 1.02)))
        n++
      }
    }
    B.count = n; Rf.count = r
    B.instanceMatrix.needsUpdate = true; Rf.instanceMatrix.needsUpdate = true
    if (B.instanceColor) B.instanceColor.needsUpdate = true
    B.computeBoundingSphere(); Rf.computeBoundingSphere()
  }, [visible, loadedTick, sim])

  const cityOf = (e: ThreeEvent<MouseEvent | PointerEvent>) => (e.instanceId != null ? slotCity.current[e.instanceId] : undefined)
  const events = {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      const c = cityOf(e)
      if (!c) return
      e.stopPropagation()
      useStore.getState().select({ kind: 'city', id: c.id })
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const c = cityOf(e)
      if (!c) return
      e.stopPropagation()
      const pop = sim.get(c.id)?.pop ?? c.pop
      useStore.getState().setTip({ title: c.name, text: `${c.name} · ${fmtPop(pop)} people`, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
    },
    onPointerOut: () => useStore.getState().setTip(null),
  }

  // the 5 biggest cities in view get a name (the pool skips overlaps and anything behind the planet)
  const items = (): LabelItem[] => visible.map((c) => ({
    key: c.id, text: c.name, pos: latLonToVec3(c.lat, c.lon, R + 0.75), weight: sim.get(c.id)?.pop ?? c.pop,
    onClick: () => useStore.getState().select({ kind: 'city', id: c.id }),
  }))

  return (
    <group ref={group} visible={false}>
      <instancedMesh ref={bodies} args={[geo, mat, MAX_BLOCKS]} frustumCulled={false} {...events} />
      <instancedMesh ref={roofs} args={[roofGeo, roofMat, Math.ceil(MAX_BLOCKS / 4)]} frustumCulled={false} raycast={() => null} />
      <LabelPool items={items} opacity={() => midFade(sceneRefs.camDist, ZOOM_CLOSE, ZOOM_FAR)} />
    </group>
  )
}
