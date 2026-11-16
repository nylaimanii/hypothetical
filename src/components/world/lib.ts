import * as THREE from 'three'
import { geoContains } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import landTopo from 'world-atlas/land-110m.json'
import type { Region } from '@/lib/types'
import { biomeAt, landBand, oceanBand, type Biome } from './geodata'
import STATIC_RAW from './tile-static.json'

const STATIC = STATIC_RAW as { n: number; biomes: string[]; land: string; band: string; depth: string; biome: string }

export const R = 10
export const LAND_TOP = R + 0.22
export const OCEAN_TOP = R + 0.06
export const CORE_POS = new THREE.Vector3(0, R + 6.5, 0)
export const PIP = 0.42 // world height of a 170cm adult
export const ZOOM_FAR = 36
export const ZOOM_CLOSE = 21
export const MIN_DIST = 12.7
export const MAX_DIST = 75

export const C = {
  bone: '#EFE8DA',
  boneDeep: '#E2D8C4',
  ink: '#1D1B19',
  ember: '#E4572E',
  dusk: '#8D88A3',
  ocean: '#5E8AA6',
  oceanDeep: '#5F7A88',
  ice: '#F4F1EA',
  grout: '#3F5866',
}

// Monk Skin Tone Scale, 10 tones. https://skintone.google/the-scale
export const MONK = ['#f6ede4', '#f3e7db', '#f7ead0', '#eadaba', '#d7bd96', '#a07e56', '#825c43', '#604134', '#3a312a', '#292420']
export const HAIR_HEX: Record<string, string> = {
  black: '#1f1b18', dark_brown: '#3b2a20', brown: '#6b4a32', blonde: '#d8b874', red: '#a4532e', gray: '#9a958f', white: '#e9e5de',
}

export function latLonToVec3(lat: number, lon: number, r: number, out = new THREE.Vector3()) {
  const la = THREE.MathUtils.degToRad(lat)
  const lo = THREE.MathUtils.degToRad(lon)
  return out.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo))
}

export function vec3ToLatLon(v: THREE.Vector3): [number, number] {
  const n = v.clone().normalize()
  return [THREE.MathUtils.radToDeg(Math.asin(n.y)), THREE.MathUtils.radToDeg(Math.atan2(-n.z, n.x))]
}

// east, up, north basis at a point on the sphere
export function tangentBasis(normal: THREE.Vector3) {
  const up = normal.clone().normalize()
  const pole = Math.abs(up.y) > 0.999 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const east = new THREE.Vector3().crossVectors(pole, up).normalize()
  const north = new THREE.Vector3().crossVectors(up, east).normalize()
  return { up, east, north }
}

// a point offset (u east, v north) in the tangent plane, projected back to radius r
export function surfacePoint(center: THREE.Vector3, u: number, v: number, r: number, out = new THREE.Vector3()) {
  const { east, north, up } = tangentBasis(center)
  return out.copy(up).multiplyScalar(r).addScaledVector(east, u).addScaledVector(north, v).normalize().multiplyScalar(r)
}

// orientation with local +y on the surface normal and local +z toward `forward`
export function surfaceQuat(normal: THREE.Vector3, forward: THREE.Vector3, out = new THREE.Quaternion()) {
  const y = normal.clone().normalize()
  const z = forward.clone().addScaledVector(y, -forward.dot(y))
  if (z.lengthSq() < 1e-8) z.copy(tangentBasis(y).north)
  z.normalize()
  const x = new THREE.Vector3().crossVectors(y, z)
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

let toonTex: THREE.DataTexture | null = null
export function toonGradient() {
  if (!toonTex) {
    // four steps: faces turned well away from the sun get almost nothing (true night, so moonlight and city
    // lights carry the dark side); the terminator keeps the old 35% twilight band; the day side reads as before
    toonTex = new THREE.DataTexture(new Uint8Array([14, 14, 14, 255, 90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat)
    toonTex.minFilter = THREE.NearestFilter
    toonTex.magFilter = THREE.NearestFilter
    toonTex.generateMipmaps = false
    toonTex.needsUpdate = true
  }
  return toonTex
}

// matte vinyl toy
export function vinyl(color: THREE.ColorRepresentation = '#ffffff', extra: THREE.MeshPhysicalMaterialParameters = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, metalness: 0.04, clearcoat: 0.35, clearcoatRoughness: 0.5, ...extra })
}

export function shade(hex: string, f: number) {
  const c = new THREE.Color(hex)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  return new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f)))
}

// ---- planet tiles: equal angle cube sphere so tiles sit on a voxel grid ----

export type Tile = { pos: THREE.Vector3; normal: THREE.Vector3; quat: THREE.Quaternion; w: number; d: number; land: boolean; ice: boolean; region: number; lat: number; lon: number; band: number; depth: number; biome: Biome }

// land stacks up to 3 extra blocks of this height (real elevation, see geodata.ts)
export const STEP = 0.085
const TILES_N = 34
let bandCache: Int8Array | null = null

type Poly = { f: Feature<Polygon>; minLon: number; maxLon: number; minLat: number; maxLat: number; wrap: boolean }
let polys: Poly[] | null = null
function landPolys(): Poly[] {
  if (polys) return polys
  const topo = landTopo as unknown as Topology<{ land: GeometryCollection }>
  const fc = feature(topo, topo.objects.land) as unknown as { features: Feature<MultiPolygon | Polygon>[] }
  const out: Poly[] = []
  for (const f of fc.features) {
    const list = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]
    for (const coords of list) {
      let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90
      for (const [lo, la] of coords[0]) {
        minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo); minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la)
      }
      out.push({ f: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: coords } }, minLon, maxLon, minLat, maxLat, wrap: maxLon - minLon > 180 || minLat < -60 })
    }
  }
  polys = out
  return out
}

function isLand(lat: number, lon: number) {
  for (const p of landPolys()) {
    if (!p.wrap && (lon < p.minLon - 1 || lon > p.maxLon + 1 || lat < p.minLat - 1 || lat > p.maxLat + 1)) continue
    if (geoContains(p.f, [lon, lat])) return true
  }
  return false
}

const FACES: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
  [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
]

const tileCache = new Map<string, { tiles: Tile[]; neighbors: Int32Array[] }>()

export function buildTiles(regions: Pick<Region, 'id' | 'lat' | 'lon'>[], n = TILES_N) {
  const key = regions.map((r) => r.id).join(',') + n
  const hit = tileCache.get(key)
  if (hit) return hit
  const centers = regions.map((r) => latLonToVec3(r.lat, r.lon, 1))
  const tiles: Tile[] = []
  const p = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3()
  const at = (N: THREE.Vector3, U: THREE.Vector3, V: THREE.Vector3, a: number, b: number, out: THREE.Vector3) =>
    out.copy(N).addScaledVector(U, Math.tan(a)).addScaledVector(V, Math.tan(b)).normalize()
  for (const [N, U, V] of FACES) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const a = -Math.PI / 4 + ((i + 0.5) / n) * (Math.PI / 2)
        const b = -Math.PI / 4 + ((j + 0.5) / n) * (Math.PI / 2)
        const h = Math.PI / 2 / n
        at(N, U, V, a, b, p)
        at(N, U, V, a + h / 2, b, pa).sub(at(N, U, V, a - h / 2, b, pb))
        const w = pa.length() * R
        const xdir = pa.clone().normalize()
        at(N, U, V, a, b + h / 2, pa).sub(at(N, U, V, a, b - h / 2, pb))
        const d = pa.length() * R
        const normal = p.clone()
        const [lat, lon] = vec3ToLatLon(normal)
        // perf: the standard grid reads land, elevation, depth and biome from a baked table (tile-static.json)
        // instead of testing every tile against natural earth polygons at startup
        const k = tiles.length
        const baked = n === TILES_N ? STATIC : null
        const ice = baked ? baked.land[k] === '2' : lat < -62
        const land = baked ? baked.land[k] !== '0' : ice || isLand(lat, lon)
        let region = -1
        if (land && !ice) {
          let best = -2
          centers.forEach((c, k) => { const dt = c.dot(normal); if (dt > best) { best = dt; region = k } })
        }
        const y = normal.clone()
        const z = new THREE.Vector3().crossVectors(xdir, y).normalize()
        const x = new THREE.Vector3().crossVectors(y, z)
        const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
        tiles.push(baked
          ? { pos: normal.clone(), normal, quat, w, d, land, ice, region, lat, lon, band: Number(baked.band[k]), depth: Number(baked.depth[k]), biome: baked.biomes[Number(baked.biome[k])] as Biome }
          : { pos: normal.clone(), normal, quat, w, d, land, ice, region, lat, lon, band: land && !ice ? landBand(lat, lon) : ice ? 1 : 0, depth: land ? 0 : oceanBand(lat, lon), biome: ice ? 'ice' : biomeAt(lat, lon) })
      }
    }
  }
  // neighbors by distance, for border glow. perf: a spatial hash on the unit normals instead of testing
  // every land tile against every tile (13M dot products on the standard grid)
  const neighbors: Int32Array[] = []
  const ang = (Math.PI / 2 / n) * 1.6
  const lim = Math.cos(ang)
  const cell = ang * 1.05
  const key3 = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`
  const grid = new Map<string, number[]>()
  tiles.forEach((t, i) => { const kk = key3(t.normal.x, t.normal.y, t.normal.z); const b = grid.get(kk); if (b) b.push(i); else grid.set(kk, [i]) })
  for (let i = 0; i < tiles.length; i++) {
    const list: number[] = []
    if (!tiles[i].land) { neighbors.push(Int32Array.from(list)); continue }
    const ni = tiles[i].normal
    const cx = Math.floor(ni.x / cell), cy = Math.floor(ni.y / cell), cz = Math.floor(ni.z / cell)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) if (j !== i && ni.dot(tiles[j].normal) > lim) list.push(j)
    }
    list.sort((a, b) => a - b)
    neighbors.push(Int32Array.from(list))
  }
  const res = { tiles, neighbors }
  tileCache.set(key, res)
  if (n === TILES_N) bandCache = Int8Array.from(tiles.map((t) => (t.land ? t.band : -1)))
  return res
}

// shared mutable scene refs (moon position etc.), written in useFrame, read anywhere
export const sceneRefs = {
  moonPos: new THREE.Vector3(30, 4, 0),
  focus: new THREE.Vector3(0, 0, R),
  camDist: 50,
  sunDir: new THREE.Vector3(1, 0.3, 0.5).normalize(), // written by the key light
  // how much of what the camera looks at is in night, 0..1 (written by the key light): windows, street
  // lights, city glow and the sky all follow it
  night: 0,
}

export const LAYERS = ['government', 'economy', 'tech', 'religion', 'media', 'family', 'biology', 'physics'] as const

export function layerMetric(layer: (typeof LAYERS)[number], r: Region, all: Region[]): number {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  switch (layer) {
    case 'government': return r.compliance
    case 'economy': {
      const pc = r.gdpUsd / r.population
      const max = Math.max(...all.map((x) => x.gdpUsd / x.population))
      return clamp(Math.sqrt(pc / max))
    }
    case 'tech': return r.techLevel
    case 'religion': return r.faith
    case 'media': return clamp((r.education + r.techLevel) / 2)
    case 'family': return clamp(1 - r.share65plus * 2.5)
    case 'biology': return clamp((r.foodKcalPerCapita - 1200) / 2600)
    case 'physics': return r.techLevel
  }
}

// the tile under a point: exact inverse of the equal angle cube sphere above
export function tileIndexAt(p: THREE.Vector3, n = TILES_N) {
  const u = p.clone().normalize()
  let f = 0, best = -Infinity
  FACES.forEach(([N], k) => { const d = u.dot(N); if (d > best) { best = d; f = k } })
  const [N, U, V] = FACES[f]
  const dn = u.dot(N)
  const a = Math.atan(u.dot(U) / dn), b = Math.atan(u.dot(V) / dn)
  const i = Math.min(n - 1, Math.max(0, Math.floor(((a + Math.PI / 4) / (Math.PI / 2)) * n)))
  const j = Math.min(n - 1, Math.max(0, Math.floor(((b + Math.PI / 4) / (Math.PI / 2)) * n)))
  return f * n * n + i * n + j
}

// surface radius where pips stand: on top of the stacked land blocks
export function groundRadius(p: THREE.Vector3) {
  if (!bandCache) return LAND_TOP
  const b = bandCache[tileIndexAt(p)]
  return LAND_TOP + Math.max(0, b) * STEP
}
