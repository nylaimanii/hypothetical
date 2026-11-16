'use client'
// night side city lights from real black marble brightness per tile, dimmed by the sim (blackouts, ruin)
// and brightened where cities grew. one instanced draw call. replaces CityLights
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Frame } from '@/lib/types'
import { LAND_TOP, STEP, buildTiles, groundRadius, latLonToVec3, sceneRefs, surfacePoint } from '../../lib'
import { lightFactor } from '../../Structures'
import { tileLights, tilePeople, useFarTiles } from './useFar'

const MAX = 2500

export default function NightLights({ frame }: { frame: Frame }) {
  const far = useFarTiles()
  const mesh = useRef<THREE.InstancedMesh>(null)
  const { tiles } = useMemo(() => buildTiles(frame.regions), [frame.regions])
  // rebuild only when the sim's light levels move in 5% steps, not every month
  const litKey = frame.regions.map((r, i) => Math.round(lightFactor(frame, i) * 20)).join() + '|' + frame.cities.map((c) => `${c.id}:${Math.round(Math.log10(Math.max(10, c.population)) * 4)}`).join()
  const points = useMemo(() => {
    const pts: { p: THREE.Vector3; n: THREE.Vector3; s: number }[] = []
    if (!far) return pts
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    // tiles ordered brightest first so the budget goes where the real lights are
    const order = tiles.map((t, i) => i).filter((i) => tiles[i].land && !tiles[i].ice).sort((a, b) => tileLights(far, b) - tileLights(far, a))
    for (const i of order) {
      const t = tiles[i]
      const lit = tileLights(far, i)
      if (lit < 0.04) break
      const dim = t.region >= 0 ? lightFactor(frame, t.region) : 1
      const n = Math.round((lit * 5 + Math.min(3, Math.log10(Math.max(1, tilePeople(far, i))) - 5)) * dim)
      for (let k = 0; k < n && pts.length < MAX - 300; k++) {
        const p = surfacePoint(t.normal, (rnd() - 0.5) * t.w * 0.85, (rnd() - 0.5) * t.d * 0.85, LAND_TOP + t.band * STEP + 0.012)
        pts.push({ p, n: p.clone().normalize(), s: 0.55 + lit * 0.7 + rnd() * 0.4 })
      }
    }
    // the sim's cities: brighter as they grow, new founded cities light up from nothing
    for (const c of frame.cities) {
      if (c.offWorld) continue
      const ri = frame.regions.findIndex((r) => r.id === c.regionId)
      const n = Math.round(Math.min(30, (c.real ? 2 : 6) + Math.log10(Math.max(10, c.population)) * (c.real ? 1.5 : 3)) * (ri >= 0 ? lightFactor(frame, ri) : 1))
      const center = latLonToVec3(c.lat, c.lon, 1)
      for (let k = 0; k < n && pts.length < MAX; k++) {
        const q = surfacePoint(center, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6, LAND_TOP)
        q.setLength(groundRadius(q) + 0.012)
        pts.push({ p: q, n: q.clone().normalize(), s: 0.9 + rnd() * 0.8 })
      }
    }
    return pts
  }, [far, tiles, litKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const mat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), [])
  const geo = useMemo(() => new THREE.SphereGeometry(1, 6, 4), [])
  const warm = useMemo(() => new THREE.Color('#FFC77A').multiplyScalar(1.7), [])
  const placed = useRef<typeof points | null>(null)
  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), col = new THREE.Color()
    // matrices only when the point set changes; every frame only the night tint moves
    if (placed.current !== points) {
      placed.current = points
      points.forEach((pt, i) => m.setMatrixAt(i, mtx.compose(pt.p, q, sc.setScalar(0.026 * pt.s))))
      m.count = points.length
      m.instanceMatrix.needsUpdate = true
    }
    const sun = sceneRefs.sunDir
    // lights read from orbit; up close among the pips they would look like floating orbs
    const farK = THREE.MathUtils.smoothstep(sceneRefs.camDist, 19, 26)
    points.forEach((pt, i) => {
      const night = THREE.MathUtils.smoothstep(-pt.n.dot(sun), -0.02, 0.18) * farK
      m.setColorAt(i, col.copy(warm).multiplyScalar(night))
    })
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })
  return <instancedMesh ref={mesh} args={[geo, mat, MAX]} frustumCulled={false} raycast={() => null} />
}
