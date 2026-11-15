'use client'
// v4 city view: a small clay diorama of one city in the governing agent's architecture. homes, the
// workplaces its people actually work at, a market, a park, a school, a clinic, a square, a shrine if
// anyone prays. its own camera (a short dive on arrival) and a sun that follows the city's local hour.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Agent, ArchStyle, Frame } from '@/lib/types'
import { archStyleFor } from '@/lib/mock/v3'
import { C, sceneRefs, toonGradient } from '../lib'
import { localHour, utcHourOf, worldDate } from '../time'
import { useStore } from '../../state/store'
import { buildLayout, STREETS, type Lot, type LotKind } from './layout'
import CityPips, { GROUND_Y, crowdSize, residentsOf } from './CityPips'

const FROM = new THREE.Vector3(0, 72, 0.1)
const TO = new THREE.Vector3(21, 19, 25)
const toon = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() })
const LOT_WORDS: Record<LotKind, string> = {
  home: 'a home', market: 'the market', park: 'the park', square: 'the square', shrine: 'the shrine', farm: 'the fields', factory: 'the factory',
  office: 'the office', lab: 'the lab', clinic: 'the clinic', school: 'the school', launch_site: 'the launch site', construction: 'the building site', power_plant: 'the power plant',
}

// unit buildings in the agent's style: footprint 1, height 1, base at y 0
function styleGeos(style: ArchStyle) {
  const tf = (g: THREE.BufferGeometry, y: number) => { g.translate(0, y, 0); return g }
  const box = (w: number, h: number, y: number) => tf(new THREE.BoxGeometry(w, h, w), y + h / 2)
  const cyl = (r: number, h: number, y: number) => tf(new THREE.CylinderGeometry(r, r, h, 12), y + h / 2)
  const dome = (r: number, y: number, sy = 1) => { const g = new THREE.SphereGeometry(r, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, sy, 1); return tf(g, y) }
  let parts: THREE.BufferGeometry[]
  let flat = true
  switch (style.towerShape) {
    case 'stepped': parts = [box(1, 0.6, 0), box(0.72, 0.28, 0.6), box(0.46, 0.12, 0.88)]; break
    case 'rounded': parts = [cyl(0.5, 0.86, 0), dome(0.5, 0.86, 0.3)]; flat = false; break
    case 'spire': parts = [box(1, 0.8, 0), (() => { const g = new THREE.ConeGeometry(0.5, 0.45, 4); g.rotateY(Math.PI / 4); return tf(g, 1.02) })()]; flat = false; break
    case 'stacked': parts = [box(1, 0.42, 0), box(0.82, 0.32, 0.42), box(0.62, 0.26, 0.74)]; break
    case 'dome': default: parts = [cyl(0.5, 0.5, 0), dome(0.5, 0.5, 0.8)]; flat = false; break
  }
  const body = mergeAll(parts)
  let roof: THREE.BufferGeometry | null = null
  if (flat && style.roofStyle === 'peaked') { const g = new THREE.CylinderGeometry(0, 0.42, 0.24, 4); g.rotateY(Math.PI / 4); roof = tf(g, 1.12) }
  if (flat && style.roofStyle === 'garden') roof = tf(new THREE.BoxGeometry(0.5, 0.06, 0.5), 1.03)
  const accent = tf(new THREE.BoxGeometry(1.04, 0.08, 1.04), 0.45)
  return { body, roof, accent }
}

function mergeAll(parts: THREE.BufferGeometry[]) {
  const ps = parts.map((p) => (p.index ? p.toNonIndexed() : p))
  const len = ps.reduce((a, p) => a + p.attributes.position.array.length, 0)
  const pos = new Float32Array(len), nor = new Float32Array(len)
  let o = 0
  for (const p of ps) { pos.set(p.attributes.position.array as Float32Array, o); nor.set(p.attributes.normal.array as Float32Array, o); o += p.attributes.position.array.length }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return g
}

type Item = { p: [number, number, number]; s?: [number, number, number]; r?: number; c?: string; lot?: number }

// static instanced props: placed once
function Instances({ geo, mat, items, shadow = true, onPick }: { geo: THREE.BufferGeometry; mat: THREE.Material; items: Item[]; shadow?: boolean; onPick?: (i: number, e: ThreeEvent<PointerEvent | MouseEvent>, kind: 'over' | 'move' | 'out' | 'click') => void }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color()
    items.forEach((it, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.r ?? 0)
      m.setMatrixAt(i, mtx.compose(new THREE.Vector3(...it.p), q, new THREE.Vector3(...(it.s ?? [1, 1, 1]))))
      if (it.c) m.setColorAt(i, col.set(it.c))
    })
    m.count = items.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [items])
  if (!items.length) return null
  const ev = onPick ? {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); if (e.instanceId != null) onPick(e.instanceId, e, 'over') },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => { if (e.instanceId != null) onPick(e.instanceId, e, 'move') },
    onPointerOut: (e: ThreeEvent<PointerEvent>) => onPick(-1, e, 'out'),
  } : { raycast: () => null }
  return <instancedMesh ref={ref} args={[geo, mat, items.length]} castShadow={shadow} receiveShadow {...ev} />
}

export default function CityView({ cityId, frame, agent }: { cityId: string; frame: Frame; agent?: Agent }) {
  const recordAgent = useStore((s) => s.record.agentId)
  const city = frame.cities.find((c) => c.id === cityId) ?? frame.cities.find((c) => !c.offWorld)
  const style = agent?.archStyle ?? archStyleFor(agent?.id ?? recordAgent)
  const region = city ? frame.regions.find((r) => r.id === city.regionId) : undefined
  const residents = useMemo(() => (city ? residentsOf(frame, city) : []), [frame, city])
  const total = city ? crowdSize(city, residents.length) : 0
  const shortFood = !!region && (region.foodKcalPerCapita < 2100 || region.visual?.damage.kind === 'famine')
  const tram = (region?.visual?.railLinks.length ?? 0) > 0
  const layout = useMemo(() => buildLayout(
    cityId, residents.map((c) => c.workplace ?? 'none'), Math.ceil(total / 3), residents.some((c) => c.belief === 'religious'), tram,
  ), [cityId, residents, total, tram])

  // ---- camera: dive in, then orbit the diorama ----
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const controls = useRef<OrbitControlsImpl>(null)
  const t0 = useRef<number | null>(null)
  useEffect(() => { camera.position.copy(FROM); camera.lookAt(0, 0, 0); t0.current = null }, [camera, cityId])

  // ---- the sun follows local time; the globe's key light is borrowed while we are here ----
  const sun = useRef<THREE.DirectionalLight | null>(null)
  useEffect(() => {
    let found: THREE.DirectionalLight | null = null
    scene.traverse((o) => { if (!found && (o as THREE.DirectionalLight).isDirectionalLight && o.castShadow) found = o as THREE.DirectionalLight })
    sun.current = found
    const light = found as THREE.DirectionalLight | null
    const orig = light ? { i: light.intensity, c: light.color.clone() } : null
    return () => { if (light && orig) { light.intensity = orig.i; light.color.copy(orig.c) } }
  }, [scene])

  // ---- windows: lit by who is inside and the hour ----
  const windowRef = useRef<THREE.InstancedMesh>(null)
  const occ = useRef(new Map<number, { inside: number; awake: number }>())
  const built = useMemo(() => layout.lots.filter((l) => ['home', 'school', 'clinic', 'office', 'lab', 'factory', 'shrine', 'power_plant'].includes(l.kind)), [layout])

  useFrame(({ clock }) => {
    // dive
    if (t0.current === null) t0.current = clock.elapsedTime
    const k = Math.min(1, (clock.elapsedTime - t0.current) / 1.2)
    const c = controls.current
    if (k < 1) {
      const e = 1 - Math.pow(1 - k, 3)
      camera.position.lerpVectors(FROM, TO, e)
      camera.lookAt(0, 0, 0)
      if (c) { c.enabled = false; c.target.set(0, 0, 0) }
    } else if (c && !c.enabled) { c.enabled = true; c.update() }
    // the globe's shadow box should sit on the diorama
    sceneRefs.camDist = 60
    sceneRefs.focus.set(0, 0, 0)
    if (!city) return
    const st = useStore.getState()
    const lh = localHour(utcHourOf(worldDate(st.playhead, st.hour, st.playing)), city.lon)
    const L = sun.current
    if (L) {
      const ang = ((lh - 6) / 12) * Math.PI
      const up = Math.sin(ang)
      const day = Math.max(0, Math.min(1, (up + 0.08) / 0.35))
      const dir = up > -0.05 ? new THREE.Vector3(Math.cos(ang), Math.max(0.08, up), 0.35).normalize() : new THREE.Vector3(-0.3, 1, 0.25).normalize()
      L.position.copy(dir).multiplyScalar(30)
      L.target.position.set(0, 0, 0)
      L.target.updateMatrixWorld()
      L.intensity = 0.22 + 1.9 * day
      L.color.set(day > 0.6 ? '#FFF4E2' : day > 0.05 ? '#FFC79A' : '#9DB0D8')
    }
    // windows
    const w = windowRef.current
    if (w) {
      const col = new THREE.Color()
      built.forEach((lot, i) => {
        const o = occ.current.get(lot.id)
        const evening = lh >= 17 || lh < 7
        const lit = lot.kind === 'home' ? !!o && o.awake > 0 && evening : !!o && o.inside > 0 && lh >= 7 && lh < 20
        w.setColorAt(i, lit ? col.set('#FFD58A').multiplyScalar(evening ? 1.8 : 1.1) : col.set('#40454E'))
      })
      if (w.instanceColor) w.instanceColor.needsUpdate = true
    }
  })

  // ---- static scene ----
  const geos = useMemo(() => ({
    plate: new RoundedBoxGeometry(33, 0.6, 33, 3, 0.45),
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
    ball: new THREE.SphereGeometry(0.5, 10, 8),
    cone: new THREE.ConeGeometry(0.5, 1, 10),
    tower: (() => { const pts: THREE.Vector2[] = []; for (let i = 0; i <= 8; i++) { const y = i / 8; pts.push(new THREE.Vector2(0.38 + 0.22 * Math.pow((y - 0.62) / 0.62, 2), y)) } return new THREE.LatheGeometry(pts, 14) })(),
    ...styleGeos(style),
  }), [style])
  const mats = useMemo(() => ({
    plate: toon('#CFC4AE'), street: toon('#B3ACA0'), pad: toon('#E3D9C6'), body: toon('#ffffff'), accent: toon(style.accent), roof: toon(style.roofStyle === 'garden' ? '#7FA866' : '#B9725A'),
    win: new THREE.MeshBasicMaterial({ toneMapped: false }), soil: toon('#A88B5E'), crop: toon('#ffffff'), grass: toon('#8DB37A'), trunk: toon('#7A5A3E'), leaf: toon('#5E8F57'),
    stone: toon('#D9CFBD'), water: toon('#7FB2C9'), steel: toon('#9A9DA3'), awning: toon('#ffffff'), goods: toon('#ffffff'), teal: toon('#3E9C93'), ink: toon(C.ink), bone: toon(C.bone),
  }), [style])

  const scene3 = useMemo(() => {
    const it = {
      streets: [] as Item[], pads: [] as Item[], bodies: [] as Item[], roofs: [] as Item[], accents: [] as Item[], windows: [] as Item[],
      soil: [] as Item[], crops: [] as Item[], grass: [] as Item[], trunks: [] as Item[], leaves: [] as Item[], stone: [] as Item[], water: [] as Item[],
      steel: [] as Item[], stalls: [] as Item[], awnings: [] as Item[], goods: [] as Item[], teal: [] as Item[], towers: [] as Item[], cones: [] as Item[], ink: [] as Item[], bone: [] as Item[],
    }
    for (const sx of STREETS) {
      it.streets.push({ p: [sx, 0.09, 0], s: [1.05, 0.18, 31] })
      it.streets.push({ p: [0, 0.09, sx], s: [31, 0.18, 1.05] })
    }
    const H = GROUND_Y - 0.02
    const facing = (l: Lot) => (l.door.z > l.z ? 1 : -1)
    for (const l of layout.lots) {
      const pad = (mat: keyof typeof it, color?: string) => it[mat].push({ p: [l.x, H / 2, l.z], s: [l.w, H, l.d], c: color })
      const building = (w: number, d: number, h: number, color: string) => {
        it.bodies.push({ p: [l.x, H, l.z], s: [w, h, d], c: color, lot: l.id })
        if (geos.roof) it.roofs.push({ p: [l.x, H, l.z], s: [w, h, d] })
        it.accents.push({ p: [l.x, H, l.z], s: [w, h * 0.9, d] })
        it.windows.push({ p: [l.x, H + h * 0.55, l.z + facing(l) * (d * 0.51)], s: [w * 0.62, Math.min(0.5, h * 0.18), 0.06], lot: l.id })
      }
      switch (l.kind) {
        case 'home': pad('pads'); building(l.w * 0.82, l.d * 0.82, 1.2 + l.floors * 0.75, (l.id * 37) % 3 ? '#EFE6D6' : '#E6D7C2'); break
        case 'school': pad('grass'); building(l.w * 0.8, l.d * 0.7, 2.6, '#F1E3C8'); it.steel.push({ p: [l.x + l.w * 0.42, H + 1.6, l.z + l.d * 0.4], s: [0.08, 3.2, 0.08] }); it.teal.push({ p: [l.x + l.w * 0.42 + 0.35, H + 2.9, l.z + l.d * 0.4], s: [0.6, 0.38, 0.04] }); break
        case 'clinic': pad('pads'); building(l.w * 0.85, l.d * 0.85, 2.8, '#F4F1EA'); for (const [w2, h2] of [[0.9, 0.28], [0.28, 0.9]]) it.teal.push({ p: [l.x, H + 2.2, l.z + facing(l) * (l.d * 0.44)], s: [w2, h2, 0.08] }); break
        case 'office': pad('pads'); building(l.w * 0.75, l.d * 0.75, 6.2, '#E9E4DA'); break
        case 'lab': pad('pads'); building(l.w * 0.8, l.d * 0.7, 3.4, '#ECEFF0'); it.bone.push({ p: [l.x - l.w * 0.2, H + 3.6, l.z], s: [1.4, 0.8, 1.4] }); break
        case 'factory': {
          pad('pads'); building(l.w * 0.85, l.d * 0.6, 2.4, '#C9B9A4')
          for (const ox of [-0.25, 0.25]) it.steel.push({ p: [l.x + l.w * ox, H + 2.6, l.z - l.d * 0.2], s: [0.45, 5.2, 0.45] })
          for (let k = 0; k < 3; k++) it.steel.push({ p: [l.x - 1.2 + k * 1.2, H + 0.35, l.door.z - facing(l) * 0.9], s: [0.7, 0.7, 0.55] })
          break
        }
        case 'power_plant': pad('pads'); it.towers.push({ p: [l.x - 0.6, H, l.z], s: [3, 4.2, 3] }); building(1.6, 1.6, 1.6, '#D7D2C8'); break
        case 'launch_site': pad('stone'); it.stone.push({ p: [l.x, H + 0.15, l.z], s: [2.6, 0.3, 2.6] }); it.bone.push({ p: [l.x, H + 2.1, l.z], s: [0.7, 3.6, 0.7] }); it.cones.push({ p: [l.x, H + 4.3, l.z], s: [0.7, 0.9, 0.7] }); it.steel.push({ p: [l.x + 1, H + 2.2, l.z], s: [0.25, 4.4, 0.25] }); break
        case 'construction': {
          pad('soil')
          for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) it.steel.push({ p: [l.x + ox, H + 1.4, l.z + oz], s: [0.12, 2.8, 0.12] })
          for (const y of [1.4, 2.8]) it.steel.push({ p: [l.x, H + y, l.z], s: [2.1, 0.1, 2.1] })
          it.steel.push({ p: [l.x + 1.8, H + 3, l.z - 1.6], s: [0.25, 6, 0.25] }); it.steel.push({ p: [l.x + 0.4, H + 5.9, l.z - 1.6], s: [3, 0.2, 0.2] })
          break
        }
        case 'farm': pad('soil'); for (let r2 = 0; r2 < 5; r2++) it.crops.push({ p: [l.x, H + 0.15, l.z - 1.8 + r2 * 0.9], s: [l.w * 0.86, 0.3, 0.3], c: shortFood ? '#9C8A5E' : r2 % 2 ? '#8FB560' : '#C9B154' }); break
        case 'park': {
          pad('grass')
          for (const [ox, oz] of [[-1.4, -1.3], [1.5, -0.9], [-0.6, 1.4], [1.2, 1.5], [0.2, -0.2]]) { it.trunks.push({ p: [l.x + ox, H + 0.45, l.z + oz], s: [0.22, 0.9, 0.22] }); it.leaves.push({ p: [l.x + ox, H + 1.3, l.z + oz], s: [1.3, 1.2, 1.3] }) }
          break
        }
        case 'square': pad('stone'); it.water.push({ p: [l.x, H + 0.25, l.z], s: [1.6, 0.5, 1.6] }); it.stone.push({ p: [l.x, H + 0.6, l.z], s: [0.35, 1.2, 0.35] }); break
        case 'market': {
          pad('pads')
          for (let k = 0; k < 6; k++) {
            const x = l.x - 1.6 + (k % 3) * 1.6, z = l.z - 1 + Math.floor(k / 3) * 2
            it.stalls.push({ p: [x, H + 0.4, z], s: [1.2, 0.8, 0.7], c: '#C9A27A' })
            it.awnings.push({ p: [x, H + 1.45, z], s: [1.35, 0.12, 0.95], c: k % 2 ? style.accent : '#EFE8DA' })
            if (!shortFood) for (let g2 = 0; g2 < 3; g2++) it.goods.push({ p: [x - 0.35 + g2 * 0.35, H + 0.92, z], s: [0.24, 0.22, 0.24], c: ['#D9763F', '#9CC25E', '#E8C547'][g2] })
          }
          break
        }
        case 'shrine': pad('stone'); building(1.6, 1.6, 1.1, '#E8DCC8'); it.bone.push({ p: [l.x, H + 1.5, l.z], s: [1.1, 0.9, 1.1] }); break
      }
    }
    if (layout.tramZ !== null) for (const dz of [-0.22, 0.22]) it.ink.push({ p: [0, 0.2, layout.tramZ + dz], s: [31, 0.05, 0.06] })
    return it
  }, [layout, geos.roof, shortFood, style.accent])

  // ---- hover a building: what it is, who is inside ----
  const onBody = (i: number, e: ThreeEvent<PointerEvent | MouseEvent>, kind: 'over' | 'move' | 'out' | 'click') => {
    if (kind === 'out' || i < 0) { useStore.getState().setTip(null); return }
    const lot = layout.lots[scene3.bodies[i]?.lot ?? -1]
    if (!lot) return
    const n = occ.current.get(lot.id)?.inside ?? 0
    const pe = e.nativeEvent as PointerEvent
    useStore.getState().setTip({ title: LOT_WORDS[lot.kind], text: n ? `${n} ${n === 1 ? 'person' : 'people'} inside` : 'empty right now', x: pe.clientX, y: pe.clientY })
  }

  // window strips sit on each building's street face; their colors change every frame above
  useLayoutEffect(() => {
    const m = windowRef.current
    if (!m) return
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion()
    scene3.windows.forEach((w, i) => m.setMatrixAt(i, mtx.compose(new THREE.Vector3(...w.p), q, new THREE.Vector3(...(w.s ?? [1, 1, 1])))))
    m.count = scene3.windows.length
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [scene3])

  // a little tram running the main street
  const tramRef = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => { if (tramRef.current) tramRef.current.position.x = Math.sin(clock.elapsedTime * 0.22) * 13 })

  if (!city) return null
  return (
    <group>
      <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping dampingFactor={0.08} minDistance={9} maxDistance={70} maxPolarAngle={1.22} target={[0, 0, 0]} />
      <mesh geometry={geos.plate} material={mats.plate} position={[0, -0.3, 0]} receiveShadow />
      <Instances geo={geos.box} mat={mats.street} items={scene3.streets} shadow={false} />
      <Instances geo={geos.box} mat={mats.pad} items={scene3.pads} shadow={false} />
      <Instances geo={geos.box} mat={mats.soil} items={scene3.soil} shadow={false} />
      <Instances geo={geos.box} mat={mats.grass} items={scene3.grass} shadow={false} />
      <Instances geo={geos.box} mat={mats.stone} items={scene3.stone} />
      <Instances geo={geos.body} mat={mats.body} items={scene3.bodies} onPick={onBody} />
      {geos.roof && <Instances geo={geos.roof} mat={mats.roof} items={scene3.roofs} />}
      <Instances geo={geos.accent} mat={mats.accent} items={scene3.accents} shadow={false} />
      <instancedMesh key={built.length} ref={windowRef} args={[geos.box, mats.win, Math.max(1, built.length)]} raycast={() => null} />
      <Instances geo={geos.box} mat={mats.crop} items={scene3.crops} />
      <Instances geo={geos.cyl} mat={mats.trunk} items={scene3.trunks} />
      <Instances geo={geos.ball} mat={mats.leaf} items={scene3.leaves} />
      <Instances geo={geos.cyl} mat={mats.water} items={scene3.water} shadow={false} />
      <Instances geo={geos.box} mat={mats.steel} items={scene3.steel} />
      <Instances geo={geos.box} mat={mats.crop} items={scene3.stalls} />
      <Instances geo={geos.box} mat={mats.awning} items={scene3.awnings} />
      <Instances geo={geos.box} mat={mats.goods} items={scene3.goods} />
      <Instances geo={geos.box} mat={mats.teal} items={scene3.teal} />
      <Instances geo={geos.tower} mat={mats.bone} items={scene3.towers} />
      <Instances geo={geos.cone} mat={mats.bone} items={scene3.cones} />
      <Instances geo={geos.cyl} mat={mats.bone} items={scene3.bone} />
      <Instances geo={geos.box} mat={mats.ink} items={scene3.ink} shadow={false} />
      {layout.tramZ !== null && (
        <mesh ref={tramRef} position={[0, 0.75, layout.tramZ]} castShadow material={mats.accent}>
          <boxGeometry args={[2.6, 1.1, 0.9]} />
        </mesh>
      )}
      <CityPips city={city} frame={frame} layout={layout} onLot={(o) => { occ.current = o }} />
    </group>
  )
}
