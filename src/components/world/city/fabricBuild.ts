// the real city around the lots, as plain data (rendered by Fabric.tsx, walked around by pipSim, checked by qa):
// every block the lots don't use and a surround that continues the street grid into the fog, built from the city's
// real GHSL cells in its region's look (looks.ts). housing shows here: towers where the real core is tall, informal
// settlements as many as the country's urban slum share (UN-Habitat, via B's housing seed, moved by the pips' own
// homes), a camp where the country has large camps, a building site where the city grows. street level: sidewalks,
// lamps, trees, poles and wires, shop signs, rooftop tanks, tokyo's vending machines. all at real sizes (grid.ts).
import { BLOCK, CENTERS, CURB, EDGE, FLOOR, FURNITURE, GROUND_FLOOR, GROUND_Y, ROAD_Y, SIDEWALK, SPACING, STREETS, m, type Grid } from './grid'
import type { Look } from './looks'
import { cellAt, type CityProfile } from './realCity'
import { FAR } from './trafficSim'

export const SUR = FAR

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }
function rng(seed: number) { let a = seed || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length) % a.length]
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-6, r()))) * Math.cos(2 * Math.PI * r())

// the ground: roads sit a curb (15 cm) below sidewalks and yards
export function groundAt(x: number, z: number) {
  const near = (v: number) => { const k = Math.round(v / SPACING - 0.5) + 0.5; return Math.abs(v - k * SPACING) }
  return near(x) < CURB || near(z) < CURB ? ROAD_Y : GROUND_Y
}

// the highest ground under a foot of radius r (a foot over a curb edge stands on the curb, it can't sink into it)
export function groundUnder(x: number, z: number, r: number) {
  return Math.max(groundAt(x, z), groundAt(x + r, z), groundAt(x - r, z), groundAt(x, z + r), groundAt(x, z - r))
}

// ---- the tallest roof under any spot, so the camera can stay above them ----
const HG = 2, HN = Math.ceil((SUR * 2 + 12) / HG)
export const heightGrid = new Float32Array(HN * HN)
const hgIdx = (x: number, z: number) => { const i = Math.floor((x + SUR + 6) / HG), j = Math.floor((z + SUR + 6) / HG); return i < 0 || j < 0 || i >= HN || j >= HN ? -1 : i * HN + j }
export function roofAt(x: number, z: number) {
  let mx = 0
  for (const dx of [-HG, 0, HG]) for (const dz of [-HG, 0, HG]) { const k = hgIdx(x + dx, z + dz); if (k >= 0) mx = Math.max(mx, heightGrid[k]) }
  return mx
}
export function markHeight(x: number, z: number, w: number, d: number, top: number) {
  for (let xx = x - w / 2; xx <= x + w / 2 + 0.01; xx += HG) for (let zz = z - d / 2; zz <= z + d / 2 + 0.01; zz += HG) { const k = hgIdx(xx, zz); if (k >= 0) heightGrid[k] = Math.max(heightGrid[k], top) }
}

export type Item = { p: [number, number, number]; s: [number, number, number]; c?: string; ry?: number; shop?: number }
export type Built = {
  walls: Item[]; wallsFar: Item[]; flat: Item[]; prism: Item[]; iron: Item[]; shackWalls: Item[]; shackRoofs: Item[]; tents: Item[]
  sidewalks: Item[]; pads: Item[]; green: Item[]; signs: Item[]; tanks: Item[]; tankCaps: Item[]; ac: Item[]
  poles: Item[]; wires: Item[]; lamps: Item[]; lampHeads: Item[]; glows: Item[]; trunks: Item[]; crowns: Item[]; palms: Item[]
  steel: Item[]; farGlows: Item[]
  posts: { x: number; z: number; r: number }[] // everything on the sidewalks people must walk around
  boxes: { x: number; z: number; w: number; d: number; h: number }[] // fabric buildings on the plate (for the qa)
}

export type FabricInput = {
  profile: CityProfile; look: Look; grid: Grid
  informal: number // share of homes that are informal, 0..1
  camp: boolean; growing: boolean; bare: boolean; leftHand: boolean
}

export function buildFabric(inp: FabricInput): Built {
  const { profile, look, grid } = inp
  const H = GROUND_Y
  const r = rng(hash(profile.row.id + look.id))
  const B: Built = { walls: [], wallsFar: [], flat: [], prism: [], iron: [], shackWalls: [], shackRoofs: [], tents: [], sidewalks: [], pads: [], green: [], signs: [], tanks: [], tankCaps: [], ac: [], poles: [], wires: [], lamps: [], lampHeads: [], glows: [], trunks: [], crowns: [], palms: [], steel: [], farGlows: [], posts: [], boxes: [] }
  heightGrid.fill(0)
  const roofOf = () => { let u = r(); for (const k of look.roofs) { if ((u -= k.share) <= 0) return k } return look.roofs[0] }
  const floorsFor = (heightM: number) => {
    const mean = Math.max(1, heightM / 3.2) * look.tall
    const sigma = 0.5 + 0.3 * Math.min(1, Math.max(0, (heightM - 10) / 20))
    return Math.max(1, Math.min(48, Math.round(mean * Math.exp(gauss(r) * sigma - sigma * sigma / 2))))
  }

  // one building: body (windows come from the shader), a roof by kind, a shop sign, maybe a rooftop tank
  const building = (x: number, z: number, w: number, d: number, floors: number, far: boolean, face: [number, number]) => {
    const shop = !far && floors <= 12 && r() < look.shops ? 1 : 0
    const h = floors * FLOOR + (shop ? GROUND_FLOOR - FLOOR : 0)
    ;(far ? B.wallsFar : B.walls).push({ p: [x, H, z], s: [w, h, d], c: pick(r, look.walls), shop })
    if (!far) B.boxes.push({ x, z, w, d, h })
    markHeight(x, z, w, d, H + h)
    const roof = roofOf()
    const rc = pick(r, roof.colors)
    if (roof.kind === 'flat' || floors > 6) B.flat.push({ p: [x, H + h, z], s: [w + m(0.2), m(0.4), d + m(0.2)], c: rc })
    else {
      const span = Math.min(w, d)
      ;(roof.kind === 'iron' ? B.iron : B.prism).push({ p: [x, H + h, z], s: [Math.max(w, d) + m(0.3), span * (roof.kind === 'iron' ? 0.2 : 0.45), span + m(0.3)], c: rc, ry: w >= d ? 0 : Math.PI / 2 })
    }
    if (shop && !far) {
      const [fx, fz] = face
      const c = pick(r, look.signs)
      const vertical = look.signStyle === 'vertical' || (look.signStyle === 'mixed' && r() < 0.4)
      const ox = fx * (w / 2 + m(0.12)), oz = fz * (d / 2 + m(0.12))
      // a board over the shop front, above head height
      B.signs.push({ p: [x + ox, H + GROUND_FLOOR - m(0.6), z + oz], s: fx !== 0 ? [m(0.15), m(0.7), d * 0.8] : [w * 0.8, m(0.7), m(0.15)], c })
      if (vertical && h > GROUND_FLOOR + FLOOR) {
        const side = r() < 0.5 ? -1 : 1
        const tall = Math.min(h - GROUND_FLOOR, 4 * FLOOR)
        const sx = fz !== 0 ? side * w * 0.4 : 0, sz = fx !== 0 ? side * d * 0.4 : 0
        B.signs.push({ p: [x + ox * 1.6 + sx, H + GROUND_FLOOR + tall / 2, z + oz * 1.6 + sz], s: fx !== 0 ? [m(0.2), tall * 0.85, m(0.8)] : [m(0.8), tall * 0.85, m(0.2)], c })
      }
    }
    if (look.tanks && (roof.kind === 'flat' || floors > 6) && r() < look.tanks.share && floors >= 2) {
      const tx = x + (r() - 0.5) * w * 0.5, tz = z + (r() - 0.5) * d * 0.5
      if (look.tanks.kind === 'ac') B.ac.push({ p: [tx, H + h + m(0.4), tz], s: [m(1.2), m(0.8), m(0.9)], c: look.tanks.color })
      else {
        const s = look.tanks.kind === 'wood' ? m(3.5) : m(1.4)
        const lift = look.tanks.kind === 'wood' ? m(2.5) : m(0.3)
        B.tanks.push({ p: [tx, H + h + m(0.4) + lift, tz], s: [s, s * 1.1, s], c: look.tanks.color })
        if (look.tanks.kind === 'wood') {
          B.tankCaps.push({ p: [tx, H + h + m(0.4) + lift + s * 1.1, tz], s: [s * 1.05, s * 0.4, s * 1.05], c: '#5B4A3A' })
          B.steel.push({ p: [tx, H + h + m(0.4) + lift / 2, tz], s: [s * 0.8, lift, s * 0.8] })
        }
      }
    }
    return h
  }

  // an informal settlement: dense small homes of iron, block and tarps, narrow lanes between them
  const informal = (cx: number, cz: number, size: number, far: boolean) => {
    const n = Math.max(2, Math.round(size / m(4)))
    const step = size / n
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (r() < 0.08) continue
      const x = cx - size / 2 + (i + 0.5) * step + (r() - 0.5) * m(0.4), z = cz - size / 2 + (j + 0.5) * step + (r() - 0.5) * m(0.4)
      const w = step * (0.74 + r() * 0.16), d = step * (0.74 + r() * 0.16)
      const h = m(2.3) + r() * m(0.6) + (r() < 0.12 ? FLOOR : 0)
      B.shackWalls.push({ p: [x, H, z], s: [w, h, d], c: pick(r, look.shack.walls), ry: (r() - 0.5) * 0.1 })
      B.shackRoofs.push({ p: [x, H + h, z], s: [w + m(0.4), m(0.1), d + m(0.4)], c: pick(r, look.shack.roofs), ry: (r() - 0.5) * 0.2 })
      if (!far) B.boxes.push({ x, z, w, d, h })
      markHeight(x, z, w, d, H + h)
    }
  }
  const camp = (cx: number, cz: number, size: number) => {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x = cx - size / 2 + (i + 0.5) * (size / 4), z = cz - size / 2 + (j + 0.5) * (size / 4)
      B.tents.push({ p: [x, H, z], s: [m(4), m(2.2), m(3)], c: (i + j) % 3 ? '#E9E4D6' : '#C9C2B0' })
    }
    B.tanks.push({ p: [cx, H + m(0.8), cz], s: [m(1.5), m(1.6), m(1.5)], c: '#3E6FA8' })
  }
  const site = (cx: number, cz: number, far: boolean) => {
    B.pads.push({ p: [cx, H - 0.005, cz], s: [BLOCK - 0.4, 0.02, BLOCK - 0.4], c: look.dirt })
    const floors = 7
    for (let f = 0; f <= floors; f++) B.flat.push({ p: [cx - 0.3, H + f * FLOOR, cz], s: [BLOCK * 0.55, m(0.25), BLOCK * 0.55], c: '#A9A69E' })
    const half = BLOCK * 0.27
    for (const [ox, oz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) B.steel.push({ p: [cx - 0.3 + ox, H + (floors * FLOOR) / 2, cz + oz], s: [m(0.35), floors * FLOOR, m(0.35)] })
    const mast = floors * FLOOR + 3
    B.steel.push({ p: [cx + BLOCK * 0.38, H + mast / 2, cz - BLOCK * 0.36], s: [m(1.6), mast, m(1.6)] })
    B.steel.push({ p: [cx + BLOCK * 0.1, H + mast, cz - BLOCK * 0.36], s: [m(40), m(1.2), m(1.2)] })
    B.steel.push({ p: [cx + BLOCK * 0.62, H + mast - 0.2, cz - BLOCK * 0.36], s: [m(4), m(2.5), m(2.5)] })
    if (!far) B.boxes.push({ x: cx - 0.3, z: cz, w: BLOCK * 0.6, d: BLOCK * 0.6, h: floors * FLOOR })
    markHeight(cx, cz, BLOCK, BLOCK, H + mast + 0.5)
  }
  const tree = (x: number, z: number, onWalk: boolean) => {
    const s = 0.85 + r() * 0.4
    if (look.trees.kind === 'palm') {
      B.trunks.push({ p: [x, H + m(4) * s, z], s: [m(0.35), m(8) * s, m(0.35)], c: '#8A7A62' })
      B.palms.push({ p: [x, H + m(8.2) * s, z], s: [m(4) * s, m(1.2) * s, m(4) * s], c: pick(r, look.trees.leaves), ry: r() * 6 })
    } else {
      B.trunks.push({ p: [x, H + m(1.6) * s, z], s: [m(0.35), m(3.2) * s, m(0.35)], c: '#6E5A48' })
      B.crowns.push({ p: [x, H + m(4.6) * s, z], s: inp.bare ? [m(3) * s, m(3.2) * s, m(3) * s] : [m(4.4) * s, m(3.8) * s, m(4.4) * s], c: inp.bare ? '#8C7B6B' : pick(r, look.trees.leaves) })
    }
    if (onWalk) B.posts.push({ x, z, r: m(0.25) })
  }
  // ordinary city: parcels sized by how tall the place is; towers take a whole block
  const block = (cx: number, cz: number, heightM: number, built: number, far: boolean) => {
    const floorsMean = heightM / 3.2
    if (built < 0.12) {
      B.green.push({ p: [cx, H - 0.005, cz], s: [BLOCK, 0.02, BLOCK] })
      const n = 1 + Math.floor(r() * 2)
      for (let k = 0; k < n; k++) building(cx + (k ? 1.2 : -1.1), cz + (r() - 0.5) * 1.6, m(8), m(7), 1 + Math.floor(r() * 2), far, [0, k ? 1 : -1])
      if (!far) for (let k = 0; k < 2; k++) tree(cx + (r() - 0.5) * 3.4, cz + (r() - 0.5) * 3.4, false)
      return
    }
    B.pads.push({ p: [cx, H - 0.005, cz], s: [BLOCK, 0.02, BLOCK], c: look.ground })
    const tower = floorsMean > 5 && r() < Math.min(0.5, (floorsMean - 5) / 12)
    if (tower) { building(cx, cz, BLOCK * (0.6 + r() * 0.15), BLOCK * (0.55 + r() * 0.2), Math.max(10, floorsFor(heightM * 1.8)), far, [0, 1]); return }
    const n = floorsMean < 4 ? 3 : 2
    const span = BLOCK - 0.2, step = span / n
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (n === 3 && i === 1 && j === 1) { if (!far && r() < 0.5) tree(cx, cz, false); continue } // a yard in the middle
      const x = cx - span / 2 + (i + 0.5) * step, z = cz - span / 2 + (j + 0.5) * step
      const fx = i === 0 ? -1 : i === n - 1 ? 1 : 0, fz = j === 0 ? -1 : j === n - 1 ? 1 : 0
      building(x, z, step * (0.88 + r() * 0.08), step * (0.88 + r() * 0.08), floorsFor(heightM), far, fz !== 0 ? [0, fz] : [fx, 0])
    }
  }

  // ---- sidewalks around every block, plate and surround ----
  const sidewalkAround = (cx: number, cz: number) => B.sidewalks.push({ p: [cx, (GROUND_Y + ROAD_Y) / 2, cz], s: [BLOCK + 2 * SIDEWALK, GROUND_Y - ROAD_Y, BLOCK + 2 * SIDEWALK] })
  for (const x of CENTERS) for (const z of CENTERS) sidewalkAround(x, z)

  // ---- the plate: blocks the lots don't use ----
  const used = new Set(grid.lots.map((l) => `${Math.round(l.x / SPACING)},${Math.round(l.z / SPACING)}`))
  const free = CENTERS.flatMap((x) => CENTERS.map((z) => ({ x, z }))).filter((b) => !used.has(`${Math.round(b.x / SPACING)},${Math.round(b.z / SPACING)}`))
  const ring = (b: { x: number; z: number }) => Math.max(Math.abs(b.x), Math.abs(b.z)) / SPACING
  const byEdge = [...free].sort((a, b) => ring(b) - ring(a) || r() - 0.5)
  let nInf = Math.round(byEdge.filter((b) => ring(b) >= 2).length * Math.min(1, inp.informal * 1.15))
  let sited = false
  for (const b of byEdge) {
    const edge = ring(b) >= 2
    if (inp.growing && !sited && !edge) { site(b.x, b.z, false); sited = true; continue }
    if (edge && nInf > 0) { informal(b.x, b.z, BLOCK - 0.2, false); nInf--; continue }
    block(b.x, b.z, profile.core.heightM * (edge ? 0.8 : 1), Math.max(0.2, profile.core.built), false)
  }

  // ---- the surround: the grid continues, sampling the real cells outward ----
  const plateEdge = STREETS[STREETS.length - 1]
  const KM0 = 0.6, KM_PER_UNIT = 0.17
  for (let i = -11; i <= 11; i++) for (let j = -11; j <= 11; j++) {
    if (Math.abs(i) <= 2 && Math.abs(j) <= 2) continue
    const x = i * SPACING, z = j * SPACING, len = Math.hypot(x, z)
    if (len > SUR + 4) continue
    sidewalkAround(x, z)
    const km = KM0 + (len - plateEdge) * KM_PER_UNIT
    const cell = cellAt(profile, (x / len) * km, (-z / len) * km)
    if (!cell) { B.green.push({ p: [x, H - 0.005, z], s: [BLOCK, 0.02, BLOCK] }); continue }
    if (inp.informal > 0.05 && cell.heightM < 10 && cell.popC >= 4 && r() < inp.informal * 1.1) { B.pads.push({ p: [x, H - 0.005, z], s: [BLOCK, 0.02, BLOCK], c: look.dirt }); informal(x, z, BLOCK - 0.2, true); continue }
    block(x, z, cell.heightM, cell.built, true)
    // street lights seen from afar at night
    B.farGlows.push({ p: [x + SPACING / 2, ROAD_Y + 0.01, z], s: [1.2, 1, 1.2] }, { p: [x, ROAD_Y + 0.01, z + SPACING / 2], s: [1.2, 1, 1.2] })
  }
  if (inp.camp) { const x = 7 * SPACING, z = -6 * SPACING; B.pads.push({ p: [x, H - 0.005, z], s: [BLOCK, 0.02, BLOCK], c: look.dirt }); camp(x, z, BLOCK - 0.4); camp(x + SPACING, z, BLOCK - 0.4) }
  if (inp.growing) site(4 * SPACING, -3 * SPACING, true)

  // ---- street level on the plate: lamps, trees, poles and wires ----
  const side = inp.leftHand ? -1 : 1
  const STEP = m(25) // a lamp every 25 m
  for (const s of STREETS) for (const axis of ['x', 'z'] as const) {
    let n = 0
    for (let t = -plateEdge - EDGE + STEP / 2; t <= plateEdge + EDGE; t += STEP / 2, n++) {
      if (STREETS.some((q) => Math.abs(q - t) < EDGE + 0.3)) continue
      const at = (o: number) => (axis === 'x' ? [t, s + o] : [s + o, t]) as [number, number]
      if (n % 2 === 0) {
        // a lamp on alternating sides
        const [lx, lz] = at((n % 4 === 0 ? 1 : -1) * FURNITURE * side)
        B.lamps.push({ p: [lx, H + m(3), lz], s: [m(0.18), m(6), m(0.18)], c: '#4A4C50' })
        B.lampHeads.push({ p: [lx, H + m(6.1), lz], s: [m(0.6), m(0.2), m(0.6)] })
        B.glows.push({ p: [lx, ROAD_Y + 0.01, lz], s: [m(9), 1, m(9)] })
        B.posts.push({ x: lx, z: lz, r: m(0.15) })
      } else {
        // between lamps: a tree, or a power pole where lines run overhead
        if (look.poles && n % 4 === 1) {
          const [px, pz] = at(-FURNITURE * side)
          B.poles.push({ p: [px, H + m(4.5), pz], s: [m(0.28), m(9), m(0.28)], c: '#6E5E4E' })
          B.poles.push({ p: [px, H + m(8.6), pz], s: axis === 'x' ? [m(0.2), m(0.2), m(2)] : [m(2), m(0.2), m(0.2)], c: '#6E5E4E' })
          B.posts.push({ x: px, z: pz, r: m(0.17) })
        } else if (r() < look.trees.per / 2) { const [tx, tz] = at((n % 4 === 1 ? 1 : -1) * FURNITURE * side); tree(tx, tz, true) }
      }
    }
    if (look.poles) {
      const o = s - FURNITURE * side
      B.wires.push({ p: axis === 'x' ? [0, H + m(8.5), o] : [o, H + m(8.5), 0], s: axis === 'x' ? [2 * (plateEdge + EDGE), m(0.03), m(0.03)] : [m(0.03), m(0.03), 2 * (plateEdge + EDGE)], c: '#3A3A3C' })
    }
  }
  // vending machines in tokyo: against shop fronts on the block side of the sidewalk; they glow at night
  if (look.id === 'tokyo') for (let k = 0; k < 14; k++) {
    const s = pick(r, STREETS.slice(1, -1)), t = (r() - 0.5) * 2 * plateEdge
    if (STREETS.some((q) => Math.abs(q - t) < EDGE + 0.5)) continue
    const o = (r() < 0.5 ? 1 : -1) * (EDGE - m(0.4))
    const [x, z] = r() < 0.5 ? [t, s + o] : [s + o, t]
    B.signs.push({ p: [x, H + m(0.9), z], s: [m(0.9), m(1.8), m(0.8)], c: pick(r, ['#E8463A', '#F0F0F0', '#4A7BD9']) })
    B.posts.push({ x, z, r: m(0.6) })
  }
  return B
}
