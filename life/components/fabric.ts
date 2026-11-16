// the neighborhood's plan as pure data: row houses, public buildings, open lots, trees, poles, laundry, chairs, cans,
// and the boxes people and the camera must not pass through. no react, no rendering: the scene draws it, the qa
// script (scripts/life-qa.ts) checks bodies against it in node
import * as THREE from 'three'
import type { Layout, Lot } from '@/components/world/city/layout'
import { K, STREETS_W, hash01, marketPlan } from './plan'
import type { CityStyle } from './style'
import { DIMS } from './dims'

export const CENTERS = [-12, -6, 0, 6, 12].map(c => c * K)
export const HALF = 2.5 * K // half a block
// the lane: house fronts stand back from the block edge so a residential lane is ~3.6 units (6 m) facade to facade, with
// a 0.55 stoop on each side: ~2.5 units (4.3 m) of open lane, like the reference photos' lanes (ESTIMATE)
export const FRONT = HALF - 0.6 // block center to facade
export const STOOP_D = 0.55
export const FACADE_FROM_STREET = 3 * K - FRONT // street centerline to facade (1.8)
export const LANE_HALF = FACADE_FROM_STREET - STOOP_D // street centerline to the stoop edge (1.25)

// ---------- the plan of the neighborhood (pure) ----------
export type Unit = {
  id: number; x: number; z: number; w: number; d: number; h: number; face: 1 | -1 // facade faces +z or -z
  wall: string; band: string; door: string; roof: string; shop: string | null; storeys: number; lotId: number | null
}
export type Special = { id: number; lot: Lot; x: number; z: number; w: number; d: number; h: number; wall: string; band: string; label: string }
export type Fabric = { stoops: boolean; units: Unit[]; specials: Special[]; open: Lot[]; trees: { x: number; z: number; r: number; palm: boolean }[]; poles: { x: number; z: number }[]; laundry: { x: number; z: number; w: number; rot: number }[]; chairs: { x: number; z: number; rot: number; color: string }[]; cans: { x: number; z: number }[] }

const SHOP_WORDS: Record<CityStyle['kind'], string[]> = {
  swahili: ['DUKA', 'SALUNI', 'MGAHAWA', 'DAWA', 'SIMU', 'FUNDI', 'NGUO', 'VIATU'], // shop, salon, eatery, medicine, phones, repairs, clothes, shoes
  tana: ['FIVAROTANA', 'HOTELY', 'MOFO', 'LAMBA', 'FANAMBOARANA'], // shop, small restaurant, bread, cloth, repairs
  musseque: ['LOJA', 'CANTINA', 'SALAO', 'FARMACIA', 'TELEMOVEIS'], // shop, canteen, salon, pharmacy, phones
  generic: ['SHOP', 'CAFE', 'PHONES', 'TAILOR', 'MEDICINE'],
}
const SPECIAL_LABEL: Record<string, Record<CityStyle['kind'], string>> = {
  clinic: { swahili: 'ZAHANATI', tana: 'TOBY FAHASALAMANA', musseque: 'POSTO DE SAUDE', generic: 'CLINIC' },
  school: { swahili: 'SHULE YA MSINGI', tana: 'SEKOLY', musseque: 'ESCOLA PRIMARIA', generic: 'SCHOOL' },
  office: { swahili: 'OFISI', tana: 'BIRAO', musseque: 'ESCRITORIO', generic: 'OFFICES' },
  factory: { swahili: 'KIWANDA', tana: 'ORINASA', musseque: 'FABRICA', generic: 'WORKS' },
  lab: { swahili: 'MAABARA', tana: 'LABORATOARA', musseque: 'LABORATORIO', generic: 'LAB' },
  shrine: { swahili: 'MSIKITI', tana: 'FIANGONANA', musseque: 'IGREJA', generic: 'PRAYER HALL' },
}

export function buildFabric(layout: Layout, style: CityStyle, seed: string): Fabric {
  let h0 = 2166136261
  for (let i = 0; i < seed.length; i++) h0 = Math.imul(h0 ^ seed.charCodeAt(i), 16777619) >>> 0
  const r = (n: number) => hash01(h0 % 100000 + n)
  const pick = <T,>(xs: T[], n: number) => xs[Math.floor(r(n) * xs.length) % xs.length]
  const blockOf = (l: Lot) => `${Math.round(l.x / 6) * 6},${Math.round(l.z / 6) * 6}`
  const specialBlocks = new Map<string, Lot[]>()
  for (const l of layout.lots) if (l.kind !== 'home') specialBlocks.set(blockOf(l), [...(specialBlocks.get(blockOf(l)) ?? []), l])
  const homeLots = layout.lots.filter(l => l.kind === 'home')
  const units: Unit[] = [], specials: Special[] = [], open: Lot[] = []
  const trees: Fabric['trees'] = [], laundry: Fabric['laundry'] = [], chairs: Fabric['chairs'] = [], cans: Fabric['cans'] = []
  let id = 1000
  const [s0, s1] = style.storeys
  for (const cx of CENTERS) for (const cz of CENTERS) {
    const key = `${Math.round(cx / K)},${Math.round(cz / K)}`
    const sp = specialBlocks.get(key)
    if (sp) {
      for (const l of sp) {
        const x = l.x * K, z = l.z * K, w = l.w * K, d = l.d * K
        if (['market', 'park', 'square', 'farm'].includes(l.kind)) { open.push(l); continue }
        const lab = SPECIAL_LABEL[l.kind]?.[style.kind] ?? ''
        specials.push({ id: l.id, lot: l, x, z, w: w * 0.92, d: d * 0.92, h: DIMS.storey * Math.max(1, l.floors) + 0.15, wall: l.kind === 'clinic' ? '#F1EEE8' : pick(style.walls, l.id * 3), band: l.kind === 'clinic' ? '#3E9C7A' : pick(style.bands, l.id * 5), label: lab })
      }
      continue
    }
    // row houses along both street faces of the block; the back halves are yards
    for (const face of [1, -1] as const) {
      const n = 5, uw = (FRONT * 2) / n, ud = 4.2
      const row: Unit[] = []
      for (let i = 0; i < n; i++) {
        let x = cx - FRONT + uw * (i + 0.5)
        const zFront = cz + face * FRONT
        const k = (id + i) * 7 + face * 3
        // a real home lot on this face takes the unit nearest its door
        const lot = homeLots.find(l => Math.abs(l.door.z * K - (cz + face * (HALF + 1.2))) < 0.6 && Math.abs(l.x * K - x) < uw * 0.55)
        if (lot) x = lot.x * K
        const storeys = s0 + Math.floor(r(k) * (s1 - s0 + 1))
        const shop = r(k + 1) < 0.22 ? pick(SHOP_WORDS[style.kind], k + 2) : null
        row.push({ id: lot ? lot.id : id++, x, z: zFront - face * ud / 2, w: uw - 0.06, d: ud, h: (style.kind === 'tana' ? Math.max(2, storeys) : storeys) * DIMS.storey + 0.1, face,
          wall: pick(style.walls, k + 3), band: pick(style.bands, k + 4), door: pick(style.doors, k + 5), roof: pick(style.roofs, k + 6), shop, storeys, lotId: lot ? lot.id : null })
      }
      // a house snapped to its real lot keeps its place; a neighbor it now overlaps gives way (trimmed to the gap, or
      // left out as an open yard when too narrow to be a house). walls never stand inside walls
      for (const u of row) if (u.lotId === null) {
        for (const o of row) if (o.lotId !== null && o !== u) {
          const lo = Math.max(u.x - u.w / 2, o.x - o.w / 2), hi = Math.min(u.x + u.w / 2, o.x + o.w / 2)
          if (hi <= lo) continue
          const left = u.x < o.x
          const a = left ? u.x - u.w / 2 : o.x + o.w / 2 + 0.04, b = left ? o.x - o.w / 2 - 0.04 : u.x + u.w / 2
          u.w = Math.max(0, b - a); u.x = (a + b) / 2
        }
      }
      for (const u of row) {
        if (u.w < 1.1) continue
        units.push(u)
        const zFront = u.z + face * u.d / 2, k = u.id * 7 + face * 3
        // on the stoop, at the far end from the door: a plastic chair, a yellow jerrycan
        // (no loose plastic chairs: people rest on the step, and a chair would stand where they sit)
        if (false && r(k + 7) < 0.35) chairs.push({ x: u.x + u.w * 0.36 * (r(k + 8) < 0.5 ? 1 : -1), z: zFront + face * STOOP_D * 0.55, rot: face > 0 ? 0 : Math.PI, color: pick(['#C9483B', '#3E6FA8', '#E8E2D6', '#3E8C6A'], k + 9) })
        if (r(k + 10) < 0.3) cans.push({ x: u.x - u.w * 0.4, z: zFront + face * 0.2 })
      }
    }
    // yards: trees and laundry lines between the backs of the houses
    for (let t = 0; t < 2 + Math.floor(r(cx * 3 + cz) * 2); t++) trees.push({ x: cx + (r(cx + cz + t * 11) - 0.5) * HALF * 1.6, z: cz + (r(cx - cz + t * 13) - 0.5) * 2.2, r: 0.9 + r(t + cx) * 0.6, palm: style.kind !== 'tana' && r(cx * cz + t) < 0.25 })
    if (r(cx + cz * 7) < 0.8) laundry.push({ x: cx + (r(cx + 5) - 0.5) * 4, z: cz + (r(cz + 9) - 0.5) * 1.6, w: 3.2, rot: 0 })
  }
  // wooden power poles along the lanes, alternating sides, ~8 units apart
  const poles: Fabric['poles'] = []
  // at the lane's edge (where the stoops end), clear of people walking the lane
  const edge = LANE_HALF + 0.07
  // along the house fronts they stand at the party walls between two houses (where nobody sits or stands at a door);
  // along the side streets (no fronts) every 7.2
  const fronts = new Set<string>()
  for (const u of units) {
    const right = u.x + u.w / 2
    const nb = units.find(o => o !== u && Math.abs(o.z - u.z) < 0.01 && Math.abs(o.x - o.w / 2 - right) < 0.2)
    const key = `${Math.round(u.z)}:${u.face}`
    if (nb && !fronts.has(`${key}:${Math.round(right * 2)}`) && Math.round(right / 2.1) % 2 === 0) {
      fronts.add(`${key}:${Math.round(right * 2)}`)
      const lane = u.z + u.face * (u.d / 2 + FACADE_FROM_STREET)
      poles.push({ x: (right + nb.x - nb.w / 2) / 2, z: lane - u.face * edge })
    }
  }
  // (never in front of a door: a pole stands where nobody walks in or out)
  const doors = layout.lots.map(l => ({ x: l.door.x * K, z: l.door.z * K }))
  for (const s of STREETS_W) for (let p = -34; p <= 34; p += 7.2) {
    const pole = { x: s + (Math.round(p / 7.2) % 2 ? edge : -edge), z: p + 1.7 }
    if (!doors.some(d => Math.hypot(d.x - pole.x, d.z - pole.z) < 1.6)) poles.push(pole)
  }
  return { stoops: style.stoops, units, specials, open, trees, poles, laundry, chairs, cans }
}


// solid boxes: each unit's walls; the eave/awning as a separate box from awning height up (a person can stand under it)
export type Solid = { id: number; idx: number; box: THREE.Box3; kind: 'wall' | 'eave' | 'special' | 'stoop' | 'stall' | 'pole' }
// a market stall table: ~1.2 x 0.8 m, 0.76 m high (world units)
export const STALL = { w: 0.7, d: 0.47, h: 0.45 }
export function fabricSolids(fabric: Fabric): Solid[] {
  const U = fabric.units
  return [
    ...U.map((u, idx) => ({ id: u.id, idx, kind: 'wall' as const, box: new THREE.Box3(new THREE.Vector3(u.x - u.w / 2, 0, u.z - u.d / 2), new THREE.Vector3(u.x + u.w / 2, u.h + 0.4, u.z + u.d / 2)) })),
    ...U.map((u, idx) => ({ id: u.id, idx, kind: 'eave' as const, box: new THREE.Box3(new THREE.Vector3(u.x - u.w / 2, DIMS.awning - 0.05, u.face < 0 ? u.z - u.d / 2 - 0.9 : u.z + u.d / 2), new THREE.Vector3(u.x + u.w / 2, u.h + 0.4, u.face < 0 ? u.z - u.d / 2 : u.z + u.d / 2 + 0.9)) })),
    // the stoop: a raised step along the front (people sit on it; nobody stands inside it)
    ...U.filter(() => fabric.stoops).map((u, idx) => { const fz = u.z + u.face * u.d / 2; return { id: u.id, idx, kind: 'stoop' as const, box: new THREE.Box3(new THREE.Vector3(u.x - u.w / 2 + 0.05, 0, Math.min(fz, fz + u.face * STOOP_D)), new THREE.Vector3(u.x + u.w / 2 - 0.05, 0.2, Math.max(fz, fz + u.face * STOOP_D))) } }),
    ...fabric.open.filter(l => l.kind === 'market').flatMap(l => marketPlan(l).stalls.map(st => { const x = (l.x + st.x) * K, z = (l.z + st.z) * K; const rot = Math.abs(Math.sin(st.facing)) > 0.5, hw = (rot ? STALL.d : STALL.w) / 2, hd = (rot ? STALL.w : STALL.d) / 2; return { id: l.id, idx: -1, kind: 'stall' as const, box: new THREE.Box3(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, STALL.h, z + hd)) } })),
    ...fabric.poles.map(p => ({ id: -2, idx: -1, kind: 'pole' as const, box: new THREE.Box3(new THREE.Vector3(p.x - 0.05, 0, p.z - 0.05), new THREE.Vector3(p.x + 0.05, 3, p.z + 0.05)) })),
    ...fabric.specials.map(s => ({ id: s.id, idx: -1, kind: 'special' as const, box: new THREE.Box3(new THREE.Vector3(s.x - s.w / 2, 0, s.z - s.d / 2), new THREE.Vector3(s.x + s.w / 2, s.h + 0.3, s.z + s.d / 2)) })),
  ]
}
