'use client'
// the chosen person's street, built to life/REFERENCE.md: the neighborhood (./Neighborhood), the people (./Crowd), the
// traffic (./Vehicles), her home inside, the market, and the core in the background of ordinary life (a public notice
// with the newest law, a news screen in a shop). the main site's city layout is read-only and scaled by K in the world.
import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { buildLayout, type Layout, type Lot } from '@/components/world/city/layout'
import { MONK, C, toonGradient } from '@/components/world/lib'
import type { LifeRecord, Workplace } from '@/lib/life/types'
import type { PlaceInfo } from '@/lib/life/place'
import ChosenPerson, { type LiveState } from './ChosenPerson'
import LifeCamera, { type CamPreset, type Collider } from './Camera'
import type { Present } from './day'
import { K, hash01, stationFor, marketPlan } from './plan'
import { STALL } from './fabric'
import Neighborhood from './Neighborhood'
import Crowd, { type FrameBodies } from './Crowd'
import { Population, Her, SEAT_H } from './population'
import { Traffic } from './traffic'
import { Qa, checkTraffic, type QaBody } from './qa'
import { DIMS } from './dims'
import Vehicles from './Vehicles'
import { cityStyle, type CityStyle } from './style'
export type { CamPreset }

export type SceneProps = {
  record: LifeRecord; layout: Layout; homeType: string
  live: React.RefObject<LiveState>; world: React.RefObject<WorldNow>
  preset: { kind: CamPreset; at: number; user?: boolean } | null; focus: React.RefObject<{ id: string; until: number } | null>
  place: PlaceInfo | undefined; onUserCamera: () => void
  budget: React.RefObject<number> // how many people may be drawn (adaptive quality lowers it before frames drop)
}
// what the clock says about the world right now (mutable, read every frame)
export type WorldNow = {
  tick: number; day: number; hour: number; speed: string; cityId: string; home: string; indoors: boolean; lotId: number
  hunger: boolean; food: number; protest: boolean; disaster: number; law: string | null; rain: number; tempC: number; heat: number; dead: boolean
  family: Present[]; kin: Present[]; arrivedAgoH: number; busX: number | null; density: number
  kinPos: Map<string, THREE.Vector3>; workLotId: number; homeLotId: number
  notice: string | null // the newest law, painted on the public notice board
}

const tmpM = new THREE.Matrix4()
const toon = (color: THREE.ColorRepresentation) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() })
const FONT = '/fonts/JetBrainsMono-Regular.ttf'

export { layoutFor } from './lifeworld'

// memoized: the HUD re-renders several times a second, the 3d scene must not (it only changes on its own props)
export default memo(function Scene({ record, layout, homeType, live, world, preset, focus, place, onUserCamera, budget }: SceneProps) {
  const homeLot = layout.homes[0]
  const colliders = useRef<Collider[]>([])
  const insideLot = useRef(-1)
  const countryId = (record.places.find(p => p.cityId === place?.cityId) ?? record.birthplace).countryId
  const style = useMemo(() => cityStyle(countryId), [countryId])
  const cityId = place?.cityId ?? record.birthplace.cityId
  // everyone in the street (./population) and the traffic (./traffic): pure state, drawn by ./Crowd and ./Vehicles,
  // checked by ./qa. the neighborhood's plan is the population's own, so walls, stoops and stalls are the same ones
  const pop = useMemo(() => new Population(record, layout, style, cityId), [record, layout, style, cityId])
  const traffic = useMemo(() => new Traffic(style, record.seed), [style, record.seed])
  const fabric = pop.fabric
  const bodies = useRef<FrameBodies>({ list: [], vehicles: [] })
  const her = useMemo(() => new Her(), [])
  // a cut (a documentary dip, a seek, a speed change): the clock jumps, and everyone is simply where they are then
  const lastHour = useRef<number | null>(null)
  const cutCount = useRef(0)
  useFrame(() => {
    const W = world.current
    if (!W) return
    const h = W.day * 24 + W.hour
    if (lastHour.current !== null && Math.abs(h - lastHour.current) > 0.12) { pop.cut(); traffic.cut(); cutCount.current++ }
    lastHour.current = h
  })
  // the building she is in: her lot when she is indoors, or (safety net) any building whose box contains her
  const probe = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const W = world.current, L = live.current
    if (!W || !L) return
    insideLot.current = W.indoors ? W.lotId : -1
    probe.set(L.pos.x, 0.5, L.pos.z)
    if (insideLot.current < 0) for (const c of colliders.current) if (c.box.containsPoint(probe)) { insideLot.current = c.lotId; break }
  })
  // clothes from the city's palette, never in skin-like hues
  const cloth = useMemo(() => style.clothes[record.seed % style.clothes.length], [style, record.seed])
  return (
    <>
      <Sky world={world} style={style} />
      <Neighborhood fabric={fabric} style={style} world={world} live={live} colliders={colliders} insideLot={insideLot} />
      <Interiors homeLot={homeLot} layout={layout} world={world} live={live} />
      <Market lot={layout.byKind.get('market')} world={world} style={style} />
      <NoticeBoard layout={layout} world={world} style={style} />
      <Crowd pop={pop} world={world} live={live} budget={budget} bodies={bodies} />
      <Vehicles traffic={traffic} world={world} live={live} bodies={bodies} />
      <Furniture pop={pop} world={world} />
      {process.env.NODE_ENV === 'development' && <RagdollQa pop={pop} her={her} bodies={bodies} world={world} live={live} record={record} cuts={cutCount} />}
      <Rain live={live} world={world} />
      <ChosenPerson look={record.look} live={live} cloth={cloth} her={her} />
      <FillLight />
      {process.env.NODE_ENV === 'development' && <GlitchMeter live={live} world={world} colliders={colliders} insideLot={insideLot} />}
      <LifeCamera live={live} preset={preset} colliders={colliders} insideLot={insideLot} focus={focus} world={world} onUserCamera={onUserCamera} />
    </>
  )
})

// ---------- inside her home: a bed, a cot when there is a baby, a table with chairs, a charcoal stove ----------
function Interiors({ homeLot, layout, world, live }: { homeLot: Lot; layout: Layout; world: React.RefObject<WorldNow>; live: React.RefObject<LiveState> }) {
  const blanket = useRef<THREE.Mesh>(null)
  const wood = useMemo(() => toon('#8C6A4E'), [])
  const sheet = useMemo(() => toon('#E8E2D6'), [])
  const cover = useMemo(() => toon('#C9483B'), [])
  const steel = useMemo(() => toon('#5E5A58'), [])
  useFrame(() => { const W = world.current; if (blanket.current && W) blanket.current.visible = live.current?.pose === 'lie' && W.lotId === homeLot.id })
  void layout
  const W = (v: { x: number; z: number }) => [v.x * K, v.z * K] as const
  const [bx, bz] = W(stationFor(homeLot, 'sleep', 0).pos)
  const [sx, sz] = W(stationFor(homeLot, 'cook', 0).pos)
  const [tx, tz] = [homeLot.x * K, (homeLot.z + 0.25) * K]
  return (
    <group>
      <mesh position={[bx, 0.2, bz]} material={sheet}><boxGeometry args={[0.6, 0.25, 1.15]} /></mesh>
      <mesh position={[bx, 0.36, bz - 0.55]} material={wood}><boxGeometry args={[0.6, 0.35, 0.06]} /></mesh>
      <mesh ref={blanket} position={[bx, 0.37, bz + 0.15]} material={cover}><boxGeometry args={[0.62, 0.08, 0.8]} /></mesh>
      {/* a small round table (~1 m across, 75 cm high); the chairs around it are drawn by ./Furniture where people sit */}
      <mesh position={[tx, DIMS.table, tz]} material={wood}><cylinderGeometry args={[0.36, 0.36, 0.04, 16]} /></mesh>
      <mesh position={[tx, DIMS.table / 2, tz]} material={wood}><cylinderGeometry args={[0.04, 0.07, DIMS.table, 8]} /></mesh>
      {/* a charcoal stove (jiko) with a pot */}
      <mesh position={[sx, 0.14, sz]} material={steel}><cylinderGeometry args={[0.16, 0.12, 0.28, 10]} /></mesh>
      <mesh position={[sx, 0.34, sz]} material={steel}><cylinderGeometry args={[0.14, 0.14, 0.14, 10]} /></mesh>
    </group>
  )
}

// ---------- the market: stalls under umbrellas, where ./plan's marketPlan puts them (vendors stand behind them);
// what is on them tracks the real food supply ----------
function Market({ lot, world, style }: { lot?: Lot; world: React.RefObject<WorldNow>; style: CityStyle }) {
  const goods = useRef<THREE.InstancedMesh>(null)
  const cols = useMemo(() => ['#D9A441', '#B5553C', '#8FAE84', '#E2C79B', '#C27F5E', '#6F9A4E'].map(c => new THREE.Color(c)), [])
  const stalls = useMemo(() => (lot ? marketPlan(lot).stalls.map(st => ({ x: (lot.x + st.x) * K, z: (lot.z + st.z) * K, facing: st.facing })) : []), [lot])
  const PER = 8, N = stalls.length * PER
  const T = useMemo(() => ({ m: new THREE.Matrix4(), zero: new THREE.Matrix4().makeScale(0, 0, 0) }), [])
  useFrame(() => {
    const W = world.current, g = goods.current
    if (!W || !g || !lot) return
    // ESTIMATE: what is on the stalls follows the region's food supply (sim) and the hour (stalls set up from ~6:30)
    const shown = Math.round(N * Math.max(0.05, Math.min(1, (W.food - 0.55) / 0.45)) * (W.hunger ? 0.5 : 1) * (W.hour > 6.4 && W.hour < 19.5 ? 1 : 0))
    for (let i = 0; i < N; i++) {
      const st = stalls[i % stalls.length], k = Math.floor(i / stalls.length)
      T.m.makeTranslation(st.x - STALL.w * 0.35 + (k % 4) * STALL.w * 0.23, STALL.h + 0.05, st.z - STALL.d * 0.2 + Math.floor(k / 4) * STALL.d * 0.4)
      g.setMatrixAt(i, i < shown ? T.m : T.zero)
      g.setColorAt(i, cols[(i * 7) % cols.length])
    }
    g.instanceMatrix.needsUpdate = true
    if (g.instanceColor) g.instanceColor.needsUpdate = true
  })
  if (!lot) return null
  const umbrellas = ['#D9483B', '#3E6FA8', '#E8A13A', '#3E8C6A', '#F4F0E6', '#8E3B6E', '#2F7F6F', '#C9A046']
  return (
    <group>
      {stalls.map((st, s) => (
        <group key={s} position={[st.x, 0, st.z]} rotation-y={st.facing}>
          <mesh position={[0, STALL.h / 2, 0]} castShadow><boxGeometry args={[STALL.w, STALL.h, STALL.d]} /><meshToonMaterial color="#9C7B5E" gradientMap={toonGradient()} /></mesh>
          <mesh position={[0, 0.75, 0]}><cylinderGeometry args={[0.02, 0.02, 1.5, 5]} /><meshToonMaterial color="#5E5A58" gradientMap={toonGradient()} /></mesh>
          <mesh position={[0, 1.5, 0]} castShadow><coneGeometry args={[0.62, 0.22, 8]} /><meshToonMaterial color={umbrellas[s % umbrellas.length]} gradientMap={toonGradient()} /></mesh>
        </group>
      ))}
      <instancedMesh ref={goods} args={[undefined, undefined, Math.max(1, N)]}><sphereGeometry args={[0.05, 8, 6]} /><meshToonMaterial gradientMap={toonGradient()} /></instancedMesh>
      {void style}
    </group>
  )
}

// ---------- the core in the background: a public notice board with the newest law, painted the local way ----------
function NoticeBoard({ layout, world, style }: { layout: Layout; world: React.RefObject<WorldNow>; style: CityStyle }) {
  const text = useRef<{ text: string } | null>(null)
  const sq = layout.byKind.get('market') ?? layout.byKind.get('square')
  const word = style.kind === 'swahili' ? 'TANGAZO' : style.kind === 'tana' ? 'FILAZANA' : style.kind === 'musseque' ? 'AVISO' : 'NOTICE'
  useFrame(() => { const W = world.current; if (W && text.current && text.current.text !== (W.notice ?? '')) text.current.text = W.notice ?? '' })
  if (!sq) return null
  const x = sq.x * K - sq.w * K * 0.5 - 0.6, z = sq.z * K + sq.d * K * 0.5 + 0.9
  return (
    <group position={[x, 0, z]}>
      {[-0.55, 0.55].map(dx => <mesh key={dx} position={[dx, 0.75, 0]}><boxGeometry args={[0.06, 1.5, 0.06]} /><meshToonMaterial color="#5E4636" gradientMap={toonGradient()} /></mesh>)}
      <mesh position={[0, 1.25, 0]}><boxGeometry args={[1.3, 0.75, 0.04]} /><meshToonMaterial color="#E8E2D6" gradientMap={toonGradient()} /></mesh>
      <Text font={FONT} fontSize={0.12} color="#C9483B" position={[0, 1.5, 0.03]} anchorX="center">{word}</Text>
      <Text ref={text as never} font={FONT} fontSize={0.07} color="#2a2622" position={[0, 1.22, 0.03]} anchorX="center" anchorY="middle" maxWidth={1.15} textAlign="center">{''}</Text>
    </group>
  )
}

// ---------- light, sky, day and night ----------
function Sky({ world, style }: { world: React.RefObject<WorldNow>; style: CityStyle }) {
  const sun = useRef<THREE.DirectionalLight>(null)
  const amb = useRef<THREE.HemisphereLight>(null)
  const { scene } = useThree()
  const day = useMemo(() => new THREE.Color('#EFE8DA'), [])
  const dusk = useMemo(() => new THREE.Color('#E6C7A8'), [])
  const night = useMemo(() => new THREE.Color('#2B2D3A'), [])
  const haze = useMemo(() => new THREE.Color('#D9B7A0'), [])
  const dust = useMemo(() => new THREE.Color(style.haze), [style])
  const grey = useMemo(() => new THREE.Color('#B8B8B4'), [])
  const bg = useMemo(() => new THREE.Color(), [])
  const nightBlue = useMemo(() => new THREE.Color('#8e9cc4'), [])
  const nightGround = useMemo(() => new THREE.Color('#3a3a48'), [])
  useEffect(() => { scene.fog = new THREE.Fog('#EFE8DA', 22, 75); return () => { scene.fog = null } }, [scene])
  useFrame(() => {
    const W = world.current!
    const a = ((W.hour - 6.2) / 12.6) * Math.PI // sunrise ~6:10, sunset ~18:50 (near the tropics; ESTIMATE, no seasons)
    const up = Math.sin(a)
    const lightK = Math.max(0, Math.min(1, up * 1.6 + 0.08))
    // a warm dusty haze over the city in daylight (the reference photos), deep blue at night
    bg.copy(night).lerp(up > 0.25 ? dust : dusk, lightK)
    if (W.rain > 0.2) bg.lerp(grey, W.rain * 0.4)
    if (W.disaster > 0) bg.lerp(haze, W.disaster * 0.5)
    scene.background = bg
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(bg) // (the fog is made in an effect: not there on the first frame or after unmount)
    if (sun.current) { sun.current.position.set(Math.cos(a) * 30, Math.max(2, up * 40), 12); sun.current.intensity = 2.4 * lightK * (1 - W.rain * 0.5) }
    // readable at dawn and dusk, properly dark and cool at night (the sky, lit windows and street lights carry it)
    const nightK = Math.max(0, Math.min(1, (-up - 0.05) * 4))
    if (amb.current) {
      amb.current.intensity = 0.8 + 0.7 * lightK - 0.5 * nightK
      amb.current.color.set('#fff8ec').lerp(nightBlue, nightK)
      amb.current.groundColor.set('#8a7f70').lerp(nightGround, nightK)
    }
    fillK.current = 1 - 0.55 * nightK
  })
  return (
    <>
      <hemisphereLight ref={amb} args={['#fff8ec', '#8a7f70', 1.2]} />
      <directionalLight ref={sun} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-24} shadow-camera-right={24} shadow-camera-top={24} shadow-camera-bottom={-24} />
    </>
  )
}

// ---------- rain around her, from the real wet season ----------
function Rain({ live, world }: { live: React.RefObject<LiveState>; world: React.RefObject<WorldNow> }) {
  const N = 400
  const level = useRef(0)
  const ref = useRef<THREE.InstancedMesh>(null)
  const seeds = useMemo(() => Float32Array.from({ length: N * 3 }, (_, i) => hash01(i)), [])
  useFrame(({ clock }) => {
    const W = world.current, L = live.current, m = ref.current
    if (!W || !L || !m) return
    level.current += (W.rain - level.current) * 0.02 // rain eases in and out over a few seconds
    m.visible = level.current > 0.03
    if (!m.visible) return
    const mat = tmpM
    for (let i = 0; i < N; i++) {
      const y = 8 - ((clock.elapsedTime * 9 + seeds[i * 3] * 8) % 8)
      mat.makeTranslation(L.pos.x + (seeds[i * 3 + 1] - 0.5) * 18, y, L.pos.z + (seeds[i * 3 + 2] - 0.5) * 18)
      m.setMatrixAt(i, mat)
    }
    m.count = Math.round(N * level.current)
    m.instanceMatrix.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[undefined, undefined, N]} frustumCulled={false}><boxGeometry args={[0.012, 0.28, 0.012]} /><meshBasicMaterial color="#8fa3b0" transparent opacity={0.45} /></instancedMesh>
}

// a soft light that rides with the camera, so a face in close-up is readable even with the sun behind them
// shared with Sky: the camera light dims at night so the night stays a night
const fillK = { current: 1 }
function FillLight() {
  const ref = useRef<THREE.PointLight>(null)
  const { camera } = useThree()
  useFrame(() => { if (!ref.current) return; ref.current.position.copy(camera.position); ref.current.intensity = 1.6 * fillK.current })
  return <pointLight ref={ref} intensity={1.6} distance={9} decay={1.2} color="#fff4e6" />
}

// dev only: counts what a viewer would notice, every frame the scene is actually visible (the veil is down)
function GlitchMeter({ live, world, colliders, insideLot }: { live: React.RefObject<LiveState>; world: React.RefObject<WorldNow>; colliders: React.RefObject<Collider[]>; insideLot: React.RefObject<number> }) {
  const { camera } = useThree()
  const last = useMemo(() => ({ cam: new THREE.Vector3(), t: 0, ndc: new THREE.Vector3(), started: false }), [])
  useFrame(() => {
    const G = ((window as unknown as { __glitch?: Record<string, number> }).__glitch ??= { frames: 0, slow20: 0, slow34: 0, maxMs: 0, camJump: 0, off: 0, camInWall: 0, camInHer: 0, overlap: 0 })
    const now = performance.now()
    const ms = last.t ? now - last.t : 16
    last.t = now
    const veil = document.querySelector('[data-veil]') as HTMLElement | null
    const hidden = veil ? parseFloat(getComputedStyle(veil).opacity) > 0.5 : false
    const L = live.current, W = world.current
    if (!L || !W || hidden || document.hidden) { last.cam.copy(camera.position); return }
    G.frames++
    if (ms > 20) G.slow20++
    if (ms > 34) G.slow34++
    G.maxMs = Math.max(G.maxMs, Math.round(ms))
    if (last.started && camera.position.distanceTo(last.cam) > 0.6) G.camJump++
    last.started = true
    last.cam.copy(camera.position)
    last.ndc.copy(L.head).project(camera)
    if (!L.dead && !(Math.abs(last.ndc.x) < 1 && Math.abs(last.ndc.y) < 1 && last.ndc.z < 1)) G.off++
    for (const c of colliders.current) if (c.lotId !== insideLot.current && c.box.containsPoint(camera.position)) { G.camInWall++; break }
    if (camera.position.distanceTo(L.head) < 0.4) G.camInHer++
    const D = W as WorldNow & { _closest?: number }
    if ((D._closest ?? 99) < 0.28 && L.pose !== 'lie') G.overlap++
  })
  return null
}

// ---------- seats: a chair, bench or stool under everyone who sits (from ./population), only where it is in view ----------
function Furniture({ pop, world }: { pop: Population; world: React.RefObject<WorldNow> }) {
  const im = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const mat = useMemo(() => new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonGradient() }), [])
  const T = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), c: { chair: new THREE.Color('#3E6FA8'), bench: new THREE.Color('#8C6A4E'), stool: new THREE.Color('#C9483B') } }), [])
  useFrame(() => {
    const W = world.current, g = im.current
    if (!W || !g) return
    let n = 0
    for (const s of pop.seats.values()) {
      if (s.kind === 'stoop' || s.kind === 'mat') continue // the step and the floor are already there
      if (s.indoors && s.lotId !== W.lotId) continue
      if (n >= 120) break
      const w = s.kind === 'bench' ? 0.5 : 0.26, h = SEAT_H[s.kind]
      T.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.facing)
      // the seat (its top exactly at the sitting height), and for a chair a back behind the sitter
      g.setMatrixAt(n, T.m.compose(new THREE.Vector3(s.x, h / 2, s.z), T.q, new THREE.Vector3(w, h, 0.26))); g.setColorAt(n++, T.c[s.kind])
      if (s.kind === 'chair') { g.setMatrixAt(n, T.m.compose(new THREE.Vector3(s.x - Math.sin(s.facing) * 0.12, h + 0.14, s.z - Math.cos(s.facing) * 0.12), T.q, new THREE.Vector3(0.26, 0.28, 0.03))); g.setColorAt(n++, T.c.chair) }
    }
    g.count = n; g.instanceMatrix.needsUpdate = true; if (g.instanceColor) g.instanceColor.needsUpdate = true
  })
  return <instancedMesh ref={im} args={[geo, mat, 240]} frustumCulled={false} castShadow />
}

// ---------- dev only: the ragdoll rules (CLAUDE.md), checked every frame against what is drawn ----------
// logs each new violation once (who, where, what) under [ragdoll], and keeps the list on window.__qa
function RagdollQa({ pop, her, bodies, world, live, record, cuts }: { pop: Population; her: Her; bodies: React.RefObject<FrameBodies>; world: React.RefObject<WorldNow>; live: React.RefObject<LiveState>; record: LifeRecord; cuts: React.RefObject<number> }) {
  const qa = useRef(new Qa())
  const seenCut = useRef(0)
  const seen = useRef(new Set<string>())
  const frames = useRef(0)
  useFrame((_, dt) => {
    const W = world.current, L = live.current
    // the first second is the scene settling in behind the loading veil (the first clock tick has not landed yet)
    if (!W || !L || frames.current++ < 60) return
    // a cut (seek, dip, speed change): a fresh look, and the first second after it is the scene landing (as in the qa script)
    if (cuts.current !== seenCut.current) { seenCut.current = cuts.current; qa.current = new Qa(); frames.current = 30 }
    if (frames.current < 60) return
    const herBody: QaBody = { id: 'her', who: `${record.name} (${L.age.toFixed(1)})`, age: L.age, root: her.root, x: L.seat?.x ?? L.pos.x, z: L.seat?.z ?? L.pos.z, heading: L.heading, action: her.last?.action ?? 'stand', walking: L.walking, presence: L.pos.y > 0.2 ? 0 : 1, body: her.last?.body ?? bodies.current!.list[0]?.body, sol: her.sol, holding: null, heldBy: L.carrier, cradle: null, indoors: W.indoors, lotId: W.lotId, lotKind: '', seat: L.seat, door: null, her: true }
    if (!herBody.body) return
    const list = [...(bodies.current?.list ?? []), herBody]
    const vs = [...qa.current.check(list, { hour: W.hour, fabric: pop.fabric, solids: pop.solids, seats: [...pop.seats.values()], herLot: W.indoors ? W.lotId : -1, herPos: L.pos }, Math.min(dt, 0.05)), ...checkTraffic(list, [], W.hour, L.pos)]
    const w = window as unknown as { __qa?: unknown[] }
    for (const v of vs) {
      const k = `${v.rule}|${v.who}`
      if (seen.current.has(k)) continue
      seen.current.add(k)
      ;(w.__qa ??= []).push(v)
      console.warn(`[ragdoll] ${v.rule}: ${v.who} at ${v.where}: ${v.what}`)
    }
  })
  return null
}
