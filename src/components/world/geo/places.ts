// the most specific real place under any tile: state or province (natural earth 10m admin-1), named sea
// (natural earth 10m marine polygons), chokepoint, or the city whose footprint covers it. see SOURCES.md
import type { City, Frame, Provenance } from '@/lib/types'
import { R, latLonToVec3, type Tile } from '../lib'
import { COUNTRY_TABLE, countryIndexOf } from './countries'
import raw from './tile-places.json'

type Raw = { n: number; a: string; s: string; A: [string, string, string, number, number, number, number?][]; S: string[] }
const data = raw as unknown as Raw

export type Admin1Row = { id: string; name: string; country: string; lat: number; lon: number; population: number; provenance: Record<string, Provenance> }
// population: GHS-POP 2025 summed over the state (SOURCED, from B's data/geo/admin1.json) where the 7th field is 1;
// otherwise an ESTIMATE (country population split by the state's share of natural earth populated places)
const GHS_POP = 'https://ghsl.jrc.ec.europa.eu/download.php?ds=pop'
export const ADMIN1_TABLE: Admin1Row[] = data.A.map(([id, name, country, lat, lon, population, sourced]) => ({ id, name, country, lat, lon, population, provenance: { population: sourced ? { kind: 'SOURCED', url: GHS_POP } : { kind: 'ESTIMATE' } } }))
export const OCEAN_TABLE: { name: string }[] = data.S.map((name) => ({ name }))

const decode = (s: string) => Int32Array.from(s.split(','), (x) => (x === '' ? -1 : parseInt(x, 36)))
const TILE_ADMIN1 = decode(data.a)
const TILE_OCEAN = decode(data.s)

export const CHOKEPOINTS: { id: string; name: string; lat: number; lon: number; radiusDeg: number }[] = [
  { id: 'hormuz', name: 'strait of hormuz', lat: 26.6, lon: 56.4, radiusDeg: 2.2 },
  { id: 'malacca', name: 'strait of malacca', lat: 2.5, lon: 101.3, radiusDeg: 3 },
  { id: 'suez', name: 'suez canal', lat: 30.6, lon: 32.3, radiusDeg: 1.8 },
  { id: 'bab-el-mandeb', name: 'bab el mandeb', lat: 12.6, lon: 43.4, radiusDeg: 1.8 },
  { id: 'panama', name: 'panama canal', lat: 9.1, lon: -79.7, radiusDeg: 1.6 },
  { id: 'gibraltar', name: 'strait of gibraltar', lat: 35.95, lon: -5.6, radiusDeg: 1.6 },
  { id: 'bosporus', name: 'bosporus', lat: 41.1, lon: 29.05, radiusDeg: 1.3 },
  { id: 'english-channel', name: 'english channel', lat: 50.4, lon: -0.8, radiusDeg: 2.4 },
  { id: 'taiwan-strait', name: 'taiwan strait', lat: 24.4, lon: 119.4, radiusDeg: 2.4 },
  { id: 'good-hope', name: 'cape of good hope', lat: -34.4, lon: 18.5, radiusDeg: 2.4 },
]

const toRad = Math.PI / 180
const arcDeg = (la1: number, lo1: number, la2: number, lo2: number) => {
  const c = Math.sin(la1 * toRad) * Math.sin(la2 * toRad) + Math.cos(la1 * toRad) * Math.cos(la2 * toRad) * Math.cos((lo2 - lo1) * toRad)
  return Math.acos(Math.max(-1, Math.min(1, c))) / toRad
}

// tile index -> its places. tiles come from lib.ts buildTiles with the default grid (the same for any regions).
// pass land when you know it: land tiles get country + state, sea tiles get the sea; without it both are returned.
// a land tile whose state lookup missed (coarse coasts) still gets its country when tileCountry is given
export function tilePlace(tileIndex: number, land?: boolean, tileCountry?: number): { country: number; admin1: number; ocean: number; chokepoint?: string } {
  const admin1 = TILE_ADMIN1[tileIndex] ?? -1
  const ocean = TILE_OCEAN[tileIndex] ?? -1
  const fromState = admin1 >= 0 ? countryIndexOf(ADMIN1_TABLE[admin1].country) : -1
  const country = fromState >= 0 ? fromState : tileCountry ?? -1
  const out = land === false ? { country: -1, admin1: -1, ocean } : land === true ? { country, admin1, ocean: -1 } : { country, admin1, ocean }
  const { lat, lon } = tileLatLon(tileIndex)
  const cp = CHOKEPOINTS.find((c) => arcDeg(lat, lon, c.lat, c.lon) <= c.radiusDeg)
  return cp ? { ...out, chokepoint: cp.id } : out
}

// center of a tile on the default grid, without building the tiles
function tileLatLon(i: number) {
  const n = data.n
  const f = Math.floor(i / (n * n)), rem = i % (n * n), a0 = Math.floor(rem / n), b0 = rem % n
  const F: number[][][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ]
  const [N, U, V] = F[f]
  const ta = Math.tan(-Math.PI / 4 + ((a0 + 0.5) / n) * (Math.PI / 2)), tb = Math.tan(-Math.PI / 4 + ((b0 + 0.5) / n) * (Math.PI / 2))
  const x = N[0] + U[0] * ta + V[0] * tb, y = N[1] + U[1] * ta + V[1] * tb, z = N[2] + U[2] * ta + V[2] * tb
  const l = Math.hypot(x, y, z)
  return { lat: Math.asin(y / l) / toRad, lon: Math.atan2(-z / l, x / l) / toRad }
}

// a city's footprint is a disc around it: about 0.6 tile widths at 1M people up to 1.6 at 37M.
// biggest city first, so a megacity wins over a suburb town on the same tile
export function cityAtTile(frame: Frame, tile: Tile): City | undefined {
  const tileDeg = (Math.max(tile.w, tile.d) / R) / toRad
  const lo = Math.sqrt(1e6), hi = Math.sqrt(37e6)
  const cities = frame.cities.filter((c) => !c.offWorld).sort((a, b) => b.population - a.population)
  for (const c of cities) {
    const k = Math.max(0, Math.min(1, (Math.sqrt(Math.max(1, c.population)) - lo) / (hi - lo)))
    const radius = (0.6 + k * 1.0) * tileDeg
    if (arcDeg(tile.lat, tile.lon, c.lat, c.lon) <= radius) return c
  }
  return undefined
}

export const countryName = (k: number) => COUNTRY_TABLE[k]?.name
export const admin1Center = (k: number) => { const r = ADMIN1_TABLE[k]; return r ? latLonToVec3(r.lat, r.lon, 1).normalize() : undefined }
