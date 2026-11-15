// npx tsx scripts/geo-bake.ts  (after data/geo/raw/fetch.sh, needs gdal: brew install gdal)
// bakes the real-world layer into compact files in data/geo/. every dataset, url and license is in
// data/geo/sources.md. rasters are resampled with gdal to a 0.25 deg global grid, plus 0.05 deg windows
// around cities over 1M. vectors are filtered and simplified. raw downloads stay in data/geo/raw (gitignored).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const GEO = path.join(process.cwd(), 'data', 'geo')
const RAW = path.join(GEO, 'raw')
const TMP = path.join(RAW, 'work')
fs.mkdirSync(TMP, { recursive: true })
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).toString()
const r = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d
const W = 1440, H = 720, RES = 0.25 // far grid
const NW = 7200, NH = 3600, NRES = 0.05 // near grid source
type GJ = { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }[] }
const readGJ = (f: string) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')) as GJ
const write = (f: string, data: unknown) => { fs.writeFileSync(path.join(GEO, f), typeof data === 'string' ? data : JSON.stringify(data)); return fs.statSync(path.join(GEO, f)).size }
const writeGz = (f: string, buf: Buffer) => { fs.writeFileSync(path.join(GEO, f), zlib.gzipSync(buf, { level: 9 })); return fs.statSync(path.join(GEO, f)).size }

function unzipTif(zip: string): string {
  const list = sh('unzip', ['-Z1', path.join(RAW, zip)]).split('\n').filter(n => n.endsWith('.tif'))
  const out = path.join(TMP, path.basename(list[0]))
  if (!fs.existsSync(out)) sh('unzip', ['-o', '-j', path.join(RAW, zip), list[0], '-d', TMP])
  return out
}
// resample a raster onto a lat/lon grid and read it as float32 (row 0 = north)
function grid(src: string, name: string, res: number, w: number, h: number, method: 'sum' | 'average' | 'max' | 'near', band1 = false): Float32Array {
  const out = path.join(TMP, `${name}.bin`)
  if (!fs.existsSync(out)) {
    sh('gdalwarp', ['-overwrite', '-q', ...(band1 ? ['-b', '1'] : []), '-t_srs', 'EPSG:4326', '-te', '-180', '-90', '180', '90', '-tr', String(res), String(res), '-r', method, '-ot', 'Float32', '-dstnodata', '0', '-of', 'ENVI', src, out])
  }
  const b = fs.readFileSync(out)
  const a = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
  if (a.length !== w * h) throw new Error(`${name}: expected ${w * h} cells, got ${a.length}`)
  return new Float32Array(a)
}
const cellAreaKm2 = (row: number, res: number, h: number) => {
  const lat = 90 - (row + 0.5) * res
  return 111.32 * res * 111.32 * res * Math.cos((lat * Math.PI) / 180) * (h ? 1 : 1)
}

function bakeRasters(cities: { lat: number; lon: number; pop: number; id: string }[]) {
  const builtS = unzipTif('ghs_built_s_2025_30ss.zip'), builtV = unzipTif('ghs_built_v_2025_30ss.zip'), popT = unzipTif('ghs_pop_2025_30ss.zip')
  const bs = grid(builtS, 'built_s_025', RES, W, H, 'sum')
  const bv = grid(builtV, 'built_v_025', RES, W, H, 'sum')
  const pp = grid(popT, 'pop_025', RES, W, H, 'sum')
  const lights = grid(path.join(RAW, 'blackmarble_gibs_025.tif'), 'lights_025', RES, W, H, 'average', true)
  const tavg: Float32Array[] = [], prec: Float32Array[] = []
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0')
    for (const [zip, arr, key] of [['wc_tavg_10m.zip', tavg, 'tavg'], ['wc_prec_10m.zip', prec, 'prec']] as const) {
      const entry = `wc2.1_10m_${key}_${mm}.tif`
      const f = path.join(TMP, entry)
      if (!fs.existsSync(f)) sh('unzip', ['-o', '-j', path.join(RAW, zip), entry, '-d', TMP])
      arr.push(grid(f, `${key}_${mm}_025`, RES, W, H, 'average'))
    }
  }
  // per cell bytes: built fraction (0..1 -> 0..255), mean height (m, 0..255), population (log10 people x 30),
  // lights (0..255), land class, 12 x monthly mean temp (C + 60), 12 x monthly precip (mm / 4, capped)
  const LAYERS = 5 + 24
  const buf = Buffer.alloc(W * H * LAYERS)
  let land = 0
  for (let i = 0; i < W * H; i++) {
    const row = Math.floor(i / W)
    const area = cellAreaKm2(row, RES, 0) * 1e6
    const built = Math.min(1, bs[i] / area)
    const height = bs[i] > 0 ? bv[i] / bs[i] : 0
    const t = tavg.map(a => a[i]), p = prec.map(a => a[i])
    const hasClimate = t.some(x => x !== 0) || p.some(x => x !== 0)
    if (hasClimate) land++
    const meanT = t.reduce((a, b) => a + b, 0) / 12, sumP = p.reduce((a, b) => a + b, 0)
    // ESTIMATE land class from climate + built (ESA WorldCover is 10 m tiles, too large to bake; see sources.md)
    // 0 water, 1 ice, 2 tundra, 3 desert, 4 grass/scrub, 5 forest, 6 tropical forest, 7 cropland-ish, 8 built
    const cls = !hasClimate ? 0 : built > 0.25 ? 8 : Math.max(...t) < 0 ? 1 : meanT < -2 ? 2 : sumP < 250 ? 3 : sumP < 500 ? 4 : meanT > 22 && sumP > 1500 ? 6 : pp[i] / (area / 1e6) > 50 ? 7 : 5
    const o = i * LAYERS
    buf[o] = Math.round(built * 255)
    buf[o + 1] = Math.min(255, Math.round(height))
    buf[o + 2] = pp[i] > 0 ? Math.min(255, Math.round(Math.log10(pp[i] + 1) * 30)) : 0
    buf[o + 3] = Math.min(255, Math.round(lights[i]))
    buf[o + 4] = cls
    for (let m = 0; m < 12; m++) { buf[o + 5 + m] = hasClimate ? Math.max(0, Math.min(255, Math.round(t[m] + 60))) : 0; buf[o + 17 + m] = hasClimate ? Math.min(255, Math.round(p[m] / 4)) : 0 }
  }
  const farSize = writeGz('grid-025.bin.gz', buf)
  // near windows: 0.05 deg, 1 x 1 deg around every city over 1M
  const nbs = grid(builtS, 'built_s_005', NRES, NW, NH, 'sum'), nbv = grid(builtV, 'built_v_005', NRES, NW, NH, 'sum'), npp = grid(popT, 'pop_005', NRES, NW, NH, 'sum')
  const nlights = fs.existsSync(path.join(RAW, 'blackmarble_gibs_005.tif')) ? grid(path.join(RAW, 'blackmarble_gibs_005.tif'), 'lights_005', NRES, NW, NH, 'average', true) : null
  const big = cities.filter(c => c.pop >= 1e6)
  const WIN = 20
  const near = Buffer.alloc(big.length * WIN * WIN * 4)
  const index: { id: string; lat0: number; lon0: number }[] = []
  big.forEach((c, k) => {
    const col0 = Math.max(0, Math.min(NW - WIN, Math.floor((c.lon + 180) / NRES) - WIN / 2))
    const row0 = Math.max(0, Math.min(NH - WIN, Math.floor((90 - c.lat) / NRES) - WIN / 2))
    index.push({ id: c.id, lat0: r(90 - row0 * NRES, 3), lon0: r(-180 + col0 * NRES, 3) })
    for (let y = 0; y < WIN; y++) for (let x = 0; x < WIN; x++) {
      const i = (row0 + y) * NW + col0 + x
      const area = cellAreaKm2(row0 + y, NRES, 0) * 1e6
      const o = ((k * WIN + y) * WIN + x) * 4
      near[o] = Math.round(Math.min(1, nbs[i] / area) * 255)
      near[o + 1] = Math.min(255, Math.round(nbs[i] > 0 ? nbv[i] / nbs[i] : 0))
      near[o + 2] = npp[i] > 0 ? Math.min(255, Math.round(Math.log10(npp[i] + 1) * 30)) : 0
      near[o + 3] = nlights ? Math.min(255, Math.round(nlights[i])) : 0
    }
  })
  const nearSize = writeGz('grid-near-005.bin.gz', near)
  write('grid-index.json', { far: { res: RES, w: W, h: H, origin: [90, -180], layers: ['built', 'heightM', 'popLog30', 'lights', 'landClass', ...Array.from({ length: 12 }, (_, m) => `tavgC+60_m${m + 1}`), ...Array.from({ length: 12 }, (_, m) => `precMm/4_m${m + 1}`)], landClasses: ['water', 'ice', 'tundra', 'desert', 'grass_scrub', 'forest', 'tropical_forest', 'cropland', 'built'] }, near: { res: NRES, win: WIN, layers: ['built', 'heightM', 'popLog30', 'lights'], cities: index } })
  return { farSize, nearSize, landCells: land, popNear: npp, nlights }
}

// ---------- vectors ----------
function iso2to3(): Map<string, string> {
  const m = new Map<string, string>()
  const c = JSON.parse(fs.readFileSync(path.join(GEO, 'countries.json'), 'utf8')) as { countries: { id: string }[] }
  void c
  const ne = readGJ('ne_10m_admin_0_countries.geojson')
  for (const f of ne.features) { const p = f.properties; if (p.ISO_A2 && p.ISO_A2 !== '-99') m.set(String(p.ISO_A2), String(p.ADM0_A3)) }
  return m
}

function simplifyLine(coords: number[][], tol: number): number[][] {
  // Douglas-Peucker
  if (coords.length <= 2) return coords
  const keep = new Uint8Array(coords.length); keep[0] = 1; keep[coords.length - 1] = 1
  const stack: [number, number][] = [[0, coords.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let max = 0, idx = -1
    const [x1, y1] = coords[a], [x2, y2] = coords[b]
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1e-12
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * coords[i][0] - dx * coords[i][1] + x2 * y1 - y2 * x1) / len
      if (d > max) { max = d; idx = i }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]) }
  }
  return coords.filter((_, i) => keep[i]).map(([x, y]) => [r(x, 3), r(y, 3)])
}
const lines = (g: { type: string; coordinates: unknown } | null): number[][][] => !g ? [] : g.type === 'LineString' ? [g.coordinates as number[][]] : g.type === 'MultiLineString' ? (g.coordinates as number[][][]) : []

function main() {
  const countries = (JSON.parse(fs.readFileSync(path.join(GEO, 'countries.json'), 'utf8')) as { countries: { id: string; regionId: string; name: string }[] }).countries
  const regionOf = new Map(countries.map(c => [c.id, c.regionId]))
  const sizes: Record<string, number> = {}

  // cities: natural earth 10m populated places, pop over 300k or any national capital
  const pp = readGJ('ne_10m_populated_places.geojson')
  const cities = pp.features.map(f => f.properties).filter(p => Number(p.POP_MAX) >= 300_000 || /Admin-0 capital/.test(String(p.FEATURECLA)))
    .map(p => ({ id: `ne${p.NE_ID}`, name: String(p.NAME), countryId: String(p.ADM0_A3), adminName: String(p.ADM1NAME ?? ''), lat: r(Number(p.LATITUDE), 4), lon: r(Number(p.LONGITUDE), 4), pop: Number(p.POP_MAX), capital: /Admin-0 capital/.test(String(p.FEATURECLA)), regionId: regionOf.get(String(p.ADM0_A3)) ?? null }))
    .sort((a, b) => b.pop - a.pop)
  sizes['cities.json'] = write('cities.json', { source: 'natural earth 10m populated places v5.1, POP_MAX', cities })

  // power plants: WRI global power plant database v1.3
  const gppdCsv = sh('unzip', ['-p', path.join(RAW, 'gppd.zip'), 'global_power_plant_database.csv'])
  const gl = gppdCsv.split('\n'); const gh = gl[0].split(',')
  const col = (n: string) => gh.indexOf(n)
  const plants: unknown[] = []
  const mixByCountry: Record<string, Record<string, number>> = {}
  // ESTIMATE typical capacity factors when a plant has no generation estimate (IEA / EIA averages)
  const CF: Record<string, number> = { Coal: 0.5, Gas: 0.45, Oil: 0.2, Nuclear: 0.85, Hydro: 0.4, Solar: 0.18, Wind: 0.3, Geothermal: 0.7, Biomass: 0.5, Waste: 0.5, Petcoke: 0.5, Cogeneration: 0.5, Storage: 0.05, 'Wave and Tidal': 0.25, Other: 0.4 }
  for (const line of gl.slice(1)) {
    if (!line.trim()) continue
    const f = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map(x => x.replace(/,$/, '').replace(/^"|"$/g, ''))
    const iso = f[col('country')], fuel = f[col('primary_fuel')], mw = Number(f[col('capacity_mw')])
    if (!mw) continue
    const gen = Number(f[col('estimated_generation_gwh_2017')]) || mw * 8.76 * (CF[fuel] ?? 0.4)
    const bucket = /Solar/.test(fuel) ? 'solar' : /Wind/.test(fuel) ? 'wind' : /Nuclear/.test(fuel) ? 'nuclear' : /Hydro|Wave/.test(fuel) ? 'hydro' : 'fossil'
    const m = (mixByCountry[iso] ??= { solar: 0, wind: 0, nuclear: 0, fossil: 0, hydro: 0 }); m[bucket] += gen
    if (mw >= 50) plants.push([f[col('gppd_idnr')], f[col('name')].slice(0, 60), iso, r(Number(f[col('latitude')]), 3), r(Number(f[col('longitude')]), 3), fuel, Math.round(mw), Number(f[col('commissioning_year')]) ? Math.round(Number(f[col('commissioning_year')])) : null])
  }
  for (const m of Object.values(mixByCountry)) { const s = Object.values(m).reduce((a, b) => a + b, 0) || 1; for (const k of Object.keys(m)) m[k] = r(m[k] / s, 3) }
  sizes['plants.json'] = write('plants.json', { source: 'WRI global power plant database v1.3 (plants >= 50 MW)', fields: ['id', 'name', 'countryId', 'lat', 'lon', 'fuel', 'mw', 'commissioned'], plants, mixByCountry })

  // airports: ourairports, large only
  const iso3 = iso2to3()
  const al = fs.readFileSync(path.join(RAW, 'airports.csv'), 'utf8').split('\n'); const ah = al[0].split(',').map(x => x.replace(/"/g, ''))
  const ac = (n: string) => ah.indexOf(n)
  const airports = al.slice(1).map(l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map(x => x.replace(/,$/, '').replace(/^"|"$/g, '')) ?? [])
    .filter(f => f[ac('type')] === 'large_airport').map(f => [f[ac('ident')], f[ac('iata_code')], f[ac('name')].slice(0, 60), iso3.get(f[ac('iso_country')]) ?? f[ac('iso_country')], r(Number(f[ac('latitude_deg')]), 3), r(Number(f[ac('longitude_deg')]), 3)])
  sizes['airports.json'] = write('airports.json', { source: 'ourairports.com, type = large_airport', fields: ['ident', 'iata', 'name', 'countryId', 'lat', 'lon'], airports })

  // ports: natural earth 10m ports (the NGA world port index download was unavailable, see sources.md)
  const ports = readGJ('ne_10m_ports.geojson').features.map(f => { const c = (f.geometry?.coordinates as number[]) ?? [0, 0]; return [String(f.properties.name ?? ''), Number(f.properties.scalerank ?? 9), r(c[1], 3), r(c[0], 3)] })
  sizes['ports.json'] = write('ports.json', { source: 'natural earth 10m ports', fields: ['name', 'scalerank', 'lat', 'lon'], ports })

  // roads (major and secondary highways) and railroads, simplified (~1 km tolerance), coords to 3 decimals
  const roads = readGJ('ne_10m_roads.geojson').features.filter(f => /Major Highway|Secondary Highway/.test(String(f.properties.type)) && Number(f.properties.scalerank) <= 7)
    .flatMap((f, i) => lines(f.geometry).map((ln, j) => ({ id: `rd${i}-${j}`, t: String(f.properties.type).startsWith('Major') ? 1 : 2, c: String(f.properties.sov_a3 ?? ''), p: simplifyLine(ln, 0.01) })))
  sizes['roads.json'] = write('roads.json', { source: 'natural earth 10m roads (major + secondary highways, scalerank <= 7), douglas-peucker 0.01 deg', roads })
  const rail = readGJ('ne_10m_railroads.geojson').features.filter(f => Number(f.properties.scalerank ?? 10) <= 8)
    .flatMap((f, i) => lines(f.geometry).map((ln, j) => ({ id: `rl${i}-${j}`, c: String(f.properties.sov_a3 ?? ''), p: simplifyLine(ln, 0.01) })))
  sizes['rail.json'] = write('rail.json', { source: 'natural earth 10m railroads (scalerank <= 8), douglas-peucker 0.01 deg', rail })

  // rasters
  const rr = bakeRasters(cities)
  sizes['grid-025.bin.gz'] = rr.farSize; sizes['grid-near-005.bin.gz'] = rr.nearSize

  // admin-1: natural earth states/provinces, population = GHSL population summed inside each area
  const a1 = readGJ('ne_10m_admin_1_states_provinces.geojson')
  const idxFile = path.join(TMP, 'admin1_idx.geojson')
  fs.writeFileSync(idxFile, JSON.stringify({ type: 'FeatureCollection', features: a1.features.map((f, i) => ({ type: 'Feature', properties: { idx: i + 1 }, geometry: f.geometry })) }))
  const rast = path.join(TMP, 'admin1_005.bin')
  if (!fs.existsSync(rast)) sh('gdal_rasterize', ['-q', '-a', 'idx', '-te', '-180', '-90', '180', '90', '-tr', String(NRES), String(NRES), '-ot', 'UInt16', '-of', 'ENVI', '-init', '0', idxFile, rast])
  const rb = fs.readFileSync(rast); const ids = new Uint16Array(rb.buffer, rb.byteOffset, rb.byteLength / 2)
  const popSum = new Float64Array(a1.features.length + 1), litSum = new Float64Array(a1.features.length + 1), cellN = new Float64Array(a1.features.length + 1)
  for (let i = 0; i < ids.length; i++) { const k = ids[i]; if (!k) continue; popSum[k] += rr.popNear[i]; cellN[k]++; if (rr.nlights) litSum[k] += rr.nlights[i] }
  const admin1 = a1.features.map((f, i) => {
    const p = f.properties
    const pop = popSum[i + 1]
    return { id: String(p.iso_3166_2 && p.iso_3166_2 !== '-99' ? p.iso_3166_2 : p.adm1_code), name: String(p.name ?? p.name_en ?? ''), countryId: String(p.adm0_a3), lat: r(Number(p.latitude), 3), lon: r(Number(p.longitude), 3),
      population: Math.round(pop), popSource: cellN[i + 1] ? 'SOURCED' : 'ESTIMATE', meanLights: cellN[i + 1] && rr.nlights ? r(litSum[i + 1] / cellN[i + 1], 1) : null }
  })
  // tiny areas that fell between 0.05 deg cells: ESTIMATE from the cities inside them
  for (const a of admin1) if (!a.population) { const inside = cities.filter(c => c.countryId === a.countryId && c.adminName === a.name); a.population = inside.reduce((s, c) => s + c.pop, 0); a.popSource = 'ESTIMATE' }
  sizes['admin1.json'] = write('admin1.json', { source: 'natural earth 10m admin-1; population = GHS-POP 2025 summed inside each area (ESTIMATE from city populations where the area is smaller than a 0.05 deg cell)', admin1 })
  // simplified admin-1 shapes for the renderer, lazy-loaded
  const shapes = path.join(GEO, 'admin1-shapes.geojson')
  sh('ogr2ogr', ['-overwrite', '-f', 'GeoJSON', '-simplify', '0.03', '-lco', 'COORDINATE_PRECISION=3', '-select', 'iso_3166_2,adm1_code,name,adm0_a3', shapes, path.join(RAW, 'ne_10m_admin_1_states_provinces.geojson')])
  sizes['admin1-shapes.geojson'] = fs.statSync(shapes).size

  const total = Object.values(sizes).reduce((a, b) => a + b, 0) + fs.statSync(path.join(GEO, 'countries.json')).size
  console.log(JSON.stringify({ sizes, totalMB: r(total / 1e6, 2), cities: cities.length, plants: plants.length, airports: airports.length, ports: ports.length, roads: roads.length, rail: rail.length, admin1: admin1.length, landCells: rr.landCells }, null, 1))
}
main()
