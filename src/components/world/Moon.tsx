'use client'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Outlines } from '@react-three/drei'
import type { Frame } from '@/lib/types'
import { C, MOON_ORBIT, MOON_R, MOON_TILT, sceneRefs, vinyl } from './lib'
import { useStore } from '../state/store'


export default function Moon({ frame }: { frame: Frame }) {
  const select = useStore((s) => s.select)
  const g = useRef<THREE.Group>(null)
  const ball = useRef<THREE.Mesh>(null)
  const mat = useMemo(() => vinyl('#DCD6CB', { emissive: new THREE.Color('#F4EEDC'), emissiveIntensity: 0, roughness: 0.8, clearcoat: 0, toneMapped: false }), [])
  const craterMat = useMemo(() => vinyl('#C4BDB0', { roughness: 0.9 }), [])
  const craters = useMemo(() => Array.from({ length: 9 }, (_, i) => {
    const v = new THREE.Vector3(Math.sin(i * 2.4) * Math.cos(i * 1.3), Math.cos(i * 2.4), Math.sin(i * 2.4) * Math.sin(i * 1.3)).normalize()
    return { p: v.clone().multiplyScalar(1.55), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v), r: 0.18 + (i % 3) * 0.1 }
  }), [])
  const landed = frame.moonStage === 'crewed_landing'
  useFrame(() => {
    const a = sceneRefs.wt * 0.04 + 0.6
    const x = Math.cos(a) * MOON_ORBIT, z = Math.sin(a) * MOON_ORBIT
    if (g.current) {
      g.current.position.set(x, Math.sin(a) * MOON_ORBIT * Math.sin(MOON_TILT) + 3, z * Math.cos(MOON_TILT))
      sceneRefs.moonPos.copy(g.current.position)
      g.current.lookAt(0, 0, 0) // flag faces home
    }
    const glow = frame.moonProgress
    mat.emissiveIntensity = glow * 1.6 + (landed ? Math.sin(sceneRefs.wt * 2) * 0.2 + 0.4 : 0)
  })
  return (
    <group ref={g} scale={MOON_R / 1.6}
      onClick={(e) => { e.stopPropagation(); select({ kind: 'moon' }) }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { document.body.style.cursor = '' }}>
      <mesh ref={ball} material={mat}>
        <icosahedronGeometry args={[1.6, 3]} />
        <Outlines thickness={0.05} color={C.ink} />
      </mesh>
      {craters.map((c, i) => (
        <mesh key={i} position={c.p} quaternion={c.q} material={craterMat}><cylinderGeometry args={[c.r, c.r * 1.1, 0.12, 14]} /></mesh>
      ))}
      {landed && (
        <group position={[0, 0, 1.58]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh position={[0, 0.35, 0]} material={craterMat}><cylinderGeometry args={[0.02, 0.02, 0.7, 6]} /></mesh>
          <mesh position={[0.17, 0.6, 0]}><boxGeometry args={[0.32, 0.2, 0.02]} /><meshPhysicalMaterial color={C.bone} roughness={0.5} /><Outlines thickness={0.02} color={C.ink} /></mesh>
        </group>
      )}
    </group>
  )
}
