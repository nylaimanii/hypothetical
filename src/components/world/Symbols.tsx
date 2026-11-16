'use client'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Outlines, RoundedBox } from '@react-three/drei'
import type { Frame, MoonStage, Region } from '@/lib/types'
import { C, LAND_TOP, LAYERS, R, groundRadius, latLonToVec3, layerMetric, surfaceQuat, tangentBasis, vinyl } from './lib'
import { useStore } from '../state/store'

export const STAGE_INDEX: Record<MoonStage, number> = { none: 0, orbital: 1, heavy_lift: 2, life_support: 3, lander: 4, crewed_landing: 5 }

export function symbolTransform(r: Pick<Region, 'lat' | 'lon'>, layerIdx: number) {
  const center = latLonToVec3(r.lat, r.lon, 1)
  const { east, north } = tangentBasis(center)
  const a = (layerIdx / LAYERS.length) * Math.PI * 2 + 0.3
  const rad = 1.7
  const pos = center.clone().multiplyScalar(LAND_TOP).addScaledVector(east, Math.cos(a) * rad).addScaledVector(north, Math.sin(a) * rad).normalize().multiplyScalar(LAND_TOP)
  pos.setLength(groundRadius(pos))
  const quat = surfaceQuat(pos.clone().normalize(), north)
  return { pos, quat }
}

export function spaceportId(frames: Frame[], idx: number, regions: Region[]) {
  for (let i = idx; i >= 0; i--) {
    const e = frames[i]?.newEvents.find((x) => x.kind === 'launch' && x.regionId)
    if (e?.regionId) return e.regionId
  }
  return [...regions].sort((a, b) => b.techLevel - a.techLevel)[0]?.id
}

// perf: an outline is a whole extra mesh per part. they only read up close, so only draw them there
function O({ t = 0.055 }: { t?: number }) {
  const close = useStore((s) => s.zoom === 'close')
  return close ? <Outlines thickness={t} color={C.ink} /> : null
}

const mats = {
  bone: vinyl(C.bone),
  boneDeep: vinyl(C.boneDeep),
  ink: vinyl('#3a3633'),
  gold: vinyl('#D8B25A', { roughness: 0.45, clearcoat: 0.6 }),
  steel: vinyl('#9DA6AE'),
  soil: vinyl('#8A6F55'),
  leaf: vinyl('#7FA36B'),
  trunk: vinyl('#6E5440'),
  roof: vinyl('#7C8FA8'),
  screen: vinyl('#BFD8E6', { emissive: new THREE.Color('#BFD8E6'), emissiveIntensity: 0.45 }),
  spire: vinyl('#E9E2F2', { emissive: new THREE.Color('#E9E2F2'), emissiveIntensity: 0.25 }),
  orb: vinyl('#F7F1E0', { emissive: new THREE.Color('#F7EBC8'), emissiveIntensity: 0.6 }),
  tip: vinyl('#F2DFA0', { emissive: new THREE.Color('#F2DFA0'), emissiveIntensity: 0.8 }),
  rocket: vinyl('#F4F0E6'),
  rocketBand: vinyl('#5F7A88'),
}

// v5: the generic layer icons (capitol, coins, tower, spire, screen, house, farm) were retired for real infrastructure

export function Rocket({ stage }: { stage: number }) {
  if (stage <= 0) return null
  const body = 0.3 + stage * 0.16
  return (
    <group>
      <mesh position={[0, body / 2, 0]} material={mats.rocket}><cylinderGeometry args={[0.09, 0.1, body, 16]} /><O t={0.04} /></mesh>
      <mesh position={[0, body * 0.35, 0]} material={mats.rocketBand}><cylinderGeometry args={[0.102, 0.102, 0.05, 16]} /></mesh>
      <mesh position={[0, body + 0.09, 0]} material={mats.rocket}><coneGeometry args={[0.09, 0.18, 16]} /><O t={0.04} /></mesh>
      {stage >= 2 && [-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.15, body * 0.3, 0]} material={mats.rocket}><cylinderGeometry args={[0.05, 0.055, body * 0.6, 12]} /><O t={0.03} /></mesh>
      ))}
      {stage >= 3 && <mesh position={[0, body + 0.02, 0]} material={mats.rocketBand}><cylinderGeometry args={[0.095, 0.095, 0.06, 16]} /></mesh>}
      {stage >= 4 && [0, 1, 2].map((k) => (
        <mesh key={k} position={[Math.cos((k * Math.PI * 2) / 3) * 0.12, 0.04, Math.sin((k * Math.PI * 2) / 3) * 0.12]} rotation={[0, -(k * Math.PI * 2) / 3, 0.5]} material={mats.ink}>
          <cylinderGeometry args={[0.012, 0.012, 0.14, 6]} />
        </mesh>
      ))}
    </group>
  )
}

function Pad({ m, rocketStage, shake }: { m: number; rocketStage: number; shake: React.RefObject<number> }) {
  const g = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!g.current) return
    const k = shake.current ?? 0
    g.current.visible = !(rocketStage > 0 && launchState.flying)
    g.current.position.set((Math.random() - 0.5) * 0.03 * k, 0, (Math.random() - 0.5) * 0.03 * k)
  })
  return (
    <group scale={0.8 + m * 0.4}>
      <mesh position={[0, 0.05, 0]} material={mats.boneDeep}><cylinderGeometry args={[0.36, 0.4, 0.1, 20]} /><O t={0.04} /></mesh>
      <RoundedBox args={[0.06, 0.6 + rocketStage * 0.15, 0.06]} radius={0.02} position={[-0.26, 0.35 + rocketStage * 0.075, 0]} material={mats.steel}><O t={0.03} /></RoundedBox>
      <group ref={g} position={[0, 0.1, 0]}><group><Rocket stage={rocketStage} /></group></group>
    </group>
  )
}


export const padShake = { current: 0 } as React.RefObject<number>
export const launchState = { flying: false } // rocket leaves the pad while flying

export default function Symbols({ frame, spaceport }: { frame: Frame; spaceport?: string }) {
  const zoom = useStore((s) => s.zoom)
  const select = useStore((s) => s.select)
  const quality = useStore((s) => s.quality)
  const stage = STAGE_INDEX[frame.moonStage]
  const root = useRef<THREE.Group>(null)
  // perf: a region's symbols past the planet's horizon are hidden (frustum culling alone keeps the far side)
  const regionGroups = useRef<(THREE.Group | null)[]>([])
  const normals = useMemo(() => frame.regions.map((r) => latLonToVec3(r.lat, r.lon, 1).normalize()), [frame.regions])
  useFrame(({ camera }) => {
    const d = camera.position.length()
    const dir = camera.position.clone().divideScalar(d)
    const horizon = Math.cos(Math.acos(Math.min(1, R / d)) + 0.35)
    normals.forEach((n, i) => { const g = regionGroups.current[i]; if (g) g.visible = n.dot(dir) > horizon })
  })
  const [warm, setWarm] = useState(false)
  useEffect(() => { const id = setTimeout(() => setWarm(true), 400); return () => clearTimeout(id) }, [])
  useLayoutEffect(() => {
    root.current?.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = quality === 'high'; o.receiveShadow = quality === 'high' } })
  })
  // mounted from the start and drawn once so shaders compile at load, then hidden at far zoom
  return (
    <group ref={root} visible={zoom !== 'far' || !warm}>
      {frame.regions.map((r, ri) => (
        <group key={r.id} ref={(g) => { regionGroups.current[ri] = g }}>
          {LAYERS.map((layer, i) => {
            // v5: the generic per-region icons are retired; real infrastructure replaces them.
            // only the launch pad stays, at the spaceport (a real launch site, and the launches fly from it)
            if (layer !== 'physics' || r.id !== spaceport) return null
            const { pos, quat } = symbolTransform(r, i)
            const m = layerMetric(layer, r, frame.regions)
            const onClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); select({ kind: 'moon' }) }
            return (
              <group key={layer} position={pos} quaternion={quat} scale={zoom === 'close' ? 0.5 : 0.95} onClick={onClick}
                onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
                onPointerOut={() => { document.body.style.cursor = '' }}>
                <Pad m={m} rocketStage={stage} shake={padShake} />
              </group>
            )
          })}
        </group>
      ))}
    </group>
  )
}
