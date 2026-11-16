// bake the far-zoom client data from B's real world layer (data/geo, see data/geo/sources.md):
//   public/geo/far/tiles.json  per tile of the standard grid: majority land class, mean black marble lights,
//                              summed ghs population, mean ghsl built fraction
//   public/geo/far/hubs.json   busy airports and ports, with plausible busy pairs between them
// run from the repo root: npx tsx --tsconfig tsconfig.json src/components/world/real/far/bake.ts
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { buildTiles, latLonToVec3, tileIndexAt } from '../../lib'

const ROOT = process.cwd()
const GEO = path.join(ROOT, 'data', 'geo')
const OUT = path.join(ROOT, 'public', 'geo', 'far')
fs.mkdirSync(OUT, { recursive: true })

type Index = { far: { res: number; w: number; h: number; origin: [number, number]; layers: string[]; landClasses: string[] } }
const idx = JSON.parse(fs.readFileSync(path.join(GEO, 'grid-index.json'), 'utf8')) as Index
const { res, w, h, layers, landClasses } = idx.far
const L = layers.length
const buf = zlib.gunzipSync(fs.readFileSync(path.join(GEO, 'grid-025.bin.gz')))
if (buf.length !== w * h * L) throw new Error(`grid size ${buf.length} != ${w * h * L}`)

// the standard tile grid (tiles depend only on the grid, not on the regions list)
const { tiles } = buildTiles([{ id: 'x', lat: 0, lon: 0 }])
const T = tiles.length
const NC = landClasses.length
const hist = new Uint32Array(T * NC)
const litSum = new Float64Array(T), cellN = new Uint32Array(T), popSum = new Float64Array(T), builtSum = new Float64Array(T)
const v = latLonToVec3(0, 0, 1)
for (let row = 0; row < h; row++) {
  const lat = 90 - (row + 0.5) * res
  for (let col = 0; col < w; col++) {
    const lon = -180 + (col + 0.5) * res
    const o = (row * w + col) * L
    latLonToVec3(lat, lon, 1, v)
    const ti = tileIndexAt(v)
    const cls = buf[o + 4]
    hist[ti * NC + cls]++
    cellN[ti]++
    // the black marble source is a public rendering, not radiance: empty desert and tundra glow faintly in it.
    // gate each cell's brightness by how many people live there (none under ~300, full from ~100k)
    const people = buf[o + 2] / 30
    litSum[ti] += buf[o + 3] * Math.max(0, Math.min(1, (people - 2.5) / 2.5))
    builtSum[ti] += buf[o]
    const pl = buf[o + 2]
    if (pl > 0) popSum[ti] += Math.pow(10, pl / 30) - 1
  }
}

// one char per tile per field (base 36), so the file stays tiny
const b36 = (n: number) => Math.max(0, Math.min(35, Math.round(n))).toString(36)
let cls = '', lit = '', pop = '', built = ''
for (let i = 0; i < T; i++) {
  // majority land class among the tile's land cells (water only when the tile is all water)
  let best = 0, bestN = -1
  for (let c = 1; c < NC; c++) if (hist[i * NC + c] > bestN) { bestN = hist[i * NC + c]; best = c }
  if (bestN <= 0) best = 0
  cls += best.toString(36)
  const n = Math.max(1, cellN[i])
  lit += b36((litSum[i] / n / 255) * 35 * 3) // mean gated brightness, lifted so dim regions still read
  pop += b36(popSum[i] > 0 ? Math.log10(popSum[i]) * 3.5 : 0) // log10 people x 3.5 (0..35 ~ 1 to 10^10)
  built += b36((builtSum[i] / n / 255) * 35 * 4)
}
const tilesOut = {
  source: 'baked from data/geo/grid-025.bin.gz: land class ESTIMATE (climate + ghsl), ghs-pop 2025, ghs-built-s 2025, nasa black marble 2016 via gibs (brightness gated by ghs-pop density, since the gibs rendering is not radiance). see data/geo/sources.md',
  n: Math.round(Math.sqrt(T / 6)),
  classes: landClasses,
  encoding: 'one base36 char per tile; lights = mean population-gated brightness x 105/255 (0..35); pop = log10(people) x 3.5; built = mean built fraction x 140',
  cls, lit, pop, built,
}
fs.writeFileSync(path.join(OUT, 'tiles.json'), JSON.stringify(tilesOut))

// ---- hubs ----
type City = { id: string; name: string; countryId: string; lat: number; lon: number; pop: number }
const cities = (JSON.parse(fs.readFileSync(path.join(GEO, 'cities.json'), 'utf8')) as { cities: City[] }).cities
const airports = (JSON.parse(fs.readFileSync(path.join(GEO, 'airports.json'), 'utf8')) as { airports: [string, string, string, string, number, number][] }).airports
const ports = (JSON.parse(fs.readFileSync(path.join(GEO, 'ports.json'), 'utf8')) as { ports: [string, number, number, number][] }).ports

const rad = Math.PI / 180
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  6371 * Math.acos(Math.max(-1, Math.min(1, Math.sin(a.lat * rad) * Math.sin(b.lat * rad) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((a.lon - b.lon) * rad))))

// airports have no traffic numbers: use the population of the biggest city within 80 km as the busyness proxy
const aps = airports.map(([, iata, name, countryId, lat, lon]) => {
  let best: City | null = null
  for (const c of cities) if (km(c, { lat, lon }) < 80 && (!best || c.pop > best.pop)) best = c
  return { code: iata || name.slice(0, 3), name, countryId, lat, lon, weight: best?.pop ?? 0, city: best?.id ?? '' }
}).filter((a) => a.weight > 0).sort((a, b) => b.weight - a.weight)
// one airport per metro
const seenCity = new Set<string>()
const hubsA = aps.filter((a) => (seenCity.has(a.city) ? false : (seenCity.add(a.city), true))).slice(0, 60)

// ports: natural earth scalerank (lower = bigger); one per 150 km
const ps = ports.map(([name, rank, lat, lon]) => ({ name, rank, lat, lon })).sort((a, b) => a.rank - b.rank)
const hubsP: typeof ps = []
for (const p of ps) { if (hubsP.length >= 40) break; if (hubsP.every((q) => km(p, q) > 150)) hubsP.push(p) }

// air pairs: each hub to its 3 nearest hubs abroad, plus long-haul links among the 15 biggest
const airPairs = new Set<string>()
const key = (i: number, j: number) => (i < j ? `${i}-${j}` : `${j}-${i}`)
hubsA.forEach((a, i) => {
  hubsA.map((b, j) => ({ j, d: km(a, b), abroad: b.countryId !== a.countryId })).filter((x) => x.j !== i && x.abroad && x.d > 400)
    .sort((x, y) => x.d - y.d).slice(0, 3).forEach((x) => airPairs.add(key(i, x.j)))
})
for (let i = 0; i < 15; i++) for (let j = i + 1; j < 15; j++) if (km(hubsA[i], hubsA[j]) > 5000 && (i + j) % 3 === 0) airPairs.add(key(i, j))

// sea pairs: prefer partners whose great circle stays over water (sampled against the tile land mask)
const landFrac = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const va = latLonToVec3(a.lat, a.lon, 1), vb = latLonToVec3(b.lat, b.lon, 1)
  let land = 0, n = 0
  for (let t = 0.1; t <= 0.9; t += 0.05) { const p = va.clone().lerp(vb, t).normalize(); if (tiles[tileIndexAt(p)].land) land++; n++ }
  return land / n
}
const seaPairs = new Set<string>()
hubsP.forEach((a, i) => {
  hubsP.map((b, j) => ({ j, d: km(a, b) })).filter((x) => x.j !== i && x.d > 800 && x.d < 9000).sort((x, y) => x.d - y.d).slice(0, 8)
    .map((x) => ({ ...x, lf: landFrac(a, hubsP[x.j]) })).filter((x) => x.lf < 0.25).sort((x, y) => x.lf - y.lf || x.d - y.d).slice(0, 2)
    .forEach((x) => seaPairs.add(key(i, x.j)))
})
const r3 = (x: number) => Math.round(x * 1000) / 1000
const hubsOut = {
  source: 'airports: ourairports.com large_airport, busyness proxy = biggest natural earth city within 80 km (ESTIMATE). ports: natural earth 10m ports by scalerank. pairs are plausible links, not real routes',
  airports: hubsA.map((a) => [a.code, a.countryId, r3(a.lat), r3(a.lon), Math.round(a.weight / 1e5) / 10]),
  ports: hubsP.map((p) => [p.name, r3(p.lat), r3(p.lon), p.rank]),
  air: [...airPairs].map((k) => k.split('-').map(Number)),
  sea: [...seaPairs].map((k) => k.split('-').map(Number)),
}
fs.writeFileSync(path.join(OUT, 'hubs.json'), JSON.stringify(hubsOut))
const size = (f: string) => fs.statSync(path.join(OUT, f)).size
console.log(JSON.stringify({ tiles: T, tilesBytes: size('tiles.json'), airports: hubsA.length, ports: hubsP.length, airPairs: airPairs.size, seaPairs: seaPairs.size, hubsBytes: size('hubs.json'), classCounts: landClasses.map((c, k) => [c, [...cls].filter((x) => x === k.toString(36)).length]) }))
