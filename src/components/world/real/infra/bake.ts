// bake the real infrastructure (B's data/geo, see data/geo/sources.md) into small client files under public/geo/infra:
//   cells/<lat>_<lon>.json  roads + rail in 15x15 degree cells, simplified for display, quantized to 0.01 deg, delta encoded
//   index.json              every cell key with its bbox and size
//   plants.json             the biggest power plants (every nuclear plant kept), fuel, MW, position
//   hubs.json               large airports and ports
// traffic in frames is per country (trafficFrame in src/lib/sim/world-layer.ts), so every segment keeps its country code.
// run from the repo root: npx tsx --tsconfig tsconfig.json src/components/world/real/infra/bake.ts
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const IN = path.join(ROOT, 'data', 'geo')
const OUT = path.join(ROOT, 'public', 'geo', 'infra')
const CELL = 15
const Q = 100 // 0.01 degree ints
const SIMPLIFY = 0.06 // degrees, display only

type Pt = [number, number] // [lon, lat]
type Road = { id: string; t: number; c: string; p: Pt[] }
type Rail = { id: string; c: string; p: Pt[] }

const read = <T,>(f: string) => JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8')) as T

// douglas-peucker on lon/lat (display only)
function simplify(p: Pt[], eps: number): Pt[] {
  if (p.length < 3) return p
  const keep = new Uint8Array(p.length)
  keep[0] = keep[p.length - 1] = 1
  const stack: [number, number][] = [[0, p.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = p[a], [bx, by] = p[b]
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9
    let best = -1, bi = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (p[i][0] - ax) - dx * (p[i][1] - ay)) / L
      if (d > best) { best = d; bi = i }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]) }
  }
  return p.filter((_, i) => keep[i])
}

const cellOf = (lon: number, lat: number) => `${Math.floor(lat / CELL)}_${Math.floor(lon / CELL)}`

// segments that cross cells are split at the crossing point's nearest vertex, so each cell owns its own pieces
function splitByCell(p: Pt[]): { key: string; pts: Pt[] }[] {
  const out: { key: string; pts: Pt[] }[] = []
  let cur: Pt[] = [], key = ''
  for (const q of p) {
    const k = cellOf(q[0], q[1])
    if (k !== key && cur.length) { cur.push(q); if (cur.length > 1) out.push({ key, pts: cur }); cur = [] }
    if (k !== key) key = k
    cur.push(q)
  }
  if (cur.length > 1) out.push({ key, pts: cur })
  return out
}

// [x0, y0, dx1, dy1, ...] in 0.01 deg ints
function encode(p: Pt[]): number[] {
  const out: number[] = []
  let px = 0, py = 0
  p.forEach((q, i) => {
    const x = Math.round(q[0] * Q), y = Math.round(q[1] * Q)
    if (i === 0) out.push(x, y); else out.push(x - px, y - py)
    px = x; py = y
  })
  return out
}

// nearest city's country for rows without one
const cities = read<{ cities: { countryId: string; lat: number; lon: number; pop: number }[] }>('cities.json').cities
function nearestCountry(lon: number, lat: number): string {
  let best = '', bd = Infinity
  for (const c of cities) { const d = (c.lat - lat) ** 2 + ((c.lon - lon) * Math.cos(lat * Math.PI / 180)) ** 2; if (d < bd) { bd = d; best = c.countryId } }
  return best
}

const roadsSrc = read<{ source: string; roads: Road[] }>('roads.json')
const railSrc = read<{ source: string; rail: Rail[] }>('rail.json')

type Cell = { countries: string[]; roads: [number, number, number[]][]; rail: [number, number[]][] } // road: [type, country idx, coords]; rail: [country idx, coords]
const cells = new Map<string, Cell>()
const cell = (k: string) => { let c = cells.get(k); if (!c) { c = { countries: [], roads: [], rail: [] }; cells.set(k, c) } return c }
const cIdx = (c: Cell, code: string) => { let i = c.countries.indexOf(code); if (i < 0) { c.countries.push(code); i = c.countries.length - 1 } return i }

let roadPts = 0, railPts = 0
roadsSrc.roads.forEach((r) => {
  for (const part of splitByCell(simplify(r.p, SIMPLIFY))) {
    const c = cell(part.key)
    c.roads.push([r.t, cIdx(c, r.c || nearestCountry(part.pts[0][0], part.pts[0][1])), encode(part.pts)])
    roadPts += part.pts.length
  }
})
railSrc.rail.forEach((r) => {
  for (const part of splitByCell(simplify(r.p, SIMPLIFY))) {
    const c = cell(part.key)
    c.rail.push([cIdx(c, r.c || nearestCountry(part.pts[0][0], part.pts[0][1])), encode(part.pts)])
    railPts += part.pts.length
  }
})

fs.mkdirSync(path.join(OUT, 'cells'), { recursive: true })
for (const f of fs.readdirSync(path.join(OUT, 'cells'))) fs.unlinkSync(path.join(OUT, 'cells', f))
const index: { key: string; bbox: [number, number, number, number]; bytes: number; roads: number; rail: number }[] = []
let total = 0, maxBytes = 0, maxKey = ''
// dense cells (europe, india, east asia) get a coarser second pass so every cell stays under ~55KB
const decode = (e: number[]): Pt[] => { const out: Pt[] = []; let x = 0, y = 0; for (let i = 0; i < e.length; i += 2) { x += e[i]; y += e[i + 1]; if (i === 0) { x = e[0]; y = e[1] } out.push([x / Q, y / Q]) } return out }
for (const [, c] of cells) {
  if (JSON.stringify(c).length < 55000) continue
  // and drops fragments shorter than ~0.4 deg (about 40 km), which don't read at mid zoom anyway
  const len = (p: Pt[]) => p.slice(1).reduce((acc, q, i) => acc + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0)
  c.roads = c.roads.filter(([t, , e]) => t === 1 || len(decode(e)) >= 0.4).map(([t, ci, e]) => [t, ci, encode(simplify(decode(e), 0.1))] as [number, number, number[]]).filter((r) => r[2].length >= 4)
  c.rail = c.rail.filter(([, e]) => len(decode(e)) >= 0.4).map(([ci, e]) => [ci, encode(simplify(decode(e), 0.1))] as [number, number[]]).filter((r) => r[1].length >= 4)
}
for (const [key, c] of cells) {
  const [la, lo] = key.split('_').map(Number)
  const body = JSON.stringify({ key, q: Q, source: 'natural earth 10m roads and railroads (public domain), via data/geo, simplified for display', ...c })
  fs.writeFileSync(path.join(OUT, 'cells', `${key}.json`), body)
  const bytes = Buffer.byteLength(body)
  total += bytes
  if (bytes > maxBytes) { maxBytes = bytes; maxKey = key }
  index.push({ key, bbox: [lo * CELL, la * CELL, lo * CELL + CELL, la * CELL + CELL], bytes, roads: c.roads.length, rail: c.rail.length })
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ cell: CELL, q: Q, source: 'natural earth 10m roads and railroads (public domain), via data/geo/sources.md', cells: index }))

// plants: the biggest 2200 at 200 MW or more, plus every nuclear plant
const plantsSrc = read<{ source: string; fields: string[]; plants: [string, string, string, number, number, string, number, number | null][] }>('plants.json')
const FUEL: Record<string, string> = { Coal: 'coal', Gas: 'gas', Oil: 'oil', Nuclear: 'nuclear', Solar: 'solar', Wind: 'wind', Hydro: 'hydro', Biomass: 'other', Waste: 'other', Geothermal: 'other', Other: 'other', Cogeneration: 'gas', Storage: 'other', Petcoke: 'oil', 'Wave and Tidal': 'hydro' }
const big = plantsSrc.plants.filter((p) => p[6] >= 200).sort((a, b) => b[6] - a[6])
const top = new Set(big.slice(0, 2200))
const keep = [...top, ...plantsSrc.plants.filter((p) => p[5] === 'Nuclear' && !top.has(p))]
const fuels = ['coal', 'gas', 'oil', 'nuclear', 'solar', 'wind', 'hydro', 'other']
// [id, short name, country, lat*100, lon*100, fuel idx, mw, commissioned]
const shortName = (n: string) => n.toLowerCase().replace(/\b(power (plant|station)|generating station|thermal|hydroelectric|nuclear|solar|wind ?farm|project|station|plant)\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 18)
const plantsOut = keep.map((p) => [p[0], shortName(p[1]) || p[1].toLowerCase().slice(0, 18), p[2], Math.round(p[3] * Q), Math.round(p[4] * Q), fuels.indexOf(FUEL[p[5]] ?? 'other'), Math.round(p[6])])
fs.writeFileSync(path.join(OUT, 'plants.json'), JSON.stringify({ source: `${plantsSrc.source}; >= 200 MW, biggest 2200 plus every nuclear plant`, q: Q, fuels, fields: ['id', 'name', 'countryId', 'lat', 'lon', 'fuel', 'mw'], plants: plantsOut }))

// hubs: large airports and the bigger ports, with their country for traffic
const air = read<{ source: string; airports: [string, string, string, string, number, number][] }>('airports.json')
const ports = read<{ source: string; ports: [string, number, number, number][] }>('ports.json')
const hubs = {
  source: `${air.source}; ${ports.source}`, q: Q,
  airports: air.airports.map((a) => [a[1] || a[0], a[2].toLowerCase().replace(/\binternational airport\b/, '').replace(/\s+/g, ' ').trim().slice(0, 36), a[3], Math.round(a[4] * Q), Math.round(a[5] * Q)]),
  ports: ports.ports.filter((p) => p[1] <= 8).map((p) => [p[0].toLowerCase().slice(0, 30), nearestCountry(p[3], p[2]), Math.round(p[2] * Q), Math.round(p[3] * Q), p[1]]),
}
fs.writeFileSync(path.join(OUT, 'hubs.json'), JSON.stringify(hubs))

const size = (f: string) => fs.statSync(path.join(OUT, f)).size
console.log(JSON.stringify({ cells: cells.size, roadPts, railPts, cellsBytes: total, maxCell: { key: maxKey, bytes: maxBytes }, plants: plantsOut.length, plantsBytes: size('plants.json'), hubsBytes: size('hubs.json'), airports: hubs.airports.length, ports: hubs.ports.length }))
