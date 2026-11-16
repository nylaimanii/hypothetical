// bake small city heightfields for the mid zoom real cities.
// run: npx tsx --tsconfig tsconfig.json src/components/world/real/cities/bake.ts
// inputs (baked by B, see data/geo/sources.md): data/geo/cities.json (natural earth 10m populated places, POP_MAX),
// data/geo/grid-near-005.bin.gz (GHSL GHS-BUILT-S / GHS-BUILT-V / GHS-POP R2023A epoch 2025, 0.05 deg windows
// around every city over 1M) and data/geo/grid-025.bin.gz (same layers at 0.25 deg, for capitals under 1M).
// output: public/geo/cities/index.json + public/geo/cities/<group>.json, fetched by the browser only at mid zoom.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

type City = { id: string; name: string; countryId: string; lat: number; lon: number; pop: number; capital: boolean; regionId: string | null }
const ROOT = process.cwd()
const GEO = path.join(ROOT, 'data', 'geo')
const OUT = path.join(ROOT, 'public', 'geo', 'cities')
const SOURCE = 'GHSL GHS-BUILT-S, GHS-BUILT-V, GHS-POP R2023A epoch 2025 (CC BY 4.0, European Commission JRC, https://ghsl.jrc.ec.europa.eu); natural earth 10m populated places (public domain); baked by data/geo (agent B), sampled here'

const cities = (JSON.parse(fs.readFileSync(path.join(GEO, 'cities.json'), 'utf8')) as { cities: City[] }).cities
const index = JSON.parse(fs.readFileSync(path.join(GEO, 'grid-index.json'), 'utf8')) as {
  far: { res: number; w: number; h: number; layers: string[] }
  near: { res: number; win: number; cities: { id: string; lat0: number; lon0: number }[] }
}
const near = zlib.gunzipSync(fs.readFileSync(path.join(GEO, 'grid-near-005.bin.gz')))
const far = zlib.gunzipSync(fs.readFileSync(path.join(GEO, 'grid-025.bin.gz')))
const WIN = index.near.win, NRES = index.near.res
const FW = index.far.w, FL = index.far.layers.length, FRES = index.far.res
const nearAt = new Map(index.near.cities.map((c, k) => [c.id, { k, ...c }]))

// one cell: x and y in the 20 x 20 window (0.05 deg steps from the window origin), built 0..255, height in meters
// (0..255, already capped by the bake), population class 0..7. packed into 4 bytes: [x | popClass << 5, y, built, height]
type Cell = { x: number; y: number; built: number; h2: number; popC: number }
const MIN_BUILT = 18 // about 7% built up

function nearCells(id: string, radiusDeg: number): { cells: Cell[]; lat0: number; lon0: number; res: number } | null {
  const w = nearAt.get(id)
  if (!w) return null
  const cells: Cell[] = []
  const c = cities.find((x) => x.id === id)!
  for (let y = 0; y < WIN; y++) for (let x = 0; x < WIN; x++) {
    const o = ((w.k * WIN + y) * WIN + x) * 4
    const built = near[o], heightM = near[o + 1], popLog = near[o + 2]
    if (built < MIN_BUILT) continue
    const clat = w.lat0 - (y + 0.5) * NRES, clon = w.lon0 + (x + 0.5) * NRES
    if (Math.hypot(clat - c.lat, (clon - c.lon) * Math.cos((c.lat * Math.PI) / 180)) > radiusDeg) continue
    cells.push({ x, y, built, h2: heightM, popC: Math.min(7, Math.floor(popLog / 30)) })
  }
  return { cells, lat0: w.lat0, lon0: w.lon0, res: NRES }
}

// capitals under 1M have no near window: take the 0.25 deg far cells around them (coarser, a few blocks)
function farCells(c: City): { cells: Cell[]; lat0: number; lon0: number; res: number } {
  const col = Math.floor((c.lon + 180) / FRES), row = Math.floor((90 - c.lat) / FRES)
  const cells: Cell[] = []
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const r = row + dy, cc = ((col + dx) % FW + FW) % FW
    const o = (r * FW + cc) * FL
    const built = far[o], heightM = far[o + 1], popLog = far[o + 2]
    if (built < 6 && !(dx === 0 && dy === 0)) continue
    cells.push({ x: dx + 1, y: dy + 1, built: Math.max(built, 40), h2: Math.min(255, Math.round(heightM)), popC: Math.min(7, Math.floor(popLog / 30)) })
  }
  return { cells, lat0: 90 - (row - 1) * FRES, lon0: -180 + (col - 1) * FRES, res: FRES }
}

const pack = (cells: Cell[]) => Buffer.from(cells.flatMap((c) => [(c.x & 31) | (c.popC << 5), c.y, c.built, c.h2])).toString('base64')

const picked = cities.filter((c) => c.pop >= 1e6 || c.capital)
type Row = { id: string; name: string; lat: number; lon: number; pop: number; country: string; group: string; n: number }
const rows: Row[] = []
const byGroup = new Map<string, Record<string, { lat0: number; lon0: number; res: number; d: string }>>()
for (const c of picked) {
  // radius grows with population; the 1 x 1 deg window caps it
  const radius = Math.min(0.5, 0.12 + Math.sqrt(c.pop / 37e6) * 0.45)
  const got = nearCells(c.id, radius) ?? farCells(c)
  // keep the densest cells; the biggest cities keep the most
  const cap = Math.round(24 + 110 * Math.sqrt(Math.min(1, c.pop / 37e6)))
  const cells = [...got.cells].sort((a, b) => b.built * (1 + b.h2 / 40) - a.built * (1 + a.h2 / 40)).slice(0, cap)
  if (!cells.length) continue
  const region = c.regionId ?? 'other'
  rows.push({ id: c.id, name: c.name.toLowerCase(), lat: +c.lat.toFixed(3), lon: +c.lon.toFixed(3), pop: c.pop, country: c.countryId, group: region, n: cells.length })
  const g = byGroup.get(region) ?? {}
  g[c.id] = { lat0: got.lat0, lon0: got.lon0, res: got.res, d: pack(cells) }
  byGroup.set(region, g)
}

// split any group over ~75 KB into numbered parts so each regional file stays small
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const sizes: Record<string, number> = {}
for (const [region, all] of byGroup) {
  const ids = Object.keys(all)
  let part = 0, cur: typeof all = {}, curSize = 0
  const flush = () => {
    if (!Object.keys(cur).length) return
    const key = part === 0 ? region : `${region}-${part}`
    const body = JSON.stringify({ source: SOURCE, cities: cur })
    fs.writeFileSync(path.join(OUT, `${key}.json`), body)
    sizes[key] = body.length
    for (const id of Object.keys(cur)) rows.find((r) => r.id === id)!.group = key
    part++; cur = {}; curSize = 0
  }
  for (const id of ids) {
    const s = JSON.stringify(all[id]).length + id.length + 4
    if (curSize + s > 75_000) flush()
    cur[id] = all[id]; curSize += s
  }
  flush()
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ source: SOURCE, cellFormat: 'base64, 4 bytes per cell: [x | popClass<<5, y, built 0..255, mean building height in meters 0..255], cell centre = (lat0 - (y+0.5)*res, lon0 + (x+0.5)*res)', cities: rows }))
console.log(JSON.stringify({ cities: rows.length, groups: Object.keys(sizes).length, maxGroupKB: Math.round(Math.max(...Object.values(sizes)) / 1024), indexKB: Math.round(fs.statSync(path.join(OUT, 'index.json')).size / 1024), totalKB: Math.round(Object.values(sizes).reduce((a, b) => a + b, 0) / 1024), cells: rows.reduce((a, r) => a + r.n, 0) }))
