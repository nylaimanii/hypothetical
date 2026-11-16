'use client'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Outlines } from '@react-three/drei'
import type { Frame } from '@/lib/types'
import { C, CORE_POS, LAND_TOP, latLonToVec3, vinyl, sceneRefs } from './lib'
import { useStore } from '../state/store'

// regions a decision touched: migration endpoints plus any region whose stats moved
export function changedRegions(prev: Frame | undefined, cur: Frame): string[] {
  const out = new Set<string>()
  for (const m of cur.decision?.migrations ?? []) { out.add(m.from); out.add(m.to) }
  if (prev) {
    for (const r of cur.regions) {
      const p = prev.regions.find((x) => x.id === r.id)
      if (!p) continue
      const d = Math.abs(r.unrest - p.unrest) + Math.abs(r.techLevel - p.techLevel) + Math.abs(r.compliance - p.compliance) + Math.abs(r.foodKcalPerCapita - p.foodKcalPerCapita) / 1000
      if (d > 0.04) out.add(r.id)
    }
  }
  return [...out]
}

export default function Core({ frame, prev, idx }: { frame: Frame; prev?: Frame; idx: number }) {
  const select = useStore((s) => s.select)
  const body = useRef<THREE.Mesh>(null)
  const ringA = useRef<THREE.Group>(null)
  const ringB = useRef<THREE.Group>(null)
  const beams = useRef<THREE.Group>(null)
  const pulse = useRef(-10)
  const dead = frame.status === 'destroyed'

  const mat = useMemo(() => vinyl('#2a2730', { emissive: new THREE.Color('#F4E9D2'), emissiveIntensity: 0.2, roughness: 0.4, clearcoat: 0.8, toneMapped: false }), [])
  const ringMat = useMemo(() => vinyl(C.bone, { emissive: new THREE.Color(C.bone), emissiveIntensity: 0.4, toneMapped: false }), [])
  const beamMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(C.bone).multiplyScalar(2.2), transparent: true, opacity: 0, toneMapped: false, depthWrite: false }), [])

  const targets = useMemo(() => (frame.decision ? changedRegions(prev, frame) : []), [frame, prev])
  const beamGeo = useMemo(() => targets.map((id) => {
    const r = frame.regions.find((x) => x.id === id)!
    const end = latLonToVec3(r.lat, r.lon, LAND_TOP)
    const mid = end.clone().sub(CORE_POS)
    const len = mid.length()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), mid.clone().normalize())
    return { id, pos: CORE_POS.clone().addScaledVector(mid, 0.5), q, len }
  }), [targets, frame.regions])

  useEffect(() => { if (frame.decision) pulse.current = performance.now() / 1000 }, [idx, frame.decision])

  useFrame(() => {
    const t = sceneRefs.wt
    const since = performance.now() / 1000 - pulse.current
    const p = since < 1.6 ? Math.sin((since / 1.6) * Math.PI) : 0
    if (body.current) {
      const breathe = 1 + Math.sin(t * 1.3) * 0.035
      body.current.scale.setScalar(breathe + p * 0.3)
      body.current.rotation.y = t * 0.15
      mat.emissiveIntensity = dead ? 0 : 0.12 + (Math.sin(t * 1.3) * 0.5 + 0.5) * 0.12 + p * 3
      mat.color.set(dead ? '#151416' : '#2a2730')
    }
    ringMat.emissiveIntensity = dead ? 0 : 0.35 + p * 2
    if (ringA.current) ringA.current.rotation.z = t * (dead ? 0.02 : 0.4)
    if (ringB.current) ringB.current.rotation.x = -t * (dead ? 0.015 : 0.3)
    beamMat.opacity = since < 2.4 ? Math.max(0, 1 - since / 2.4) * 0.9 : 0
    if (beams.current) beams.current.visible = beamMat.opacity > 0.01
  })

  return (
    <group>
      <group position={CORE_POS}
        onClick={(e) => { e.stopPropagation(); select({ kind: 'core' }) }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = '' }}>
        <mesh ref={body} material={mat} castShadow>
          <icosahedronGeometry args={[1.5, 2]} />
          <Outlines thickness={0.05} color={C.ink} />
        </mesh>
        <group rotation={[0.5, 0, 0.3]}>
          <group ref={ringA}>
            <mesh material={ringMat}><torusGeometry args={[2.3, 0.07, 10, 80]} /><Outlines thickness={0.03} color={C.ink} /></mesh>
            <mesh material={ringMat} position={[2.3, 0, 0]}><sphereGeometry args={[0.16, 12, 10]} /></mesh>
          </group>
        </group>
        <group rotation={[-0.35, 0.8, 0.9]}>
          <group ref={ringB}>
            <mesh material={ringMat}><torusGeometry args={[2.7, 0.05, 10, 90]} /><Outlines thickness={0.03} color={C.ink} /></mesh>
            <mesh material={ringMat} position={[0, 2.7, 0]}><sphereGeometry args={[0.12, 12, 10]} /></mesh>
          </group>
        </group>
      </group>
      <group ref={beams} visible={false}>
        {beamGeo.map((b) => (
          <mesh key={b.id} position={b.pos} quaternion={b.q} material={beamMat} raycast={() => null}>
            <cylinderGeometry args={[0.025, 0.025, b.len, 6, 1, true]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
