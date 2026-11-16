'use client'
// the neighborhood, built to life/REFERENCE.md: row houses along the lanes (plastered walls with a painted lower band,
// steel doors, grilled windows, tin roofs with an overhang, a concrete stoop), shopfronts with awnings and painted
// signs, dirt lanes with earth patches (pavers in antananarivo), wooden power poles with sagging wires, trees in the
// yards, laundry lines, plastic chairs, yellow jerrycans. the main site's lot layout (read-only) is scaled by K so a lane
// is about two car widths. repeated parts are instanced; the building she is in, or one between the camera and her, is
// cut away (swapped for a see-through proxy).
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type { Layout, Lot } from '@/components/world/city/layout'
import { toonGradient } from '@/components/world/lib'
import type { LiveState } from './ChosenPerson'
import type { Collider } from './Camera'
import type { WorldNow } from './Scene'
import { K, STREETS_W, hash01 } from './plan'
import type { CityStyle } from './style'
import { DIMS } from './dims'
import { CENTERS, HALF, STOOP_D, fabricSolids, type Fabric, type Unit, type Special } from './fabric'
export { buildFabric, type Fabric } from './fabric'

const FONT = '/fonts/JetBrainsMono-Regular.ttf'

// ---------- textures ----------
function dirtTexture(base: string, patch: string, paved: boolean): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = base; g.fillRect(0, 0, 256, 256)
  if (paved) {
    // brick pavers in a running bond, a little uneven
    for (let y = 0; y < 256; y += 16) for (let x = (y / 16) % 2 ? -12 : 0; x < 256; x += 24) { g.fillStyle = `rgba(0,0,0,${0.05 + ((x * 7 + y * 13) % 9) / 100})`; g.fillRect(x + 1, y + 1, 22, 14) }
  } else {
    for (let i = 0; i < 26; i++) { g.fillStyle = patch; g.globalAlpha = 0.18 + (i % 5) / 25; g.beginPath(); g.ellipse((i * 97) % 256, (i * 61) % 256, 18 + (i * 7) % 30, 8 + (i * 5) % 14, i, 0, Math.PI * 2); g.fill() }
    g.globalAlpha = 0.14; g.strokeStyle = '#3b3027'; g.lineWidth = 3
    for (const x of [92, 164]) { g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= 256; y += 32) g.lineTo(x + Math.sin(y * 0.05) * 4, y); g.stroke() } // ruts
    g.globalAlpha = 1
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
  return t
}
function tinTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64)
  for (let x = 0; x < 64; x += 8) { g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(x, 0, 3, 64) } // corrugation
  g.fillStyle = 'rgba(120,60,20,0.18)'; g.fillRect(10, 30, 20, 12); g.fillRect(40, 5, 14, 9) // rust patches
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace
  return t
}

const toon = (c: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonGradient(), ...extra })

// ---------- the component ----------
export default function Neighborhood({ fabric, style, world, live, colliders, insideLot }: {
  fabric: Fabric; style: CityStyle; world: React.RefObject<WorldNow>; live: React.RefObject<LiveState>
  colliders: React.RefObject<Collider[]>; insideLot: React.RefObject<number>
}) {
  const { camera } = useThree()
  const U = fabric.units
  const tex = useMemo(() => ({ dirt: dirtTexture(style.ground, style.groundPatch, style.paved), tin: tinTexture() }), [style])
  const mats = useMemo(() => ({
    inst: toon('#ffffff'), roof: toon('#ffffff', { map: tex.tin }), dark: toon('#2a2622'), glass: new THREE.MeshBasicMaterial({ color: '#3a3f44' }),
    stoop: toon('#B5AEA2'), wood: toon('#6E4A36'), pole: toon('#5E4636'), leaf: toon('#5E8A4E'), leaf2: toon('#6F9A4E'), trunk: toon('#6B5544'),
    can: toon('#E8C23A'), floor: toon('#CFC6B6'), wire: new THREE.LineBasicMaterial({ color: '#2a2622', transparent: true, opacity: 0.55 }),
  }), [tex])
  const geo = useMemo(() => ({ box: new THREE.BoxGeometry(1, 1, 1) }), [])

  // per-unit part matrices, so a cut-away unit can be zeroed and restored
  type Part = 'wall' | 'band' | 'door' | 'win' | 'roof' | 'stoop' | 'awning' | 'sign' | 'balcony' | 'rail' | 'floor'
  const parts = useMemo(() => {
    const out: Record<Part, { m: THREE.Matrix4[]; c: THREE.Color[]; owner: number[] }> = { wall: { m: [], c: [], owner: [] }, band: { m: [], c: [], owner: [] }, door: { m: [], c: [], owner: [] }, win: { m: [], c: [], owner: [] }, roof: { m: [], c: [], owner: [] }, stoop: { m: [], c: [], owner: [] }, awning: { m: [], c: [], owner: [] }, sign: { m: [], c: [], owner: [] }, balcony: { m: [], c: [], owner: [] }, rail: { m: [], c: [], owner: [] }, floor: { m: [], c: [], owner: [] } }
    const add = (p: Part, owner: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, rx = 0, ry = 0) => {
      out[p].m.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(sx, sy, sz)))
      out[p].c.push(new THREE.Color(color)); out[p].owner.push(owner)
    }
    U.forEach((u, i) => {
      const fz = u.z + u.face * u.d / 2 // facade plane
      add('floor', i, u.x, 0.025, u.z, u.w - 0.1, 0.05, u.d - 0.1, '#CFC6B6')
      add('wall', i, u.x, u.h / 2, u.z, u.w, u.h, u.d, u.wall)
      // the painted lower band on the street face (swahili), a plinth elsewhere
      add('band', i, u.x, style.kind === 'swahili' ? DIMS.plinth / 2 : 0.1, fz + u.face * 0.012, u.w + 0.01, style.kind === 'swahili' ? DIMS.plinth : 0.2, 0.03, style.kind === 'tana' ? '#7E5A48' : u.band)
      if (u.shop) {
        add('door', i, u.x, DIMS.shopDoor / 2, fz + u.face * 0.02, u.w * 0.55, DIMS.shopDoor, 0.04, '#2a2622') // open shutter
        add('awning', i, u.x, DIMS.awning, fz + u.face * 0.38, u.w * 0.7, 0.05, 0.8, u.band, u.face * 0.18)
        add('sign', i, u.x, DIMS.awning + 0.25 + (u.storeys - 1) * DIMS.storey, fz + u.face * 0.04, u.w * 0.8, 0.28, 0.04, u.band)
      } else {
        add('door', i, u.x, DIMS.door / 2, fz + u.face * 0.02, DIMS.doorW, DIMS.door, 0.04, u.door)
        add('win', i, u.x + u.w * 0.3, DIMS.windowSill + DIMS.window / 2, fz + u.face * 0.02, 0.5, DIMS.window, 0.04, '#3a3f44')
        for (let b = -1; b <= 1; b++) add('rail', i, u.x + u.w * 0.3 + b * 0.14, DIMS.windowSill + DIMS.window / 2, fz + u.face * 0.045, 0.025, DIMS.window + 0.02, 0.02, '#4a4c50') // window grille
      }
      for (let f = 1; f < u.storeys; f++) add('win', i, u.x, DIMS.windowSill + DIMS.window / 2 + f * DIMS.storey, fz + u.face * 0.02, u.w * 0.5, 0.38, 0.04, '#3a3f44')
      if (style.stoops) add('stoop', i, u.x, 0.1, fz + u.face * STOOP_D / 2, u.w - 0.1, 0.2, STOOP_D, '#B5AEA2')
      if (style.balconies) {
        add('balcony', i, u.x, DIMS.storey, fz + u.face * 0.35, u.w * 0.9, 0.07, 0.7, '#6E4A36')
        add('rail', i, u.x, DIMS.storey + 0.32, fz + u.face * 0.68, u.w * 0.9, 0.05, 0.04, u.band)
        for (let b = -3; b <= 3; b++) add('rail', i, u.x + b * u.w * 0.13, DIMS.storey + 0.16, fz + u.face * 0.68, 0.04, 0.32, 0.04, u.band)
      }
      // tin roof: a slab sloping down toward the street, overhanging the front (a gable in the highlands)
      if (style.kind === 'tana') {
        add('roof', i, u.x, u.h + 0.32, u.z + u.face * u.d * 0.24, u.w + 0.1, 0.08, u.d * 0.62, u.roof, -u.face * 0.42)
        add('roof', i, u.x, u.h + 0.32, u.z - u.face * u.d * 0.24, u.w + 0.1, 0.08, u.d * 0.62, u.roof, u.face * 0.42)
      } else add('roof', i, u.x, u.h + 0.12, u.z + u.face * 0.25, u.w + 0.08, 0.06, u.d + 0.9, u.roof, u.face * (style.kind === 'musseque' ? 0.06 : 0.14))
    })
    return out
  }, [U, style])

  const refs = useRef<Partial<Record<Part, THREE.InstancedMesh | null>>>({})
  useEffect(() => {
    for (const p of Object.keys(parts) as Part[]) {
      const im = refs.current[p]; if (!im) continue
      parts[p].m.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, parts[p].c[i]) })
      im.count = parts[p].m.length
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
    }
  }, [parts])

  // colliders for the camera, and the cutaway: units she is in, or between the camera and her, swap for a proxy
  const boxes = useMemo(() => fabricSolids(fabric), [fabric])
  useEffect(() => { colliders.current = boxes.map(b => ({ box: b.box, lotId: b.id })) }, [boxes, colliders])
  const POOL = 6
  const proxies = useRef<(THREE.Mesh | null)[]>([])
  const proxyMats = useMemo(() => Array.from({ length: POOL }, () => new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonGradient(), transparent: true, opacity: 0.15, depthWrite: false })), [])
  const faded = useRef<Map<number, number>>(new Map()) // unit idx -> opacity
  const ray = useMemo(() => new THREE.Ray(), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  const specialFade = useRef<Map<number, THREE.Material>>(new Map())
  useFrame((_, dt) => {
    const L = live.current
    if (!L) return
    const dist = camera.position.distanceTo(L.head)
    ray.origin.copy(camera.position); ray.direction.copy(L.head).sub(camera.position).normalize()
    const want = new Map<number, number>() // row-house unit index -> target opacity
    const wantSpecial = new Map<number, number>() // public building id -> target opacity
    for (const b of boxes) {
      const inside = insideLot.current === b.id
      const between = !inside && !!ray.intersectBox(b.box, hit) && camera.position.distanceTo(hit) < dist - 0.2
      if (!inside && !between) continue
      if (b.idx >= 0) want.set(b.idx, inside ? 0.1 : 0.18)
      else wantSpecial.set(b.id, inside ? 0.1 : 0.18)
    }
    for (const [id, m] of specialFade.current) {
      const mm = m as THREE.MeshToonMaterial
      mm.opacity += ((wantSpecial.get(id) ?? 1) - mm.opacity) * Math.min(1, dt * 6)
      mm.depthWrite = mm.opacity > 0.95
    }
    // swap units in and out of the cutaway, fading the proxy
    const F = faded.current
    for (const [idx, op] of [...F]) { const target = want.get(idx); const next = op + ((target ?? 1) - op) * Math.min(1, dt * 6); if (target === undefined && next > 0.97) { F.delete(idx); setUnitVisible(idx, true) } else F.set(idx, next) }
    for (const [idx] of want) if (!F.has(idx) && F.size < POOL) { F.set(idx, 0.98); setUnitVisible(idx, false) }
    let k = 0
    for (const [idx, op] of F) {
      const px = proxies.current[k]; if (!px) break
      const u = U[idx]
      px.visible = true; px.position.set(u.x, u.h / 2, u.z); px.scale.set(u.w, u.h, u.d)
      proxyMats[k].color.set(u.wall); proxyMats[k].opacity = op
      k++
    }
    for (; k < POOL; k++) { const px = proxies.current[k]; if (px) px.visible = false }
  })
  const zero = useMemo(() => new THREE.Matrix4().makeScale(0, 0, 0), [])
  function setUnitVisible(idx: number, on: boolean) {
    for (const p of Object.keys(parts) as Part[]) {
      if (p === 'floor') continue // the floor stays: it is what you see inside
      const im = refs.current[p]; if (!im) continue
      const P = parts[p]
      P.owner.forEach((o, i) => { if (o === idx) im.setMatrixAt(i, on ? P.m[i] : zero) })
      im.instanceMatrix.needsUpdate = true
    }
  }

  // wires between consecutive poles along each lane, sagging
  const wires = useMemo(() => {
    const pts: number[] = []
    const byLine = new Map<string, { x: number; z: number }[]>()
    for (const p of fabric.poles) { const k = Math.abs(p.x - Math.round(p.x / (6 * K)) * 6 * K) < 1.3 ? `x${Math.round(p.x)}` : `z${Math.round(p.z)}`; byLine.set(k, [...(byLine.get(k) ?? []), p]) }
    for (const line of byLine.values()) {
      line.sort((a, b) => a.x - b.x || a.z - b.z)
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i]
        for (const off of [0, 0.12]) for (let s = 0; s < 6; s++) {
          const t0 = s / 6, t1 = (s + 1) / 6
          const y = (t: number) => 2.45 - off - Math.sin(Math.PI * t) * 0.35
          pts.push(a.x + (b.x - a.x) * t0, y(t0), a.z + (b.z - a.z) * t0, a.x + (b.x - a.x) * t1, y(t1), a.z + (b.z - a.z) * t1)
        }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [fabric.poles])

  const signUnits = useMemo(() => U.map((u, i) => ({ u, i })).filter(x => x.u.shop), [U])
  const im = (p: Part, mat: THREE.Material, castShadow = true) => (
    <instancedMesh key={p} ref={el => { refs.current[p] = el }} args={[geo.box, mat, Math.max(1, parts[p].m.length)]} castShadow={castShadow} receiveShadow frustumCulled={false} />
  )
  return (
    <group>
      {/* the ground: packed earth everywhere, the lanes in their own surface */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]} receiveShadow><planeGeometry args={[220, 220]} /><meshToonMaterial color={style.groundPatch} gradientMap={toonGradient()} /></mesh>
      {STREETS_W.map(s => (
        <group key={s}>
          <mesh rotation-x={-Math.PI / 2} position={[s, 0.004, 0]} receiveShadow><planeGeometry args={[1 * K + 0.4, 80]} /><meshToonMaterial map={tex.dirt} gradientMap={toonGradient()} onUpdate={m => { (m as THREE.MeshToonMaterial).map!.repeat.set(1, 30) }} /></mesh>
          <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} position={[0, 0.006, s]} receiveShadow><planeGeometry args={[1 * K + 0.4, 80]} /><meshToonMaterial map={tex.dirt} gradientMap={toonGradient()} /></mesh>
        </group>
      ))}
      {im('floor', mats.floor, false)}{im('wall', mats.inst)}{im('band', mats.inst, false)}{im('door', mats.inst, false)}{im('win', mats.glass, false)}
      {im('roof', mats.roof)}{im('stoop', mats.stoop)}{im('awning', mats.inst)}{im('sign', mats.inst, false)}{im('balcony', mats.wood)}{im('rail', mats.inst, false)}
      {Array.from({ length: POOL }, (_, k) => <mesh key={k} ref={el => { proxies.current[k] = el }} geometry={geo.box} material={proxyMats[k]} visible={false} />)}
      {/* painted shop signs (local words, no brands) */}
      {signUnits.map(({ u }) => (
        <Text key={u.id} font={FONT} fontSize={0.17} color="#F4F0E6" anchorX="center" anchorY="middle" position={[u.x - u.w * 0.12, 1.2 + (u.storeys - 1) * 1.15, u.z + u.face * (u.d / 2 + 0.07)]} rotation={[0, u.face > 0 ? 0 : Math.PI, 0]} maxWidth={u.w * 0.75}>{u.shop}</Text>
      ))}
      {/* public buildings: clinic, school, workplaces, with their painted names */}
      {fabric.specials.map(s => (
        <group key={s.id}>
          <mesh position={[s.x, s.h / 2, s.z]} castShadow receiveShadow ref={m => { if (m) specialFade.current.set(s.id, m.material as THREE.Material) }}>
            <boxGeometry args={[s.w, s.h, s.d]} /><meshToonMaterial color={s.wall} gradientMap={toonGradient()} transparent />
          </mesh>
          <mesh position={[s.x, 0.3, s.z + s.d / 2 + 0.01]}><boxGeometry args={[s.w + 0.01, 0.6, 0.02]} /><meshToonMaterial color={s.band} gradientMap={toonGradient()} /></mesh>
          {Array.from({ length: Math.max(1, Math.round((s.h - 0.6) / 1.15)) }, (_, f) => <mesh key={f} position={[s.x, 0.9 + f * 1.15, s.z + s.d / 2 + 0.02]} material={mats.glass}><boxGeometry args={[s.w * 0.7, 0.38, 0.02]} /></mesh>)}
          {s.label && <Text font={FONT} fontSize={0.32} color="#2a2622" position={[s.x, s.h - 0.35, s.z + s.d / 2 + 0.04]} anchorX="center" anchorY="middle" maxWidth={s.w * 0.9}>{s.label}</Text>}
        </group>
      ))}
      {/* poles and wires */}
      {fabric.poles.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh position={[0, 1.3, 0]} material={mats.pole} castShadow><cylinderGeometry args={[0.05, 0.07, 2.6, 6]} /></mesh>
          <mesh position={[0, 2.45, 0]} material={mats.pole}><boxGeometry args={[0.7, 0.05, 0.05]} /></mesh>
        </group>
      ))}
      <lineSegments geometry={wires} material={mats.wire} />
      {/* trees in the yards: neem / mango with round canopies, palms on the coast */}
      {fabric.trees.map((t, i) => t.palm ? (
        <group key={i} position={[t.x, 0, t.z]}>
          <mesh position={[0, 1.6, 0]} material={mats.trunk} castShadow><cylinderGeometry args={[0.06, 0.1, 3.2, 6]} /></mesh>
          {[0, 1, 2, 3, 4, 5].map(k => <mesh key={k} position={[Math.cos(k) * 0.55, 3.15, Math.sin(k) * 0.55]} rotation={[Math.sin(k) * 0.9, 0, -Math.cos(k) * 0.9]} material={mats.leaf} castShadow><boxGeometry args={[0.18, 0.05, 1.3]} /></mesh>)}
        </group>
      ) : (
        <group key={i} position={[t.x, 0, t.z]}>
          <mesh position={[0, 0.9, 0]} material={mats.trunk} castShadow><cylinderGeometry args={[0.1, 0.14, 1.8, 6]} /></mesh>
          <mesh position={[0, 2.1, 0]} material={mats.leaf} castShadow><sphereGeometry args={[t.r, 10, 8]} /></mesh>
          <mesh position={[t.r * 0.5, 2.4, t.r * 0.2]} material={mats.leaf2} castShadow><sphereGeometry args={[t.r * 0.7, 10, 8]} /></mesh>
        </group>
      ))}
      {/* laundry drying in the yards */}
      {fabric.laundry.map((l, i) => (
        <group key={i} position={[l.x, 0, l.z]}>
          {[-l.w / 2, l.w / 2].map(x => <mesh key={x} position={[x, 0.85, 0]} material={mats.wood}><cylinderGeometry args={[0.025, 0.025, 1.7, 5]} /></mesh>)}
          <mesh position={[0, 1.65, 0]} material={mats.dark}><boxGeometry args={[l.w, 0.012, 0.012]} /></mesh>
          {[0, 1, 2, 3, 4].map(k => <mesh key={k} position={[-l.w / 2 + 0.4 + k * 0.6, 1.4, 0]}><boxGeometry args={[0.42, 0.48, 0.015]} /><meshToonMaterial color={['#D9483B', '#F2D16B', '#3E6FA8', '#F4F0E6', '#2F7F6F'][(i + k) % 5]} gradientMap={toonGradient()} /></mesh>)}
        </group>
      ))}
      {/* plastic chairs and yellow jerrycans at the doors */}
      {fabric.chairs.map((c, i) => (
        <group key={i} position={[c.x, 0, c.z]} rotation-y={c.rot}>
          <mesh position={[0, 0.24, 0]}><boxGeometry args={[0.3, 0.04, 0.3]} /><meshToonMaterial color={c.color} gradientMap={toonGradient()} /></mesh>
          <mesh position={[0, 0.42, -0.14]}><boxGeometry args={[0.3, 0.34, 0.03]} /><meshToonMaterial color={c.color} gradientMap={toonGradient()} /></mesh>
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => <mesh key={`${a}${b}`} position={[a * 0.13, 0.11, b * 0.13]}><boxGeometry args={[0.03, 0.22, 0.03]} /><meshToonMaterial color={c.color} gradientMap={toonGradient()} /></mesh>)}
        </group>
      ))}
      {fabric.cans.map((c, i) => <mesh key={i} position={[c.x, 0.13, c.z]} material={mats.can} castShadow><boxGeometry args={[0.2, 0.26, 0.14]} /></mesh>)}
    </group>
  )
}
