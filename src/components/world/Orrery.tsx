'use client'
// zoomed out past the moon: a chunky clay orrery. earth is the globe itself at the origin, the moon is the Moon component.
// distances are heavily compressed so the whole system fits on screen; it says so on a label.
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Frame, SpaceAsset } from '@/lib/types'
import { C, R, sceneRefs, toonGradient } from './lib'
import { tipProps, useCallouts, yearOf, type Callout } from './explain'

const MOON_ORBIT = 30
const MOON_TILT = 0.26
const MARS_ORBIT = 120
const BELT = 165
const OUTER = 215
const MARS_R = 4
const FADE_FROM = 90
const FADE_TO = 130
const HIDE_BELOW = 85
const BELT_ROCKS = 160

const fadeOf = (d: number) => Math.max(0, Math.min(1, (d - FADE_FROM) / (FADE_TO - FADE_FROM)))

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// every orrery material fades together
function useFadeMats() {
  const list = useRef<THREE.Material[]>([])
  const make = <T extends THREE.Material>(m: T) => { m.transparent = true; m.opacity = 0; list.current.push(m); return m }
  return { list, make }
}

const marsAngle = (t: number) => t * 0.012 + 2.1
const marsPos = (t: number, out: THREE.Vector3) => out.set(Math.cos(marsAngle(t)) * MARS_ORBIT, 0, Math.sin(marsAngle(t)) * MARS_ORBIT)
const BELT_ANCHOR = 0.7 // angle of the rock the mining ship works
const beltRot = (t: number) => t * 0.004

const KIND_WEIGHT: Record<SpaceAsset['kind'], number> = { mars_habitat: 9, moon_base: 8, station: 6, asteroid_mine: 6, ship: 4, probe: 3 }
const KIND_WORDS: Record<SpaceAsset['kind'], string> = {
  station: 'orbital station', moon_base: 'moon base', mars_habitat: 'mars habitat', asteroid_mine: 'asteroid mine', probe: 'probe', ship: 'ship',
}

function describe(a: SpaceAsset) {
  const bits = [KIND_WORDS[a.kind]]
  if (a.population) bits.push(`${a.population.toLocaleString('en-US')} people`)
  bits.push(`built ${yearOf(a.builtTick)}`)
  if (a.status === 'dark') bits.push('gone dark')
  if (a.status === 'destroyed') bits.push('destroyed')
  return bits.join(', ')
}

// where an asset sits this frame (mutates out)
function assetPos(a: SpaceAsset, i: number, t: number, out: THREE.Vector3) {
  const k = i * 1.7
  switch (a.body) {
    case 'earth_orbit': {
      const ang = t * 0.15 + k
      return out.set(Math.cos(ang) * R * 1.6, Math.sin(ang * 0.7) * 2.5, Math.sin(ang) * R * 1.6)
    }
    case 'moon':
      return out.copy(sceneRefs.moonPos).add(new THREE.Vector3(Math.cos(k) * 2.6, 1.4, Math.sin(k) * 2.6))
    case 'mars': {
      marsPos(t, out)
      return out.add(new THREE.Vector3(Math.cos(k) * (MARS_R + 1.6), 2.2, Math.sin(k) * (MARS_R + 1.6)))
    }
    case 'asteroid_belt': {
      const ang = BELT_ANCHOR + beltRot(t) + i * 0.05
      return out.set(Math.cos(ang) * BELT, 3 + Math.sin(t * 0.8 + k) * 0.4, Math.sin(ang) * BELT)
    }
    case 'outer': {
      // probes creep outward, slowly
      const ang = -0.9 + k * 0.3
      const r = OUTER + 6 + ((t * 0.6 + i * 9) % 18)
      return out.set(Math.cos(ang) * r, 6, Math.sin(ang) * r)
    }
  }
}

function AssetModel({ a, mats }: { a: SpaceAsset; mats: { body: THREE.Material; accent: THREE.Material; dark: THREE.Material } }) {
  const live = a.status === 'active'
  const body = live ? mats.body : mats.dark
  const accent = live ? mats.accent : mats.dark
  switch (a.kind) {
    case 'station':
      return (
        <group rotation={[0.4, 0, 0.2]}>
          <mesh material={body}><torusGeometry args={[1.3, 0.28, 10, 28]} /></mesh>
          <mesh material={accent}><cylinderGeometry args={[0.35, 0.35, 0.9, 12]} /></mesh>
          <mesh material={body} position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]}><boxGeometry args={[0.18, 3.4, 0.6]} /></mesh>
        </group>
      )
    case 'moon_base':
      return (
        <group>
          <mesh material={body}><sphereGeometry args={[1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
          <mesh material={accent} position={[1.2, 0.25, 0]}><boxGeometry args={[0.8, 0.5, 0.6]} /></mesh>
          <mesh material={body} position={[-1, 0, 0.6]}><sphereGeometry args={[0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        </group>
      )
    case 'mars_habitat':
      return (
        <group>
          <mesh material={body}><sphereGeometry args={[1.1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
          <mesh material={body} position={[1.5, 0, 0.4]}><sphereGeometry args={[0.7, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
          <mesh material={accent} position={[0.75, 0.2, 0.2]} rotation={[0, 0.3, Math.PI / 2]}><cylinderGeometry args={[0.22, 0.22, 0.9, 10]} /></mesh>
        </group>
      )
    case 'asteroid_mine':
    case 'ship':
      return (
        <group rotation={[0, 0, Math.PI / 2]}>
          <mesh material={body}><capsuleGeometry args={[0.5, 1.6, 6, 12]} /></mesh>
          <mesh material={accent} position={[0, -1.2, 0]}><coneGeometry args={[0.55, 0.6, 12]} /></mesh>
          <mesh material={accent} position={[0.5, -0.8, 0]}><boxGeometry args={[0.6, 0.5, 0.1]} /></mesh>
          <mesh material={accent} position={[-0.5, -0.8, 0]}><boxGeometry args={[0.6, 0.5, 0.1]} /></mesh>
        </group>
      )
    case 'probe':
      return (
        <group>
          <mesh material={body}><boxGeometry args={[0.7, 0.7, 0.7]} /></mesh>
          <mesh material={accent} position={[0, 0.7, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.9, 0.4, 16, 1, true]} /></mesh>
          <mesh material={body} position={[0.9, 0, 0]}><boxGeometry args={[1.1, 0.05, 0.5]} /></mesh>
        </group>
      )
  }
}

// a few chips drifting off a destroyed asset
function Debris({ seed, mat }: { seed: number; mat: THREE.Material }) {
  const g = useRef<THREE.Group>(null)
  const chips = useMemo(() => {
    const r = rng(seed)
    return Array.from({ length: 5 }, () => ({ d: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), s: 0.15 + r() * 0.25, p: r() * 10 }))
  }, [seed])
  useFrame(({ clock }) => {
    const grp = g.current
    if (!grp) return
    const t = clock.elapsedTime
    grp.children.forEach((c, i) => {
      const ch = chips[i]
      c.position.copy(ch.d).multiplyScalar(1.6 + ((t * 0.15 + ch.p) % 2))
      c.rotation.set(t * 0.4 + ch.p, t * 0.3, 0)
    })
  })
  return (
    <group ref={g}>
      {chips.map((c, i) => <mesh key={i} material={mat} scale={c.s}><boxGeometry args={[1, 0.6, 0.8]} /></mesh>)}
    </group>
  )
}

const labelCls = 'pointer-events-none select-none whitespace-nowrap rounded-full border border-ink/15 bg-bone/85 px-2.5 py-0.5 font-display text-[12px] text-ink shadow-sm'

export default function Orrery({ frame }: { frame: Frame }) {
  const root = useRef<THREE.Group>(null)
  const mars = useRef<THREE.Group>(null)
  const belt = useRef<THREE.InstancedMesh>(null)
  const moonLabel = useRef<THREE.Group>(null)
  const scaleNote = useRef<THREE.Group>(null)
  const labels = useRef<(HTMLDivElement | null)[]>([])
  const assetGroups = useRef<(THREE.Group | null)[]>([])
  const arcRefs = useRef<(THREE.Line | null)[]>([])
  const trail = useRef<THREE.InstancedMesh>(null)
  const camera = useThree((s) => s.camera)
  const { list: fadeMats, make } = useFadeMats()

  const mats = useMemo(() => {
    const toon = (color: string, extra: THREE.MeshToonMaterialParameters = {}) => make(new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra }))
    return {
      mars: toon('#B8613D'),
      marsCap: toon('#F1E6DA'),
      rock: toon('#8C8478'),
      outer: toon('#D8D4E4'),
      ring: make(new THREE.MeshBasicMaterial({ color: C.ink, toneMapped: false })),
      dash: make(new THREE.LineDashedMaterial({ color: C.ink, dashSize: 4, gapSize: 3 })),
      body: toon(C.bone, { emissive: new THREE.Color('#F4D9A6'), emissiveIntensity: 0.25 }),
      accent: toon('#E8A13A', { emissive: new THREE.Color('#E8A13A'), emissiveIntensity: 0.45 }),
      dark: toon('#7d7a76'),
      arc: make(new THREE.LineBasicMaterial({ color: new THREE.Color('#FFE2A8').multiplyScalar(2.2), toneMapped: false })),
      trail: make(new THREE.MeshBasicMaterial({ color: '#E9E3D2', toneMapped: false })),
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // belt rocks: one instanced mesh, chunky and uneven
  const rockGeo = useMemo(() => new THREE.DodecahedronGeometry(1, 0), [])
  useLayoutEffect(() => {
    const m = belt.current
    if (!m) return
    const r = rng(7), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    for (let i = 0; i < BELT_ROCKS; i++) {
      const ang = (i / BELT_ROCKS) * Math.PI * 2 + r() * 0.03
      const rad = BELT + (r() - 0.5) * 16
      const s = 0.6 + r() * 1.1
      q.setFromEuler(e.set(r() * 3, r() * 3, r() * 3))
      mtx.compose(new THREE.Vector3(Math.cos(ang) * rad, (r() - 0.5) * 4, Math.sin(ang) * rad), q, new THREE.Vector3(s, s * (0.6 + r() * 0.5), s))
      m.setMatrixAt(i, mtx)
    }
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [])

  // orbit rings
  const moonRing = useMemo(() => new THREE.TorusGeometry(MOON_ORBIT, 0.12, 6, 160), [])
  const marsRing = useMemo(() => new THREE.TorusGeometry(MARS_ORBIT, 0.22, 6, 240), [])
  const beltRing = useMemo(() => new THREE.TorusGeometry(BELT, 0.18, 6, 240), [])
  const outerLine = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 200; i++) { const a = (i / 200) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * OUTER, 0, Math.sin(a) * OUTER)) }
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mats.dash)
    ln.computeLineDistances()
    return ln
  }, [mats])
  const outerMarkers = useMemo(() => [0.4, 2.6, 4.4].map((a, i) => ({ pos: new THREE.Vector3(Math.cos(a) * OUTER, 0, Math.sin(a) * OUTER), s: 1.6 + i * 0.5 })), [])

  const assets = useMemo(() => frame.space ?? [], [frame.space])
  const recent = useMemo(() => assets.filter((a) => a.builtTick > frame.tick - 12 && a.builtTick <= frame.tick && a.body !== 'earth_orbit'), [assets, frame.tick])
  const arcs = useMemo(() => recent.map(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(33 * 3), 3))
    return new THREE.Line(g, mats.arc)
  }), [recent, mats])

  // callouts carry live positions; weight drops to 0 while the orrery is hidden
  const list = useMemo<Callout[]>(() => assets.map((a) => ({
    id: `orrery-${a.id}`, pos: new THREE.Vector3(), title: a.label, text: describe(a), weight: 0, danger: a.status === 'destroyed',
  })), [assets])
  useCallouts('orrery', list)

  const tmp = useMemo(() => new THREE.Vector3(), [])
  const probeIdx = assets.findIndex((a) => a.kind === 'probe' && a.body === 'outer')

  useFrame(({ clock }) => {
    const d = sceneRefs.camDist
    const g = root.current
    if (!g) return
    const show = d > HIDE_BELOW
    g.visible = show
    const f = fadeOf(d)
    for (const m of fadeMats.current) m.opacity = f
    labels.current.forEach((el) => { if (el) { el.style.opacity = String(f); el.style.display = f > 0.02 ? '' : 'none' } })
    list.forEach((c, i) => { c.weight = f > 0.3 ? KIND_WEIGHT[assets[i].kind] : 0 })
    if (!show) return
    const t = clock.elapsedTime
    if (mars.current) { marsPos(t, mars.current.position); mars.current.rotation.y = t * 0.1 }
    if (belt.current) belt.current.rotation.y = beltRot(t)
    if (moonLabel.current) moonLabel.current.position.copy(sceneRefs.moonPos).add(tmp.set(0, 3.2, 0))
    assets.forEach((a, i) => {
      const grp = assetGroups.current[i]
      assetPos(a, i, t, list[i].pos)
      if (grp) { grp.position.copy(list[i].pos); grp.rotation.y = t * 0.2 + i }
    })
    // transfer arcs from earth to the body, bulging above the plane
    recent.forEach((a, k) => {
      const ln = arcRefs.current[k]
      if (!ln) return
      const i = assets.indexOf(a)
      const end = list[i].pos
      const start = tmp.copy(end).setLength(R + 1)
      const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, end.length() * 0.25, 0))
      const curve = new THREE.QuadraticBezierCurve3(start.clone(), mid, end.clone())
      const attr = ln.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let s = 0; s <= 32; s++) { const p = curve.getPoint(s / 32); attr.setXYZ(s, p.x, p.y, p.z) }
      attr.needsUpdate = true
      ln.geometry.computeBoundingSphere()
    })
    // the probe's fading trail points back toward home
    if (trail.current && probeIdx >= 0) {
      const p = list[probeIdx].pos
      const back = tmp.copy(p).normalize().negate()
      const mtx = new THREE.Matrix4()
      for (let s = 0; s < 10; s++) {
        const sc = 0.45 * (1 - s / 10)
        mtx.compose(p.clone().addScaledVector(back, 1.6 + s * 1.5), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc))
        trail.current.setMatrixAt(s, mtx)
      }
      trail.current.instanceMatrix.needsUpdate = true
    }
    // "not to scale" floats near the top of the view
    if (scaleNote.current) {
      const fwd = camera.getWorldDirection(new THREE.Vector3())
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
      const dist = 40
      const h = Math.tan(((camera as THREE.PerspectiveCamera).fov ?? 38) * Math.PI / 360) * dist
      scaleNote.current.position.copy(camera.position).addScaledVector(fwd, dist).addScaledVector(up, h * 0.82)
    }
  })

  const label = (i: number, text: string) => (
    <Html center zIndexRange={[5, 0]}>
      <div ref={(el) => { labels.current[i] = el }} className={labelCls} style={{ opacity: 0, display: 'none' }}>{text}</div>
    </Html>
  )

  return (
    <group ref={root} visible={false}>
      {/* orbit rings */}
      <mesh geometry={moonRing} material={mats.ring} position={[0, 3, 0]} rotation={[Math.PI / 2 - MOON_TILT, 0, 0]} raycast={() => null} />
      <mesh geometry={marsRing} material={mats.ring} rotation={[Math.PI / 2, 0, 0]} raycast={() => null} />
      <mesh geometry={beltRing} material={mats.ring} rotation={[Math.PI / 2, 0, 0]} raycast={() => null} />
      <primitive object={outerLine} />

      <group position={[0, R + 5, 0]}>{label(0, 'earth')}</group>
      <group ref={moonLabel}>{label(1, 'moon')}</group>

      <group ref={mars}>
        <mesh material={mats.mars} {...tipProps('mars', 'the red planet. a crewed mars settlement is a mission milestone')}>
          <icosahedronGeometry args={[MARS_R, 3]} />
        </mesh>
        <mesh material={mats.marsCap} position={[0, MARS_R * 0.92, 0]}><sphereGeometry args={[MARS_R * 0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 5]} /></mesh>
        <group position={[0, MARS_R + 2.4, 0]}>{label(2, 'mars')}</group>
      </group>

      <instancedMesh ref={belt} args={[rockGeo, mats.rock, BELT_ROCKS]} raycast={() => null} />
      <group position={[Math.cos(-0.3) * BELT, 6, Math.sin(-0.3) * BELT]}>{label(3, 'asteroid belt')}</group>

      {outerMarkers.map((m, i) => (
        <mesh key={i} position={m.pos} material={mats.outer} scale={m.s} {...tipProps('outer system', 'the gas giants and beyond, marked here far closer than they are')}>
          <sphereGeometry args={[1, 16, 12]} />
        </mesh>
      ))}
      <group position={[outerMarkers[0].pos.x, 6, outerMarkers[0].pos.z]}>{label(4, 'outer system')}</group>

      {assets.map((a, i) => (
        <group key={a.id} ref={(el) => { assetGroups.current[i] = el }} {...tipProps(a.label, describe(a))}>
          <AssetModel a={a} mats={mats} />
          {a.status === 'destroyed' && <Debris seed={i * 97 + 13} mat={mats.dark} />}
        </group>
      ))}
      {probeIdx >= 0 && <instancedMesh ref={trail} args={[undefined, mats.trail, 10]} raycast={() => null}><sphereGeometry args={[1, 8, 6]} /></instancedMesh>}

      {arcs.map((ln, k) => <primitive key={recent[k].id} object={ln} ref={(el: THREE.Line | null) => { arcRefs.current[k] = el }} />)}

      <group ref={scaleNote}>{label(5, 'not to scale')}</group>
    </group>
  )
}
