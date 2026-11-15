'use client'
// v3: every world looks like its decisions. energy sites, rail, towns in the agent's architecture and landmarks,
// all rendered from Region.visual and Agent.archStyle. only in the "real" overlay mode.
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Agent, ArchStyle, Frame, Region } from '@/lib/types'
import { archStyleFor } from '@/lib/mock/v3'
import { C, LAND_TOP, STEP, buildTiles, latLonToVec3, surfacePoint, surfaceQuat, tangentBasis, tileIndexAt, toonGradient, vinyl, type Tile } from './lib'
import { tipProps, useCallouts, yearOf, type Callout } from './explain'
import { useStore } from '../state/store'

type EnergyKind = 'solar' | 'wind' | 'nuclear' | 'fossil' | 'hydro'
type Info = { title: string; text: string }

const ENERGY_WORD: Record<EnergyKind, string> = { solar: 'solar field', wind: 'wind turbines', nuclear: 'nuclear plant', fossil: 'fossil plant', hydro: 'hydro dam' }
const ENERGY_WHY: Record<EnergyKind, string> = {
  solar: 'panels on dry, sunny land',
  wind: 'turbines on open coast and plains',
  nuclear: 'reactors with cooling towers, steady power day and night',
  fossil: 'coal and gas stacks, cheap now and paid for in the air',
  hydro: 'a dam holding back a river on high ground',
}

// how bright a region's cities are at night, 0..1. regions without v3 data keep full lights
export function lightFactor(frame: Frame, regionIndex: number): number {
  const v = frame.regions[regionIndex]?.visual
  if (!v) return 1
  return Math.max(0, Math.min(1, v.lightDensity * (1 - v.damage.level * 0.85)))
}

const hash = (n: number) => { let h = (n * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296 }
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }

// ---- geometry, built once ----

function tf(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, ry = 0, rz = 0) {
  if (rz) g.rotateZ(rz)
  if (ry) g.rotateY(ry)
  g.translate(x, y, z)
  return g
}
// merge with only position + normal so mixed geometry types combine
function merge(parts: THREE.BufferGeometry[]) {
  const clean = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p
    const out = new THREE.BufferGeometry()
    out.setAttribute('position', g.getAttribute('position'))
    out.setAttribute('normal', g.getAttribute('normal'))
    return out
  })
  return mergeGeometries(clean)!
}

// unit buildings: footprint about 1, height 1, base at y=0
function buildingGeos(style: ArchStyle) {
  const box = (w: number, h: number, y: number, x = 0) => tf(new THREE.BoxGeometry(w, h, w), x, y + h / 2)
  const cyl = (r: number, h: number, y: number) => tf(new THREE.CylinderGeometry(r, r, h, 10), 0, y + h / 2)
  const half = (r: number, y: number, sy = 1) => { const g = new THREE.SphereGeometry(r, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, sy, 1); return tf(g, 0, y) }
  let body: THREE.BufferGeometry, top = 1, topW = 1, round = false
  switch (style.towerShape) {
    case 'stepped': body = merge([box(1, 0.55, 0), box(0.72, 0.3, 0.55), box(0.46, 0.15, 0.85)]); topW = 0.46; break
    case 'rounded': body = merge([cyl(0.5, 0.82, 0), half(0.5, 0.82, 0.36)]); round = true; break
    case 'spire': body = merge([box(1, 0.78, 0), tf(new THREE.ConeGeometry(0.5, 0.5, 4), 0, 1.03, 0, Math.PI / 4)]); top = 1.28; topW = 0; break
    case 'stacked': body = merge([box(1, 0.4, 0), box(0.8, 0.34, 0.4, 0.14), box(0.6, 0.26, 0.74, -0.1)]); topW = 0.6; break
    case 'dome': default: body = merge([cyl(0.5, 0.34, 0), half(0.5, 0.34)]); top = 0.84; round = true; break
  }
  // roof only on flat topped shapes
  let roof: THREE.BufferGeometry | null = null
  if (!round && topW > 0) {
    const ox = style.towerShape === 'stacked' ? -0.1 : 0
    if (style.roofStyle === 'peaked') { const g = new THREE.CylinderGeometry(0, topW * 0.6, 0.22, 4); g.rotateY(Math.PI / 4); roof = tf(g, ox, top + 0.11) }
    else if (style.roofStyle === 'garden') roof = tf(new THREE.BoxGeometry(topW * 0.86, 0.06, topW * 0.86), ox, top + 0.03)
  }
  const accent = round ? tf(new THREE.CylinderGeometry(0.515, 0.515, 0.07, 10), 0, 0.42) : tf(new THREE.BoxGeometry(1.03, 0.07, 1.03), 0, 0.42)
  return { body, roof, accent, top }
}

function hyperboloid() {
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 7; i++) {
    const y = i / 7
    const r = 0.36 + 0.22 * Math.pow((y - 0.62) / 0.62, 2)
    pts.push(new THREE.Vector2(r, y))
  }
  return new THREE.LatheGeometry(pts, 10)
}

function bladesGeo() {
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 3; k++) { const g = new THREE.BoxGeometry(0.014, 0.075, 0.005); g.translate(0, 0.04, 0); g.rotateZ((k / 3) * Math.PI * 2); parts.push(g) }
  parts.push(new THREE.SphereGeometry(0.01, 6, 4))
  return merge(parts)
}

// ---- layout ----

type Site = { kind: EnergyKind; tile: number; region: number; info: Info; weight: number }
type Placed = { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3; info: Info }
type Spin = { pos: THREE.Vector3; quat: THREE.Quaternion; phase: number }
type Puff = { base: THREE.Vector3; up: THREE.Vector3; side: THREE.Vector3; phase: number; size: number }
type Rail = { curve: THREE.CatmullRomCurve3; a: Region; b: Region; traffic: number; radius: number }

function topOf(t: Tile) { return LAND_TOP + t.band * STEP }

// a point on a tile in its local frame (x right, z forward), lifted by y above the tile top
function onTile(t: Tile, lx: number, lz: number, y = 0) {
  const x = AX.x.clone().applyQuaternion(t.quat), z = AX.z.clone().applyQuaternion(t.quat)
  return t.normal.clone().multiplyScalar(topOf(t) + y).addScaledVector(x, lx * t.w).addScaledVector(z, lz * t.d)
}
function yaw(t: Tile, a: number) { return t.quat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(AX.y, a)) }

function useLayout(frame: Frame, style: ArchStyle, agentName: string) {
  const { tiles, neighbors } = useMemo(() => buildTiles(frame.regions), [frame.regions])
  // rebuild only when the look actually changes, not every month
  const key = useMemo(() => [
    style.towerShape, style.roofStyle,
    ...frame.regions.map((r) => {
      const v = r.visual
      if (!v) return r.id
      const m = v.energyMix
      return [r.id, Math.round(m.solar * 20), Math.round(m.wind * 20), Math.round(m.nuclear * 20), Math.round(m.fossil * 20), Math.round(m.hydro * 20), Math.round(v.urbanDensity * 10), v.railLinks.join('+'), v.landmarks.map((l) => l.label).join('+'), Math.round(Math.log10(Math.max(1, r.population)) * 4)].join(':')
    }),
    ...frame.cities.filter((c) => !c.offWorld).map((c) => c.id),
  ].join('|'), [frame.regions, frame.cities, style.towerShape, style.roofStyle])

  return useMemo(() => {
    const regions = frame.regions
    const byRegion = new Map<number, number[]>()
    tiles.forEach((t, i) => { if (t.land && !t.ice && t.region >= 0) byRegion.set(t.region, [...(byRegion.get(t.region) ?? []), i]) })
    const coastal = (i: number) => Array.from(neighbors[i]).some((j) => !tiles[j].land)
    const centerTile = (ri: number) => {
      const r = regions[ri], c = latLonToVec3(r.lat, r.lon, 1)
      let best = -1, bd = -Infinity
      for (const i of byRegion.get(ri) ?? []) { const d = tiles[i].normal.dot(c); if (d > bd) { bd = d; best = i } }
      return best
    }

    // energy sites: each region spends its tiles in proportion to its mix
    const sites: Site[] = []
    const used = new Set<number>()
    regions.forEach((r, ri) => {
      const v = r.visual
      const own = byRegion.get(ri)
      if (!v || !own?.length) return
      const total = Math.max(4, Math.min(18, Math.round(4 + Math.sqrt(r.population / 1e6) * 0.35)))
      const center = centerTile(ri)
      const kinds = (Object.keys(v.energyMix) as EnergyKind[]).sort((a, b) => v.energyMix[b] - v.energyMix[a])
      for (const kind of kinds) {
        const share = v.energyMix[kind]
        const n = Math.round(total * share)
        if (!n) continue
        const pref = (i: number) => {
          const t = tiles[i]
          switch (kind) {
            case 'solar': return (t.biome === 'desert' ? 2 : t.biome === 'savanna' ? 1.4 : 0) + (t.band === 0 ? 0.3 : 0)
            case 'wind': return (coastal(i) ? 1.6 : 0) + (t.biome === 'temperate' || t.biome === 'tundra' ? 0.8 : 0)
            case 'hydro': return (t.band >= 1 ? 1.5 : -3) + (coastal(i) ? 0.8 : 0)
            default: return 0
          }
        }
        const ranked = own.filter((i) => i !== center && !used.has(i)).map((i) => ({ i, s: pref(i) + hash(i * 7 + kind.length * 131) })).sort((a, b) => b.s - a.s)
        for (const { i } of ranked.slice(0, n)) {
          used.add(i)
          const pct = Math.round(share * 100)
          sites.push({ kind, tile: i, region: ri, weight: share * Math.sqrt(r.population / 1e8), info: { title: ENERGY_WORD[kind], text: `${ENERGY_WHY[kind]}. ${pct}% of ${r.name}'s power comes from ${kind}` } })
        }
      }
    })

    const solar: Placed[] = [], poles: Placed[] = [], towers: Placed[] = [], stacks: Placed[] = [], dams: Placed[] = []
    const blades: (Spin & { info: Info })[] = [], steam: Puff[] = [], smoke: Puff[] = []
    const S = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    for (const s of sites) {
      const t = tiles[s.tile], h = hash(s.tile * 3 + 1), up = t.normal.clone()
      const side = AX.x.clone().applyQuaternion(t.quat)
      if (s.kind === 'solar') {
        const tilt = new THREE.Quaternion().setFromAxisAngle(AX.x, -0.45)
        for (let a = 0; a < 2; a++) for (let b = 0; b < 3; b++)
          solar.push({ pos: onTile(t, (b - 1) * 0.22, (a - 0.5) * 0.24, 0.012), quat: yaw(t, h * 0.4).multiply(tilt), scale: S(0.085, 0.008, 0.055), info: s.info })
      } else if (s.kind === 'wind') {
        for (let k = 0; k < 2; k++) {
          const lx = (k - 0.5) * 0.4, lz = (h - 0.5) * 0.3
          const q = yaw(t, h * 6)
          poles.push({ pos: onTile(t, lx, lz), quat: q, scale: S(1, 1, 1), info: s.info })
          blades.push({ pos: onTile(t, lx, lz, 0.16), quat: q, phase: hash(s.tile + k) * 6, info: s.info })
        }
      } else if (s.kind === 'nuclear') {
        for (let k = 0; k < 2; k++) {
          const lx = (k - 0.5) * 0.36
          const sz = 0.11 + h * 0.02
          towers.push({ pos: onTile(t, lx, 0), quat: t.quat.clone(), scale: S(sz, sz * 1.3, sz), info: s.info })
          for (let p = 0; p < 3; p++) steam.push({ base: onTile(t, lx, 0, sz * 1.3), up, side, phase: (p / 3 + h) % 1, size: 0.05 })
        }
      } else if (s.kind === 'fossil') {
        const v = s.region >= 0 ? regions[s.region].visual : undefined
        const puffs = 2 + Math.round((v?.energyMix.fossil ?? 0.3) * 5)
        for (let k = 0; k < 3; k++) {
          const lx = (k - 1) * 0.18, lz = (hash(s.tile * 5 + k) - 0.5) * 0.2, sh = 0.17 + hash(s.tile + k * 9) * 0.06
          stacks.push({ pos: onTile(t, lx, lz), quat: t.quat.clone(), scale: S(1, sh / 0.2, 1), info: s.info })
          for (let p = 0; p < puffs; p++) smoke.push({ base: onTile(t, lx, lz, sh), up, side, phase: (p / puffs + hash(k + s.tile)) % 1, size: 0.04 })
        }
      } else {
        dams.push({ pos: onTile(t, 0, 0.1, 0), quat: yaw(t, h * 3), scale: S(1, 1, 1), info: s.info })
      }
    }

    // rail: one glowing arc per linked pair, sized by the smaller region's population
    const rails: Rail[] = []
    const seen = new Set<string>()
    regions.forEach((r) => {
      for (const to of r.visual?.railLinks ?? []) {
        const b = regions.find((x) => x.id === to)
        if (!b) continue
        const k = [r.id, b.id].sort().join('~')
        if (seen.has(k)) continue
        seen.add(k)
        const A = latLonToVec3(r.lat, r.lon, 1), B = latLonToVec3(b.lat, b.lon, 1)
        const ang = A.angleTo(B)
        const pts: THREE.Vector3[] = []
        for (let i = 0; i <= 20; i++) {
          const f = i / 20
          const p = new THREE.Vector3().copy(A).lerp(B, f).normalize()
          pts.push(p.multiplyScalar(LAND_TOP + 0.3 + Math.sin(Math.PI * f) * ang * 0.9))
        }
        const traffic = Math.min(r.population, b.population)
        rails.push({ curve: new THREE.CatmullRomCurve3(pts), a: r, b, traffic, radius: 0.014 + 0.03 * clamp01(traffic / 1e9) })
      }
    })
    let railGeo: THREE.BufferGeometry | null = null
    if (rails.length) railGeo = merge(rails.map((x) => new THREE.TubeGeometry(x.curve, 40, x.radius, 5, false)))

    // towns: dense tall cores when urbanDensity is high, scattered small towns when low
    const homes: Placed[] = []
    const cluster = (center: THREE.Vector3, n: number, radius: number, hScale: number, seed: number, info: Info) => {
      for (let k = 0; k < n; k++) {
        const a = hash(seed + k * 17) * Math.PI * 2, d = Math.sqrt(hash(seed + k * 31)) * radius
        const p = surfacePoint(center, Math.cos(a) * d, Math.sin(a) * d, 1)
        const ti = tileIndexAt(p)
        const t = tiles[ti]
        if (!t?.land || t.ice) continue
        const falloff = 1 - (d / Math.max(0.01, radius)) * 0.6
        const w = 0.04 + hash(seed + k * 5) * 0.025
        const ht = (0.045 + hash(seed + k * 11) * 0.06) * hScale * falloff
        const n2 = p.clone().normalize()
        homes.push({ pos: n2.clone().multiplyScalar(topOf(t)), quat: surfaceQuat(n2, tangentBasis(n2).north.applyAxisAngle(n2, hash(seed + k) * 3)), scale: S(w, ht, w), info })
      }
    }
    regions.forEach((r, ri) => {
      const v = r.visual
      if (!v) return
      const u = v.urbanDensity
      const popK = Math.max(0.6, Math.min(1.6, Math.sqrt(r.population / 3e8)))
      const info: Info = { title: u > 0.6 ? 'dense city' : u < 0.4 ? 'spread-out towns' : 'city', text: `${r.name}: ${u > 0.6 ? 'people packed into tall towers, short commutes' : u < 0.4 ? 'small towns spread through the countryside' : 'a mid-sized city and its suburbs'}. urban density ${Math.round(u * 100)}%` }
      const c = latLonToVec3(r.lat, r.lon, 1)
      cluster(c, Math.round((6 + 22 * u) * popK), 0.12 + (1 - u) * 0.2, 1 + 2 * u, ri * 1000, info)
      const towns = Math.round(3 * (1 - u) * popK)
      for (let k = 0; k < towns; k++) {
        const a = hash(ri * 77 + k) * Math.PI * 2, d = 0.55 + hash(ri * 91 + k) * 0.5
        cluster(surfacePoint(c, Math.cos(a) * d, Math.sin(a) * d, 1), 3 + Math.round(hash(k + ri) * 2), 0.07, 0.6, ri * 1000 + 300 + k * 13, info)
      }
    })
    for (const city of frame.cities) {
      if (city.offWorld) continue
      const ri = regions.findIndex((r) => r.id === city.regionId)
      const v = regions[ri]?.visual
      if (!v) continue
      const u = v.urbanDensity
      const size = Math.max(0.5, Math.min(1.5, Math.log10(Math.max(1e4, city.population)) / 6))
      cluster(latLonToVec3(city.lat, city.lon, 1), Math.round((4 + 12 * u) * size), 0.06 + (1 - u) * 0.08, (1 + 1.6 * u) * size, Math.round(hash(city.id.length * 7 + city.lat * 13) * 1e6), { title: city.name, text: `${city.name}: ${city.reason}` })
    }

    // landmarks: next to the region center, off to one side so the core cluster stays readable
    const landmarks = regions.flatMap((r, ri) => (r.visual?.landmarks ?? []).map((l, k) => {
      const c = latLonToVec3(r.lat, r.lon, 1)
      const a = 0.9 + k * 2.1
      const p = surfacePoint(c, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 1)
      const t = tiles[tileIndexAt(p)]
      const n2 = p.clone().normalize()
      const pos = n2.clone().multiplyScalar(t?.land ? topOf(t) : LAND_TOP)
      return { key: `${r.id}-${l.label}`, l, region: r, ri, pos, quat: surfaceQuat(n2, tangentBasis(n2).north) }
    }))

    return { sites, solar, poles, blades, towers, stacks, dams, steam, smoke, rails, railGeo, homes, landmarks, agentName }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

// ---- instanced parts ----

function useHover(infos: Info[]) {
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      if (e.instanceId == null || !infos[e.instanceId]) return
      e.stopPropagation()
      const i = infos[e.instanceId]
      useStore.getState().setTip({ title: i.title, text: i.text, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
      document.body.style.cursor = 'help'
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const t = useStore.getState().tip
      if (t) useStore.getState().setTip({ ...t, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
    },
    onPointerOut: () => { useStore.getState().setTip(null); document.body.style.cursor = '' },
  }
}

function Static({ items, geo, mat, shadow = false, hover = true, colors }: { items: Placed[]; geo: THREE.BufferGeometry; mat: THREE.Material; shadow?: boolean; hover?: boolean; colors?: THREE.Color[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const mtx = new THREE.Matrix4()
    items.forEach((it, k) => m.setMatrixAt(k, mtx.compose(it.pos, it.quat, it.scale)))
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [items])
  useEffect(() => {
    const m = ref.current
    if (!m || !colors) return
    colors.forEach((c, k) => m.setColorAt(k, c))
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [colors])
  const h = useHover(items.map((i) => i.info))
  if (!items.length) return null
  return <instancedMesh ref={ref} args={[geo, mat, items.length]} castShadow={shadow} receiveShadow={shadow} {...(hover ? h : { raycast: () => null })} />
}

function Blades({ items, geo, mat }: { items: (Spin & { info: Info })[]; geo: THREE.BufferGeometry; mat: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), r: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) }), [])
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    const t = clock.elapsedTime
    items.forEach((it, k) => {
      tmp.r.setFromAxisAngle(AX.z, t * 1.6 + it.phase)
      m.setMatrixAt(k, tmp.m.compose(it.pos, tmp.q.copy(it.quat).multiply(tmp.r), tmp.s))
    })
    m.instanceMatrix.needsUpdate = true
  })
  useLayoutEffect(() => { ref.current?.computeBoundingSphere() }, [items])
  if (!items.length) return null
  return <instancedMesh ref={ref} args={[geo, mat, items.length]} raycast={() => null} frustumCulled={false} />
}

function Puffs({ items, geo, mat, rise, drift }: { items: Puff[]; geo: THREE.BufferGeometry; mat: THREE.Material; rise: number; drift: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion() }), [])
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    const t = clock.elapsedTime
    items.forEach((it, k) => {
      const f = (t * 0.22 + it.phase) % 1
      tmp.p.copy(it.base).addScaledVector(it.up, f * rise).addScaledVector(it.side, f * f * drift)
      const sz = it.size * (0.4 + f * 1.4) * Math.sin(Math.PI * Math.min(1, f * 1.15))
      m.setMatrixAt(k, tmp.m.compose(tmp.p, tmp.q, tmp.s.setScalar(Math.max(0.0001, sz))))
    })
    m.instanceMatrix.needsUpdate = true
  })
  if (!items.length) return null
  return <instancedMesh ref={ref} args={[geo, mat, items.length]} raycast={() => null} frustumCulled={false} />
}

function Trams({ rails, mat }: { rails: Rail[]; mat: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(() => new THREE.SphereGeometry(1, 6, 4), [])
  const per = 3
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion() }), [])
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    const t = clock.elapsedTime
    rails.forEach((r, i) => {
      for (let k = 0; k < per; k++) {
        const f = (t * 0.06 + k / per + i * 0.17) % 1
        r.curve.getPointAt(k % 2 ? f : 1 - f, tmp.p)
        m.setMatrixAt(i * per + k, tmp.m.compose(tmp.p, tmp.q, tmp.s.setScalar(r.radius * 1.9)))
      }
    })
    m.instanceMatrix.needsUpdate = true
  })
  if (!rails.length) return null
  return <instancedMesh ref={ref} args={[geo, mat, rails.length * per]} raycast={() => null} frustumCulled={false} />
}

// ---- landmarks: one original clay shape per kind ----

function LandmarkShape({ kind, mats }: { kind: string; mats: Record<string, THREE.Material> }) {
  const ring = (n: number, el: (k: number, a: number) => ReactNode) => Array.from({ length: n }, (_, k) => el(k, (k / n) * Math.PI * 2))
  switch (kind) {
    case 'solar_belt':
      return (
        <group>
          <mesh material={mats.bone} position={[0, 0.2, 0]} castShadow><cylinderGeometry args={[0.035, 0.05, 0.4, 8]} /></mesh>
          <mesh material={mats.glow} position={[0, 0.42, 0]}><sphereGeometry args={[0.05, 8, 6]} /></mesh>
          {ring(10, (k, a) => <mesh key={k} material={mats.panel} position={[Math.cos(a) * 0.2, 0.03, Math.sin(a) * 0.2]} rotation={[0, -a, 0.5]}><boxGeometry args={[0.02, 0.07, 0.07]} /></mesh>)}
        </group>
      )
    case 'arcology':
      return (
        <group>
          {[0, 1, 2, 3].map((k) => (
            <group key={k}>
              <mesh material={mats.bone} position={[0, 0.06 + k * 0.12, 0]} castShadow><boxGeometry args={[0.5 - k * 0.11, 0.12, 0.5 - k * 0.11]} /></mesh>
              <mesh material={mats.leaf} position={[0, 0.125 + k * 0.12, 0]}><boxGeometry args={[0.48 - k * 0.11, 0.02, 0.48 - k * 0.11]} /></mesh>
            </group>
          ))}
        </group>
      )
    case 'launch_tower':
      return (
        <group>
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z], k) => <mesh key={k} material={mats.steel} position={[x * 0.04, 0.3, z * 0.04]} castShadow><boxGeometry args={[0.012, 0.6, 0.012]} /></mesh>)}
          {[0, 1, 2, 3, 4].map((k) => <mesh key={`b${k}`} material={mats.steel} position={[0, 0.08 + k * 0.12, 0]}><boxGeometry args={[0.1, 0.012, 0.1]} /></mesh>)}
          <mesh material={mats.accent} position={[0, 0.62, 0]}><coneGeometry args={[0.04, 0.06, 4]} /></mesh>
        </group>
      )
    case 'reactor_park':
      return (
        <group>
          {[0, 1, 2].map((k) => { const a = (k / 3) * Math.PI * 2; return <mesh key={k} material={mats.bone} position={[Math.cos(a) * 0.14, 0, Math.sin(a) * 0.14]} castShadow><sphereGeometry args={[0.11, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh> })}
          <mesh material={mats.accent} position={[0, 0.01, 0]}><cylinderGeometry args={[0.05, 0.05, 0.02, 10]} /></mesh>
        </group>
      )
    case 'forest_reserve':
      return (
        <group>
          {[0, 1, 2, 3, 4].map((k) => { const a = k * 1.3, d = k ? 0.16 : 0; return (
            <group key={k} position={[Math.cos(a) * d, 0, Math.sin(a) * d]}>
              <mesh material={mats.trunk} position={[0, 0.06, 0]}><cylinderGeometry args={[0.015, 0.02, 0.12, 6]} /></mesh>
              <mesh material={mats.leaf} position={[0, 0.2, 0]} castShadow><icosahedronGeometry args={[0.09 + (k % 2) * 0.02, 0]} /></mesh>
            </group>
          ) })}
        </group>
      )
    case 'stack_field':
      return (
        <group>
          {[0, 1, 2, 3, 4, 5].map((k) => <mesh key={k} material={mats.dark} position={[(k % 3 - 1) * 0.1, 0.16 + (k % 2) * 0.03, (Math.floor(k / 3) - 0.5) * 0.12]} castShadow><cylinderGeometry args={[0.018, 0.024, 0.32 + (k % 2) * 0.06, 8]} /></mesh>)}
        </group>
      )
    case 'pipeline':
      return (
        <group>
          {[0, 1, 2, 3, 4, 5].map((k) => <mesh key={k} material={mats.steel} position={[(k - 2.5) * 0.1, 0.05, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.025, 0.025, 0.09, 8]} /></mesh>)}
          {[0, 1, 2, 3, 4, 5].map((k) => <mesh key={`s${k}`} material={mats.dark} position={[(k - 2.5) * 0.1, 0.02, 0]}><boxGeometry args={[0.012, 0.04, 0.04]} /></mesh>)}
        </group>
      )
    case 'monument':
      return (
        <group>
          <mesh material={mats.bone} position={[0, 0.3, 0]} castShadow><boxGeometry args={[0.07, 0.6, 0.07]} /></mesh>
          <mesh material={mats.accent} position={[0, 0.42, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.1, 0.015, 6, 16]} /></mesh>
          <mesh material={mats.boneDeep} position={[0, 0.02, 0]}><cylinderGeometry args={[0.13, 0.15, 0.04, 10]} /></mesh>
        </group>
      )
    case 'launch_corridor':
      return (
        <group>
          {[0, 1, 2, 3].map((k) => (
            <group key={k} position={[(k - 1.5) * 0.14, 0, 0]}>
              <mesh material={mats.boneDeep} position={[0, 0.01, 0]}><cylinderGeometry args={[0.05, 0.05, 0.02, 10]} /></mesh>
              <mesh material={mats.bone} position={[0, 0.08, 0]} castShadow><capsuleGeometry args={[0.018, 0.1, 3, 8]} /></mesh>
            </group>
          ))}
        </group>
      )
    case 'dam':
      return (
        <group>
          <mesh material={mats.concrete} position={[0, 0.08, 0]} castShadow><cylinderGeometry args={[0.32, 0.32, 0.16, 12, 1, true, -0.6, 1.2]} /></mesh>
          <mesh material={mats.water} position={[0, 0.07, -0.05]}><boxGeometry args={[0.36, 0.1, 0.18]} /></mesh>
        </group>
      )
    default:
      return (
        <group>
          <mesh material={mats.boneDeep} position={[0, 0.04, 0]} castShadow><boxGeometry args={[0.16, 0.08, 0.16]} /></mesh>
          <mesh material={mats.steel} position={[0, 0.2, 0]}><cylinderGeometry args={[0.006, 0.006, 0.24, 6]} /></mesh>
          <mesh material={mats.accent} position={[0.04, 0.29, 0]}><boxGeometry args={[0.08, 0.05, 0.005]} /></mesh>
        </group>
      )
  }
}

// ---- main ----

export default function Structures({ frame, agent }: { frame: Frame; agent?: Agent }) {
  const overlay = useStore((s) => s.overlay)
  const recordAgent = useStore((s) => s.record.agentId)
  const style = useMemo(() => agent?.archStyle ?? archStyleFor(agent?.id ?? recordAgent), [agent, recordAgent])
  const agentName = agent?.name ?? 'the core'
  const L = useLayout(frame, style, agentName)

  const geos = useMemo(() => {
    const b = buildingGeos(style)
    return {
      ...b,
      panel: new THREE.BoxGeometry(1, 1, 1),
      pole: tf(new THREE.CylinderGeometry(0.006, 0.011, 0.16, 6), 0, 0.08),
      blades: bladesGeo(),
      tower: hyperboloid(),
      stack: tf(new THREE.CylinderGeometry(0.012, 0.017, 0.2, 8), 0, 0.1),
      stackBand: tf(new THREE.CylinderGeometry(0.0135, 0.0135, 0.018, 8), 0, 0.17),
      dam: merge([tf(new THREE.BoxGeometry(0.24, 0.08, 0.05), 0, 0.04), tf(new THREE.BoxGeometry(0.2, 0.05, 0.12), 0, 0.025, -0.08)]),
      puff: new THREE.IcosahedronGeometry(1, 0),
    }
  }, [style])
  useEffect(() => () => { for (const g of Object.values(geos)) if (g && typeof g === 'object' && 'dispose' in g) (g as THREE.BufferGeometry).dispose() }, [geos])
  useEffect(() => () => { L.railGeo?.dispose() }, [L.railGeo])

  const mats = useMemo(() => {
    const toon = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() })
    return {
      panel: new THREE.MeshPhysicalMaterial({ color: '#2B3F6B', metalness: 0.3, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
      white: toon('#F3EFE7'),
      tower: toon('#E6DDCB'),
      stack: toon('#4A4642'),
      stackBand: toon('#B9B3A6'),
      concrete: toon('#B9B3A6'),
      steam: new THREE.MeshToonMaterial({ color: '#F6F4EF', gradientMap: toonGradient(), transparent: true, opacity: 0.7, depthWrite: false }),
      smoke: new THREE.MeshToonMaterial({ color: '#5A5550', gradientMap: toonGradient(), transparent: true, opacity: 0.75, depthWrite: false }),
      rail: new THREE.MeshBasicMaterial({ color: '#FFD59A', transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false }),
      tram: new THREE.MeshBasicMaterial({ color: '#FFF3DC', toneMapped: false }),
      body: new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonGradient() }),
      roof: toon(style.roofStyle === 'garden' ? '#7FA36B' : '#7C8FA8'),
      accent: toon(style.accent),
    }
  }, [style])
  const lmMats = useMemo<Record<string, THREE.Material>>(() => ({
    bone: vinyl(C.bone), boneDeep: vinyl(C.boneDeep), steel: vinyl('#9DA6AE'), leaf: vinyl('#7FA36B'), trunk: vinyl('#6E5440'), dark: vinyl('#4A4642'),
    concrete: vinyl('#B9B3A6'), water: vinyl('#6FA3BE'), panel: vinyl('#2B3F6B', { metalness: 0.3, roughness: 0.3 }), accent: vinyl(style.accent),
    glow: new THREE.MeshBasicMaterial({ color: '#FFE9B0', toneMapped: false }),
  }), [style.accent])

  // building colors: bone family, going ash grey where the region is damaged
  const homeColors = useMemo(() => {
    const ash = new THREE.Color('#77736E')
    return L.homes.map((h, k) => {
      const c = new THREE.Color(['#EFE8DA', '#E2D8C4', '#D9D4CB', '#F2EBDD'][k % 4])
      const ti = tileIndexAt(h.pos)
      const t = buildTiles(frame.regions).tiles[ti]
      const dmg = t && t.region >= 0 ? frame.regions[t.region]?.visual?.damage.level ?? 0 : 0
      return dmg > 0 ? c.lerp(ash, Math.min(0.85, dmg)) : c
    })
  }, [L.homes, frame.regions])

  // words: landmarks, the busiest rail line, the biggest site of each power type per region, smog
  const list = useMemo<Callout[]>(() => {
    const out: Callout[] = []
    for (const lm of L.landmarks) {
      const law = lm.l.lawId ? frame.laws.find((x) => x.id === lm.l.lawId) : undefined
      out.push({ id: `lm-${lm.key}`, pos: lm.pos.clone().setLength(lm.pos.length() + 0.4), title: lm.l.label, text: `built ${yearOf(lm.l.tick)}${law ? ` under the law "${law.title}"` : ` by ${agentName}`}`, weight: 3 })
    }
    const busiest = [...L.rails].sort((a, b) => b.traffic - a.traffic)[0]
    if (busiest) out.push({ id: 'rail-top', pos: busiest.curve.getPointAt(0.5), title: 'rail line', text: `rail between ${busiest.a.name} and ${busiest.b.name}. built by ${agentName}`, weight: 2 })
    const best = new Map<string, (typeof L.sites)[number]>()
    for (const s of L.sites) {
      const k = `${s.region}-${s.kind}`
      const cur = best.get(k)
      const share = frame.regions[s.region]?.visual?.energyMix[s.kind] ?? 0
      if (share >= 0.15 && (!cur || s.weight > cur.weight)) best.set(k, s)
    }
    const tiles = buildTiles(frame.regions).tiles
    for (const s of best.values()) {
      const t = tiles[s.tile]
      out.push({ id: `site-${s.region}-${s.kind}`, pos: t.normal.clone().multiplyScalar(topOf(t) + 0.3), title: s.info.title, text: s.info.text, weight: 1 + s.weight })
    }
    frame.regions.forEach((r) => {
      if ((r.visual?.pollution ?? 0) > 0.6) out.push({ id: `smog-${r.id}`, pos: latLonToVec3(r.lat, r.lon, LAND_TOP + 0.6), title: 'brown haze', text: `${r.name} still burns coal for most of its power`, weight: 2 })
    })
    return out
  }, [L, frame.laws, frame.regions, agentName])
  useCallouts('structures', overlay === 'real' ? list : [])

  if (overlay !== 'real') return null
  return (
    <group>
      <Static items={L.solar} geo={geos.panel} mat={mats.panel} />
      <Static items={L.poles} geo={geos.pole} mat={mats.white} />
      <Blades items={L.blades} geo={geos.blades} mat={mats.white} />
      <Static items={L.towers} geo={geos.tower} mat={mats.tower} shadow />
      <Puffs items={L.steam} geo={geos.puff} mat={mats.steam} rise={0.22} drift={0.05} />
      <Static items={L.stacks} geo={geos.stack} mat={mats.stack} shadow />
      <Static items={L.stacks} geo={geos.stackBand} mat={mats.stackBand} hover={false} />
      <Puffs items={L.smoke} geo={geos.puff} mat={mats.smoke} rise={0.3} drift={0.12} />
      <Static items={L.dams} geo={geos.dam} mat={mats.concrete} />
      {L.railGeo && <mesh geometry={L.railGeo} material={mats.rail} raycast={() => null} renderOrder={3} />}
      <Trams rails={L.rails} mat={mats.tram} />
      <Static items={L.homes} geo={geos.body} mat={mats.body} shadow colors={homeColors} />
      {geos.roof && <Static items={L.homes} geo={geos.roof} mat={mats.roof} hover={false} />}
      <Static items={L.homes} geo={geos.accent} mat={mats.accent} hover={false} />
      {L.landmarks.map((lm) => (
        // minimal shell: landmarks name themselves on hover, not with a standing label
        <group key={lm.key} position={lm.pos} quaternion={lm.quat} {...tipProps(lm.l.label, `landmark, built ${yearOf(lm.l.tick)}`)}>
          <LandmarkShape kind={lm.l.kind} mats={lmMats} />
        </group>
      ))}
    </group>
  )
}
