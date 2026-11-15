'use client'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Frame } from '@/lib/types'
import { buildTiles, C, LAND_TOP, OCEAN_TOP, R, shade, toonGradient } from './lib'
import { useStore } from '../state/store'

const TILE_H = 0.5

export default function Planet({ frame }: { frame: Frame }) {
  const { tiles, neighbors } = useMemo(() => buildTiles(frame.regions), [frame.regions])
  const tileRef = useRef<THREE.InstancedMesh>(null)
  const glowRef = useRef<THREE.InstancedMesh>(null)
  const glowMat = useRef<THREE.MeshBasicMaterial>(null)
  const select = useStore((s) => s.select)
  const quality = useStore((s) => s.quality)

  const geo = useMemo(() => new RoundedBoxGeometry(1, TILE_H, 1, 2, 0.09), [])
  const mat = useMemo(() => new THREE.MeshToonMaterial({ gradientMap: toonGradient() }), [])

  // border tiles: land touching ocean or another region
  const border = useMemo(() => tiles.map((t, i) => t.land && !t.ice && Array.from(neighbors[i]).some((j) => tiles[j].region !== t.region)), [tiles, neighbors])

  useLayoutEffect(() => {
    const m = tileRef.current
    const g = glowRef.current
    if (!m || !g) return
    const mtx = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    tiles.forEach((t, i) => {
      const top = t.land ? LAND_TOP : OCEAN_TOP
      pos.copy(t.normal).multiplyScalar(top - TILE_H / 2)
      scl.set(t.w * 1.03, 1, t.d * 1.03)
      mtx.compose(pos, t.quat, scl)
      m.setMatrixAt(i, mtx)
      scl.set(t.w * 1.02, 1.08, t.d * 1.02)
      mtx.compose(pos, t.quat, border[i] ? scl : scl.set(0, 0, 0))
      g.setMatrixAt(i, mtx)
    })
    m.instanceMatrix.needsUpdate = true
    g.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [tiles, border])

  // colors follow the frame: region color, famine desaturates, unrest glows ember on borders
  useEffect(() => {
    const m = tileRef.current
    const g = glowRef.current
    if (!m || !g) return
    const regionCols = frame.regions.map((r) => {
      const famine = r.foodKcalPerCapita < 2150 || frame.newEvents.some((e) => e.kind === 'famine' && e.regionId === r.id)
      const c = new THREE.Color(r.color)
      if (famine) {
        const hsl = { h: 0, s: 0, l: 0 }
        c.getHSL(hsl)
        c.setHSL(hsl.h, hsl.s * 0.18, hsl.l * 0.92)
      }
      return c
    })
    const ocean = new THREE.Color(C.ocean)
    const oceanAlt = shade(C.ocean, 0.94)
    const ice = new THREE.Color(C.ice)
    const ember = new THREE.Color(C.ember)
    const off = new THREE.Color(0, 0, 0)
    const tmp = new THREE.Color()
    tiles.forEach((t, i) => {
      if (t.ice) m.setColorAt(i, ice)
      else if (!t.land) m.setColorAt(i, (i * 7919) % 5 === 0 ? oceanAlt : ocean)
      else {
        // tiny per tile value jitter reads as clay
        const j = 0.96 + ((i * 2654435761) % 1000) / 1000 * 0.08
        m.setColorAt(i, tmp.copy(regionCols[t.region]).multiplyScalar(j))
      }
      const u = t.region >= 0 ? frame.regions[t.region].unrest : 0
      const k = border[i] && u > 0.45 ? (u - 0.45) / 0.55 : 0
      g.setColorAt(i, k > 0 ? tmp.copy(ember).multiplyScalar(0.25 + k * 0.75) : off)
    })
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    if (g.instanceColor) g.instanceColor.needsUpdate = true
  }, [frame, tiles, border])

  useFrame(({ clock }) => {
    if (glowMat.current) glowMat.current.opacity = 0.55 + Math.sin(clock.elapsedTime * 2.4) * 0.25
  })

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.instanceId == null) return
    const t = tiles[e.instanceId]
    if (t.region >= 0) select({ kind: 'region', id: frame.regions[t.region].id })
  }

  return (
    <group>
      <mesh>
        <sphereGeometry args={[R - 0.2, 64, 48]} />
        <meshToonMaterial color={C.grout} gradientMap={toonGradient()} />
      </mesh>
      <instancedMesh
        ref={tileRef}
        args={[geo, mat, tiles.length]}
        castShadow={quality === 'high'}
        receiveShadow
        onClick={onClick}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = '' }}
      />
      <instancedMesh ref={glowRef} args={[geo, undefined, tiles.length]} raycast={() => null} renderOrder={2}>
        <meshBasicMaterial ref={glowMat} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.BackSide} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
