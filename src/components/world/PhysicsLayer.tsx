'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { BallCollider, CapsuleCollider, CuboidCollider, RigidBody, useBeforePhysicsStep, useRapier, useSphericalJoint, type RapierRigidBody } from '@react-three/rapier'
import { C, LAND_TOP, vinyl } from './lib'
import { P, buildW, headScale, pipRegistry, pipScale, shoulderX, usePhys, type Agent } from './pipShared'
import { useStore } from '../state/store'

const G = 3.2 // world units / s^2, scaled for 0.42 unit tall people

// radial gravity for every dynamic body
function GravityField() {
  const { world } = useRapier()
  useBeforePhysicsStep(() => {
    const dt = world.timestep
    world.forEachRigidBody((b) => {
      if (!b.isDynamic() || b.isSleeping()) return
      const p = b.translation()
      const l = Math.hypot(p.x, p.y, p.z) || 1
      const k = (-G * b.mass() * dt) / l
      b.applyImpulse({ x: p.x * k, y: p.y * k, z: p.z * k }, true)
    })
  })
  return null
}

const v3 = (o: { x: number; y: number; z: number }) => new THREE.Vector3(o.x, o.y, o.z)
const q4 = (o: { x: number; y: number; z: number; w: number }) => new THREE.Quaternion(o.x, o.y, o.z, o.w)

// angular velocity that rotates `cur` toward `target`
function rotErr(cur: THREE.Quaternion, target: THREE.Quaternion) {
  const d = target.clone().multiply(cur.clone().invert())
  if (d.w < 0) { d.x = -d.x; d.y = -d.y; d.z = -d.z; d.w = -d.w }
  const ang = 2 * Math.acos(Math.min(1, d.w))
  const s = Math.sqrt(1 - d.w * d.w)
  return s < 1e-5 ? new THREE.Vector3() : new THREE.Vector3(d.x / s, d.y / s, d.z / s).multiplyScalar(ang)
}

function Ragdoll({ agent }: { agent: Agent }) {
  const c = agent.citizen
  const s = pipScale(c)
  const hs = headScale(c)
  const bw = buildW(c.build)
  const sx = shoulderX(bw)
  const torso = useRef<RapierRigidBody>(null!)
  const head = useRef<RapierRigidBody>(null!)
  const armL = useRef<RapierRigidBody>(null!)
  const armR = useRef<RapierRigidBody>(null!)
  const legL = useRef<RapierRigidBody>(null!)
  const legR = useRef<RapierRigidBody>(null!)
  const joints = [
    useSphericalJoint(torso, head, [[0, P.neckY * s, 0], [0, 0, 0]]),
    useSphericalJoint(torso, armL, [[sx * s, P.shoulderY * s, 0], [0, 0, 0]]),
    useSphericalJoint(torso, armR, [[-sx * s, P.shoulderY * s, 0], [0, 0, 0]]),
    useSphericalJoint(torso, legL, [[P.hipX * s, 0, 0], [0, 0, 0]]),
    useSphericalJoint(torso, legR, [[-P.hipX * s, 0, 0], [0, 0, 0]]),
  ]
  const state = useRef({ stunnedUntil: 0, recoverFrom: 0, shocks: new Set<number>(), nextHop: 0 })

  // spawn standing where the animated pip already is
  const spawn = useMemo(() => {
    const r = pipRegistry.roots.get(agent.key)
    const pos = r?.pos.clone() ?? agent.home.clone().setLength(LAND_TOP)
    const quat = r?.quat.clone() ?? new THREE.Quaternion()
    const w = (x: number, y: number, z: number) => pos.clone().add(new THREE.Vector3(x * s, y * s, z * s).applyQuaternion(quat)).toArray()
    return {
      quat: quat.toArray() as [number, number, number, number],
      torso: w(0, P.hipY + 0.01, 0), head: w(0, P.hipY + P.neckY, 0),
      armL: w(sx, P.hipY + P.shoulderY, 0), armR: w(-sx, P.hipY + P.shoulderY, 0),
      legL: w(P.hipX, P.hipY, 0), legR: w(-P.hipX, P.hipY, 0),
    }
  }, [agent.key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const j of joints) j.current?.setContactsEnabled(false)
    const id = requestAnimationFrame(() => {
      if (torso.current && head.current && armL.current && armR.current && legL.current && legR.current)
        pipRegistry.ragdolls.set(agent.key, { torso: torso.current, head: head.current, armL: armL.current, armR: armR.current, legL: legL.current, legR: legR.current })
    })
    return () => { cancelAnimationFrame(id); pipRegistry.ragdolls.delete(agent.key) }
  }, [agent.key]) // eslint-disable-line react-hooks/exhaustive-deps

  useBeforePhysicsStep(() => {
    const ag = pipRegistry.agents.get(agent.key) ?? agent
    const tb = torso.current
    if (!tb) return
    const now = performance.now() / 1000
    const st = state.current
    const pos = v3(tb.translation())
    const n = pos.clone().normalize()
    const h = pos.length() - LAND_TOP
    const H = P.hipY * s
    const rot = q4(tb.rotation())
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rot)
    const all = [tb, head.current, armL.current, armR.current, legL.current, legR.current]

    // shockwaves from disasters
    for (const sh of pipRegistry.shocks) {
      if (st.shocks.has(sh.id) || now - sh.at > 1.5) continue
      st.shocks.add(sh.id)
      const d = pos.clone().sub(sh.center)
      const dist = d.length()
      if (dist > sh.radius) continue
      const fall = 1 - dist / sh.radius
      d.addScaledVector(n, -d.dot(n)).normalize()
      for (const b of all) {
        if (!b) continue
        const v = v3(b.linvel()).addScaledVector(d, sh.strength * fall * (0.8 + Math.random() * 0.5)).addScaledVector(n, sh.strength * fall * 0.6)
        b.setLinvel(v, true)
        b.setAngvel(new THREE.Vector3().randomDirection().multiplyScalar(8 * fall), true)
      }
      st.stunnedUntil = now + 1.6 + Math.random() * 1.2
    }

    // stumble when tipped too far
    const tilt = up.angleTo(n)
    // only a pip that is fully back on its feet can stumble again
    if (now >= st.stunnedUntil && now - st.recoverFrom > 1.6 && tilt > 1.05) { st.stunnedUntil = now + 0.8 + Math.random() * 0.6 }
    if (now < st.stunnedUntil) { st.recoverFrom = st.stunnedUntil; return }
    const rec = Math.min(1, (now - st.recoverFrom) / 1.2) * 0.85 + 0.15

    // follow the animated path
    const root = pipRegistry.roots.get(agent.key)
    const v = v3(tb.linvel())
    const vn = v.dot(n)
    const vt = v.clone().addScaledVector(n, -vn)
    let want = new THREE.Vector3()
    if (root) {
      want = root.pos.clone().sub(pos)
      want.addScaledVector(n, -want.dot(n)).multiplyScalar(3)
      const max = ag.revolt ? 0.7 : 0.35
      if (want.length() > max) want.setLength(max)
    }
    // pd hover holds the hips at leg height; it is weak while recovering so they visibly get up
    const near = h < H * 1.8
    const vnWant = near ? Math.max(-1.5, Math.min(1.5, (H - h) * 14)) : vn
    const nv = vt.lerp(want, 0.18 * rec).addScaledVector(n, vn + (vnWant - vn) * 0.3 * rec)
    tb.setLinvel(nv, true)

    // revolt: sync hops and shoves so the crowd piles up
    if (ag.revolt && now > st.nextHop) {
      st.nextHop = Math.ceil(now / 0.42) * 0.42 + 0.001
      tb.applyImpulse(n.clone().multiplyScalar(tb.mass() * 0.9), true)
      if (Math.random() < 0.25) tb.applyImpulse(new THREE.Vector3().randomDirection().addScaledVector(n, -0.3).multiplyScalar(tb.mass() * 0.6), true)
    }

    // pd upright + face the walking direction
    const fwd = root?.heading.lengthSq() ? root.heading.clone() : new THREE.Vector3(0, 0, 1).applyQuaternion(rot)
    const zDir = fwd.addScaledVector(n, -fwd.dot(n)).normalize()
    const xDir = new THREE.Vector3().crossVectors(n, zDir)
    const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xDir, n, zDir))
    const elder = c.age > 66 ? 0.32 : 0.05
    const torsoTarget = target.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), elder))
    const w = v3(tb.angvel())
    tb.setAngvel(w.lerp(rotErr(rot, torsoTarget).multiplyScalar(9), 0.3 * rec), true)

    // limbs swing with the gait
    const phase = now * (7 + ((c.personalitySeed >> 5) % 30) / 10)
    const speed = Math.min(1, vt.length() / 0.25)
    const limb = (b: RapierRigidBody | null, ang: number, roll = 0) => {
      if (!b) return
      const tq = torsoTarget.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(ang, 0, roll)))
      const lw = v3(b.angvel())
      b.setAngvel(lw.lerp(rotErr(q4(b.rotation()), tq).multiplyScalar(12), 0.35 * rec), true)
    }
    const sw = Math.sin(phase) * 0.5 * speed
    limb(legL.current, sw); limb(legR.current, -sw)
    limb(armL.current, ag.revolt ? -2.3 : -Math.sin(phase - 0.7) * 0.45 * speed, 0.12)
    limb(armR.current, Math.sin(phase - 0.7) * 0.45 * speed, -0.12)
    limb(head.current, -elder * 0.7)
  })

  const common = { colliders: false as const, linearDamping: 0.6, angularDamping: 2, canSleep: false, quaternion: spawn.quat, friction: 0.9 }
  return (
    <>
      <RigidBody ref={torso} position={spawn.torso as [number, number, number]} {...common}>
        <CapsuleCollider args={[P.torsoHalf * s, P.torsoR * bw * s]} position={[0, P.torsoCenter * s, 0]} density={1.4} />
      </RigidBody>
      <RigidBody ref={head} position={spawn.head as [number, number, number]} {...common}>
        <BallCollider args={[0.14 * s * hs]} position={[0, P.headCenter * s * hs, 0]} density={0.9} />
      </RigidBody>
      <RigidBody ref={armL} position={spawn.armL as [number, number, number]} {...common}>
        <CapsuleCollider args={[P.armHalf * s, P.armR * s]} position={[0, P.armCenter * s, 0]} />
      </RigidBody>
      <RigidBody ref={armR} position={spawn.armR as [number, number, number]} {...common}>
        <CapsuleCollider args={[P.armHalf * s, P.armR * s]} position={[0, P.armCenter * s, 0]} />
      </RigidBody>
      <RigidBody ref={legL} position={spawn.legL as [number, number, number]} {...common}>
        <CapsuleCollider args={[P.legHalf * s, P.legR * s]} position={[0, P.legCenter * s, 0]} />
      </RigidBody>
      <RigidBody ref={legR} position={spawn.legR as [number, number, number]} {...common}>
        <CapsuleCollider args={[P.legHalf * s, P.legR * s]} position={[0, P.legCenter * s, 0]} />
      </RigidBody>
    </>
  )
}

// launch failure debris: real rigid bodies that tumble and settle on the planet
function Debris() {
  const tick = usePhys((s) => s.debrisTick)
  const [bursts, setBursts] = useState<{ id: number; origin: THREE.Vector3 }[]>([])
  const mat = useMemo(() => vinyl(C.boneDeep), [])
  const matDark = useMemo(() => vinyl('#5b5650'), [])
  useEffect(() => {
    const fresh = pipRegistry.debris.filter((d) => performance.now() / 1000 - d.at < 1)
    if (!fresh.length) return
    setBursts((b) => [...b, ...fresh.filter((f) => !b.some((x) => x.id === f.id))])
    const ids = fresh.map((f) => f.id)
    const t = setTimeout(() => setBursts((b) => b.filter((x) => !ids.includes(x.id))), 9000)
    return () => clearTimeout(t)
  }, [tick])
  return (
    <>
      {bursts.map((b) =>
        Array.from({ length: 16 }, (_, i) => {
          const n = b.origin.clone().normalize()
          const dir = new THREE.Vector3().randomDirection().addScaledVector(n, 1.4).normalize()
          const sz = 0.04 + Math.random() * 0.07
          return (
            <RigidBody key={`${b.id}-${i}`} position={b.origin.clone().addScaledVector(n, 0.6 + Math.random() * 0.4).toArray()} linearVelocity={dir.multiplyScalar(1.5 + Math.random() * 2.5).toArray()} angularVelocity={[Math.random() * 10, Math.random() * 10, Math.random() * 10]} colliders={false} restitution={0.3} friction={0.8}>
              <CuboidCollider args={[sz, sz * 0.6, sz * 1.3]} />
              <mesh castShadow material={i % 3 ? mat : matDark}>
                <boxGeometry args={[sz * 2, sz * 1.2, sz * 2.6]} />
              </mesh>
            </RigidBody>
          )
        }),
      )}
    </>
  )
}

export default function PhysicsLayer() {
  const keys = usePhys((s) => s.keys)
  const record = useStore((s) => s.record)
  // agents map refreshes with frames; ragdolls key on citizen id so they persist across frames
  const agents = keys.map((k) => pipRegistry.agents.get(k)).filter(Boolean) as Agent[]
  void record
  return (
    <>
      <GravityField />
      <RigidBody type="fixed" colliders={false} position={[0, 0, 0]} friction={1}>
        <BallCollider args={[LAND_TOP]} />
      </RigidBody>
      {agents.map((a) => <Ragdoll key={a.key} agent={a} />)}
      <Debris />
    </>
  )
}
