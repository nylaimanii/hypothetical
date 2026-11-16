// the real place around a chosen person, from B's baked geo layer (data/geo, read-only):
//   climate: worldclim 2.1 monthly mean temperature and rainfall at her city (grid-025, 0.25 deg)
//   city: ghsl built-up fraction, mean building height, population and night lights in a 1 x 1 deg window around
//         her city at 0.05 deg (grid-near-005), for every city over 1M people. sources: data/geo/sources.md
// there is no street-level geometry in the geo layer (natural earth roads are highways only), so the life view's
// streets stay a stylized grid; density, building heights, crowd size and weather come from these real numbers.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export type CityGrid = { win: number; lat0: number; lon0: number; res: number; built: number[]; heightM: number[]; pop: number[]; lights: number[] }
export type PlaceInfo = {
  cityId: string; city: string; country: string; lat: number; lon: number
  tavgC: number[]; precMm: number[] // 12 months, january first
  built: number; heightM: number; popPerKm2: number; lights: number // at her cell: 0..1, meters, people per km2, 0..255
  grid: CityGrid | null // the real city around her, for the minimap
  source: string
}

type Index = { far: { res: number; w: number; h: number; layers: string[] }; near: { res: number; win: number; cities: { id: string; lat0: number; lon0: number }[] } }
let cache: { idx: Index; far: Buffer; near: Buffer; cities: { id: string; name: string; lat: number; lon: number }[] } | null | undefined

function load() {
  if (cache !== undefined) return cache
  try {
    // statically scoped paths so the life site's build traces only data/geo
    const base = path.basename(process.cwd()) === 'life' ? path.join(process.cwd(), '..', 'data', 'geo') : path.join(process.cwd(), 'data', 'geo')
    const idx = JSON.parse(fs.readFileSync(path.join(base, 'grid-index.json'), 'utf8')) as Index
    const far = zlib.gunzipSync(fs.readFileSync(path.join(base, 'grid-025.bin.gz')))
    const near = zlib.gunzipSync(fs.readFileSync(path.join(base, 'grid-near-005.bin.gz')))
    const c = JSON.parse(fs.readFileSync(path.join(base, 'cities.json'), 'utf8')) as { id: string; name: string; lat: number; lon: number }[] | { cities: { id: string; name: string; lat: number; lon: number }[] }
    cache = { idx, far, near, cities: Array.isArray(c) ? c : c.cities }
  } catch { cache = null }
  return cache
}

// cell area at a latitude, km2, for a cell of `res` degrees
const cellKm2 = (lat: number, res: number) => (res * 111.32) * (res * 111.32 * Math.cos(lat * Math.PI / 180))

export function placeInfo(p: { cityId: string; city: string; country: string; lat: number; lon: number }): PlaceInfo {
  const g = load()
  const out: PlaceInfo = { ...p, tavgC: [], precMm: [], built: 0, heightM: 0, popPerKm2: 0, lights: 0, grid: null, source: 'ghsl r2023a + worldclim 2.1 + natural earth, via data/geo (see data/geo/sources.md)' }
  if (!g) return { ...out, source: 'data/geo missing: climate and density are ESTIMATE' }
  // climate: worldclim normals
  const L = g.idx.far.layers.length
  const row = Math.max(0, Math.min(g.idx.far.h - 1, Math.floor((90 - p.lat) / g.idx.far.res)))
  const col = Math.max(0, Math.min(g.idx.far.w - 1, Math.floor((p.lon + 180) / g.idx.far.res)))
  const o = (row * g.idx.far.w + col) * L
  for (let m = 0; m < 12; m++) { out.tavgC.push(g.far[o + 5 + m] - 60); out.precMm.push(g.far[o + 17 + m] * 4) }
  out.built = g.far[o] / 255; out.heightM = g.far[o + 1]; out.lights = g.far[o + 3]
  out.popPerKm2 = g.far[o + 2] ? (10 ** (g.far[o + 2] / 30) - 1) / cellKm2(p.lat, g.idx.far.res) : 0
  // the near window of the natural earth city closest to hers (within ~35 km)
  let best: { id: string; d: number } | null = null
  for (const c of g.cities) { const d = Math.hypot(c.lat - p.lat, (c.lon - p.lon) * Math.cos(p.lat * Math.PI / 180)); if (d < 0.32 && (!best || d < best.d)) best = { id: c.id, d } }
  const k = best ? g.idx.near.cities.findIndex(c => c.id === best!.id) : -1
  if (k >= 0) {
    const W = g.idx.near.win, w = g.idx.near.cities[k]
    const grid: CityGrid = { win: W, lat0: w.lat0, lon0: w.lon0, res: g.idx.near.res, built: [], heightM: [], pop: [], lights: [] }
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const q = ((k * W + y) * W + x) * 4
      grid.built.push(g.near[q] / 255); grid.heightM.push(g.near[q + 1]); grid.pop.push(g.near[q + 2] ? Math.round(10 ** (g.near[q + 2] / 30) - 1) : 0); grid.lights.push(g.near[q + 3])
    }
    out.grid = grid
    const cy = Math.max(0, Math.min(W - 1, Math.floor((w.lat0 - p.lat) / grid.res))), cx = Math.max(0, Math.min(W - 1, Math.floor((p.lon - w.lon0) / grid.res)))
    const i = cy * W + cx
    out.built = grid.built[i]; out.heightM = grid.heightM[i]; out.lights = grid.lights[i]
    out.popPerKm2 = grid.pop[i] / cellKm2(p.lat, grid.res)
  }
  return out
}
