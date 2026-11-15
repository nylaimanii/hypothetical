'use client'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Frame } from '@/lib/types'
import { LAND_TOP, buildTiles, latLonToVec3, sceneRefs, surfacePoint } from './lib'

const MAX = 900

// warm specks on land, denser where people live, glowing only on the night side of the terminator
export default function CityLights({ frame }: { frame: Frame }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const { tiles } = useMemo(() => buildTiles(frame.regions), [frame.regions])
  const points = useMemo(() => {
    const pts: { n: THREE.Vector3; s: number }[] = []
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    frame.regions.forEach((r, ri) => {
      const land = tiles.filter((t) => t.region === ri)
      const count = Math.min(90, Math.round(Math.sqrt(r.population / 1e6) * 2.2))
      for (let k = 0; k < count && land.length; k++) {
        const t = land[Math.floor(rnd() * land.length)]
        const p = surfacePoint(t.normal, (rnd() - 0.5) * t.w * 0.8, (rnd() - 0.5) * t.d * 0.8, LAND_TOP + 0.012)
        pts.push({ n: p, s: 0.6 + rnd() * 0.8 })
      }
    })
    for (const c of frame.cities) {
      if (c.offWorld) continue
      const center = latLonToVec3(c.lat, c.lon, 1)
      const n = Math.min(40, 6 + Math.round(Math.log10(Math.max(10, c.population)) * 4))
      for (let k = 0; k < n; k++) pts.push({ n: surfacePoint(center, (rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.7, LAND_TOP + 0.012), s: 0.9 + rnd() * 0.9 })
    }
    return pts.slice(0, MAX)
  }, [frame.regions, frame.cities, tiles])

  const mat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), [])
  const warm = useMemo(() => new THREE.Color('#FFC77A').multiplyScalar(1.7), [])
  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const mtx = new THREE.Matrix4(), col = new THREE.Color(), q = new THREE.Quaternion(), sc = new THREE.Vector3()
    const sun = sceneRefs.sunDir
    // lights read from orbit; up close among the pips they would look like floating orbs
    const far = THREE.MathUtils.smoothstep(sceneRefs.camDist, 19, 26)
    points.forEach((p, i) => {
      const d = p.n.clone().normalize().dot(sun)
      const night = THREE.MathUtils.smoothstep(-d, -0.02, 0.18) * far
      sc.setScalar(night > 0.01 ? 0.026 * p.s : 0)
      m.setMatrixAt(i, mtx.compose(p.n, q, sc))
      m.setColorAt(i, col.copy(warm).multiplyScalar(night))
    })
    for (let i = points.length; i < MAX; i++) m.setMatrixAt(i, mtx.makeScale(0, 0, 0))
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })
  return (
    <instancedMesh ref={mesh} args={[undefined, mat, MAX]} frustumCulled={false} raycast={() => null}>
      <icosahedronGeometry args={[1, 1]} />
    </instancedMesh>
  )
}
