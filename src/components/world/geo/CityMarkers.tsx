'use client'
// mid zoom: every city on earth as a little cluster of clay blocks, taller and denser the bigger it is.
// names only for the 5 most populous in view. click = the city card
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { City, Frame } from '@/lib/types'
import { C, ZOOM_CLOSE, ZOOM_FAR, groundRadius, latLonToVec3, sceneRefs, surfacePoint, toonGradient } from '../lib'
import { useStore } from '../../state/store'
import { midFade } from './labels'

const fmtPop = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))
const hash = (s: string, k: number) => { let h = 2166136261 ^ k; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296 }
const TINTS = ['#EFE8DA', '#E6DCC8', '#D9CFBC', '#F3EEE4'].map((h) => new THREE.Color(h))

type Block = { city: number; pos: THREE.Vector3; quat: THREE.Quaternion; w: number; h: number; tint: THREE.Color }

export default function CityMarkers({ frame }: { frame: Frame }) {
  // v5: real cities are drawn by RealCities (GHSL blocks + the 5 names); markers are for cities the sim founds
  const cities = useMemo(() => frame.cities.filter((c) => !c.offWorld && !c.real), [frame.cities])
  const mesh = useRef<THREE.InstancedMesh>(null)
  const plate = useRef<THREE.InstancedMesh>(null)

  const layout = useMemo(() => {
    const blocks: Block[] = []
    const plates: { pos: THREE.Vector3; quat: THREE.Quaternion; r: number }[] = []
    cities.forEach((c, ci) => {
      const center = latLonToVec3(c.lat, c.lon, 1).normalize()
      const ground = groundRadius(center)
      const big = Math.max(0, Math.log10(Math.max(1e4, c.population)) - 4) // 0 for 10k, 3.6 for 40M
      const count = Math.min(14, 3 + Math.round(big * 3))
      const spread = 0.1 + big * 0.06
      const up = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), center)
      plates.push({ pos: center.clone().multiplyScalar(ground + 0.012), quat: up, r: spread + 0.08 })
      for (let k = 0; k < count; k++) {
        const a = hash(c.id, k) * Math.PI * 2, rr = Math.sqrt(hash(c.id, k + 50)) * spread
        // the middle of a big city is its tallest part
        const h = (0.06 + big * 0.07) * (1.15 - rr / (spread + 0.01) * 0.7) * (0.6 + hash(c.id, k + 99) * 0.6)
        const p = surfacePoint(center, Math.cos(a) * rr, Math.sin(a) * rr, ground)
        const n = p.clone().normalize()
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a))
        blocks.push({ city: ci, pos: p.clone().addScaledVector(n, h / 2), quat: q, w: 0.045 + hash(c.id, k + 7) * 0.035, h, tint: TINTS[Math.floor(hash(c.id, k + 3) * TINTS.length)] })
      }
    })
    return { blocks, plates }
  }, [cities])

  const geo = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 1, 0.12), [])
  const plateGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 0.02, 14), [])
  const mat = useMemo(() => new THREE.MeshToonMaterial({ gradientMap: toonGradient() }), [])
  const plateMat = useMemo(() => new THREE.MeshToonMaterial({ color: C.boneDeep, gradientMap: toonGradient() }), [])

  // grow out of the ground as mid zoom arrives, sink back as you leave it
  const last = useRef(-1)
  useEffect(() => { last.current = -1 }, [layout])
  useFrame(() => {
    const f = midFade(sceneRefs.camDist, ZOOM_CLOSE - 2, ZOOM_FAR)
    const M = mesh.current, P = plate.current
    if (!M || !P) return
    M.visible = P.visible = f > 0.02
    if (!M.visible || Math.abs(f - last.current) < 0.01) return
    last.current = f
    const m = new THREE.Matrix4(), s = new THREE.Vector3(), p = new THREE.Vector3()
    layout.blocks.forEach((b, i) => {
      const n = b.pos.clone().normalize()
      p.copy(b.pos).addScaledVector(n, -b.h / 2 * (1 - f))
      M.setMatrixAt(i, m.compose(p, b.quat, s.set(b.w, Math.max(0.001, b.h * f), b.w)))
      M.setColorAt(i, b.tint)
    })
    layout.plates.forEach((pl, i) => P.setMatrixAt(i, m.compose(pl.pos, pl.quat, s.set(pl.r * f, 1, pl.r * f))))
    M.instanceMatrix.needsUpdate = true
    if (M.instanceColor) M.instanceColor.needsUpdate = true
    P.instanceMatrix.needsUpdate = true
  })

  const cityOf = (e: ThreeEvent<PointerEvent | MouseEvent>, fromPlate: boolean): City | undefined => {
    if (e.instanceId == null) return undefined
    return cities[fromPlate ? e.instanceId : layout.blocks[e.instanceId]?.city]
  }
  const handlers = (fromPlate: boolean) => ({
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); const c = cityOf(e, fromPlate); if (c) useStore.getState().select({ kind: 'city', id: c.id }) },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      const c = cityOf(e, fromPlate)
      if (c) { document.body.style.cursor = 'pointer'; useStore.getState().setTip({ title: c.name, text: `${c.name} · ${fmtPop(c.population)} people`, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }) }
    },
    onPointerOut: () => { document.body.style.cursor = ''; useStore.getState().setTip(null) },
  })


  return (
    <>
      <instancedMesh key={`b${layout.blocks.length}`} ref={mesh} args={[geo, mat, Math.max(1, layout.blocks.length)]} frustumCulled={false} visible={false} castShadow {...handlers(false)} />
      <instancedMesh key={`p${layout.plates.length}`} ref={plate} args={[plateGeo, plateMat, Math.max(1, layout.plates.length)]} frustumCulled={false} visible={false} receiveShadow {...handlers(true)} />
      {/* names come from RealCities (the 5-name budget); founded cities name themselves on hover */}
    </>
  )
}
