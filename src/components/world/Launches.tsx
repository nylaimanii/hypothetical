'use client'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Frame } from '@/lib/types'
import { sceneRefs, surfaceQuat, vinyl } from './lib'
import { Rocket, STAGE_INDEX, launchState, padShake, symbolTransform } from './Symbols'
import { pipRegistry, usePhys } from './pipShared'
import { useStore, type Juice } from '../state/store'

const PUFFS = 64
type Puff = { pos: THREE.Vector3; vel: THREE.Vector3; born: number; life: number; size: number }

export default function Launches({ frame, spaceport }: { frame: Frame; spaceport?: string }) {
  const juice = useStore((s) => s.juice)
  const quality = useStore((s) => s.quality)
  const bumpDebris = usePhys((s) => s.bumpDebris)
  const active = useRef<{ j: Juice; fail: boolean; popped: boolean } | null>(null)
  const seen = useRef(0)
  const puffs = useRef<Puff[]>([])
  const puffMesh = useRef<THREE.InstancedMesh>(null)
  const chunks = useRef<{ pos: THREE.Vector3; vel: THREE.Vector3; born: number }[]>([])
  const chunkMesh = useRef<THREE.InstancedMesh>(null)
  const flier = useRef<THREE.Group>(null)
  const flame = useRef<THREE.Mesh>(null)
  const puffMat = useMemo(() => vinyl('#F3EEE4', { roughness: 0.9, clearcoat: 0 }), [])
  const chunkMat = useMemo(() => vinyl('#6a645d'), [])
  const flameMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFC27A').multiplyScalar(3), toneMapped: false }), [])
  const region = frame.regions.find((r) => r.id === spaceport)
  const pad = useMemo(() => (region ? symbolTransform(region, 7) : null), [region])
  const stage = Math.max(1, STAGE_INDEX[frame.moonStage])

  useEffect(() => {
    for (const j of juice) {
      if (j.id <= seen.current) continue
      seen.current = j.id
      if (j.kind !== 'launch') continue
      active.current = { j, fail: /fail/i.test(j.text), popped: false }
    }
  }, [juice])

  const spawnPuff = (at: THREE.Vector3, vel: THREE.Vector3, size: number, life: number) => {
    const now = performance.now() / 1000
    const list = puffs.current
    if (list.length >= PUFFS) list.shift()
    list.push({ pos: at.clone(), vel, born: now, life, size })
  }

  useFrame((_, dt) => {
    const now = performance.now() / 1000
    const a = active.current
    padShake.current = 0
    launchState.flying = false
    if (a && pad) {
      const since = now - a.j.at / 1000
      const n = pad.pos.clone().normalize()
      const base = pad.pos.clone().addScaledVector(n, 0.08)
      if (since < 1.4) {
        padShake.current = 1
        if (Math.random() < 0.6) spawnPuff(base.clone().addScaledVector(n, 0.05), new THREE.Vector3().randomDirection().addScaledVector(n, -0.5).multiplyScalar(0.5).addScaledVector(n, 0.2), 0.12 + Math.random() * 0.1, 1.6)
      } else if (since < 6 && !(a.fail && a.popped)) {
        launchState.flying = true
        // arc toward the moon, bulging away from the planet
        const u = Math.min(1, (since - 1.4) / 4.4)
        const e = u * u * (1.6 - 0.6 * u)
        const target = sceneRefs.moonPos
        const ctrl = base.clone().addScaledVector(n, 14).lerp(target, 0.25)
        const p = new THREE.Vector3().copy(base).multiplyScalar((1 - e) * (1 - e)).addScaledVector(ctrl, 2 * e * (1 - e)).addScaledVector(target, e * e)
        const ahead = new THREE.Vector3().copy(base).multiplyScalar((1 - e - 0.01) ** 2).addScaledVector(ctrl, 2 * (e + 0.01) * (1 - e - 0.01)).addScaledVector(target, (e + 0.01) ** 2)
        const dir = ahead.sub(p).normalize()
        if (flier.current) {
          flier.current.visible = true
          flier.current.position.copy(p)
          flier.current.quaternion.copy(surfaceQuat(dir, n))
          flier.current.scale.setScalar(0.95 * (1 + u * 0.5))
        }
        if (flame.current) flame.current.scale.set(1, 0.8 + Math.random() * 0.6, 1)
        if (Math.random() < 0.7) spawnPuff(p.clone().addScaledVector(dir, -0.2), dir.clone().multiplyScalar(-0.3).add(new THREE.Vector3().randomDirection().multiplyScalar(0.1)), 0.08 + u * 0.1, 2.2)
        if (a.fail && since > 2.9 && !a.popped) {
          a.popped = true
          for (let i = 0; i < 18; i++) spawnPuff(p, new THREE.Vector3().randomDirection().multiplyScalar(0.9 + Math.random()), 0.15 + Math.random() * 0.15, 1.8)
          if (quality === 'high') {
            pipRegistry.debris.push({ id: a.j.id, origin: p.clone().addScaledVector(n, -0.5).setLength(Math.min(p.length(), 11.6)), at: now })
            bumpDebris()
          } else {
            for (let i = 0; i < 12; i++) chunks.current.push({ pos: p.clone(), vel: new THREE.Vector3().randomDirection().multiplyScalar(1.4).addScaledVector(n, 0.8), born: now })
          }
        }
      } else if (since >= 6) active.current = null
    }
    if (!launchState.flying && flier.current) flier.current.visible = false

    // puffs swell then shrink
    const pm = puffMesh.current
    if (pm) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion()
      puffs.current = puffs.current.filter((p) => now - p.born < p.life)
      for (let i = 0; i < PUFFS; i++) {
        const p = puffs.current[i]
        if (!p) { pm.setMatrixAt(i, m.makeScale(0, 0, 0)); continue }
        const k = (now - p.born) / p.life
        p.pos.addScaledVector(p.vel, dt)
        p.vel.multiplyScalar(0.97)
        const s = p.size * Math.sin(Math.min(1, k * 1.4) * Math.PI * 0.5) * (1 - k * k) * 1.6
        pm.setMatrixAt(i, m.compose(p.pos, q, new THREE.Vector3(s, s, s)))
      }
      pm.instanceMatrix.needsUpdate = true
    }
    // cheap debris for fast mode
    const cm = chunkMesh.current
    if (cm) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion()
      chunks.current = chunks.current.filter((c) => now - c.born < 4)
      for (let i = 0; i < 24; i++) {
        const c = chunks.current[i]
        if (!c) { cm.setMatrixAt(i, m.makeScale(0, 0, 0)); continue }
        const nrm = c.pos.clone().normalize()
        c.vel.addScaledVector(nrm, -3 * dt)
        c.pos.addScaledVector(c.vel, dt)
        if (c.pos.length() < 10.25) { c.pos.setLength(10.25); c.vel.multiplyScalar(0.3) }
        q.setFromEuler(new THREE.Euler(now * 3 + i, now * 2, i))
        cm.setMatrixAt(i, m.compose(c.pos, q, new THREE.Vector3(0.08, 0.05, 0.1)))
      }
      cm.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group>
      <instancedMesh ref={puffMesh} args={[undefined, puffMat, PUFFS]} frustumCulled={false} raycast={() => null}>
        <icosahedronGeometry args={[1, 1]} />
      </instancedMesh>
      <instancedMesh ref={chunkMesh} args={[undefined, chunkMat, 24]} frustumCulled={false} raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      <group ref={flier} visible={false}>
        <Rocket stage={stage} />
        <mesh ref={flame} position={[0, -0.12, 0]} rotation={[Math.PI, 0, 0]} material={flameMat}>
          <coneGeometry args={[0.08, 0.3, 12]} />
        </mesh>
      </group>
    </group>
  )
}
