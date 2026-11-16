'use client'
// the city view: one real city at street level, at real scale (grid.ts: 1 unit = 3.1 m). the plate is its core,
// laid out around the places its people actually go (homes, workplaces, the market, a park, a school, a clinic, the
// square, a shrine if anyone prays), in the region's look (looks.ts: colors sampled from street photos). around it,
// the real city continues into the fog (fabricBuild.ts) with its housing: towers, informal homes, camps, building
// sites. people (pipSim) and traffic (trafficSim) follow the ragdoll rules in CLAUDE.md. the government's own
// buildings (school, clinic, office, lab) carry the governing agent's accent color. night comes from the city's
// local hour: windows, shop signs, street lights and headlights come on.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Agent, City, Frame } from '@/lib/types'
import { archStyleFor } from '@/lib/mock/v3'
import { frameDate } from '@/lib/sim/replay-pure'
import { C, sceneRefs } from '../lib'
import { localHour, utcHourOf, worldDate } from '../time'
import { useStore } from '../../state/store'
import { usePlaceYear } from '../../state/usePlaces'
import { buildGrid, BENCH_LEN, COUNTER, DOOR_H, DOOR_W, FLOOR, GROUND_Y, SEAT, m, type Box, type Lot, type LotKind } from './grid'
import { buildFabric, markHeight, roofAt, SUR } from './fabricBuild'
import Fabric, { Inst, prismGeo, toon, wallMaterial } from './Fabric'
import CityPips, { residentsOf } from './CityPips'
import Traffic from './Traffic'
import { crowdSize, sceneOf } from './pipSim'
import { LEFT_HAND, makeTraffic } from './trafficSim'
import { bareTrees, lookFor } from './looks'
import { cityFromRow, useCityProfile, type CityProfile } from './realCity'

const FROM = new THREE.Vector3(0, 110, 0.1)
// the dive ends low over the street, close enough to see the people, from a side with a clear view of the square
// (orbit out for the whole city)
const TO = new THREE.Vector3(9, 7, 11)
function clearView(): THREE.Vector3 {
  for (const h of [7, 9, 12, 16]) for (let a = 0; a < 12; a++) for (const d of [14, 18]) {
    const ang = 0.7 + (a * Math.PI) / 6
    const p = new THREE.Vector3(Math.sin(ang) * d, h, Math.cos(ang) * d)
    if (roofAt(p.x, p.z) > p.y - 1.5) continue
    // the line from there to the middle of the square stays above every roof under it
    let ok = true
    for (let t = 0.05; t < 0.95 && ok; t += 0.05) { const q = p.clone().multiplyScalar(1 - t); if (roofAt(q.x, q.z) > q.y - 0.3) ok = false }
    if (ok) return p
  }
  return new THREE.Vector3(10, 30, 12)
}
const LOT_WORDS: Record<LotKind, string> = {
  home: 'a home', market: 'the market', park: 'the park', square: 'the square', shrine: 'the shrine', farm: 'the fields', factory: 'the factory',
  office: 'the office', lab: 'the lab', clinic: 'the clinic', school: 'the school', launch_site: 'the launch site', construction: 'the building site', power_plant: 'the power plant',
}
type Item = { p: [number, number, number]; s: [number, number, number]; c?: string; ry?: number; shop?: number }

export default function CityView({ cityId, frame, agent }: { cityId: string; frame: Frame; agent?: Agent }) {
  const recordAgent = useStore((s) => s.record.agentId)
  const runId = useStore((s) => s.record.runId)
  // a city the sim founded, or a real one from the city index
  const simCity = frame.cities.find((c) => c.id === cityId) ?? null
  const real = useCityProfile(simCity ? null : cityId)
  const city: City | null = simCity ?? (real ? cityFromRow(real.row, frame) : null)
  const profile: CityProfile | null = real ?? (simCity ? { row: { id: simCity.id, name: simCity.name, lat: simCity.lat, lon: simCity.lon, pop: simCity.population, country: simCity.countryId ?? '', group: 'other', n: 0 }, cells: [], core: { heightM: 9, built: 0.4, popC: 4 }, seed: null } : null)
  if (!city || !profile) return null
  return <CityScene key={city.id} city={city} profile={profile} frame={frame} accent={(agent?.archStyle ?? archStyleFor(agent?.id ?? recordAgent)).accent} runId={runId} />
}

function CityScene({ city, profile, frame, accent, runId }: { city: City; profile: CityProfile; frame: Frame; accent: string; runId: string }) {
  const look = useMemo(() => lookFor(profile.row.country || undefined, profile.row.group, city.lat, city.lon), [profile.row.country, profile.row.group, city.lat, city.lon])
  const residentsNow = residentsOf(frame, city)
  const resKey = residentsNow.map((c) => `${c.id}:${c.workplace ?? ''}:${c.belief}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const residents = useMemo(() => residentsNow, [resKey])
  const total = crowdSize(city.population, profile.core.popC)
  const leftHand = LEFT_HAND.has(profile.row.country)
  const month = frameDate(frame.tick).getUTCMonth()
  const homeFloors = Math.max(1, Math.min(6, Math.round((profile.core.heightM / 3.2) * 0.8)))
  const tram = (frame.regions.find((r) => r.id === city.regionId)?.visual?.railLinks.length ?? 0) > 0
  const grid = useMemo(() => buildGrid(city.id, residents.map((c) => c.workplace ?? 'none'), Math.ceil(total / 3), residents.some((c) => c.belief === 'religious'), tram, homeFloors), [city.id, residents, total, tram, homeFloors])

  // housing: the country's 2026 urban slum share (UN-Habitat, B's seed), moved toward the share of this city's own
  // people living informally once there are enough of them to say; a camp where the country has large camps
  const homes = residents.map((c) => (c as { home?: string }).home).filter(Boolean)
  const seedInf = profile.seed?.slumUrbanShare ?? 0
  const informal = homes.length >= 4 ? seedInf + (homes.filter((h) => h === 'informal').length / homes.length - seedInf) * Math.min(1, homes.length / 12) : seedInf
  const camp = (profile.seed?.campResidents ?? 0) > 150000 || homes.includes('camp')
  // building sites where the city is growing (B's places file: population over the last years)
  const place = usePlaceYear(runId, frame.tick, 'city', city.id)
  const hist = place?.history ?? []
  const growing = hist.length >= 2 ? hist[hist.length - 1].stats.population > hist[0].stats.population * 1.01 : true
  const bare = bareTrees(look, city.lat, month)
  // built once we know whether the city is growing (so nothing appears or vanishes after it has grown in)
  const ready = place !== undefined
  const built = useMemo(() => (ready ? buildFabric({ profile, look, grid, informal, camp, growing, bare, leftHand }) : null), [ready, profile, look, grid, informal, camp, growing, bare, leftHand])
  const scene = useMemo(() => (built ? sceneOf(grid, built.posts, built.boxes) : null), [grid, built])
  const traffic = useMemo(() => makeTraffic(city.id, look, leftHand, grid.tramZ), [city.id, look, leftHand, grid.tramZ])

  // ---- the hour, and night, from the city's own clock ----
  const lhRef = useRef(12)
  const nightRef = useRef(0)
  const night = () => nightRef.current
  // windows lit: most in the evening, few deep at night; shop fronts lit while open after dark
  const litShare = () => { const h = lhRef.current; return h >= 17 && h < 23 ? 0.6 : h >= 23 || h < 1 ? 0.35 : h < 5 ? 0.08 : h < 7 ? 0.25 : 0.3 }
  const shopLit = () => { const h = lhRef.current; return h >= 7 && h < 21 ? Math.max(0.25, nightRef.current) : 0 }

  // ---- camera: a dive on arrival, then orbit, never inside a building ----
  const camera = useThree((s) => s.camera)
  const three = useThree((s) => s.scene)
  const controls = useRef<OrbitControlsImpl>(null)
  const t0 = useRef<number | null>(null)
  const to = useRef(TO.clone())
  const viewReady = useRef(false)
  useEffect(() => { camera.position.copy(FROM); camera.lookAt(0, 0, 0); t0.current = null }, [camera])

  // the globe's key light is borrowed as the sun while we're here; fog hides the far edge of the city
  const sun = useRef<THREE.DirectionalLight | null>(null)
  useEffect(() => {
    let found: THREE.DirectionalLight | null = null
    three.traverse((o) => { if (!found && (o as THREE.DirectionalLight).isDirectionalLight && o.castShadow) found = o as THREE.DirectionalLight })
    sun.current = found
    const light = found as THREE.DirectionalLight | null
    const orig = light ? { i: light.intensity, c: light.color.clone() } : null
    const fog = new THREE.Fog('#D4CCC6', 55, SUR + 40)
    three.fog = fog
    return () => {
      if (light && orig) { light.intensity = orig.i; light.color.copy(orig.c) }
      three.fog = null
      sceneRefs.nightOverride = null
    }
  }, [three])

  useFrame(({ clock }) => {
    // the dive starts once the city is built and a clear view chosen
    if (t0.current === null || !viewReady.current) t0.current = clock.elapsedTime
    const k = Math.min(1, (clock.elapsedTime - t0.current) / 1.4)
    const c = controls.current
    if (k < 1) {
      const e = 1 - Math.pow(1 - k, 3)
      camera.position.lerpVectors(FROM, to.current, e)
      camera.lookAt(0, 0, 0)
      if (c) { c.enabled = false; c.target.set(0, 0, 0) }
    } else if (c && !c.enabled) { c.enabled = true; c.update() }
    // never inside or under a building: stay a little above the tallest roof below
    const top = roofAt(camera.position.x, camera.position.z)
    if (camera.position.y < top + 1.2) camera.position.y = top + 1.2
    sceneRefs.camDist = 90
    sceneRefs.focus.set(0, 0, 0)
    const st = useStore.getState()
    const lh = localHour(utcHourOf(worldDate(st.playhead, st.hour, st.playing)), city.lon)
    lhRef.current = lh
    const ang = ((lh - 6) / 12) * Math.PI
    const up = Math.sin(ang)
    const day = Math.max(0, Math.min(1, (up + 0.08) / 0.35))
    nightRef.current = 1 - day
    sceneRefs.nightOverride = 1 - day
    const L = sun.current
    if (L) {
      const dir = up > -0.05 ? new THREE.Vector3(Math.cos(ang), Math.max(0.08, up), 0.35).normalize() : new THREE.Vector3(-0.3, 1, 0.25).normalize()
      L.position.copy(dir).multiplyScalar(60)
      L.target.position.set(0, 0, 0)
      L.target.updateMatrixWorld()
      L.intensity = 0.18 + 1.9 * day
      L.color.set(day > 0.6 ? '#FFF4E2' : day > 0.05 ? '#FFC79A' : '#9DB0D8')
    }
    if (three.fog) (three.fog as THREE.Fog).color.set('#D4CCC6').lerp(new THREE.Color('#1A2036'), 1 - day)
  })

  // ---- the lots: buildings, doors, yards, and what's in them ----
  const occ = useRef(new Map<number, { inside: number; awake: number }>())
  const shortFood = (frame.regions.find((r) => r.id === city.regionId)?.foodKcalPerCapita ?? 2500) < 2100
  const lots = useMemo(() => lotItems(grid.lots, look, accent, shortFood), [grid, look, accent, shortFood])
  useEffect(() => {
    if (!built) return
    for (const it of [...lots.bodies, ...lots.cyls, ...lots.towers]) markHeight(it.p[0], it.p[2], it.s[0], it.s[2], it.p[1] + it.s[1])
    to.current = clearView()
    viewReady.current = true
  }, [built, lots])
  const u = useMemo(() => ({ uNight: { value: 0 }, uLit: { value: 0 }, uShop: { value: 0 } }), [])
  const mats = useMemo(() => ({
    wall: wallMaterial(u, GROUND_Y), plain: toon(), door: toon('#3A3532'), water: toon('#7FB2C9'), steel: toon('#8E9196'), ink: toon(C.ink),
  }), [u])
  useFrame(() => { u.uNight.value = nightRef.current; u.uLit.value = litShare(); u.uShop.value = shopLit() })
  const geos = useMemo(() => {
    const unit = new THREE.BoxGeometry(1, 1, 1); unit.translate(0, 0.5, 0)
    return { box: unit, plain: new THREE.BoxGeometry(1, 1, 1), prism: prismGeo(), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14), crown: new THREE.IcosahedronGeometry(0.5, 1), cone: new THREE.ConeGeometry(0.5, 1, 12), tower: (() => { const pts: THREE.Vector2[] = []; for (let i = 0; i <= 8; i++) { const y = i / 8; pts.push(new THREE.Vector2(0.38 + 0.22 * Math.pow((y - 0.62) / 0.62, 2), y)) } return new THREE.LatheGeometry(pts, 16) })() }
  }, [])
  const onBody = (i: number, e: ThreeEvent<PointerEvent>, kind: 'over' | 'move' | 'out') => {
    if (kind === 'out' || i < 0) { useStore.getState().setTip(null); return }
    const lot = grid.lots[lots.bodyLot[i] ?? -1]
    if (!lot) return
    const n = occ.current.get(lot.id)?.inside ?? 0
    useStore.getState().setTip({ title: LOT_WORDS[lot.kind], text: n ? `${n} ${n === 1 ? 'person' : 'people'} inside` : 'nobody inside right now', x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
  }

  return (
    <group>
      <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping dampingFactor={0.08} minDistance={5} maxDistance={110} maxPolarAngle={1.32} target={[0, 0, 0]} />
      {built && <Fabric built={built} look={look} groundY={GROUND_Y} night={night} litShare={litShare} shopLit={shopLit} />}
      <Inst geo={geos.plain} mat={mats.plain} items={lots.pads} />
      <BodyInst geo={geos.box} mat={mats.wall} items={lots.bodies} onPick={onBody} />
      <Inst geo={geos.plain} mat={mats.plain} items={lots.flat} />
      <Inst geo={geos.prism} mat={mats.plain} items={lots.prism} shadow />
      <Inst geo={geos.plain} mat={mats.door} items={lots.doors} receive={false} />
      <Inst geo={geos.plain} mat={mats.plain} items={lots.parts} shadow />
      <Inst geo={geos.cyl} mat={mats.plain} items={lots.cyls} shadow />
      <Inst geo={geos.crown} mat={mats.plain} items={lots.crowns} shadow />
      <Inst geo={geos.cone} mat={mats.plain} items={lots.cones} shadow />
      <Inst geo={geos.tower} mat={mats.plain} items={lots.towers} shadow />
      <Inst geo={geos.cyl} mat={mats.water} items={lots.water} />
      <Traffic traffic={traffic} night={night} />
      {scene && <CityPips city={city} frame={frame} grid={grid} scene={scene} traffic={traffic} night={night} density={profile.core.popC} onLot={(o) => { occ.current = o }} />}
    </group>
  )
}

function BodyInst({ geo, mat, items, onPick }: { geo: THREE.BufferGeometry; mat: THREE.Material; items: Item[]; onPick: (i: number, e: ThreeEvent<PointerEvent>, kind: 'over' | 'move' | 'out') => void }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color()
    const shop = new Float32Array(Math.max(1, items.length))
    items.forEach((it, i) => { mesh.setMatrixAt(i, mtx.compose(new THREE.Vector3(...it.p), q, new THREE.Vector3(...it.s))); mesh.setColorAt(i, col.set(it.c ?? '#ffffff')); shop[i] = it.shop ?? 0 })
    mesh.geometry = geo.clone()
    mesh.geometry.setAttribute('aShop', new THREE.InstancedBufferAttribute(shop, 1))
    mesh.count = items.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items, geo])
  if (!items.length) return null
  return <instancedMesh ref={ref} args={[geo, mat, items.length]} castShadow receiveShadow frustumCulled={false}
    onPointerOver={(e) => { e.stopPropagation(); if (e.instanceId != null) onPick(e.instanceId, e, 'over') }}
    onPointerMove={(e) => { if (e.instanceId != null) onPick(e.instanceId, e, 'move') }}
    onPointerOut={(e) => onPick(-1, e, 'out')} />
}

// everything drawn for the lots, at real sizes
function lotItems(lots: Lot[], look: ReturnType<typeof lookFor>, accent: string, shortFood: boolean) {
  const out = { pads: [] as Item[], bodies: [] as Item[], bodyLot: [] as number[], flat: [] as Item[], prism: [] as Item[], doors: [] as Item[], parts: [] as Item[], cyls: [] as Item[], crowns: [] as Item[], cones: [] as Item[], towers: [] as Item[], water: [] as Item[] }
  const H = GROUND_Y
  let k = 0
  const pick = <T,>(a: T[]) => a[(k++ * 7 + 3) % a.length]
  const pad = (l: Lot, c: string) => out.pads.push({ p: [l.x, H - 0.01, l.z], s: [l.w, 0.02, l.d], c })
  const building = (l: Lot, b: Box, color: string, civic: boolean) => {
    out.bodies.push({ p: [b.x, H, b.z], s: [b.w, b.h, b.d], c: color, shop: 0 })
    out.bodyLot.push(l.id)
    const roof = look.roofs.find((r) => r.kind === 'pitched' || r.kind === 'iron')
    if (l.kind === 'home' && roof && l.floors <= 3) out.prism.push({ p: [b.x, H + b.h, b.z], s: [Math.max(b.w, b.d) + m(0.4), Math.min(b.w, b.d) * (roof.kind === 'iron' ? 0.2 : 0.45), Math.min(b.w, b.d) + m(0.4)], c: pick(roof.colors), ry: b.w >= b.d ? 0 : Math.PI / 2 })
    else out.flat.push({ p: [b.x, H + b.h, b.z], s: [b.w + m(0.2), m(0.4), b.d + m(0.2)], c: pick(look.roofs[0].colors) })
    // the door, on the front wall where people go in and out (a doorway for a person: 1 m by 2.1 m)
    out.doors.push({ p: [l.door.x, H + DOOR_H / 2, l.door.z + l.face * m(0.03)], s: [l.kind === 'home' ? DOOR_W : DOOR_W * 2, DOOR_H, m(0.08)] })
    // the government's buildings wear the governing agent's color, a band above the door
    if (civic) out.parts.push({ p: [b.x, H + FLOOR + m(0.4), l.door.z + l.face * m(0.06)], s: [b.w * 0.9, m(0.5), m(0.1)], c: accent })
  }
  const bench = (b: Box) => {
    // seat at 45 cm, a backrest, two legs (the box is the whole bench's footprint)
    const along = b.w >= b.d
    out.parts.push({ p: [b.x, H + SEAT - m(0.03), b.z], s: [along ? BENCH_LEN : m(0.45), m(0.06), along ? m(0.45) : BENCH_LEN], c: '#8A6A4A' })
    for (const s of [-1, 1]) out.parts.push({ p: [b.x + (along ? s * BENCH_LEN * 0.4 : 0), H + (SEAT - m(0.06)) / 2, b.z + (along ? 0 : s * BENCH_LEN * 0.4)], s: [m(0.08), SEAT - m(0.06), m(0.08)], c: '#4A4A4C' })
  }
  for (const l of lots) {
    const b = l.building
    switch (l.kind) {
      case 'home': {
        pad(l, look.ground)
        if (b) building(l, b, pick(look.walls), false)
        for (const pr of l.props) bench(pr)
        break
      }
      case 'school': pad(l, '#B7AFA2'); if (b) building(l, b, '#E8DCC2', true); out.parts.push({ p: [l.x + l.w * 0.4, H + m(4), l.door.z + l.face * m(4)], s: [m(0.12), m(8), m(0.12)], c: '#8E9196' }); break
      case 'clinic': {
        pad(l, look.ground)
        if (b) {
          building(l, b, '#F2EFE8', true)
          // a green cross over the door
          for (const [w2, h2] of [[m(1.6), m(0.5)], [m(0.5), m(1.6)]]) out.parts.push({ p: [l.door.x, H + b.h - m(1.4), l.door.z + l.face * m(0.08)], s: [w2, h2, m(0.1)], c: '#3E9C6B' })
        }
        break
      }
      case 'office': case 'lab': pad(l, look.ground); if (b) building(l, b, l.kind === 'lab' ? '#E6EAEC' : '#DCD6CC', true); break
      case 'factory': {
        pad(l, '#A9A396')
        if (b) {
          building(l, b, '#C9B9A4', false)
          for (const ox of [-0.3, 0.3]) out.cyls.push({ p: [b.x + b.w * ox, H + b.h + m(6), b.z - l.face * b.d * 0.25], s: [m(1.6), m(12), m(1.6)], c: '#9A9DA3' })
        }
        break
      }
      case 'power_plant': pad(l, '#A9A396'); if (b) building(l, b, '#D7D2C8', false); out.towers.push({ p: [l.x - l.w * 0.25, H, l.z + l.d * 0.2], s: [m(14), m(20), m(14)], c: '#D9D3C6' }); break
      case 'launch_site': {
        pad(l, '#B5AE9F')
        out.parts.push({ p: [l.x, H + m(0.5), l.z], s: [m(9), m(1), m(9)], c: '#9C978E' })
        out.cyls.push({ p: [l.x, H + m(1) + m(14), l.z], s: [m(3.6), m(28), m(3.6)], c: C.bone })
        out.cones.push({ p: [l.x, H + m(1) + m(28) + m(3), l.z], s: [m(3.6), m(6), m(3.6)], c: C.bone })
        out.parts.push({ p: [l.x + m(4), H + m(16), l.z], s: [m(1), m(32), m(1)], c: '#8E9196' })
        break
      }
      case 'construction': {
        pad(l, look.dirt)
        const fr = l.props[0]
        if (fr) {
          for (let f = 0; f <= 3; f++) out.parts.push({ p: [fr.x, H + f * FLOOR, fr.z], s: [fr.w, m(0.25), fr.d], c: '#A9A69E' })
          for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) out.parts.push({ p: [fr.x + sx * fr.w / 2, H + (3 * FLOOR) / 2, fr.z + sz * fr.d / 2], s: [m(0.3), 3 * FLOOR, m(0.3)], c: '#8E9196' })
        }
        break
      }
      case 'farm': {
        pad(l, '#8C6E4A')
        for (let r = 0; r < 4; r++) out.parts.push({ p: [l.x, H + m(0.25), l.z - l.d * 0.33 + r * (l.d * 0.66 / 3)], s: [l.w * 0.85, m(0.5), m(0.7)], c: shortFood ? '#9C8A5E' : r % 2 ? '#8FB560' : '#C9B154' })
        break
      }
      case 'park': {
        pad(l, '#8DA86F')
        for (const pr of l.props) {
          if (pr.h > m(2)) { out.cyls.push({ p: [pr.x, H + m(1.6), pr.z], s: [m(0.35), m(3.2), m(0.35)], c: '#6E5A48' }); out.crowns.push({ p: [pr.x, H + m(4.6), pr.z], s: [m(4.4), m(3.8), m(4.4)], c: pick(look.trees.leaves) }) }
          else bench(pr)
        }
        break
      }
      case 'square': {
        pad(l, '#C9C1B0')
        for (const pr of l.props) {
          if (pr.w === pr.d) { out.cyls.push({ p: [pr.x, H + m(0.4), pr.z], s: [pr.w, m(0.8), pr.d], c: '#BDB5A6' }); out.water.push({ p: [pr.x, H + m(0.75), pr.z], s: [pr.w * 0.85, m(0.1), pr.d * 0.85] }); out.cyls.push({ p: [pr.x, H + m(1.2), pr.z], s: [m(0.5), m(1.6), m(0.5)], c: '#BDB5A6' }) }
          else bench(pr)
        }
        break
      }
      case 'market': {
        pad(l, look.ground)
        for (const pr of l.props) {
          // a stall: counter at 90 cm, posts, an awning at 2.3 m in the region's umbrella colors, goods on top
          out.parts.push({ p: [pr.x, H + COUNTER / 2, pr.z], s: [pr.w, COUNTER, pr.d], c: '#A9845E' })
          for (const sx of [-1, 1]) out.parts.push({ p: [pr.x + sx * pr.w * 0.46, H + m(1.15), pr.z], s: [m(0.08), m(2.3), m(0.08)], c: '#6E5E4E' })
          out.parts.push({ p: [pr.x, H + m(2.35), pr.z], s: [pr.w + m(0.4), m(0.12), pr.d + m(0.9)], c: pick(look.umbrellas ?? look.signs) })
          if (!shortFood) for (let g2 = 0; g2 < 3; g2++) out.parts.push({ p: [pr.x - pr.w * 0.3 + g2 * pr.w * 0.3, H + COUNTER + m(0.15), pr.z], s: [m(0.6), m(0.3), m(0.5)], c: ['#D9763F', '#9CC25E', '#E8C547'][g2] })
        }
        break
      }
      case 'shrine': {
        pad(l, '#C9C1B0')
        if (b) { building(l, b, '#E8DCC8', false); out.cones.push({ p: [b.x, H + b.h + m(2), b.z], s: [b.w * 0.7, m(4), b.d * 0.7], c: '#C9B98A' }) }
        break
      }
    }
  }
  return out
}
