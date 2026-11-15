'use client'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Outlines, RoundedBox } from '@react-three/drei'
import type { Frame, Layer, MoonStage, Region } from '@/lib/types'
import { C, LAND_TOP, LAYERS, latLonToVec3, layerMetric, surfaceQuat, tangentBasis, vinyl } from './lib'
import { useStore } from '../state/store'

export const STAGE_INDEX: Record<MoonStage, number> = { none: 0, orbital: 1, heavy_lift: 2, life_support: 3, lander: 4, crewed_landing: 5 }

export function symbolTransform(r: Pick<Region, 'lat' | 'lon'>, layerIdx: number) {
  const center = latLonToVec3(r.lat, r.lon, 1)
  const { east, north } = tangentBasis(center)
  const a = (layerIdx / LAYERS.length) * Math.PI * 2 + 0.3
  const rad = 1.7
  const pos = center.clone().multiplyScalar(LAND_TOP).addScaledVector(east, Math.cos(a) * rad).addScaledVector(north, Math.sin(a) * rad).normalize().multiplyScalar(LAND_TOP)
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

const O = ({ t = 0.055 }: { t?: number }) => <Outlines thickness={t} color={C.ink} />

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

function Capitol({ m }: { m: number }) {
  return (
    <group scale={0.75 + m * 0.5}>
      <RoundedBox args={[0.9, 0.18, 0.62]} radius={0.05} position={[0, 0.09, 0]} material={mats.boneDeep}><O /></RoundedBox>
      <RoundedBox args={[0.7, 0.3, 0.46]} radius={0.05} position={[0, 0.33, 0]} material={mats.bone}><O /></RoundedBox>
      {[-0.24, -0.08, 0.08, 0.24].map((x) => (
        <mesh key={x} position={[x, 0.33, 0.25]} material={mats.boneDeep}><cylinderGeometry args={[0.035, 0.035, 0.3, 10]} /><O t={0.04} /></mesh>
      ))}
      <mesh position={[0, 0.5, 0]} material={mats.bone}><sphereGeometry args={[0.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><O /></mesh>
      <mesh position={[0, 0.76, 0]} material={mats.ink}><cylinderGeometry args={[0.018, 0.018, 0.14, 6]} /></mesh>
    </group>
  )
}

function Coins({ m }: { m: number }) {
  const n = 2 + Math.round(m * 7)
  return (
    <group>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[Math.sin(i * 1.7) * 0.025, 0.05 + i * 0.085, Math.cos(i * 2.3) * 0.025]} material={mats.gold}>
          <cylinderGeometry args={[0.22, 0.22, 0.075, 22]} /><O t={0.04} />
        </mesh>
      ))}
      {n > 5 && (
        <mesh position={[0.36, 0.05, 0.1]} material={mats.gold}><cylinderGeometry args={[0.16, 0.16, 0.075, 20]} /><O t={0.04} /></mesh>
      )}
    </group>
  )
}

function Tower({ m }: { m: number }) {
  const tip = useRef<THREE.Mesh>(null)
  const h = 0.6 + m * 0.9
  useFrame(({ clock }) => {
    if (tip.current) (tip.current.material as THREE.MeshPhysicalMaterial).emissiveIntensity = Math.sin(clock.elapsedTime * 4) > 0.2 ? 0.9 : 0.1
  })
  const tipMat = useMemo(() => mats.tip.clone(), [])
  return (
    <group>
      <mesh position={[0, h / 2, 0]} material={mats.steel}><cylinderGeometry args={[0.05, 0.2, h, 4]} /><O /></mesh>
      {[0.3, 0.6].map((f) => (
        <RoundedBox key={f} args={[0.5 - f * 0.3, 0.04, 0.06]} radius={0.015} position={[0, h * f, 0]} material={mats.steel}><O t={0.03} /></RoundedBox>
      ))}
      <mesh ref={tip} position={[0, h + 0.06, 0]} material={tipMat}><sphereGeometry args={[0.07, 14, 10]} /><O t={0.04} /></mesh>
    </group>
  )
}

function Spire({ m }: { m: number }) {
  const orb = useRef<THREE.Mesh>(null)
  const h = 0.5 + m * 0.8
  useFrame(({ clock }) => { if (orb.current) orb.current.position.y = h + 0.14 + Math.sin(clock.elapsedTime * 1.4) * 0.03 })
  return (
    <group>
      <RoundedBox args={[0.3, 0.1, 0.3]} radius={0.03} position={[0, 0.05, 0]} material={mats.boneDeep}><O t={0.04} /></RoundedBox>
      <mesh position={[0, 0.1 + h / 2, 0]} material={mats.spire}><cylinderGeometry args={[0.03, 0.1, h, 6]} /><O /></mesh>
      <mesh ref={orb} material={mats.orb}><icosahedronGeometry args={[0.09, 1]} /><O t={0.04} /></mesh>
    </group>
  )
}

function Screen({ m }: { m: number }) {
  return (
    <group scale={0.75 + m * 0.5}>
      <mesh position={[0, 0.12, 0]} material={mats.ink}><cylinderGeometry args={[0.04, 0.06, 0.24, 8]} /></mesh>
      <RoundedBox args={[0.72, 0.48, 0.14]} radius={0.05} position={[0, 0.48, 0]} material={mats.boneDeep}><O /></RoundedBox>
      <RoundedBox args={[0.6, 0.36, 0.02]} radius={0.01} position={[0, 0.48, 0.07]} material={mats.screen} />
    </group>
  )
}

function House({ m }: { m: number }) {
  return (
    <group scale={0.7 + m * 0.5}>
      <RoundedBox args={[0.5, 0.36, 0.44]} radius={0.04} position={[0, 0.18, 0]} material={mats.bone}><O /></RoundedBox>
      <mesh position={[0, 0.48, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.roof}>
        <cylinderGeometry args={[0.2, 0.2, 0.56, 3]} /><O />
      </mesh>
      <RoundedBox args={[0.12, 0.2, 0.02]} radius={0.01} position={[0, 0.1, 0.225]} material={mats.ink} />
      <RoundedBox args={[0.1, 0.1, 0.02]} radius={0.01} position={[0.15, 0.22, 0.225]} material={mats.screen} />
    </group>
  )
}

function Farm({ m }: { m: number }) {
  const trees = 1 + Math.round(m * 3)
  return (
    <group>
      <RoundedBox args={[0.8, 0.08, 0.6]} radius={0.03} position={[0, 0.04, 0]} material={mats.soil}><O t={0.04} /></RoundedBox>
      {[-0.2, 0, 0.2].map((z) => (
        <RoundedBox key={z} args={[0.66, 0.06, 0.08]} radius={0.02} position={[0, 0.1, z]} material={mats.leaf} />
      ))}
      {Array.from({ length: trees }, (_, i) => (
        <group key={i} position={[-0.5 + (i % 2) * 0.12, 0, -0.3 + i * 0.22]}>
          <mesh position={[0, 0.12, 0]} material={mats.trunk}><cylinderGeometry args={[0.03, 0.04, 0.24, 6]} /></mesh>
          <mesh position={[0, 0.3, 0]} material={mats.leaf}><icosahedronGeometry args={[0.13, 1]} /><O t={0.04} /></mesh>
        </group>
      ))}
    </group>
  )
}

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

const ICON: Record<Exclude<Layer, 'physics'>, (p: { m: number }) => React.ReactElement> = {
  government: Capitol, economy: Coins, tech: Tower, religion: Spire, media: Screen, family: House, biology: Farm,
}

export const padShake = { current: 0 } as React.RefObject<number>
export const launchState = { flying: false } // rocket leaves the pad while flying

export default function Symbols({ frame, spaceport }: { frame: Frame; spaceport?: string }) {
  const zoom = useStore((s) => s.zoom)
  const select = useStore((s) => s.select)
  const quality = useStore((s) => s.quality)
  const stage = STAGE_INDEX[frame.moonStage]
  const root = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    root.current?.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = quality === 'high'; o.receiveShadow = quality === 'high' } })
  })
  if (zoom === 'far') return null
  return (
    <group ref={root}>
      {frame.regions.map((r) => (
        <group key={r.id}>
          {LAYERS.map((layer, i) => {
            const { pos, quat } = symbolTransform(r, i)
            const m = layerMetric(layer, r, frame.regions)
            const onClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); select(layer === 'physics' && r.id === spaceport ? { kind: 'moon' } : { kind: 'layer', regionId: r.id, layer }) }
            const Icon = layer === 'physics' ? null : ICON[layer]
            return (
              <group key={layer} position={pos} quaternion={quat} scale={zoom === 'close' ? 0.5 : 0.95} onClick={onClick}
                onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
                onPointerOut={() => { document.body.style.cursor = '' }}>
                {Icon ? <Icon m={m} /> : <Pad m={m} rocketStage={r.id === spaceport ? stage : 0} shake={padShake} />}
              </group>
            )
          })}
        </group>
      ))}
    </group>
  )
}
