'use client'
// the chosen person's world at close zoom: their city block diorama (the main site's city layout, read-only from
// src/components/world/city/layout), their home, street, weather and day/night, their family, and the world's events
// reaching in (an empty market in a famine, a news screen with a new law, a protest walking past the window).
// the camera never loses them: anything between the camera and the person fades to a see-through cutaway.
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { buildLayout, STREETS, type Layout, type Lot } from '@/components/world/city/layout'
import { C, MONK, HAIR_HEX, toonGradient } from '@/components/world/lib'
import type { LifeRecord, Workplace } from '@/lib/life/types'
import ChosenPerson, { PERSON_SCALE, type LiveState } from './ChosenPerson'
import { heightShare, householdAt, type Present } from './day'

export type CamPreset = 'face' | 'shoulder' | 'side' | 'top' | 'wide'
export type SceneProps = {
  record: LifeRecord
  layout: Layout
  homeType: string
  live: React.RefObject<LiveState>
  world: React.RefObject<WorldNow>
  preset: { kind: CamPreset; at: number } | null
  onUserCamera: () => void
}
// what the clock says about the world right now (mutable, read every frame)
export type WorldNow = {
  tick: number; hour: number; cityId: string; home: string; indoors: boolean; lotId: number
  hunger: boolean; food: number; protest: boolean; disaster: number; law: string | null; rain: number; heat: number; dead: boolean
  family: Present[]; arrivedAgoH: number
}

const toon = (color: THREE.ColorRepresentation) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() })
const damp = (c: number, t: number, r: number, dt: number) => c + (t - c) * (1 - Math.exp(-r * dt))
const GROUND_Y = 0

// colors per lot kind, quiet and close to the main site's diorama
const LOT_COLOR: Record<string, string> = { home: '#EFE6D6', school: '#E7D5A8', clinic: '#F1EEE8', office: '#C9CFD6', lab: '#DCE3E8', factory: '#B9AFA2', farm: '#B7C79A', market: '#E2C79B', park: '#A9C49A', square: '#E4DBCB', shrine: '#E9DCC2', construction: '#D8B98A', power_plant: '#A9A9AE', launch_site: '#D9D7D2' }

export function layoutFor(r: LifeRecord, cityId: string): Layout {
  const workplaces = [...new Set(r.snaps.map(s => s.workplace).filter(w => w !== 'none'))] as Workplace[]
  const religious = r.snaps.some(s => s.behavior.includes('prays'))
  return buildLayout(cityId, workplaces.length ? workplaces : ['shop'], 12, religious, false)
}

export default function Scene({ record, layout, homeType, live, world, preset, onUserCamera }: SceneProps) {
  const homeLot = layout.homes[0]
  // clothes never in skin-like hues, so nobody reads as undressed on any monk tone
  const cloth = useMemo(() => ['#5F7FA0', '#C9A046', '#6F9A6A', '#8873B0', '#4F8A8E', '#A65D57'][record.seed % 6], [record.seed])
  return (
    <>
      <Sky world={world} />
      <Ground />
      <Buildings layout={layout} homeLot={homeLot} homeKind={homeType} live={live} world={world} />
      <Market lot={layout.byKind.get('market')} world={world} />
      <Family record={record} live={live} world={world} homeLot={homeLot} />
      <Protest layout={layout} homeLot={homeLot} world={world} />
      <Rain live={live} world={world} />
      <NewsScreen homeLot={homeLot} world={world} />
      <ChosenPerson look={record.look} live={live} cloth={cloth} />
      <FollowCamera live={live} preset={preset} onUserCamera={onUserCamera} />
    </>
  )
}

// ---------- light, sky, day and night ----------
function Sky({ world }: { world: React.RefObject<WorldNow> }) {
  const sun = useRef<THREE.DirectionalLight>(null)
  const amb = useRef<THREE.HemisphereLight>(null)
  const { scene } = useThree()
  const day = useMemo(() => new THREE.Color('#EFE8DA'), [])
  const dusk = useMemo(() => new THREE.Color('#E6C7A8'), [])
  const night = useMemo(() => new THREE.Color('#2B2D3A'), [])
  const haze = useMemo(() => new THREE.Color('#D9B7A0'), [])
  const bg = useMemo(() => new THREE.Color(), [])
  useEffect(() => { scene.fog = new THREE.Fog('#EFE8DA', 30, 90); return () => { scene.fog = null } }, [scene])
  useFrame(() => {
    const W = world.current!
    // sun height from the local hour: up at 6, top at 13, down at 20 (ESTIMATE, no seasons yet)
    const a = ((W.hour - 6.5) / 13.5) * Math.PI
    const up = Math.sin(a)
    const lightK = Math.max(0, Math.min(1, up * 1.6 + 0.1))
    bg.copy(night).lerp(up > 0.25 ? day : dusk, lightK)
    if (W.rain > 0.2) bg.lerp(new THREE.Color('#B8B8B4'), W.rain * 0.4)
    if (W.disaster > 0) bg.lerp(haze, W.disaster * 0.5) // danger haze (ember family, kept soft)
    scene.background = bg
    ;(scene.fog as THREE.Fog).color.copy(bg)
    if (sun.current) {
      sun.current.position.set(Math.cos(a) * 30, Math.max(2, up * 40), 12)
      sun.current.intensity = 2.4 * lightK * (1 - W.rain * 0.5)
    }
    if (amb.current) amb.current.intensity = 0.55 + 0.9 * lightK
  })
  return (
    <>
      <hemisphereLight ref={amb} args={['#fff8ec', '#8a7f70', 1.2]} />
      <directionalLight ref={sun} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-24} shadow-camera-right={24} shadow-camera-top={24} shadow-camera-bottom={-24} />
    </>
  )
}

function Ground() {
  const m = useMemo(() => ({ plate: toon('#E2D8C4'), street: toon('#CFC4B0'), curb: toon('#D8CDB8') }), [])
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow material={m.plate}><planeGeometry args={[120, 120]} /></mesh>
      {STREETS.map(s => (
        <group key={s}>
          <mesh rotation-x={-Math.PI / 2} position={[s, 0.001, 0]} receiveShadow material={m.street}><planeGeometry args={[1.1, 31]} /></mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, s]} receiveShadow material={m.street}><planeGeometry args={[31, 1.1]} /></mesh>
        </group>
      ))}
    </group>
  )
}

// ---------- buildings with cutaways ----------
// a building fades to see-through when the person is inside it, or when it stands between the camera and them
function Buildings({ layout, homeLot, homeKind, live, world }: { layout: Layout; homeLot: Lot; homeKind: string; live: React.RefObject<LiveState>; world: React.RefObject<WorldNow> }) {
  const { camera } = useThree()
  const items = useMemo(() => layout.lots.filter(l => !['park', 'square', 'market', 'farm'].includes(l.kind)).map(l => {
    const h = l.kind === 'home' ? 1.2 + l.floors * 0.75 : 1.4 + l.floors * 0.9
    const w = l.kind === 'home' ? l.w * 0.82 : l.w * 0.85, d = l.kind === 'home' ? l.d * 0.82 : l.d * 0.85
    const mat = new THREE.MeshToonMaterial({ color: LOT_COLOR[l.kind] ?? '#E6DCCB', gradientMap: toonGradient(), transparent: true, opacity: 1 })
    const roof = new THREE.MeshToonMaterial({ color: '#B98F72', gradientMap: toonGradient(), transparent: true, opacity: 1 })
    const box = new THREE.Box3(new THREE.Vector3(l.x - w / 2, 0, l.z - d / 2), new THREE.Vector3(l.x + w / 2, h + 0.8, l.z + d / 2))
    return { l, h, w, d, mat, roof, box, group: { current: null as THREE.Group | null } }
  }), [layout])
  const ray = useMemo(() => new THREE.Ray(), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, dt) => {
    const L = live.current, W = world.current
    if (!L || !W) return
    const dist = camera.position.distanceTo(L.head)
    ray.origin.copy(camera.position)
    ray.direction.copy(L.head).sub(camera.position).normalize()
    for (const it of items) {
      const inside = W.lotId === it.l.id && W.indoors
      const between = !!ray.intersectBox(it.box, hit) && camera.position.distanceTo(hit) < dist - 0.2
      const target = inside ? 0.14 : between ? 0.2 : 1
      it.mat.opacity = damp(it.mat.opacity, target, 6, dt)
      it.mat.depthWrite = it.mat.opacity > 0.95
      it.roof.opacity = it.mat.opacity
      it.roof.depthWrite = it.mat.depthWrite
      // a see-through building stops casting its shadow over them
      it.group.current?.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = it.mat.opacity > 0.6 })
    }
  })
  // the home type changes how their own home looks: an informal settlement is low tin, a shelter is a tent
  return (
    <group>
      {items.map(({ l, h, w, d, mat, roof, group }) => {
        const own = l.id === homeLot.id
        if (own && (homeKind === 'informal_settlement' || homeKind === 'shelter')) {
          const tin = homeKind === 'shelter' ? '#D9D2C2' : '#A7A39A'
          return (
            <group key={l.id} ref={el => { group.current = el }}>
              <mesh position={[l.x, 0.7, l.z]} material={mat} castShadow receiveShadow><boxGeometry args={[w * 0.9, 1.4, d * 0.9]} /></mesh>
              <mesh position={[l.x, 1.45, l.z]} rotation-z={0.06} material={roof} castShadow onUpdate={m => (m.material as THREE.MeshToonMaterial).color.set(tin)}><boxGeometry args={[w * 1.0, 0.08, d * 1.0]} /></mesh>
            </group>
          )
        }
        return (
          <group key={l.id} ref={el => { group.current = el }}>
            <mesh position={[l.x, h / 2, l.z]} material={mat} castShadow receiveShadow><boxGeometry args={[w, h, d]} /></mesh>
            {l.kind === 'home' && (homeKind === 'house' || !own) && <mesh position={[l.x, h + 0.35, l.z]} rotation-y={Math.PI / 4} material={roof} castShadow><coneGeometry args={[Math.max(w, d) * 0.72, 0.7, 4]} /></mesh>}
          </group>
        )
      })}
      {layout.lots.filter(l => l.kind === 'park').map(l => (
        <group key={l.id}>
          <mesh rotation-x={-Math.PI / 2} position={[l.x, 0.01, l.z]} receiveShadow><planeGeometry args={[l.w, l.d]} /><meshToonMaterial color={LOT_COLOR.park} gradientMap={toonGradient()} /></mesh>
          {[[-1.2, -1], [1.3, 0.8], [0.2, -1.6]].map(([dx, dz], i) => (
            <group key={i} position={[l.x + dx, 0, l.z + dz]}>
              <mesh position={[0, 0.5, 0]} castShadow><cylinderGeometry args={[0.08, 0.1, 1, 6]} /><meshToonMaterial color="#8C6F55" gradientMap={toonGradient()} /></mesh>
              <mesh position={[0, 1.25, 0]} castShadow><sphereGeometry args={[0.55, 10, 8]} /><meshToonMaterial color="#8FAE84" gradientMap={toonGradient()} /></mesh>
            </group>
          ))}
        </group>
      ))}
      {layout.lots.filter(l => l.kind === 'square' || l.kind === 'farm').map(l => (
        <mesh key={l.id} rotation-x={-Math.PI / 2} position={[l.x, 0.01, l.z]} receiveShadow><planeGeometry args={[l.w, l.d]} /><meshToonMaterial color={LOT_COLOR[l.kind]} gradientMap={toonGradient()} /></mesh>
      ))}
    </group>
  )
}

// ---------- the market: full stalls, or empty ones in a famine ----------
function Market({ lot, world }: { lot?: Lot; world: React.RefObject<WorldNow> }) {
  const goods = useRef<THREE.InstancedMesh>(null)
  const cols = useMemo(() => ['#D9A441', '#B5553C', '#8FAE84', '#E2C79B', '#C27F5E'].map(c => new THREE.Color(c)), [])
  const N = 40
  useFrame(() => {
    const W = world.current, g = goods.current
    if (!W || !g || !lot) return
    // ESTIMATE: what is on the stalls tracks the region's food supply; hunger in the house empties them further
    const shown = Math.round(N * Math.max(0.05, Math.min(1, (W.food - 0.55) / 0.45)) * (W.hunger ? 0.4 : 1))
    const m = new THREE.Matrix4()
    for (let i = 0; i < N; i++) {
      const stall = i % 4, k = Math.floor(i / 4)
      const x = lot.x - 1.5 + stall * 1.0, z = lot.z - 0.9 + (k % 2) * 1.6
      m.makeTranslation(x - 0.25 + (k % 5) * 0.12, 0.62, z + ((k * 7) % 3 - 1) * 0.12)
      g.setMatrixAt(i, i < shown ? m : m.clone().scale(new THREE.Vector3(0, 0, 0)))
      g.setColorAt(i, cols[(i * 3) % cols.length])
    }
    g.instanceMatrix.needsUpdate = true
    if (g.instanceColor) g.instanceColor.needsUpdate = true
  })
  if (!lot) return null
  return (
    <group>
      {[0, 1, 2, 3].map(s => [0, 1].map(r => (
        <group key={`${s}${r}`} position={[lot.x - 1.5 + s * 1.0, 0, lot.z - 0.9 + r * 1.6]}>
          <mesh position={[0, 0.27, 0]} castShadow><boxGeometry args={[0.8, 0.54, 0.6]} /><meshToonMaterial color="#B08A5A" gradientMap={toonGradient()} /></mesh>
          <mesh position={[0, 1.15, 0]}><boxGeometry args={[0.95, 0.05, 0.75]} /><meshToonMaterial color={s % 2 ? '#E8DCC6' : '#C9A46A'} gradientMap={toonGradient()} /></mesh>
        </group>
      )))}
      <instancedMesh ref={goods} args={[undefined, undefined, N]}><sphereGeometry args={[0.09, 8, 6]} /><meshToonMaterial gradientMap={toonGradient()} /></instancedMesh>
    </group>
  )
}

// ---------- family: simpler pips that turn toward the chosen person and hug them when they come home ----------
function Family({ record, live, world, homeLot }: { record: LifeRecord; live: React.RefObject<LiveState>; world: React.RefObject<WorldNow>; homeLot: Lot }) {
  const MAX = 8
  const refs = useRef<(THREE.Group | null)[]>([])
  const look = useMemo(() => {
    const out: { skin: string; hair: string; cloth: string }[] = []
    for (let i = 0; i < MAX; i++) out.push({ skin: MONK[Math.max(0, Math.min(9, record.look.skinTone - 1 + ((i * 5) % 3) - 1))], hair: HAIR_HEX[record.look.hairColor] ?? '#2a221c', cloth: ['#C9A46A', '#8FAE84', '#9C8CB8', '#B98370', '#7FA39A', '#D2B48C', '#A5788F', '#6F8F95'][i] })
    return out
  }, [record.look])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock }) => {
    const W = world.current, L = live.current
    if (!W || !L) return
    const fam = W.family.slice(0, MAX)
    const personHome = W.lotId === homeLot.id && !W.dead
    for (let i = 0; i < MAX; i++) {
      const g = refs.current[i]
      if (!g) continue
      const f = fam[i]
      g.visible = !!f && (W.hour > 6 && W.hour < 22.5 || personHome)
      if (!f) continue
      // around the table at home; when the person is home they gather close and face them
      const a = (i / Math.max(1, fam.length)) * Math.PI * 2 + 0.6
      const rr = personHome ? 0.75 + (i % 2) * 0.25 : 0.55
      tmp.set(homeLot.x + Math.cos(a) * rr, 0, homeLot.z + Math.sin(a) * rr * 0.8)
      g.position.lerp(tmp, 0.08)
      const yaw = personHome ? Math.atan2(L.pos.x - g.position.x, L.pos.z - g.position.z) : a + Math.PI
      g.rotation.y += (Math.atan2(Math.sin(yaw - g.rotation.y), Math.cos(yaw - g.rotation.y))) * 0.1
      const s = 0.85 * (f.age < 1 ? 0.35 : heightShare(f.age)) * PERSON_SCALE / 1.45
      g.scale.setScalar(s)
      // a hug when they walk in (the first ~1.5 hours home), little ones bounce
      const hug = personHome && W.arrivedAgoH >= 0 && W.arrivedAgoH < 1.5 ? 1 : 0
      const armL = g.children[2] as THREE.Object3D, armR = g.children[3] as THREE.Object3D
      if (armL && armR) { armL.rotation.x = -1.2 * hug; armR.rotation.x = -1.2 * hug }
      g.position.y = f.age < 8 ? Math.abs(Math.sin(clock.elapsedTime * 3 + i)) * 0.06 * (hug ? 1 : 0.3) : 0
    }
  })
  return (
    <group>
      {look.map((c, i) => (
        <group key={i} ref={el => { refs.current[i] = el }} visible={false}>
          {/* same shapes as the main site's city pips: capsule body, round head, simple eyes */}
          <mesh position={[0, 0.98, 0]} castShadow><capsuleGeometry args={[0.24, 0.3, 4, 10]} /><meshToonMaterial color={c.cloth} gradientMap={toonGradient()} /></mesh>
          <group position={[0, 1.6, 0]}>
            <mesh castShadow><sphereGeometry args={[0.3, 14, 10]} /><meshToonMaterial color={c.skin} gradientMap={toonGradient()} /></mesh>
            <mesh position={[0, 0.02, -0.02]}><sphereGeometry args={[0.315, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.55]} /><meshToonMaterial color={c.hair} gradientMap={toonGradient()} /></mesh>
            <mesh position={[0.1, 0.03, 0.27]}><sphereGeometry args={[0.045, 6, 4]} /><meshToonMaterial color={C.ink} /></mesh>
            <mesh position={[-0.1, 0.03, 0.27]}><sphereGeometry args={[0.045, 6, 4]} /><meshToonMaterial color={C.ink} /></mesh>
          </group>
          <group position={[0.3, 1.22, 0]}><mesh position={[0, -0.24, 0]}><capsuleGeometry args={[0.09, 0.3, 3, 8]} /><meshToonMaterial color={c.cloth} gradientMap={toonGradient()} /></mesh></group>
          <group position={[-0.3, 1.22, 0]}><mesh position={[0, -0.24, 0]}><capsuleGeometry args={[0.09, 0.3, 3, 8]} /><meshToonMaterial color={c.cloth} gradientMap={toonGradient()} /></mesh></group>
          <mesh position={[0.13, 0.31, 0]}><capsuleGeometry args={[0.1, 0.42, 3, 8]} /><meshToonMaterial color="#6b5f55" gradientMap={toonGradient()} /></mesh>
          <mesh position={[-0.13, 0.31, 0]}><capsuleGeometry args={[0.1, 0.42, 3, 8]} /><meshToonMaterial color="#6b5f55" gradientMap={toonGradient()} /></mesh>
        </group>
      ))}
    </group>
  )
}

// ---------- a protest walking past the window ----------
function Protest({ layout, homeLot, world }: { layout: Layout; homeLot: Lot; world: React.RefObject<WorldNow> }) {
  const N = 14
  const g = useRef<THREE.Group>(null)
  void layout
  useFrame(({ clock }) => {
    const W = world.current
    if (!g.current || !W) return
    g.current.visible = W.protest
    if (!W.protest) return
    const z = homeLot.door.z
    g.current.children.forEach((c, i) => {
      const x = ((clock.elapsedTime * 0.9 + i * 0.9) % 30) - 15
      c.position.set(x, Math.abs(Math.sin(clock.elapsedTime * 6 + i)) * 0.05, z + (i % 2 ? 0.25 : -0.25))
    })
  })
  return (
    <group ref={g} visible={false}>
      {Array.from({ length: N }, (_, i) => (
        <group key={i} scale={0.75} rotation-y={Math.PI / 2}>
          <mesh position={[0, 0.98, 0]}><capsuleGeometry args={[0.24, 0.3, 4, 10]} /><meshToonMaterial color={['#7E9CB5', '#C9A46A', '#8FAE84', '#B98370'][i % 4]} gradientMap={toonGradient()} /></mesh>
          <mesh position={[0, 1.6, 0]}><sphereGeometry args={[0.3, 12, 8]} /><meshToonMaterial color={MONK[(i * 3) % 10]} gradientMap={toonGradient()} /></mesh>
          {i % 3 === 0 && <mesh position={[0.36, 1.9, 0.12]}><boxGeometry args={[0.62, 0.42, 0.04]} /><meshToonMaterial color={C.bone} gradientMap={toonGradient()} /></mesh>}
        </group>
      ))}
    </group>
  )
}

// ---------- weather: rain around the person ----------
function Rain({ live, world }: { live: React.RefObject<LiveState>; world: React.RefObject<WorldNow> }) {
  const N = 400
  const ref = useRef<THREE.InstancedMesh>(null)
  const seeds = useMemo(() => Float32Array.from({ length: N * 3 }, (_, i) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1), [])
  useFrame(({ clock }) => {
    const W = world.current, L = live.current, m = ref.current
    if (!W || !L || !m) return
    m.visible = W.rain > 0.15
    if (!m.visible) return
    const mat = new THREE.Matrix4()
    for (let i = 0; i < N; i++) {
      const y = 8 - ((clock.elapsedTime * 9 + seeds[i * 3] * 8) % 8)
      mat.makeTranslation(L.pos.x + (seeds[i * 3 + 1] - 0.5) * 18, y, L.pos.z + (seeds[i * 3 + 2] - 0.5) * 18)
      m.setMatrixAt(i, mat)
    }
    m.count = Math.round(N * W.rain)
    m.instanceMatrix.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[undefined, undefined, N]}><boxGeometry args={[0.012, 0.28, 0.012]} /><meshBasicMaterial color="#8fa3b0" transparent opacity={0.5} /></instancedMesh>
}

// ---------- a news screen in the kitchen when a law lands ----------
function NewsScreen({ homeLot, world }: { homeLot: Lot; world: React.RefObject<WorldNow> }) {
  const ref = useRef<THREE.Mesh>(null)
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#cfe3f0' }), [])
  useFrame(({ clock }) => {
    const W = world.current
    if (!ref.current || !W) return
    ref.current.visible = !!W.law
    mat.color.setHSL(0.56, 0.4, 0.78 + Math.sin(clock.elapsedTime * 7) * 0.04)
  })
  return <mesh ref={ref} position={[homeLot.x - 0.55, 1.05, homeLot.z - 0.55]} rotation-y={Math.PI / 4} material={mat}><boxGeometry args={[0.55, 0.34, 0.03]} /></mesh>
}

// ---------- the camera: orbit freely, always locked on them ----------
// damped follow (no jitter when they walk), the target leads slightly in the direction they walk so they sit a
// little off-center, presets animate in and give control back the moment you drag
function FollowCamera({ live, preset, onUserCamera }: { live: React.RefObject<LiveState>; preset: SceneProps['preset']; onUserCamera: () => void }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const { camera } = useThree()
  const anim = useRef<{ from: THREE.Vector3; offset: THREE.Vector3; start: number } | null>(null)
  const prevTarget = useMemo(() => new THREE.Vector3(), [])
  const want = useMemo(() => new THREE.Vector3(), [])
  const started = useRef(false)

  useEffect(() => {
    if (!preset || !live.current) return
    const L = live.current
    const fwd = L.forward.clone().setY(0).normalize()
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x)
    const off = new THREE.Vector3()
    switch (preset.kind) {
      case 'face': off.copy(fwd).multiplyScalar(1.3).add(new THREE.Vector3(0, 0.05, 0)); break
      case 'shoulder': off.copy(fwd).multiplyScalar(-1.6).addScaledVector(side, 0.55).add(new THREE.Vector3(0, 0.45, 0)); break
      case 'side': off.copy(side).multiplyScalar(3.2).add(new THREE.Vector3(0, 0.6, 0)); break
      case 'top': off.set(0.01, 14, 0.01); break
      case 'wide': off.copy(fwd).multiplyScalar(14).add(new THREE.Vector3(0, 11, 0)).addScaledVector(side, 6); break
    }
    anim.current = { from: camera.position.clone().sub(L.head), offset: off, start: performance.now() }
  }, [preset, camera, live])

  useFrame((_, rawDt) => {
    const L = live.current, c = controls.current
    if (!L || !c) return
    const dt = Math.min(rawDt, 0.05)
    want.copy(L.head).addScaledVector(L.forward, L.walking ? 0.45 : 0.1)
    want.y -= 0.12
    if (!started.current) {
      started.current = true
      c.target.copy(want)
      camera.position.copy(want).add(new THREE.Vector3(3.5, 2.4, 5))
      prevTarget.copy(want)
    }
    c.target.x = damp(c.target.x, want.x, 5, dt)
    c.target.y = damp(c.target.y, want.y, 5, dt)
    c.target.z = damp(c.target.z, want.z, 5, dt)
    // carry the camera with the target so the orbit stays locked on them as they move
    camera.position.add(c.target.clone().sub(prevTarget))
    prevTarget.copy(c.target)
    if (anim.current) {
      const k = Math.min(1, (performance.now() - anim.current.start) / 1100)
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      camera.position.copy(c.target).add(anim.current.from.clone().lerp(anim.current.offset, e))
      if (k >= 1) anim.current = null
    }
    // never under the ground
    if (camera.position.y < 0.25) camera.position.y = 0.25
    c.update()
  })
  return (
    <>
    <FillLight />
    <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} enablePan={false} minDistance={0.55} maxDistance={42}
      maxPolarAngle={Math.PI * 0.495} onStart={() => { anim.current = null; onUserCamera() }} />
    </>
  )
}

// a soft light that rides with the camera, so a face in close-up is readable even with the sun behind them
function FillLight() {
  const ref = useRef<THREE.PointLight>(null)
  const { camera } = useThree()
  useFrame(() => { ref.current?.position.copy(camera.position) })
  return <pointLight ref={ref} intensity={1.6} distance={9} decay={1.2} color="#fff4e6" />
}
