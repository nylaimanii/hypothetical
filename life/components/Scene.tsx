'use client'
// the chosen person's city at close zoom. the street grid and lots are the main site's city layout (read-only from
// src/components/world/city/layout); every free block is filled with homes and shops at the real density, and
// building heights scale with the real mean building height (ghsl, via src/lib/life/place.ts). people live in it:
// her family where they actually live, coworkers at the stations next to hers, neighbors and a crowd sized by the
// real population density and the hour, all on day plans from ./plan. a bus runs the main street; she rides it.
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildLayout, STREETS, type Layout, type Lot } from '@/components/world/city/layout'
import { C, MONK, HAIR_HEX, toonGradient } from '@/components/world/lib'
import type { LifeRecord, Workplace } from '@/lib/life/types'
import type { PlaceInfo } from '@/lib/life/place'
import ChosenPerson, { type LiveState } from './ChosenPerson'
import LifeCamera, { type CamPreset, type Collider } from './Camera'
import { heightShare, type Present } from './day'
import { BUS_Z, hash01, planDay, schedule, stationFor, whereIn, type DayPlan } from './plan'
export type { CamPreset }

export type SceneProps = {
  record: LifeRecord; layout: Layout; homeType: string
  live: React.RefObject<LiveState>; world: React.RefObject<WorldNow>
  preset: { kind: CamPreset; at: number; user?: boolean } | null; focus: React.RefObject<{ id: string; until: number } | null>
  place: PlaceInfo | undefined; onUserCamera: () => void
}
// what the clock says about the world right now (mutable, read every frame)
export type WorldNow = {
  tick: number; day: number; hour: number; speed: string; cityId: string; home: string; indoors: boolean; lotId: number
  hunger: boolean; food: number; protest: boolean; disaster: number; law: string | null; rain: number; tempC: number; heat: number; dead: boolean
  family: Present[]; kin: Present[]; arrivedAgoH: number; busX: number | null; density: number
  kinPos: Map<string, THREE.Vector3>; workLotId: number; homeLotId: number
}

const toon = (color: THREE.ColorRepresentation) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() })
const damp = (c: number, t: number, r: number, dt: number) => c + (t - c) * (1 - Math.exp(-r * dt))
const LOT_COLOR: Record<string, string> = { home: '#EFE6D6', school: '#E7D5A8', clinic: '#F1EEE8', office: '#C9CFD6', lab: '#DCE3E8', factory: '#B9AFA2', farm: '#B7C79A', market: '#E2C79B', park: '#A9C49A', square: '#E4DBCB', shrine: '#E9DCC2', construction: '#D8B98A', power_plant: '#A9A9AE', launch_site: '#D9D7D2' }
const WALLS = ['#EFE6D6', '#E6D7C2', '#E9DCC8', '#DCCFB8', '#E3D3BF', '#D9C9AF', '#EAD9C4']

export function layoutFor(r: LifeRecord, cityId: string): Layout {
  const workplaces = [...new Set(r.snaps.map(s => s.workplace).filter(w => w !== 'none'))] as Workplace[]
  const religious = r.snaps.some(s => s.behavior.includes('prays'))
  return buildLayout(cityId, workplaces.length ? workplaces : ['shop'], 12, religious, true)
}

// free blocks (and a ring of outskirts) get filler buildings: homes, apartment blocks, corner shops
type Filler = { x: number; z: number; w: number; d: number; h: number; color: string; shop: boolean }
function fillers(layout: Layout, place: PlaceInfo | undefined, seed: string): Filler[] {
  const centers = [-12, -6, 0, 6, 12], ring = [-24, -18, 18, 24]
  const taken = new Set(layout.lots.map(l => `${Math.round(l.x / 6) * 6},${Math.round(l.z / 6) * 6}`))
  // real numbers: ghsl mean building height (m) and built-up share. ESTIMATE mapping to the diorama
  const heightM = place?.heightM || 8, built = place?.built ?? 0.3
  const floorsBase = Math.max(1, Math.min(6, heightM / 3.2))
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const r = (n: number) => hash01(h + n)
  const out: Filler[] = []
  const block = (bx: number, bz: number, k: number, outer: boolean) => {
    const dense = r(k) < built * 1.6
    if (dense && !outer) {
      out.push({ x: bx - 0.6, z: bz - 0.4, w: 3.2, d: 3.4, h: 1.2 + floorsBase * (0.8 + r(k + 1) * 0.6) * 0.75, color: WALLS[k % WALLS.length], shop: false })
      out.push({ x: bx + 1.6, z: bz + 1.6, w: 1.4, d: 1.4, h: 1.1, color: '#E2C79B', shop: true })
    } else {
      for (const [ox, oz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
        if (outer && r(k + ox * 7 + oz * 13) < 0.25) continue
        out.push({ x: bx + ox, z: bz + oz, w: 1.6, d: 1.6, h: 1.2 + Math.max(1, Math.round(floorsBase * (0.5 + r(k + ox + oz * 3)))) * 0.75, color: WALLS[(k + Math.round(ox + oz * 2) + 7) % WALLS.length], shop: r(k + ox * 3) < 0.12 })
      }
    }
  }
  let k = 0
  for (const x of centers) for (const z of centers) { k++; if (!taken.has(`${x},${z}`)) block(x, z, k * 17, false) }
  for (const x of [...ring, ...centers]) for (const z of [...ring, ...centers]) { k++; if (Math.abs(x) >= 18 || Math.abs(z) >= 18) block(x, z, k * 17, true) }
  return out
}

export default function Scene({ record, layout, homeType, live, world, preset, focus, place, onUserCamera }: SceneProps) {
  const homeLot = layout.homes[0]
  const colliders = useRef<Collider[]>([])
  const insideLot = useRef(-1)
  // the building she is in: her lot when she is indoors, or (safety net) any building whose box contains her
  const probe = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const W = world.current, L = live.current
    if (!W || !L) return
    insideLot.current = W.indoors ? W.lotId : -1
    probe.set(L.pos.x, 0.5, L.pos.z)
    if (insideLot.current < 0) for (const c of colliders.current) if (c.box.containsPoint(probe)) { insideLot.current = c.lotId; break }
  })
  // clothes never in skin-like hues, so nobody reads as undressed on any monk tone
  const cloth = useMemo(() => ['#5F7FA0', '#C9A046', '#6F9A6A', '#8873B0', '#4F8A8E', '#A65D57'][record.seed % 6], [record.seed])
  const fill = useMemo(() => fillers(layout, place, record.places[0]?.cityId ?? 'x'), [layout, place, record.places])
  return (
    <>
      <Sky world={world} />
      <Ground />
      <Buildings layout={layout} homeLot={homeLot} homeKind={homeType} live={live} world={world} colliders={colliders} fill={fill} insideLot={insideLot} />
      <Interiors layout={layout} homeLot={homeLot} world={world} live={live} />
      <Market lot={layout.byKind.get('market')} world={world} />
      <People record={record} layout={layout} world={world} live={live} />
      <Bus world={world} />
      <Traffic world={world} live={live} />
      <StreetLights world={world} live={live} />
      <Protest homeLot={homeLot} world={world} />
      <Rain live={live} world={world} />
      <NewsScreen homeLot={homeLot} world={world} />
      <ChosenPerson look={record.look} live={live} cloth={cloth} />
      <FillLight />
      <LifeCamera live={live} preset={preset} colliders={colliders} insideLot={insideLot} focus={focus} world={world} onUserCamera={onUserCamera} />
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
  const grey = useMemo(() => new THREE.Color('#B8B8B4'), [])
  const bg = useMemo(() => new THREE.Color(), [])
  const nightBlue = useMemo(() => new THREE.Color('#8e9cc4'), [])
  const nightGround = useMemo(() => new THREE.Color('#3a3a48'), [])
  useEffect(() => { scene.fog = new THREE.Fog('#EFE8DA', 26, 70); return () => { scene.fog = null } }, [scene])
  useFrame(() => {
    const W = world.current!
    const a = ((W.hour - 6.2) / 12.6) * Math.PI // sunrise ~6:10, sunset ~18:50 (near the tropics; ESTIMATE, no seasons)
    const up = Math.sin(a)
    const lightK = Math.max(0, Math.min(1, up * 1.6 + 0.08))
    bg.copy(night).lerp(up > 0.25 ? day : dusk, lightK)
    if (W.rain > 0.2) bg.lerp(grey, W.rain * 0.4)
    if (W.disaster > 0) bg.lerp(haze, W.disaster * 0.5)
    scene.background = bg
    ;(scene.fog as THREE.Fog).color.copy(bg)
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

function Ground() {
  const m = useMemo(() => ({ plate: toon('#DCD2BE'), street: toon('#BDB3A2'), walk: toon('#D3C8B4') }), [])
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow material={m.plate}><planeGeometry args={[160, 160]} /></mesh>
      {[-27, -21, ...STREETS, 21, 27].map(s => (
        <group key={s}>
          <mesh rotation-x={-Math.PI / 2} position={[s, 0.002, 0]} receiveShadow material={m.walk}><planeGeometry args={[1.9, 60]} /></mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.003, s]} receiveShadow material={m.walk}><planeGeometry args={[60, 1.9]} /></mesh>
          <mesh rotation-x={-Math.PI / 2} position={[s, 0.004, 0]} receiveShadow material={m.street}><planeGeometry args={[1.2, 60]} /></mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, s]} receiveShadow material={m.street}><planeGeometry args={[60, 1.2]} /></mesh>
        </group>
      ))}
    </group>
  )
}

// ---------- buildings with cutaways ----------
function Buildings({ layout, homeLot, homeKind, live, world, colliders, fill, insideLot }: { layout: Layout; homeLot: Lot; homeKind: string; live: React.RefObject<LiveState>; world: React.RefObject<WorldNow>; colliders: React.RefObject<Collider[]>; fill: Filler[]; insideLot: React.RefObject<number> }) {
  const { camera } = useThree()
  const items = useMemo(() => [
    ...layout.lots.filter(l => !['park', 'square', 'market', 'farm'].includes(l.kind)).map(l => {
      const h = l.kind === 'home' ? 1.25 + l.floors * 0.75 : 1.5 + l.floors * 0.9
      const w = l.kind === 'home' ? l.w * 0.86 : l.w * 0.85, d = l.kind === 'home' ? l.d * 0.86 : l.d * 0.85
      return { id: l.id, x: l.x, z: l.z, w, d, h, color: LOT_COLOR[l.kind] ?? '#E6DCCB', home: l.kind === 'home', lot: l as Lot | null }
    }),
    ...fill.map((f, i) => ({ id: 1000 + i, x: f.x, z: f.z, w: f.w, d: f.d, h: f.h, color: f.color, home: !f.shop, lot: null as Lot | null })),
  ].map(it => ({
    ...it,
    mat: new THREE.MeshToonMaterial({ color: it.color, gradientMap: toonGradient(), transparent: true, opacity: 1 }),
    roof: new THREE.MeshToonMaterial({ color: it.home ? '#B98F72' : '#A9A39A', gradientMap: toonGradient(), transparent: true, opacity: 1 }),
    box: new THREE.Box3(new THREE.Vector3(it.x - it.w / 2, 0, it.z - it.d / 2), new THREE.Vector3(it.x + it.w / 2, it.h + 0.8, it.z + it.d / 2)),
    group: { current: null as THREE.Group | null },
  })), [layout, fill])
  useEffect(() => { colliders.current = items.map(it => ({ box: it.box, lotId: it.id })) }, [items, colliders])
  const ray = useMemo(() => new THREE.Ray(), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  const windowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#f6d58c' }), [])
  useFrame((_, dt) => {
    const L = live.current, W = world.current
    if (!L || !W) return
    const dist = camera.position.distanceTo(L.head)
    ray.origin.copy(camera.position)
    ray.direction.copy(L.head).sub(camera.position).normalize()
    for (const it of items) {
      const inside = insideLot.current === it.id
      const between = !!ray.intersectBox(it.box, hit) && camera.position.distanceTo(hit) < dist - 0.2
      const target = inside ? 0.12 : between ? 0.18 : 1
      it.mat.opacity = damp(it.mat.opacity, target, 6, dt)
      it.mat.depthWrite = it.mat.opacity > 0.95
      it.roof.opacity = inside ? 0 : it.mat.opacity
      it.roof.depthWrite = it.mat.depthWrite
      it.group.current?.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = it.mat.opacity > 0.6 })
    }
    windowMat.color.set(W.hour > 18.3 || W.hour < 6.3 ? '#f6d58c' : '#9fb3bf')
  })
  return (
    <group>
      {items.map(it => {
        const own = it.lot?.id === homeLot.id
        if (own && (homeKind === 'informal_settlement' || homeKind === 'shelter')) {
          return (
            <group key={it.id} ref={el => { it.group.current = el }}>
              <mesh position={[it.x, 0.75, it.z]} material={it.mat} castShadow receiveShadow><boxGeometry args={[it.w, 1.5, it.d]} /></mesh>
              <mesh position={[it.x, 1.55, it.z]} rotation-z={0.06} material={it.roof} castShadow onUpdate={m => (m.material as THREE.MeshToonMaterial).color.set(homeKind === 'shelter' ? '#D9D2C2' : '#A7A39A')}><boxGeometry args={[it.w * 1.1, 0.08, it.d * 1.1]} /></mesh>
            </group>
          )
        }
        return (
          <group key={it.id} ref={el => { it.group.current = el }}>
            <mesh position={[it.x, it.h / 2, it.z]} material={it.mat} castShadow receiveShadow><boxGeometry args={[it.w, it.h, it.d]} /></mesh>
            {it.home && it.h < 3.2 ? <mesh position={[it.x, it.h + 0.3, it.z]} rotation-y={Math.PI / 4} material={it.roof} castShadow><coneGeometry args={[Math.max(it.w, it.d) * 0.72, 0.6, 4]} /></mesh>
              : <mesh position={[it.x, it.h + 0.05, it.z]} material={it.roof}><boxGeometry args={[it.w * 1.02, 0.1, it.d * 1.02]} /></mesh>}
            {Array.from({ length: Math.max(1, Math.floor((it.h - 0.6) / 0.75)) }, (_, f) => (
              <mesh key={f} position={[it.x, 0.95 + f * 0.75, it.z + it.d / 2 + 0.01]} material={windowMat}><planeGeometry args={[it.w * 0.55, 0.26]} /></mesh>
            ))}
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
          {[[-0.9, 0.9], [0.9, -0.2]].map(([dx, dz], i) => <mesh key={`b${i}`} position={[l.x + dx, 0.22, l.z + dz]}><boxGeometry args={[0.9, 0.08, 0.32]} /><meshToonMaterial color="#9C7B5E" gradientMap={toonGradient()} /></mesh>)}
        </group>
      ))}
      {layout.lots.filter(l => l.kind === 'square' || l.kind === 'farm').map(l => (
        <mesh key={l.id} rotation-x={-Math.PI / 2} position={[l.x, 0.01, l.z]} receiveShadow><planeGeometry args={[l.w, l.d]} /><meshToonMaterial color={LOT_COLOR[l.kind]} gradientMap={toonGradient()} /></mesh>
      ))}
    </group>
  )
}

// ---------- inside her home and her workplace: a bed, a table, a stove, workstations ----------
function Interiors({ layout, homeLot, world, live }: { layout: Layout; homeLot: Lot; world: React.RefObject<WorldNow>; live: React.RefObject<LiveState> }) {
  const work = useRef<THREE.Group>(null)
  const blanket = useRef<THREE.Mesh>(null)
  const cover = useMemo(() => toon('#A65D57'), [])
  const wood = useMemo(() => toon('#9C7B5E'), [])
  const sheet = useMemo(() => toon('#E8E2D6'), [])
  const steel = useMemo(() => toon('#8F969C'), [])
  useFrame(() => {
    const W = world.current
    if (!W || !work.current) return
    if (blanket.current) blanket.current.visible = live.current?.pose === 'lie' && W.lotId === homeLot.id
    const lot = layout.lots.find(l => l.id === W.workLotId)
    work.current.visible = !!lot && lot.kind !== 'market' && lot.kind !== 'farm'
    if (lot) work.current.position.set(lot.x, 0, lot.z)
  })
  const bed = stationFor(homeLot, 'sleep', 0), stove = stationFor(homeLot, 'cook', 0)
  return (
    <group>
      <mesh position={[bed.pos.x, 0.16, bed.pos.z]} material={sheet}><boxGeometry args={[0.5, 0.2, 1.05]} /></mesh>
      <mesh position={[bed.pos.x, 0.3, bed.pos.z - 0.5]} material={wood}><boxGeometry args={[0.5, 0.3, 0.06]} /></mesh>
      <mesh position={[homeLot.x, 0.33, homeLot.z + 0.25]} material={wood}><cylinderGeometry args={[0.24, 0.24, 0.05, 16]} /></mesh>
      <mesh position={[stove.pos.x, 0.3, stove.pos.z - 0.12]} material={steel}><boxGeometry args={[0.3, 0.42, 0.22]} /></mesh>
      {/* the blanket, over her when she sleeps */}
      <mesh ref={blanket} position={[bed.pos.x, 0.36, bed.pos.z + 0.14]} material={cover}><boxGeometry args={[0.52, 0.1, 0.72]} /></mesh>
      <group ref={work}>
        {Array.from({ length: 8 }, (_, i) => {
          const gx = (i % 4 - 1.5) * 0.9, gz = (Math.floor(i / 4) - 0.5) * 1.1
          return <mesh key={i} position={[gx, 0.3, gz - 0.25]} material={wood}><boxGeometry args={[0.6, 0.06, 0.32]} /></mesh>
        })}
      </group>
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
    const shown = Math.round(N * Math.max(0.05, Math.min(1, (W.food - 0.55) / 0.45)) * (W.hunger ? 0.4 : 1) * (W.hour > 6 && W.hour < 19 ? 1 : 0))
    const m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < N; i++) {
      const stall = i % 4, k = Math.floor(i / 4)
      m.makeTranslation(lot.x - 1.5 + stall * 1.0 - 0.25 + (k % 5) * 0.12, 0.62, lot.z - 0.9 + (k % 2) * 1.6 + ((k * 7) % 3 - 1) * 0.12)
      g.setMatrixAt(i, i < shown ? m : zero)
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

// ---------- people: family, coworkers, neighbors, the crowd ----------
type Agent = {
  id: string; kin?: Present; role: 'kin' | 'coworker' | 'crowd'
  skin: THREE.Color; cloth: THREE.Color; hair: THREE.Color; age: number; size: number; kid: boolean
  home: Lot; workplace: Workplace; slot: number; activity: 'working' | 'school' | 'retired' | 'infant' | 'unemployed'
  plan?: { day: number; plan: DayPlan }
  pos: THREE.Vector3; heading: number
}
const WORKPLACES: Workplace[] = ['shop', 'office', 'factory', 'clinic', 'school', 'construction']
const LEGS = new THREE.Color('#6b5f55')

function People({ record, layout, world, live }: { record: LifeRecord; layout: Layout; world: React.RefObject<WorldNow>; live: React.RefObject<LiveState> }) {
  const MAX = 110
  const { camera } = useThree()
  const seg = useMemo(() => ({ ab: new THREE.Vector3(), ap: new THREE.Vector3() }), [])
  // nobody may stand between the camera and her: anyone near that line (and closer than her) is skipped this frame
  const blocksHer = (x: number, z: number, L: LiveState) => {
    seg.ab.set(L.head.x - camera.position.x, 0, L.head.z - camera.position.z)
    seg.ap.set(x - camera.position.x, 0, z - camera.position.z)
    const len2 = seg.ab.lengthSq()
    if (len2 < 1e-6) return false
    const k = seg.ap.dot(seg.ab) / len2
    if (k < 0 || k > 0.92) return false
    return seg.ap.addScaledVector(seg.ab, -k).length() < 0.5
  }
  const torso = useRef<THREE.InstancedMesh>(null), head = useRef<THREE.InstancedMesh>(null), hair = useRef<THREE.InstancedMesh>(null)
  const arm = useRef<THREE.InstancedMesh>(null), leg = useRef<THREE.InstancedMesh>(null), eye = useRef<THREE.InstancedMesh>(null)
  const agents = useRef<Agent[]>([])
  const key = useRef('')
  const g = useMemo(() => ({
    torso: (() => { const t = new THREE.CapsuleGeometry(0.24, 0.3, 4, 10); t.translate(0, 0.36, 0); return t })(),
    head: new THREE.SphereGeometry(0.3, 14, 10),
    hair: (() => { const h = new THREE.SphereGeometry(0.315, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.55); h.translate(0, 0.02, -0.02); return h })(),
    arm: (() => { const l = new THREE.CapsuleGeometry(0.09, 0.3, 3, 8); l.translate(0, -0.24, 0); return l })(),
    leg: (() => { const l = new THREE.CapsuleGeometry(0.1, 0.42, 3, 8); l.translate(0, -0.31, 0); return l })(),
    eye: new THREE.SphereGeometry(0.045, 6, 4),
  }), [])
  const mat = useMemo(() => ({ inst: new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonGradient() }), eye: toon(C.ink) }), [])
  const tmp = useMemo(() => ({ base: new THREE.Matrix4(), torso: new THREE.Matrix4(), head: new THREE.Matrix4(), out: new THREE.Matrix4(), t: new THREE.Matrix4(), r: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), s: new THREE.Vector3() }), [])

  // the cast for this month: who lives where, who works next to her
  const cast = (W: WorldNow): Agent[] => {
    const r = (n: number) => hash01(n + record.seed)
    const out: Agent[] = []
    const skinOf = (k: number) => new THREE.Color(MONK[Math.max(0, Math.min(9, record.look.skinTone - 1 + Math.round((r(k) - 0.5) * 4)))])
    const clothOf = (k: number) => new THREE.Color(['#C9A046', '#6F9A6A', '#8873B0', '#4F8A8E', '#A65D57', '#5F7FA0', '#B08A5A', '#7A8B99'][Math.floor(r(k + 9) * 8)])
    const hairOf = (k: number, age: number) => new THREE.Color(HAIR_HEX[age > 60 ? 'gray' : record.look.hairColor] ?? '#2a221c').lerp(new THREE.Color('#3a2a20'), r(k + 3) * 0.4)
    const parentsHome = layout.homes[1] ?? layout.homes[0]
    const herAge = W.tick / 12
    const together = (rel: string) => rel === 'partner' || rel === 'child' || herAge < 20
    // all her living family are in the world: who she lives with at her home, parents and siblings at theirs
    W.kin.forEach((f, i) => {
      const home = f.relation === 'grandchild' ? (layout.homes[3] ?? parentsHome) : together(f.relation) ? layout.homes[0] : parentsHome
      const age = f.age
      const activity: Agent['activity'] = age < 5 ? 'infant' : age < 18 ? 'school' : age >= 63 ? 'retired' : 'working'
      out.push({ id: f.id, kin: f, role: 'kin', skin: skinOf(i), cloth: clothOf(i), hair: hairOf(i, age), age, size: 0.53 * heightShare(age), kid: age < 14, home, workplace: WORKPLACES[Math.floor(r(i * 31) * WORKPLACES.length)], slot: i + 1, activity, pos: new THREE.Vector3(home.x, 0, home.z), heading: 0 })
    })
    const herWork = layout.lots.find(l => l.id === W.workLotId)
    if (herWork) {
      const wp: Workplace = herWork.kind === 'market' ? 'shop' : (herWork.kind as Workplace)
      for (let i = 0; i < 5; i++) { const home = layout.homes[2 + (i % 8)] ?? layout.homes[0]; out.push({ id: `co${i}`, role: 'coworker', skin: skinOf(50 + i), cloth: clothOf(50 + i), hair: hairOf(50 + i, 35), age: 25 + r(i * 7) * 30, size: 0.53 * (0.92 + r(i) * 0.14), kid: false, home, workplace: wp, slot: i + 1, activity: 'working', pos: new THREE.Vector3(home.x, 0, home.z), heading: 0 }) }
    }
    const n = Math.round(30 + 60 * W.density)
    for (let i = 0; i < n; i++) {
      const age = r(i * 13 + 100) < 0.3 ? 6 + r(i) * 11 : 18 + r(i * 3) * 55
      const activity: Agent['activity'] = age < 18 ? 'school' : age > 63 ? 'retired' : r(i * 5) < 0.12 ? 'unemployed' : 'working'
      // neighbors live in the other homes, never in hers or her parents'
      const home = layout.homes[2 + (i % Math.max(1, layout.homes.length - 2))] ?? layout.homes[layout.homes.length - 1]
      out.push({ id: `p${i}`, role: 'crowd', skin: skinOf(200 + i), cloth: clothOf(200 + i), hair: hairOf(200 + i, age), age, size: 0.53 * heightShare(age) * (0.92 + r(i * 2) * 0.14), kid: age < 14, home, workplace: WORKPLACES[Math.floor(r(i * 17) * WORKPLACES.length)], slot: 6 + (i % 2), activity, pos: new THREE.Vector3(home.x, 0, home.z), heading: 0 }) // stations 6-7: never hers (0) or her coworkers' (1-5)
    }
    return out.slice(0, MAX)
  }

  useFrame(({ clock }) => {
    const W = world.current, L = live.current
    if (!W || !L || !torso.current || !head.current || !hair.current || !arm.current || !leg.current || !eye.current) return
    const k = `${W.cityId}:${W.tick}:${W.kin.map(f => f.id).join(',')}:${W.workLotId}`
    if (k !== key.current) { key.current = k; agents.current = cast(W); W.kinPos.clear() }
    const t = clock.elapsedTime
    const T = (x: number, y: number, z: number) => tmp.t.makeTranslation(x, y, z)
    const RX = (a: number) => tmp.r.makeRotationX(a)
    let n = 0
    for (const a of agents.current) {
      if (!a.plan || a.plan.day !== W.day) {
        const weekend = W.day % 7 >= 5
        // her parents' house hosts her on weekend afternoons: the family there stays home for it (the 'visit' stop
        // resolves to their own house)
        const hosts = a.role === 'kin' && a.home.id === (layout.homes[1] ?? layout.homes[0]).id && W.tick >= 240
        const defs = schedule(a.activity, { kids: false, weekend, religious: false, visit: weekend && hosts })
        // the crowd's days are offset a little so not everyone leaves at the same minute
        const jitter = (hash01(a.id.length * 97 + a.slot * 13 + W.day + (a.id.charCodeAt(1) || 0)) - 0.5) * 0.9
        a.plan = { day: W.day, plan: planDay(layout, a.home, defs.map((d, i) => ({ ...d, hour: i ? Math.max(0.1, d.hour + jitter) : 0 })), a.workplace, a.slot, a.role !== 'kin' && hash01(a.slot * 7 + W.day) < 0.4) }
      }
      const w = whereIn(a.plan.plan, W.hour)
      a.pos.set(w.pos.x, 0, w.pos.z)
      if (a.kin) W.kinPos.set(a.kin.id, a.pos.clone().setY(a.size * 1.75))
      // indoors people show only when the camera can see inside (her building is cut away)
      const visible = (!w.indoors || w.stop.lot.id === W.lotId) && !w.onBus
      if (!visible || n >= MAX || blocksHer(a.pos.x, a.pos.z, L)) continue
      let heading = w.heading
      if (a.role === 'kin' && w.stop.at === 'home' && W.lotId === w.stop.lot.id && !w.moving) heading = Math.atan2(L.pos.x - a.pos.x, L.pos.z - a.pos.z)
      a.heading += Math.atan2(Math.sin(heading - a.heading), Math.cos(heading - a.heading)) * 0.15
      const walk = w.moving ? Math.sin(t * 7 + a.slot * 1.7) : 0
      const sit = w.pose === 'sit', lie = w.pose === 'lie', busy = w.pose === 'busy'
      const hip = sit ? 0.32 : 0.62
      const pitch = lie ? -1.5 : busy ? 0.15 : 0
      tmp.e.set(0, a.heading, 0)
      tmp.base.compose(tmp.v.set(a.pos.x, lie ? 0.3 : Math.abs(walk) * 0.03, a.pos.z), tmp.q.setFromEuler(tmp.e), tmp.s.setScalar(a.size))
      tmp.torso.copy(tmp.base).multiply(T(0, hip, 0)).multiply(RX(pitch))
      torso.current.setMatrixAt(n, tmp.torso); torso.current.setColorAt(n, a.cloth)
      tmp.head.copy(tmp.torso).multiply(T(0, 0.98, 0))
      if (a.kid) tmp.head.scale(tmp.v.set(1.2, 1.2, 1.2))
      head.current.setMatrixAt(n, tmp.head); head.current.setColorAt(n, a.skin)
      hair.current.setMatrixAt(n, tmp.head); hair.current.setColorAt(n, a.hair)
      for (const side of [0, 1]) {
        const sx = side ? -1 : 1
        eye.current.setMatrixAt(n * 2 + side, tmp.out.copy(tmp.head).multiply(T(sx * 0.1, 0.03, 0.27)))
        const armA = w.moving ? -walk * 0.8 * sx : busy ? -1.1 + Math.sin(t * 5 + a.slot) * 0.3 : sit ? -0.4 : 0.08
        arm.current.setMatrixAt(n * 2 + side, tmp.out.copy(tmp.torso).multiply(T(sx * 0.3, 0.6, 0)).multiply(RX(armA)))
        arm.current.setColorAt(n * 2 + side, a.cloth)
        const legA = sit ? -1.45 : lie ? -1.5 : walk * 0.6 * sx
        leg.current.setMatrixAt(n * 2 + side, tmp.out.copy(tmp.base).multiply(T(sx * 0.13, lie ? 0.1 : hip, 0)).multiply(RX(legA)))
        leg.current.setColorAt(n * 2 + side, LEGS)
      }
      n++
    }
    // passersby: people walking along whatever street she is on, so her street is never empty in the day.
    // how many follows the real density and the hour (ESTIMATE). they are decoration around her, not tracked lives
    const nearX = STREETS.reduce((b, s) => (Math.abs(s - L.pos.x) < Math.abs(b - L.pos.x) ? s : b))
    const nearZ = STREETS.reduce((b, s) => (Math.abs(s - L.pos.z) < Math.abs(b - L.pos.z) ? s : b))
    const alongZ = Math.abs(nearX - L.pos.x) < Math.abs(nearZ - L.pos.z)
    const day = W.hour > 6 && W.hour < 21.5 ? 1 : W.hour > 5 && W.hour < 23 ? 0.35 : 0.1
    const pass = Math.round(day * (5 + 11 * W.density))
    for (let j = 0; j < pass && n < MAX; j++) {
      const dir = j % 2 ? 1 : -1
      const sp = 0.7 + hash01(j * 5 + record.seed) * 0.5
      const along = ((t * sp * dir + hash01(j * 3) * 26) % 26 + 26) % 26 - 13
      const side = (j % 4 < 2 ? 0.78 : -0.78) + (hash01(j * 11) - 0.5) * 0.2
      const x = alongZ ? nearX + side : L.pos.x + along, z = alongZ ? L.pos.z + along : nearZ + side
      const heading = alongZ ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2)
      if (blocksHer(x, z, L)) continue
      const kid = hash01(j * 7) < 0.25
      const size = 0.53 * (kid ? 0.7 : 0.95 + hash01(j) * 0.12)
      const walk = Math.sin(t * 7 * sp + j)
      tmp.e.set(0, heading, 0)
      tmp.base.compose(tmp.v.set(x, Math.abs(walk) * 0.02, z), tmp.q.setFromEuler(tmp.e), tmp.s.setScalar(size))
      tmp.torso.copy(tmp.base).multiply(T(0, 0.62, 0))
      const look = agents.current[(j * 7) % Math.max(1, agents.current.length)]
      if (!look) break
      torso.current.setMatrixAt(n, tmp.torso); torso.current.setColorAt(n, look.cloth)
      tmp.head.copy(tmp.torso).multiply(T(0, 0.98, 0))
      if (kid) tmp.head.scale(tmp.v.set(1.2, 1.2, 1.2))
      head.current.setMatrixAt(n, tmp.head); head.current.setColorAt(n, look.skin)
      hair.current.setMatrixAt(n, tmp.head); hair.current.setColorAt(n, look.hair)
      for (const sd of [0, 1]) {
        const sx = sd ? -1 : 1
        eye.current.setMatrixAt(n * 2 + sd, tmp.out.copy(tmp.head).multiply(T(sx * 0.1, 0.03, 0.27)))
        arm.current.setMatrixAt(n * 2 + sd, tmp.out.copy(tmp.torso).multiply(T(sx * 0.3, 0.6, 0)).multiply(RX(-walk * 0.8 * sx)))
        arm.current.setColorAt(n * 2 + sd, look.cloth)
        leg.current.setMatrixAt(n * 2 + sd, tmp.out.copy(tmp.base).multiply(T(sx * 0.13, 0.62, 0)).multiply(RX(walk * 0.6 * sx)))
        leg.current.setColorAt(n * 2 + sd, LEGS)
      }
      n++
    }
    if (process.env.NODE_ENV === 'development') { const D = W as WorldNow & { _people?: number; _agents?: number }; D._people = n; D._agents = agents.current.length }
    for (const [im, per] of [[torso.current, 1], [head.current, 1], [hair.current, 1], [arm.current, 2], [leg.current, 2], [eye.current, 2]] as const) {
      im.count = n * per
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
    }
  })
  return (
    <group>
      <instancedMesh ref={torso} args={[g.torso, mat.inst, MAX]} castShadow frustumCulled={false} />
      <instancedMesh ref={head} args={[g.head, mat.inst, MAX]} castShadow frustumCulled={false} />
      <instancedMesh ref={hair} args={[g.hair, mat.inst, MAX]} frustumCulled={false} />
      <instancedMesh ref={arm} args={[g.arm, mat.inst, MAX * 2]} frustumCulled={false} />
      <instancedMesh ref={leg} args={[g.leg, mat.inst, MAX * 2]} frustumCulled={false} />
      <instancedMesh ref={eye} args={[g.eye, mat.eye, MAX * 2]} frustumCulled={false} />
    </group>
  )
}

// ---------- the bus: when she rides, it is her bus; otherwise it runs its route ----------
function Bus({ world }: { world: React.RefObject<WorldNow> }) {
  const ref = useRef<THREE.Group>(null)
  const body = useMemo(() => new THREE.MeshToonMaterial({ color: '#D9A441', gradientMap: toonGradient(), transparent: true, opacity: 1 }), [])
  const glass = useMemo(() => new THREE.MeshBasicMaterial({ color: '#9fb3bf', transparent: true, opacity: 0.7 }), [])
  const last = useRef({ x: 0, dir: 1 })
  useFrame((_, dt) => {
    const W = world.current, g = ref.current
    if (!W || !g) return
    let x: number
    if (W.busX !== null) x = W.busX
    else { const p = (W.hour * 1.3) % 2; x = (p < 1 ? p : 2 - p) * 36 - 18 } // back and forth along the street, ESTIMATE schedule
    if (Math.abs(x - last.current.x) > 0.001) last.current.dir = x >= last.current.x ? 1 : -1
    last.current.x = x
    g.position.set(x, 0, BUS_Z - 0.25)
    g.rotation.y = last.current.dir > 0 ? Math.PI / 2 : -Math.PI / 2
    // when she is on board, the body goes see-through so she stays visible
    body.opacity = damp(body.opacity, W.busX !== null ? 0.28 : 1, 6, dt)
    body.depthWrite = body.opacity > 0.95
  })
  return (
    <group ref={ref}>
      <mesh position={[0, 0.85, 0]} material={body} castShadow><boxGeometry args={[1.25, 1.2, 3.4]} /></mesh>
      <mesh position={[0, 1.05, 0]} material={glass}><boxGeometry args={[1.27, 0.38, 3.0]} /></mesh>
      {[-1.1, 1.1].map(z => [-0.62, 0.62].map(xx => <mesh key={`${z}${xx}`} position={[xx, 0.22, z]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.22, 0.22, 0.14, 12]} /><meshToonMaterial color="#2f2d2b" gradientMap={toonGradient()} /></mesh>))}
    </group>
  )
}

// ---------- traffic: cars and motorbikes on the streets, more at rush hour ----------
function Traffic({ world, live }: { world: React.RefObject<WorldNow>; live: React.RefObject<LiveState> }) {
  const { camera } = useThree()
  const N = 40
  const cars = useRef<THREE.InstancedMesh>(null)
  const motos = useRef<THREE.InstancedMesh>(null)
  const carCount: number[] = [], motoCount: number[] = []
  // a small car: body plus cabin (1.6 long at scale 0.62 = about 1 unit, a person's height); a motorbike with a rider's bump
  const carGeo = useMemo(() => { const b = new THREE.BoxGeometry(0.9, 0.38, 1.6); b.translate(0, 0.32, 0); const c = new THREE.BoxGeometry(0.8, 0.32, 0.85); c.translate(0, 0.66, -0.1); return mergeGeometries([b, c])! }, [])
  const motoGeo = useMemo(() => { const f = new THREE.BoxGeometry(0.18, 0.3, 1.0); f.translate(0, 0.42, 0); const r = new THREE.BoxGeometry(0.32, 0.55, 0.32); r.translate(0, 0.85, -0.12); return mergeGeometries([f, r])! }, [])
  const lanes = useMemo(() => Array.from({ length: N }, (_, i) => ({ street: STREETS[i % STREETS.length], axis: i % 2, dir: i % 4 < 2 ? 1 : -1, speed: 2.2 + hash01(i) * 2.5, off: hash01(i * 7) * 60, moto: hash01(i * 3) < 0.45, color: new THREE.Color(['#7A8B99', '#A65D57', '#E8E2D6', '#2f2d2b', '#5F7FA0', '#C9A046'][i % 6]) })), [])
  useFrame(({ clock }) => {
    const W = world.current, m = cars.current
    if (!W || !m) return
    // ESTIMATE: traffic follows the day, peaks around 8 and 18, thin at night, scaled by real density
    const h = W.hour
    const rush = Math.exp(-((h - 8) ** 2) / 2) + Math.exp(-((h - 18) ** 2) / 2)
    const show = Math.round(N * Math.min(1, (0.15 + 0.8 * rush + (h > 6 && h < 21 ? 0.25 : 0)) * (0.5 + W.density)))
    const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), zero = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < N; i++) {
      const l = lanes[i]
      if (i >= show || (l.street === BUS_Z && l.axis === 0)) { m.setMatrixAt(i, zero); continue }
      const p = ((clock.elapsedTime * l.speed * l.dir + l.off) % 40 + 40) % 40 - 20
      const side = l.dir * 0.28
      v.set(l.axis ? l.street + side : p, 0.32, l.axis ? p : l.street + side)
      // a car between the camera and her pulls out of the shot (she is always visible)
      const L = live.current
      if (L) {
        const ax = camera.position.x, az = camera.position.z, bx = L.head.x - ax, bz = L.head.z - az, len2 = bx * bx + bz * bz
        const k = len2 > 1e-6 ? ((v.x - ax) * bx + (v.z - az) * bz) / len2 : -1
        if (k > 0 && k < 0.95 && Math.hypot(v.x - (ax + bx * k), v.z - (az + bz * k)) < 0.9) { m.setMatrixAt(i, zero); continue }
      }
      q.setFromAxisAngle(up, l.axis ? (l.dir > 0 ? 0 : Math.PI) : (l.dir > 0 ? Math.PI / 2 : -Math.PI / 2))
      s.setScalar(l.moto ? 0.42 : 0.62)
      v.y = 0
      m.setMatrixAt(i, mat.compose(v, q, s))
      m.setColorAt(i, l.color)
      ;(l.moto ? motoCount : carCount).push(i)
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    // motorbikes get the slim shape: hide car bodies for them by swapping into the moto mesh
    const mm = motos.current
    if (mm) {
      for (let i = 0; i < N; i++) { m.getMatrixAt(i, mat); if (lanes[i].moto) { mm.setMatrixAt(i, mat); m.setMatrixAt(i, zero) } else mm.setMatrixAt(i, zero); mm.setColorAt(i, lanes[i].color) }
      mm.instanceMatrix.needsUpdate = true
      if (mm.instanceColor) mm.instanceColor.needsUpdate = true
      m.instanceMatrix.needsUpdate = true
    }
    carCount.length = 0; motoCount.length = 0
  })
  return (
    <group>
      <instancedMesh ref={cars} args={[carGeo, undefined, N]} castShadow frustumCulled={false}><meshToonMaterial gradientMap={toonGradient()} /></instancedMesh>
      <instancedMesh ref={motos} args={[motoGeo, undefined, N]} castShadow frustumCulled={false}><meshToonMaterial gradientMap={toonGradient()} /></instancedMesh>
    </group>
  )
}

// ---------- street lights, on at night ----------
function StreetLights({ world, live }: { world: React.RefObject<WorldNow>; live: React.RefObject<LiveState> }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#f6d58c' }), [])
  const pts = useMemo(() => STREETS.flatMap(x => [-12, -6, 0, 6, 12].map(z => [x + 0.75, z + 3] as const)), [])
  const poles = useRef<(THREE.Group | null)[]>([])
  const { camera } = useThree()
  useFrame(() => {
    const W = world.current, L = live.current
    if (W) mat.color.set(W.hour > 18.2 || W.hour < 6.2 ? '#f6d58c' : '#8f8a80')
    if (!L) return
    // a pole between the camera and her steps out of the way (she is always visible)
    const ax = camera.position.x, az = camera.position.z, bx = L.head.x - ax, bz = L.head.z - az, len2 = bx * bx + bz * bz
    pts.forEach(([x, z], i) => {
      const g = poles.current[i]
      if (!g || len2 < 1e-6) return
      const k = ((x - ax) * bx + (z - az) * bz) / len2
      const d = Math.hypot(x - (ax + bx * k), z - (az + bz * k))
      g.visible = !(k > 0 && k < 0.95 && d < 0.35)
    })
  })
  return (
    <group>
      {pts.map(([x, z], i) => (
        <group key={i} ref={el => { poles.current[i] = el }} position={[x, 0, z]}>
          <mesh position={[0, 0.9, 0]}><cylinderGeometry args={[0.03, 0.04, 1.8, 6]} /><meshToonMaterial color="#5f5a52" gradientMap={toonGradient()} /></mesh>
          <mesh position={[0, 1.82, 0]} material={mat}><sphereGeometry args={[0.09, 8, 6]} /></mesh>
        </group>
      ))}
    </group>
  )
}

// ---------- a protest walking past her window ----------
function Protest({ homeLot, world }: { homeLot: Lot; world: React.RefObject<WorldNow> }) {
  const N = 14
  const g = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const W = world.current
    if (!g.current || !W) return
    g.current.visible = W.protest && W.hour > 9 && W.hour < 18
    if (!g.current.visible) return
    const z = homeLot.door.z
    g.current.children.forEach((c, i) => c.position.set(((clock.elapsedTime * 0.9 + i * 0.9) % 30) - 15, Math.abs(Math.sin(clock.elapsedTime * 6 + i)) * 0.05, z + (i % 2 ? 0.25 : -0.25)))
  })
  return (
    <group ref={g} visible={false}>
      {Array.from({ length: N }, (_, i) => (
        <group key={i} scale={0.53} rotation-y={Math.PI / 2}>
          <mesh position={[0, 0.98, 0]}><capsuleGeometry args={[0.24, 0.3, 4, 10]} /><meshToonMaterial color={['#7E9CB5', '#C9A46A', '#8FAE84', '#B98370'][i % 4]} gradientMap={toonGradient()} /></mesh>
          <mesh position={[0, 1.6, 0]}><sphereGeometry args={[0.3, 12, 8]} /><meshToonMaterial color={MONK[(i * 3) % 10]} gradientMap={toonGradient()} /></mesh>
          {i % 3 === 0 && <mesh position={[0.36, 1.9, 0.12]}><boxGeometry args={[0.62, 0.42, 0.04]} /><meshToonMaterial color={C.bone} gradientMap={toonGradient()} /></mesh>}
        </group>
      ))}
    </group>
  )
}

// ---------- rain around her, from the real wet season ----------
function Rain({ live, world }: { live: React.RefObject<LiveState>; world: React.RefObject<WorldNow> }) {
  const N = 400
  const ref = useRef<THREE.InstancedMesh>(null)
  const seeds = useMemo(() => Float32Array.from({ length: N * 3 }, (_, i) => hash01(i)), [])
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
  return <instancedMesh ref={ref} args={[undefined, undefined, N]} frustumCulled={false}><boxGeometry args={[0.012, 0.28, 0.012]} /><meshBasicMaterial color="#8fa3b0" transparent opacity={0.45} /></instancedMesh>
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
  return <mesh ref={ref} position={[homeLot.x - 0.6, 0.9, homeLot.z + 0.55]} material={mat}><boxGeometry args={[0.4, 0.26, 0.03]} /></mesh>
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
