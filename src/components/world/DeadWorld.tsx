'use client'
// a dying world shows its wounds. each region's visual.damage ({ kind, level }) scatters scars on its land tiles:
// famine cracks and withered stubs, revolt burned towers and smoke, war craters and ash, collapse rubble,
// disaster floods, scorch and wrecked roofs. everything is instanced: ~9 draw calls total.
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type { Frame, RegionVisual } from '@/lib/types'
import { C, CORE_POS, LAND_TOP, STEP, buildTiles, latLonToVec3, toonGradient, vinyl, type Tile, sceneRefs } from './lib'
import { useCallouts, yearOf, type Callout } from './explain'
import { useStore } from '../state/store'

type Kind = RegionVisual['damage']['kind']
const MIN_LEVEL = 0.15
const MAX_SMOKE = 25 // columns
const PUFFS = 8 // per column, so at most 200 puffs
const ASH = 260

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

// the worst damage on the planet right now: drives grey sky, dim lights and quiet sound elsewhere
export function useDeathMood(frame: Frame): { kind: Kind; level: number } {
  return useMemo(() => {
    let kind: Kind = 'none', level = 0
    for (const r of frame.regions) {
      const d = r.visual?.damage
      if (d && d.kind !== 'none' && d.level > level) { kind = d.kind; level = d.level }
    }
    return { kind, level }
  }, [frame.regions])
}

type Inst = { m: THREE.Matrix4; c: THREE.Color; tip: string }
type Smoke = { base: THREE.Vector3; n: THREE.Vector3; phase: number; dark: boolean }

const COL = {
  crackPlate: '#7A5A3A', crack: '#2C2119', stub: '#8A7350', charred: '#2B2622', toppled: '#6D655C', rubble: '#7D766D',
  board: '#CFC4AE', post: '#5B4A3A', roof: '#8C7F6C', scorch: '#3B2F28', craterRim: '#2E2A27', craterPit: '#1F1B19',
}

const TIPS: Record<Exclude<Kind, 'none'>, string> = {
  famine: 'famine: the fields failed and the ground cracked',
  revolt: 'revolt: towers burned and signs were left where people walked off',
  war: 'war: craters and smoke where the fighting reached',
  collapse: 'collapse: what was left when the systems that held it up stopped',
  disaster: 'disaster: the scar the flood, fire or storm left behind',
}

const LINES: Record<Exclude<Kind, 'none'>, (name: string, y: number) => string> = {
  famine: (n, y) => `fields went bare in ${n} as the famine spread, ${y}`,
  revolt: (n, y) => `towers burned in ${n} as the revolt spread, ${y}`,
  war: (n, y) => `craters and smoke over ${n} after the fighting, ${y}`,
  collapse: (n, y) => `${n} went dark as the systems that fed it stopped, ${y}`,
  disaster: (n, y) => `${n} still carries the scar of the disaster, ${y}`,
}

// world matrix for something sitting on a tile at local offset (x along tile, z across), lifted y, extra rotation
function onTile(t: Tile, x: number, y: number, z: number, sx: number, sy: number, sz: number, rot?: THREE.Euler) {
  const top = LAND_TOP + t.band * STEP
  const pos = new THREE.Vector3(x, y, z).applyQuaternion(t.quat).addScaledVector(t.normal, top)
  const q = t.quat.clone()
  if (rot) q.multiply(new THREE.Quaternion().setFromEuler(rot))
  return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(sx, sy, sz))
}

function useInstances(ref: React.RefObject<THREE.InstancedMesh | null>, list: Inst[]) {
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    m.count = list.length
    list.forEach((it, i) => { m.setMatrixAt(i, it.m); m.setColorAt(i, it.c) })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [ref, list])
}

// hovering an instance shows the tip for whatever scar it belongs to
function instTip(list: Inst[]) {
  const show = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId == null || !list[e.instanceId]) return
    e.stopPropagation()
    const [title, ...rest] = list[e.instanceId].tip.split(': ')
    useStore.getState().setTip({ title, text: rest.join(': '), x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
  }
  return { onPointerOver: show, onPointerMove: show, onPointerOut: () => useStore.getState().setTip(null) }
}

export default function DeadWorld({ frame }: { frame: Frame }) {
  const { tiles, neighbors } = useMemo(() => buildTiles(frame.regions), [frame.regions])
  const hurt = useMemo(() => frame.regions.map((r, i) => ({ r, i, d: r.visual?.damage })).filter((x) => x.d && x.d.kind !== 'none' && x.d.level >= MIN_LEVEL), [frame.regions])
  const key = hurt.map((h) => `${h.r.id}:${h.d!.kind}:${Math.round(h.d!.level * 10)}`).join('|')

  const scars = useMemo(() => {
    const plates: Inst[] = [], cracks: Inst[] = [], stubs: Inst[] = [], blocks: Inst[] = [], craters: Inst[] = [], flood: Inst[] = []
    const smoke: Smoke[] = [], ash: THREE.Vector3[] = [], ashN: THREE.Vector3[] = []
    const col = (h: string) => new THREE.Color(h)
    for (const { r, i, d } of hurt) {
      const kind = d!.kind as Exclude<Kind, 'none'>
      const tip = TIPS[kind]
      const land = tiles.map((t, k) => ({ t, k })).filter(({ t }) => t.land && !t.ice && t.region === i)
      if (!land.length) continue
      const rnd = rng(r.id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7))
      const n = Math.min(land.length, Math.max(2, Math.round(land.length * d!.level * 0.35)))
      // deterministic pick of n tiles
      const picks = land.map((x) => ({ ...x, o: rnd() })).sort((a, b) => a.o - b.o).slice(0, n)
      for (const { t, k } of picks) {
        const w = t.w, dd = t.d
        const jx = (rnd() - 0.5) * w * 0.4, jz = (rnd() - 0.5) * dd * 0.4
        const tilt = () => new THREE.Euler((rnd() - 0.5) * 0.5, rnd() * Math.PI, (rnd() - 0.5) * 0.5)
        const addSmoke = (dark: boolean) => {
          if (smoke.length >= MAX_SMOKE) return
          const top = LAND_TOP + t.band * STEP
          smoke.push({ base: new THREE.Vector3(jx, 0, jz).applyQuaternion(t.quat).addScaledVector(t.normal, top + 0.05), n: t.normal.clone(), phase: rnd(), dark })
        }
        if (kind === 'famine') {
          plates.push({ m: onTile(t, 0, 0.006, 0, w * 0.86, 0.012, dd * 0.86), c: col(COL.crackPlate), tip })
          for (let c = 0; c < 3; c++) cracks.push({ m: onTile(t, (rnd() - 0.5) * w * 0.5, 0.014, (rnd() - 0.5) * dd * 0.5, w * (0.35 + rnd() * 0.3), 0.006, 0.012, new THREE.Euler(0, rnd() * Math.PI, 0)), c: col(COL.crack), tip })
          for (let s = 0; s < 4; s++) stubs.push({ m: onTile(t, (rnd() - 0.5) * w * 0.7, 0.03, (rnd() - 0.5) * dd * 0.7, 0.012, 0.06 + rnd() * 0.03, 0.012, new THREE.Euler((rnd() - 0.5) * 0.6, 0, (rnd() - 0.5) * 0.6)), c: col(COL.stub), tip })
        } else if (kind === 'revolt') {
          // burned stepped tower stub
          const bw = 0.06 + rnd() * 0.04
          blocks.push({ m: onTile(t, jx, 0.04, jz, bw, 0.08, bw), c: col(COL.charred), tip })
          blocks.push({ m: onTile(t, jx, 0.1, jz, bw * 0.7, 0.05, bw * 0.7, new THREE.Euler(0, 0, (rnd() - 0.5) * 0.3)), c: col(COL.charred), tip })
          // a toppled block lying on its side
          blocks.push({ m: onTile(t, -jx * 0.8, 0.018, jz + 0.05, 0.04, 0.12, 0.04, new THREE.Euler(0, rnd() * Math.PI, Math.PI / 2)), c: col(COL.toppled), tip })
          // an abandoned sign, tilted on its post
          if (rnd() < 0.5) {
            const sx = (rnd() - 0.5) * w * 0.6, sz = (rnd() - 0.5) * dd * 0.6, lean = new THREE.Euler(0.25, rnd() * Math.PI, 0.15)
            stubs.push({ m: onTile(t, sx, 0.035, sz, 0.008, 0.07, 0.008, lean), c: col(COL.post), tip })
            blocks.push({ m: onTile(t, sx, 0.075, sz, 0.06, 0.035, 0.006, lean), c: col(COL.board), tip })
          }
          addSmoke(true)
        } else if (kind === 'war') {
          craters.push({ m: onTile(t, jx, 0.004, jz, 0.07 + rnd() * 0.04, 0.03, 0.07 + rnd() * 0.04), c: col(COL.craterRim), tip })
          plates.push({ m: onTile(t, jx, 0.003, jz, 0.08, 0.008, 0.08), c: col(COL.craterPit), tip })
          if (rnd() < 0.6) blocks.push({ m: onTile(t, -jx, 0.02, -jz, 0.05, 0.04, 0.05, tilt()), c: col(COL.charred), tip })
          addSmoke(true)
          for (let a = 0; a < 6 && ash.length < ASH; a++) {
            const top = LAND_TOP + t.band * STEP
            ash.push(new THREE.Vector3((rnd() - 0.5) * w, 0, (rnd() - 0.5) * dd).applyQuaternion(t.quat).addScaledVector(t.normal, top))
            ashN.push(t.normal.clone())
          }
        } else if (kind === 'collapse') {
          // rubble piles: a few small blocks heaped together
          for (let b = 0; b < 4; b++) blocks.push({ m: onTile(t, jx + (rnd() - 0.5) * 0.06, 0.012 + b * 0.008, jz + (rnd() - 0.5) * 0.06, 0.025 + rnd() * 0.03, 0.02, 0.025 + rnd() * 0.03, tilt()), c: col(COL.rubble), tip })
          if (rnd() < 0.3) blocks.push({ m: onTile(t, -jx, 0.03, -jz, 0.04, 0.06, 0.04, new THREE.Euler(0.4, 0, 0.3)), c: col(COL.charred), tip })
        } else if (kind === 'disaster') {
          const coastal = Array.from(neighbors[k]).some((j) => !tiles[j].land)
          if (coastal) flood.push({ m: onTile(t, 0, 0.008, 0, w * 0.95, 0.01, dd * 0.95), c: col('#6FA7C4'), tip })
          else plates.push({ m: onTile(t, jx, 0.005, jz, w * 0.6, 0.01, dd * 0.6, new THREE.Euler(0, rnd(), 0)), c: col(COL.scorch), tip })
          // storm-wrecked roofs: broken tilted slabs
          blocks.push({ m: onTile(t, -jx, 0.03, -jz, 0.07, 0.008, 0.05, new THREE.Euler(0.5 + rnd() * 0.4, rnd() * Math.PI, 0.2)), c: col(COL.roof), tip })
        }
      }
    }
    return { plates, cracks, stubs, blocks, craters, flood, smoke, ash, ashN }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  // callouts for the worst-hit regions
  const list = useMemo<Callout[]>(() => [...hurt].sort((a, b) => b.d!.level - a.d!.level).slice(0, 3).map(({ r, d }) => ({
    id: `dead-${r.id}`, pos: latLonToVec3(r.lat, r.lon, LAND_TOP + 0.35), title: d!.kind,
    text: LINES[d!.kind as Exclude<Kind, 'none'>](r.name.toLowerCase(), yearOf(frame.tick)), weight: 5 + d!.level * 5, danger: true,
  })), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useCallouts('dead', list)

  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const cyl = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 6), [])
  const ring = useMemo(() => new THREE.TorusGeometry(0.8, 0.25, 6, 14).rotateX(Math.PI / 2), [])
  const puffGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), [])
  const toon = useMemo(() => new THREE.MeshToonMaterial({ gradientMap: toonGradient() }), [])
  const floodMat = useMemo(() => new THREE.MeshToonMaterial({ gradientMap: toonGradient(), color: '#6FA7C4', transparent: true, opacity: 0.7, depthWrite: false }), [])
  const smokeMat = useMemo(() => new THREE.MeshToonMaterial({ gradientMap: toonGradient(), transparent: true, opacity: 0.82, depthWrite: false }), [])
  const emberMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(C.ember).multiplyScalar(2), toneMapped: false }), [])
  const ashMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#5a5550') } },
    vertexShader: `
      uniform float uTime; attribute vec3 aN; attribute float aSeed; varying float vA;
      void main() {
        float f = fract(uTime * 0.07 + aSeed);
        vec3 p = position + aN * (0.9 - f * 0.9) + vec3(sin(uTime + aSeed * 40.0), 0.0, cos(uTime * 0.7 + aSeed * 30.0)) * 0.03;
        vA = sin(f * 3.14159);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 3.0 * (20.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA; void main() { vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard; gl_FragColor = vec4(uColor, vA * 0.85); }`,
    transparent: true, depthWrite: false,
  }), [])
  const ashGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(scars.ash.length * 3), nn = new Float32Array(scars.ash.length * 3), seed = new Float32Array(scars.ash.length)
    scars.ash.forEach((p, i) => { pos.set([p.x, p.y, p.z], i * 3); nn.set([scars.ashN[i].x, scars.ashN[i].y, scars.ashN[i].z], i * 3); seed[i] = (i * 0.618) % 1 })
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aN', new THREE.BufferAttribute(nn, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    g.computeBoundingSphere()
    return g
  }, [scars])

  const platesRef = useRef<THREE.InstancedMesh>(null)
  const cracksRef = useRef<THREE.InstancedMesh>(null)
  const stubsRef = useRef<THREE.InstancedMesh>(null)
  const blocksRef = useRef<THREE.InstancedMesh>(null)
  const cratersRef = useRef<THREE.InstancedMesh>(null)
  const floodRef = useRef<THREE.InstancedMesh>(null)
  const smokeRef = useRef<THREE.InstancedMesh>(null)
  const emberRef = useRef<THREE.InstancedMesh>(null)
  useInstances(platesRef, scars.plates)
  useInstances(cracksRef, scars.cracks)
  useInstances(stubsRef, scars.stubs)
  useInstances(blocksRef, scars.blocks)
  useInstances(cratersRef, scars.craters)
  useInstances(floodRef, scars.flood)

  // smoke colors once: dark at the base, paler as it rises
  useLayoutEffect(() => {
    const m = smokeRef.current
    if (!m) return
    m.count = scars.smoke.length * PUFFS
    const c = new THREE.Color()
    scars.smoke.forEach((s, i) => { for (let p = 0; p < PUFFS; p++) m.setColorAt(i * PUFFS + p, c.set(s.dark ? '#4a4643' : '#8d8984').lerp(new THREE.Color('#c9c4bc'), p / PUFFS)) })
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    if (emberRef.current) emberRef.current.count = scars.smoke.length
  }, [scars])

  const mtx = useMemo(() => new THREE.Matrix4(), [])
  const q = useMemo(() => new THREE.Quaternion(), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  const sc = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const t = sceneRefs.wt
    ashMat.uniforms.uTime.value = t
    const m = smokeRef.current, em = emberRef.current
    if (!m || !scars.smoke.length) return
    scars.smoke.forEach((s, i) => {
      for (let p = 0; p < PUFFS; p++) {
        // each puff rises, swells, then shrinks away near the top
        const f = (t * 0.18 + s.phase + p / PUFFS) % 1
        const size = 0.035 + f * 0.07
        const fade = f > 0.75 ? (1 - f) / 0.25 : 1
        v.copy(s.base).addScaledVector(s.n, f * 0.9)
        mtx.compose(v, q, sc.setScalar(size * fade))
        m.setMatrixAt(i * PUFFS + p, mtx)
      }
      if (em) {
        const flick = 0.012 + (Math.sin(t * 9 + i * 3) * 0.5 + 0.5) * 0.01
        em.setMatrixAt(i, mtx.compose(s.base, q, sc.setScalar(flick)))
      }
    })
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
    if (em) { em.instanceMatrix.needsUpdate = true; em.computeBoundingSphere() }
  })

  if (!hurt.length) return null
  const cap = (n: number) => Math.max(1, n)
  return (
    <group>
      <instancedMesh ref={platesRef} args={[box, toon, cap(scars.plates.length)]} receiveShadow {...instTip(scars.plates)} />
      <instancedMesh ref={cracksRef} args={[box, toon, cap(scars.cracks.length)]} raycast={() => null} />
      <instancedMesh ref={stubsRef} args={[cyl, toon, cap(scars.stubs.length)]} raycast={() => null} />
      <instancedMesh ref={blocksRef} args={[box, toon, cap(scars.blocks.length)]} castShadow receiveShadow {...instTip(scars.blocks)} />
      <instancedMesh ref={cratersRef} args={[ring, toon, cap(scars.craters.length)]} {...instTip(scars.craters)} />
      <instancedMesh ref={floodRef} args={[box, floodMat, cap(scars.flood.length)]} renderOrder={1} {...instTip(scars.flood)} />
      <instancedMesh ref={smokeRef} args={[puffGeo, smokeMat, cap(scars.smoke.length * PUFFS)]} raycast={() => null} renderOrder={2} />
      <instancedMesh ref={emberRef} args={[puffGeo, emberMat, cap(scars.smoke.length)]} raycast={() => null} />
      {scars.ash.length > 0 && <points geometry={ashGeo} material={ashMat} raycast={() => null} renderOrder={3} />}
    </group>
  )
}

// a collapsed world's core, broken into drifting shards. mount in place of the core when active
export function CoreShards({ active }: { active: boolean }) {
  const g = useRef<THREE.Group>(null)
  const since = useRef<number | null>(null)
  const mat = useMemo(() => vinyl('#151416', { roughness: 0.5, clearcoat: 0.6 }), [])
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(C.ember).multiplyScalar(1.4), toneMapped: false, transparent: true, opacity: 0.5 }), [])
  const shards = useMemo(() => {
    const r = rng(41)
    return Array.from({ length: 8 }, (_, i) => {
      const dir = new THREE.Vector3(Math.cos(i * 2.399) * Math.sqrt(1 - ((i + 0.5) / 8 * 2 - 1) ** 2), (i + 0.5) / 8 * 2 - 1, Math.sin(i * 2.399) * Math.sqrt(1 - ((i + 0.5) / 8 * 2 - 1) ** 2)).normalize()
      return { dir, s: new THREE.Vector3(0.5 + r() * 0.4, 0.4 + r() * 0.5, 0.45 + r() * 0.35), spin: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.6), p: r() * 6 }
    })
  }, [])
  useFrame(() => {
    if (!active || !g.current) { since.current = null; return }
    const t = sceneRefs.wt
    since.current ??= t
    // ease apart over ~8s, then keep drifting very slowly
    const k = Math.min(1, (t - since.current) / 8)
    const spread = 0.35 + (1 - (1 - k) ** 3) * 1.4 + (t - since.current) * 0.01
    g.current.children.forEach((c, i) => {
      const s = shards[i]
      if (!s) { c.scale.setScalar(0.25 + Math.sin(t * 1.3) * 0.05); return } // the dim heart
      c.position.copy(s.dir).multiplyScalar(spread).addScaledVector(s.dir, Math.sin(t * 0.5 + s.p) * 0.06)
      c.rotation.set(s.p + t * s.spin.x, t * s.spin.y, t * s.spin.z)
    })
    glow.opacity = 0.25 + (Math.sin(t * 1.3) * 0.5 + 0.5) * 0.25
  })
  if (!active) return null
  return (
    <group ref={g} position={CORE_POS}>
      {shards.map((s, i) => (
        <mesh key={i} material={mat} scale={s.s} castShadow>
          <tetrahedronGeometry args={[1, 0]} />
        </mesh>
      ))}
      <mesh material={glow}><icosahedronGeometry args={[1, 1]} /></mesh>
    </group>
  )
}
