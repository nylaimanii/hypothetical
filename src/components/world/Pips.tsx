'use client'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Outlines } from '@react-three/drei'
import type { Frame } from '@/lib/types'
import { C, HAIR_HEX, LAND_TOP, MONK, latLonToVec3, sceneRefs, shade, surfaceQuat, tangentBasis, vinyl } from './lib'
import { HAIRS, P, buildW, hairGeometries, headScale, partGeometries, pipRegistry, pipScale, shoulderX, usePhys, type Agent } from './pipShared'
import { useStore } from '../state/store'

const N = 180
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)

// scratch
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler()
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _s = new THREE.Vector3()
const T = (x: number, y: number, z: number, out = new THREE.Matrix4()) => out.makeTranslation(x, y, z)
const Rx = (a: number, b = 0, c = 0) => new THREE.Matrix4().makeRotationFromEuler(_e.set(a, b, c))
const off = {
  torso: (bw: number) => new THREE.Matrix4().compose(new THREE.Vector3(0, P.torsoCenter, 0), new THREE.Quaternion(), new THREE.Vector3(bw, 1, bw * 0.85)),
  head: T(0, P.headCenter, 0),
  arm: T(0, P.armCenter, 0),
  hand: T(0, P.handY, 0),
  leg: T(0, P.legCenter + 0.03, 0),
  foot: T(0, -0.38, 0.035),
}

export function buildAgents(frame: Frame, extraRevolt: string[] = [], extraFamine: string[] = []): Agent[] {
  const regions = new Map(frame.regions.map((r) => [r.id, r]))
  const revoltIds = new Set([...frame.newEvents.filter((e) => e.kind === 'revolt' || e.kind === 'war').map((e) => e.regionId), ...extraRevolt])
  const famineIds = new Set([...frame.newEvents.filter((e) => e.kind === 'famine').map((e) => e.regionId), ...extraFamine])
  const agents: Agent[] = []
  for (const c of frame.citizens) {
    const r = regions.get(c.regionId)
    if (!r) continue
    const revolt = revoltIds.has(r.id) || r.unrest > 0.78
    agents.push({
      key: c.id, citizen: c, home: latLonToVec3(r.lat, r.lon, 1), color: r.color, revolt,
      famine: famineIds.has(r.id) || r.foodKcalPerCapita < 2150,
      angry: revolt || c.mood < 0.3,
    })
  }
  // lines of migrants walking between regions
  for (const m of frame.decision?.migrations ?? []) {
    const a = regions.get(m.from), b = regions.get(m.to)
    if (!a || !b) continue
    const pool = frame.citizens.filter((c) => c.regionId === m.from || c.regionId === m.to)
    const n = Math.min(12, Math.max(4, Math.round(Math.log10(m.people) * 1.6)))
    for (let k = 0; k < n && pool.length; k++) {
      const c = pool[k % pool.length]
      agents.push({
        key: `mig-${m.from}-${m.to}-${k}`, citizen: { ...c, id: c.id }, home: latLonToVec3(b.lat, b.lon, 1), color: a.color,
        revolt: false, famine: false, angry: c.mood < 0.3, migrant: { from: latLonToVec3(a.lat, a.lon, 1), to: latLonToVec3(b.lat, b.lon, 1), k, n },
      })
    }
  }
  return agents.slice(0, N)
}

type Base = { torso: THREE.Matrix4; head: THREE.Matrix4; armL: THREE.Matrix4; armR: THREE.Matrix4; legL: THREE.Matrix4; legR: THREE.Matrix4 }
const newBase = (): Base => ({ torso: new THREE.Matrix4(), head: new THREE.Matrix4(), armL: new THREE.Matrix4(), armR: new THREE.Matrix4(), legL: new THREE.Matrix4(), legR: new THREE.Matrix4() })

function slerpUnit(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) {
  const d = Math.min(1, Math.max(-1, a.dot(b)))
  const th = Math.acos(d)
  if (th < 1e-4) return out.copy(a)
  const s = Math.sin(th)
  return out.copy(a).multiplyScalar(Math.sin((1 - t) * th) / s).addScaledVector(b, Math.sin(t * th) / s)
}

// where the pip wants to be: a wandering path around home, a cluster in revolt, or a line between regions
function rootAt(a: Agent, t: number, out: THREE.Vector3) {
  const sd = a.citizen.personalitySeed
  if (a.migrant) {
    const s = (t * 0.01 + a.migrant.k / a.migrant.n / 3) % 1
    slerpUnit(a.migrant.from, a.migrant.to, s, out)
    const { east } = tangentBasis(out)
    return out.multiplyScalar(LAND_TOP).addScaledVector(east, (a.migrant.k % 2 ? 1 : -1) * 0.08).normalize().multiplyScalar(LAND_TOP)
  }
  const p1 = (sd % 628) / 100, p2 = ((sd >> 3) % 628) / 100, p3 = ((sd >> 6) % 628) / 100
  const w1 = 0.05 + ((sd >> 9) % 50) / 1000, w2 = 0.09 + ((sd >> 12) % 60) / 1000
  const rad = a.revolt ? 0.28 : 1.0
  const u = rad * (0.62 * Math.sin(t * w1 + p1) + 0.38 * Math.sin(t * w2 + p2))
  const v = rad * (0.62 * Math.cos(t * w1 * 0.8 + p3) + 0.38 * Math.cos(t * w2 * 1.3 + p1))
  const { up, east, north } = tangentBasis(a.home)
  return out.copy(up).multiplyScalar(LAND_TOP).addScaledVector(east, u).addScaledVector(north, v).normalize().multiplyScalar(LAND_TOP)
}

function speedOf(a: Agent) {
  const c = a.citizen
  let s = 1
  if (c.age > 66) s *= 0.55
  if (c.age < 14) s *= 1.25
  if (a.famine) s *= 0.45
  if (a.revolt) s *= 1.6
  return s * (0.85 + ((c.personalitySeed >> 4) % 30) / 100)
}

export default function Pips({ frame }: { frame: Frame }) {
  const zoom = useStore((s) => s.zoom)
  const quality = useStore((s) => s.quality)
  const select = useStore((s) => s.select)
  const juice = useStore((s) => s.juice)
  const setKeys = usePhys((s) => s.setKeys)
  const adaptive = useStore((s) => s.adaptive)
  const camera = useThree((s) => s.camera)
  // injected revolts and famines last 12s on top of the frame
  const injected = juice.filter((j) => j.text === 'injected by you' && j.regionId)
  const revKey = injected.filter((j) => j.kind === 'revolt' || j.kind === 'war').map((j) => j.regionId!).join()
  const famKey = injected.filter((j) => j.kind === 'famine').map((j) => j.regionId!).join()
  const agents = useMemo(() => buildAgents(frame, revKey ? revKey.split(',') : [], famKey ? famKey.split(',') : []), [frame, revKey, famKey])
  const visible = zoom === 'close'

  const geos = useMemo(() => partGeometries(), [])
  const hairGeos = useMemo(() => hairGeometries(), [])
  const mats = useMemo(() => ({
    body: vinyl('#ffffff'),
    skin: vinyl('#ffffff', { roughness: 0.6, clearcoat: 0.15 }),
    ink: vinyl(C.ink, { roughness: 0.4 }),
    angry: vinyl(C.ember, { emissive: new THREE.Color(C.ember), emissiveIntensity: 2.6, toneMapped: false }),
    hair: vinyl('#ffffff', { roughness: 0.7, clearcoat: 0.1 }),
    halo: vinyl('#F2DFA0', { emissive: new THREE.Color('#F2DFA0'), emissiveIntensity: 0.35 }),
    dot: vinyl('#CFE3F0', { emissive: new THREE.Color('#CFE3F0'), emissiveIntensity: 0.5 }),
  }), [])

  const refs = {
    torso: useRef<THREE.InstancedMesh>(null), head: useRef<THREE.InstancedMesh>(null),
    arm: useRef<THREE.InstancedMesh>(null), hand: useRef<THREE.InstancedMesh>(null),
    leg: useRef<THREE.InstancedMesh>(null), foot: useRef<THREE.InstancedMesh>(null),
    eye: useRef<THREE.InstancedMesh>(null), eyeA: useRef<THREE.InstancedMesh>(null),
    brow: useRef<THREE.InstancedMesh>(null), browA: useRef<THREE.InstancedMesh>(null),
    halo: useRef<THREE.InstancedMesh>(null), dot: useRef<THREE.InstancedMesh>(null),
  }
  const hairRefs = useRef<Record<string, THREE.InstancedMesh | null>>({})
  const bases = useMemo(() => Array.from({ length: N }, newBase), [])

  // matrices move every frame, so raycasts need a sphere that always covers the planet
  useLayoutEffect(() => {
    for (const r of [refs.torso, refs.head]) if (r.current) r.current.boundingSphere = new THREE.Sphere(new THREE.Vector3(), LAND_TOP + 3)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // registry for ragdolls
  useEffect(() => {
    pipRegistry.agents = new Map(agents.map((a) => [a.key, a]))
  }, [agents])

  // per instance colors
  useLayoutEffect(() => {
    const col = new THREE.Color()
    const set = (m: THREE.InstancedMesh | null, i: number, c: THREE.ColorRepresentation | THREE.Color) => m?.setColorAt(i, c instanceof THREE.Color ? c : col.set(c))
    agents.forEach((a, i) => {
      const skin = MONK[Math.max(0, Math.min(9, a.citizen.skinTone - 1))]
      set(refs.torso.current, i, a.color)
      set(refs.head.current, i, skin)
      for (const k of [0, 1]) {
        set(refs.arm.current, i * 2 + k, a.color)
        set(refs.hand.current, i * 2 + k, skin)
        set(refs.leg.current, i * 2 + k, shade(a.color, 0.6))
        set(refs.foot.current, i * 2 + k, '#2d2925')
      }
      const h = hairRefs.current[a.citizen.hair]
      set(h ?? null, i, HAIR_HEX[a.citizen.hairColor] ?? '#222')
    })
    for (const m of [refs.torso, refs.head, refs.arm, refs.hand, refs.leg, refs.foot]) if (m.current?.instanceColor) m.current.instanceColor.needsUpdate = true
    for (const h of Object.values(hairRefs.current)) if (h?.instanceColor) h.instanceColor.needsUpdate = true
  }, [agents]) // eslint-disable-line react-hooks/exhaustive-deps

  // juice: disasters knock pips down (procedural path; ragdolls handle their own)
  const seenJuice = useRef(0)
  useEffect(() => {
    for (const j of juice) {
      if (j.id <= seenJuice.current) continue
      seenJuice.current = j.id
      if (!['disaster', 'war', 'injected'].includes(j.kind) || !j.regionId) continue
      const now = performance.now() / 1000
      for (const a of agents) if (a.citizen.regionId === j.regionId && !a.migrant) pipRegistry.knockAt.set(a.key, now + Math.random() * 0.25)
    }
  }, [juice, agents])

  // which pips get real physics: high quality, close zoom, near the camera focus
  useEffect(() => {
    if (!(visible && quality === 'high')) { setKeys([]); return }
    const pick = () => {
      const f = sceneRefs.focus.clone().normalize()
      // adaptive level 2: only pips actually on screen keep physics
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      const onScreen = (k: string) => adaptive < 2 || frustum.intersectsSphere(new THREE.Sphere(pipRegistry.roots.get(k)!.pos, 0.3))
      const scored = agents.filter((a) => !a.migrant && pipRegistry.roots.has(a.key) && onScreen(a.key)).map((a) => ({ k: a.key, d: a.home.dot(f) })).filter((x) => x.d > Math.cos(0.32)).sort((x, y) => y.d - x.d).slice(0, 40).map((x) => x.k).sort()
      const cur = usePhys.getState().keys
      if (scored.join() !== cur.join()) setKeys(scored)
    }
    pick()
    const id = setInterval(pick, 600)
    return () => clearInterval(id)
  }, [visible, quality, agents, setKeys, adaptive, camera])

  useFrame(({ clock }) => {
    if (!visible) return
    const t = clock.elapsedTime
    const now = performance.now() / 1000
    const hairCounts: Record<string, number> = {}
    agents.forEach((a, i) => {
      const c = a.citizen
      const s = pipScale(c)
      const hs = headScale(c)
      const bw = buildW(c.build)
      const sd = c.personalitySeed
      const spd = speedOf(a)
      const tt = t * spd + (sd % 1000)
      // root
      const pos = rootAt(a, tt, _v)
      const ahead = rootAt(a, tt + 0.6, _v2)
      const heading = ahead.sub(pos)
      const normal = pos.clone().normalize()
      const quat = surfaceQuat(normal, heading.lengthSq() > 1e-10 ? heading : tangentBasis(normal).north, _q)
      let root = pipRegistry.roots.get(a.key)
      if (!root) { root = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), heading: new THREE.Vector3() }; pipRegistry.roots.set(a.key, root) }
      root.pos.copy(pos); root.quat.copy(quat); root.heading.copy(heading).normalize()

      const b = bases[i]
      // ragdoll bodies can be removed from the world before the registry hears about it
      let rag = pipRegistry.ragdolls.get(a.key)
      if (rag) {
        try {
          const parts = [rag.torso, rag.head, rag.armL, rag.armR, rag.legL, rag.legR]
          if (!parts.every((p) => p.isValid())) throw new Error('stale')
          const put = (body: typeof parts[number], m: THREE.Matrix4) => {
            const tr = body.translation(), ro = body.rotation()
            m.compose(_s.set(tr.x, tr.y, tr.z), new THREE.Quaternion(ro.x, ro.y, ro.z, ro.w), new THREE.Vector3(s, s, s))
          }
          put(rag.torso, b.torso); put(rag.head, b.head); put(rag.armL, b.armL); put(rag.armR, b.armR); put(rag.legL, b.legL); put(rag.legR, b.legR)
        } catch {
          pipRegistry.ragdolls.delete(a.key)
          rag = undefined
        }
      }
      if (!rag) {
        const elder = c.age > 66
        const freq = 7 + ((sd >> 5) % 30) / 10
        const phase = t * freq * Math.min(1.4, spd)
        const swing = Math.sin(phase) * (a.famine ? 0.25 : 0.45)
        const lagSwing = Math.sin(phase - 0.7 - ((sd >> 7) % 10) / 20) * (elder ? 0.25 : 0.5)
        const syncBounce = a.revolt ? Math.abs(Math.sin(t * 7.5)) * 0.12 : 0
        const bob = Math.abs(Math.cos(phase)) * 0.025 + syncBounce
        const wobble = Math.sin(phase * 0.5 + sd) * 0.07
        const pitch = (elder ? 0.36 : 0.06) + (c.mood < 0.35 ? 0.08 : 0) + (a.revolt ? -0.05 : 0)
        _m.compose(pos, quat, new THREE.Vector3(s, s, s))
        // procedural knockdown: fall back, lie, get up
        const k0 = pipRegistry.knockAt.get(a.key)
        if (k0 !== undefined) {
          const k = now - k0
          if (k > 3) pipRegistry.knockAt.delete(a.key)
          else if (k > 0) {
            const ease = (x: number) => x * x * (3 - 2 * x)
            const ang = k < 0.4 ? ease(k / 0.4) : k < 1.9 ? 1 : 1 - ease(Math.min(1, (k - 1.9) / 1.1))
            _m.multiply(Rx(-ang * 1.45))
          }
        }
        const hip = _m2.copy(_m).multiply(T(0, P.hipY + bob, 0)).multiply(Rx(0, 0, wobble))
        b.torso.copy(hip).multiply(Rx(pitch))
        b.legL.copy(hip).multiply(T(P.hipX, 0, 0)).multiply(Rx(swing))
        b.legR.copy(hip).multiply(T(-P.hipX, 0, 0)).multiply(Rx(-swing))
        const sx = shoulderX(bw)
        const raise = a.revolt ? -2.4 + Math.sin(t * 7.5) * 0.3 : 0
        b.armL.copy(b.torso).multiply(T(sx, P.shoulderY, 0)).multiply(Rx(raise || -lagSwing, 0, 0.12))
        b.armR.copy(b.torso).multiply(T(-sx, P.shoulderY, 0)).multiply(Rx(-lagSwing * (a.revolt ? 0.3 : 1), 0, -0.12))
        b.head.copy(b.torso).multiply(T(0, P.neckY, 0)).multiply(Rx(-pitch * 0.7 + Math.sin(phase * 0.5 + 1) * 0.05, 0, -wobble * 0.6))
      }

      // write instances
      refs.torso.current!.setMatrixAt(i, _m.copy(b.torso).multiply(off.torso(bw)))
      const head = _m2.copy(b.head).scale(_s.set(hs, hs, hs))
      refs.head.current!.setMatrixAt(i, _m.copy(head).multiply(off.head))
      const arms = [b.armL, b.armR], legs = [b.legL, b.legR]
      for (const k of [0, 1]) {
        refs.arm.current!.setMatrixAt(i * 2 + k, _m.copy(arms[k]).multiply(off.arm))
        refs.hand.current!.setMatrixAt(i * 2 + k, _m.copy(arms[k]).multiply(off.hand))
        refs.leg.current!.setMatrixAt(i * 2 + k, _m.copy(legs[k]).multiply(off.leg))
        refs.foot.current!.setMatrixAt(i * 2 + k, _m.copy(legs[k]).multiply(off.foot))
      }
      // face: eyes blink, brows carry mood
      const blink = (t + (sd % 7)) % 4.3 < 0.12 ? 0.15 : 1
      const m = c.mood
      const browY = a.angry ? -0.008 : m > 0.62 ? 0.022 : 0
      const tilt = a.angry ? 0.4 : m > 0.62 ? -0.08 : 0
      for (const k of [0, 1]) {
        const sx = k === 0 ? 1 : -1
        const eyeM = _m.copy(head).multiply(T(sx * 0.062, 0.165, 0.131)).scale(_s.set(1, blink, 1))
        refs.eye.current!.setMatrixAt(i * 2 + k, a.angry ? ZERO : eyeM)
        refs.eyeA.current!.setMatrixAt(i * 2 + k, a.angry ? eyeM : ZERO)
        const browM = _m.copy(head).multiply(T(sx * 0.066, 0.228 + browY, 0.134)).multiply(Rx(0, 0, sx * tilt))
        refs.brow.current!.setMatrixAt(i * 2 + k, a.angry ? ZERO : browM)
        refs.browA.current!.setMatrixAt(i * 2 + k, a.angry ? browM : ZERO)
      }
      // belief accessory
      refs.halo.current!.setMatrixAt(i, c.belief === 'religious' ? _m.copy(head).multiply(T(0, 0.43 + Math.sin(t * 2 + sd) * 0.015, 0)) : ZERO)
      refs.dot.current!.setMatrixAt(i, c.belief === 'spiritual' ? _m.copy(head).multiply(T(Math.cos(t * 2.2 + sd) * 0.24, 0.3, Math.sin(t * 2.2 + sd) * 0.24)) : ZERO)
      // hair: each type mesh uses the agent index, others zeroed
      hairCounts[c.hair] = (hairCounts[c.hair] ?? 0) + 1
      for (const h of HAIRS) {
        const hm = hairRefs.current[h]
        if (hm) hm.setMatrixAt(i, h === c.hair ? head : ZERO)
      }
    })
    for (let i = agents.length; i < N; i++) {
      for (const r of [refs.torso, refs.head, refs.halo, refs.dot]) r.current!.setMatrixAt(i, ZERO)
      for (const r of [refs.arm, refs.hand, refs.leg, refs.foot, refs.eye, refs.eyeA, refs.brow, refs.browA]) { r.current!.setMatrixAt(i * 2, ZERO); r.current!.setMatrixAt(i * 2 + 1, ZERO) }
      for (const h of HAIRS) hairRefs.current[h]?.setMatrixAt(i, ZERO)
    }
    for (const r of Object.values(refs)) if (r.current) r.current.instanceMatrix.needsUpdate = true
    for (const h of Object.values(hairRefs.current)) if (h) h.instanceMatrix.needsUpdate = true
  })

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.instanceId == null) return
    const a = agents[e.instanceId]
    if (a) select({ kind: 'pip', id: a.citizen.id })
  }
  const hover = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = 'pointer' },
    onPointerOut: () => { document.body.style.cursor = '' },
  }
  const shadow = quality === 'high' && adaptive < 1
  const outline = <Outlines thickness={0.022} color={C.ink} />
  const im = (ref: React.RefObject<THREE.InstancedMesh | null>, geo: THREE.BufferGeometry, mat: THREE.Material, count: number, opts: { click?: boolean; outline?: boolean } = {}) => (
    <instancedMesh ref={ref} args={[geo, mat, count]} frustumCulled={false} castShadow={shadow} receiveShadow={shadow}
      {...(opts.click ? { onClick, ...hover } : { raycast: () => null })}>
      {opts.outline && outline}
    </instancedMesh>
  )

  return (
    <group visible={visible}>
      {im(refs.torso, geos.torso, mats.body, N, { click: true, outline: true })}
      {im(refs.head, geos.head, mats.skin, N, { click: true, outline: true })}
      {im(refs.arm, geos.limbArm, mats.body, N * 2, { outline: true })}
      {im(refs.hand, geos.hand, mats.skin, N * 2, { outline: true })}
      {im(refs.leg, geos.limbLeg, mats.body, N * 2, { outline: true })}
      {im(refs.foot, geos.foot, mats.body, N * 2, { outline: true })}
      {im(refs.eye, geos.eye, mats.ink, N * 2)}
      {im(refs.eyeA, geos.eye, mats.angry, N * 2)}
      {im(refs.brow, geos.brow, mats.ink, N * 2)}
      {im(refs.browA, geos.brow, mats.angry, N * 2)}
      {im(refs.halo, geos.halo, mats.halo, N)}
      {im(refs.dot, geos.dot, mats.dot, N)}
      {HAIRS.map((h) => {
        const g = hairGeos[h]
        if (!g) return null
        return (
          <instancedMesh key={h} ref={(m) => { hairRefs.current[h] = m }} args={[g, mats.hair, N]} frustumCulled={false} castShadow={shadow} raycast={() => null}>
            {outline}
          </instancedMesh>
        )
      })}
    </group>
  )
}
