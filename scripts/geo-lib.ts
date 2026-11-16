// shared fetch / csv / zip / name-matching helpers for scripts/seed.ts and scripts/geo-*.ts
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RegionId } from '../src/lib/sim/regions'

export const WB = 'https://api.worldbank.org/v2'

export async function getJson(url: string): Promise<unknown> {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'hypothetical-seed/1.0' }, signal: AbortSignal.timeout(90_000) })
      if (res.ok) return await res.json()
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 1500 * (i + 1)))
  }
  throw new Error(`fetch failed: ${url}`)
}

export async function getText(url: string): Promise<string> {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(120_000) })
      if (res.ok) return await res.text()
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 1500 * (i + 1)))
  }
  throw new Error(`fetch failed: ${url}`)
}

export async function getZipEntry(url: string, match: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyp-seed-'))
  const zip = path.join(dir, 'a.zip')
  // curl, not fetch: ncdrisc.org answers non-browser user agents with 421
  // (and intermittently over http/2), so force http/1.1 and retry
  for (let i = 0; ; i++) {
    try { execFileSync('curl', ['-sSL', '--fail', '--http1.1', '-m', '180', '-A', 'Mozilla/5.0', '-o', zip, url], { stdio: 'ignore' }); break }
    catch (e) { if (i >= 4) throw e; await new Promise(r => setTimeout(r, 2000 * (i + 1))) }
  }
  const list = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean)
  const entry = list.find(n => n.includes(match))
  if (!entry) throw new Error(`no entry ${match} in ${url}`)
  return execFileSync('unzip', ['-p', zip, entry], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

export type Country = { iso3: string; name: string; region: RegionId }
export type Obs = Map<string, { value: number; date: string }>

export async function wbIndicator(ind: string, source?: number): Promise<Obs> {
  // per_page 20000: some indicators (life expectancy) ignore mrnev and return every year; the newest per country wins
  const url = `${WB}/country/all/indicator/${ind}?format=json&mrnev=1&per_page=20000${source ? `&source=${source}` : ''}`
  const json = await getJson(url) as [unknown, Array<{ countryiso3code: string; value: number | null; date: string }> | null]
  const out: Obs = new Map()
  console.log(`  ${ind}: ${(json[1] ?? []).length} rows`)
  for (const row of json[1] ?? []) {
    if (row.countryiso3code && row.value !== null && row.value !== undefined && !(out.get(row.countryiso3code)?.date > row.date)) out.set(row.countryiso3code, { value: row.value, date: row.date })
  }
  return out
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '')
}

// names used by Pew and NCD-RisC that differ from World Bank names
export const ALIASES: Record<string, string> = {
  unitedstatesofamerica: 'USA', russia: 'RUS', iran: 'IRN', egypt: 'EGY', southkorea: 'KOR', republicofkorea: 'KOR',
  northkorea: 'PRK', dprkorea: 'PRK', vietnam: 'VNM', vietnamviet: 'VNM', laos: 'LAO', laopdr: 'LAO', syria: 'SYR',
  yemen: 'YEM', venezuela: 'VEN', bolivia: 'BOL', tanzania: 'TZA', democraticrepublicofthecongo: 'COD', drcongo: 'COD',
  republicofthecongo: 'COG', congo: 'COG', ivorycoast: 'CIV', cotedivoire: 'CIV', gambia: 'GMB', thegambia: 'GMB',
  kyrgyzstan: 'KGZ', slovakia: 'SVK', turkey: 'TUR', turkiye: 'TUR', macedonia: 'MKD', northmacedonia: 'MKD', tfyrmacedonia: 'MKD',
  moldova: 'MDA', republicofmoldova: 'MDA', micronesia: 'FSM', federatedstatesofmicronesia: 'FSM', micronesiafederatedstatesof: 'FSM',
  stkittsandnevis: 'KNA', saintkittsandnevis: 'KNA', stlucia: 'LCA', saintlucia: 'LCA', stvincentandthegrenadines: 'VCT',
  saintvincentandthegrenadines: 'VCT', capeverde: 'CPV', caboverde: 'CPV', swaziland: 'SWZ', eswatini: 'SWZ', burma: 'MMR',
  myanmar: 'MMR', burmamyanmar: 'MMR', palestinianterritories: 'PSE', palestine: 'PSE', occupiedpalestinianterritory: 'PSE',
  hongkong: 'HKG', macau: 'MAC', macao: 'MAC', bahamas: 'BHS', thebahamas: 'BHS', brunei: 'BRN', czechrepublic: 'CZE', czechia: 'CZE',
  unitedkingdom: 'GBR', greatbritain: 'GBR', saotomeandprincipe: 'STP', timorleste: 'TLS', easttimor: 'TLS', curacao: 'CUW',
  usvirginislands: 'VIR', britishvirginislands: 'VGB', samoa: 'WSM', americansamoa: 'ASM', guineabissau: 'GNB', kosovo: 'XKX',
  china: 'CHN', taiwan: 'TWN', unitedrepublicoftanzania: 'TZA', libya: 'LBY', libyanarabjamahiriya: 'LBY',
  bolivarianrepublicofvenezuela: 'VEN', iranislamicrepublicof: 'IRN', syrianarabrepublic: 'SYR', egyptarabrepublic: 'EGY',
  koreadem: 'PRK', korearep: 'KOR', republicofthegambia: 'GMB', sintmaarten: 'SXM', saintmartin: 'MAF', stmartin: 'MAF',
  turksandcaicosislands: 'TCA', caymanislands: 'CYM', northernmarianaislands: 'MNP', guam: 'GUM', frenchpolynesia: 'PYF',
  newcaledonia: 'NCL', marshallislands: 'MHL', solomonislands: 'SLB', puertorico: 'PRI', westernsahara: 'ESH',
  bosniaherzegovina: 'BIH', chinahongkongsar: 'HKG', macedoniatfyr: 'MKD', centralafricanrepublic: 'CAF', southsudan: 'SSD', sudan: 'SDN', somalia: 'SOM', ethiopia: 'ETH',
}

export function buildNameIndex(countries: Country[]): (name: string) => string | undefined {
  const idx = new Map<string, string>()
  for (const c of countries) idx.set(norm(c.name), c.iso3)
  for (const [k, v] of Object.entries(ALIASES)) idx.set(k, v)
  return (name: string) => idx.get(norm(name))
}


// ESTIMATE land class from climate, population and built-up (ESA WorldCover is 10 m tiles, too large to bake; see
// sources.md). 0 water, 1 ice, 2 tundra, 3 desert, 4 grass/scrub/savanna, 5 forest, 6 tropical forest, 7 cropland, 8 built.
// reads one grid-025 cell: [built, height, popLog30, lights, class, 12 x temp+60, 12 x precip/4]. koppen-style rules:
// ice if the warmest month is below 0 C, tundra if below 10 C (koppen ET); rainforest needs warmth, >1200 mm and at most
// 3 dry months (<60 mm), otherwise tropical savanna; cropland is temperate/subtropical, 400-1100 mm and lived in
// (>3 people/km2: farm belts like iowa ~15, the kansas wheat belt ~5), or anywhere settled above 50/km2 outside
// rainforest; boreal land with >=250 mm is forest (taiga), wetter or emptier temperate land is forest
export function landClassOf(buf: Uint8Array, o: number, cellKm2: number): number {
  const t = Array.from({ length: 12 }, (_, m) => buf[o + 5 + m] - 60), p = Array.from({ length: 12 }, (_, m) => buf[o + 17 + m] * 4)
  if (t.every(x => x === -60) && p.every(x => x === 0)) return 0
  const built = buf[o] / 255, pop = buf[o + 2] ? Math.pow(10, buf[o + 2] / 30) - 1 : 0, dens = pop / cellKm2
  const meanT = t.reduce((a, b) => a + b, 0) / 12, maxT = Math.max(...t), sumP = p.reduce((a, b) => a + b, 0), dry = p.filter(x => x < 60).length
  if (built > 0.25) return 8
  if (maxT < 0) return 1
  if (maxT < 10) return 2
  if (sumP < 250) return meanT < 0 ? 2 : 3 // cold and dry is polar tundra, not sand
  if (meanT > 20 && sumP > 1200 && dry <= 3) return 6
  if ((meanT >= 3 && meanT <= 24 && sumP >= 400 && sumP <= 1100 && dens > 3) || (dens > 50 && meanT <= 24)) return 7
  if (meanT < 3) return sumP >= 250 ? 5 : 4
  if (sumP < 500 || (meanT > 18 && dry >= 4) || (sumP < 800 && dens <= 3)) return 4
  return 5
}
