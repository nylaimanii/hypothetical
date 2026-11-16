'use client'
// a chunky floating arrow over every simulated country: green up when rising, grey block when stable,
// ember down when declining. far zoom; bigger (and also at mid) in the trend overlay
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Frame } from '@/lib/types'
import { C, LAND_TOP, ZOOM_CLOSE, ZOOM_FAR, latLonToVec3, sceneRefs, toonGradient } from '../lib'
import { useStore } from '../../state/store'
import { COUNTRY_TABLE, countryIndexOf } from './countries'

const UP = new THREE.Color('#5E8C4A'), FLAT = new THREE.Color('#9A948A'), DOWN = new THREE.Color(C.ember)

type Spot = { name: string; n: THREE.Vector3; q: THREE.Quaternion; kind: 'rising' | 'stable' | 'declining'; text: string; seed: number }

export default function TrendArrows({ frame }: { frame: Frame }) {
  const arrows = useRef<THREE.InstancedMesh>(null)
  const blocks = useRef<THREE.InstancedMesh>(null)
  const spots = useMemo<Spot[]>(() => (frame.countries ?? []).flatMap((c, i) => {
    const k = countryIndexOf(c.id)
    if (k < 0) return []
    const row = COUNTRY_TABLE[k]
    const n = latLonToVec3(row.lat, row.lon, 1).normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)
    // declining arrows point down: flip around a tangent
    if (c.stats.trend === 'declining') q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI))
    const s = c.stats
    return [{ name: c.name, n, q, kind: s.trend, seed: i * 1.7, text: `${s.trend}: happiness ${Math.round(s.happiness * 100)}, economy ${Math.round(s.economy * 100)}` }]
  }), [frame.countries])
  const arrowList = useMemo(() => spots.filter((s) => s.kind !== 'stable'), [spots])
  const blockList = useMemo(() => spots.filter((s) => s.kind === 'stable'), [spots])

  const arrowGeo = useMemo(() => {
    const shaft = new RoundedBoxGeometry(0.14, 0.32, 0.14, 1, 0.04).translate(0, 0.16, 0)
    const head = new THREE.ConeGeometry(0.24, 0.3, 8).translate(0, 0.46, 0)
    const g = mergeGeometries([shaft.toNonIndexed(), head.toNonIndexed()])!
    g.translate(0, -0.3, 0) // center it, so flipping keeps it in place
    return g
  }, [])
  const blockGeo = useMemo(() => new RoundedBoxGeometry(0.36, 0.14, 0.36, 2, 0.05), [])
  const mat = useMemo(() => new THREE.MeshToonMaterial({ gradientMap: toonGradient() }), [])

  useFrame(() => {
    const trendMode = useStore.getState().overlay === 'trend'
    const d = sceneRefs.camDist
    const show = d > ZOOM_FAR - 2 || (trendMode && d > ZOOM_CLOSE)
    const scale = (trendMode ? 1.6 : 1) * Math.min(1.4, Math.max(0.6, d / 45))
    const t = sceneRefs.wt
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3()
    const write = (mesh: THREE.InstancedMesh | null, list: Spot[]) => {
      if (!mesh) return
      mesh.visible = show && list.length > 0
      if (!mesh.visible) return
      list.forEach((sp, i) => {
        const bob = Math.sin(t * 1.6 + sp.seed) * 0.06
        p.copy(sp.n).multiplyScalar(LAND_TOP + 0.75 * scale + bob)
        mesh.setMatrixAt(i, m.compose(p, sp.q, s.set(scale, scale, scale)))
        mesh.setColorAt(i, sp.kind === 'rising' ? UP : sp.kind === 'declining' ? DOWN : FLAT)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    write(arrows.current, arrowList)
    write(blocks.current, blockList)
  })

  const tip = (list: Spot[]) => ({
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      const sp = e.instanceId != null ? list[e.instanceId] : undefined
      if (sp) useStore.getState().setTip({ title: sp.name, text: sp.text, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
    },
    onPointerOut: () => useStore.getState().setTip(null),
  })
  return (
    <>
      <instancedMesh key={`a${arrowList.length}`} ref={arrows} args={[arrowGeo, mat, Math.max(1, arrowList.length)]} frustumCulled={false} {...tip(arrowList)} />
      <instancedMesh key={`b${blockList.length}`} ref={blocks} args={[blockGeo, mat, Math.max(1, blockList.length)]} frustumCulled={false} {...tip(blockList)} />
    </>
  )
}
