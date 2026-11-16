// phase 1: the real world layer in the sim. climate drifts with emissions, weather is seeded daily from real
// climate normals, every pip lives in a real city with a local job, a commute, clothes for the weather and a
// day plan. power plants, rail and cities change over time and are recorded as diffs from the real 2026
// baseline. states and cities get yearly stats, stories and trends in a compact lazy file per run.
import { homeOf } from './housing'
import { faithOf, type Faith } from './daily'
import { addLifeEvent } from './behavior'
import type { HomeKind } from '../types-v5'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import type { Citizen, PlaceStats, Trend, Workplace } from '../types'
import type { Clothing, CommuteMode, InfraDiff, Weather } from '../types-v5'
import plantsJson from '../../../data/geo/plants.json'
import { link } from './causes'
import { hashString, mulberry32 } from './rng'
import { ADMIN_SEEDS, CITY_SEEDS, COUNTRY_SEEDS, countriesOf, countryPop, housingMultiple, placeStats, trendOf, type CountryState } from './places'
import { START_MIX, SOURCES, type Mix } from './visuals'
import { clamp, incomeIdx, regionPop, sum, type RegionState, type World } from './state'

// ---------- climate ----------
// 2026 anomaly ~1.3 C above pre-industrial (WMO State of the Global Climate 2024 puts the 2015-2024 mean at ~1.24 C;
// https://wmo.int/publication-series/state-of-global-climate-2024). TCRE: ~0.45 C per 1,000 GtCO2 (IPCC AR6 WG1
// SPM D.1.1, likely range 0.27-0.63). https://www.ipcc.ch/report/ar6/wg1/
export const START_ANOMALY_C = 1.3
export const TCRE_C_PER_GT = 0.45 / 1000
// 2024 fossil CO2 ~37.4 Gt (Global Carbon Budget 2024, https://globalcarbonbudget.org). ESTIMATE split: ~14 Gt from
// electricity (~0.75 Mt per fossil TWh), ~23 Gt everything else, which scales with economy and the fossil share.
const MT_PER_FOSSIL_TWH = 0.75
const NON_POWER_GT_2026 = 23.4
// ESTIMATE: staple yields lose ~5% per C of warming (Zhao et al. 2017 PNAS: wheat -6%, rice -3.2%, maize -7.4%)
// https://doi.org/10.1073/pnas.1701762114
export const YIELD_LOSS_PER_C = 0.05

export type ClimateState = { cumGt: number; anomalyC: number; gtPerYear: number; fossilShare0: number; gdp0: number; marks: number[] }
export function initClimate(w: World): ClimateState {
  const fossil = sum(w.regions.map(r => r.mixCap.fossil)), cap = sum(w.regions.map(r => r.capacityTWh))
  return { cumGt: 0, anomalyC: START_ANOMALY_C, gtPerYear: 37.4, fossilShare0: fossil / Math.max(cap, 1), gdp0: sum(w.regions.map(r => r.r.gdpUsd)), marks: [] }
}

export function stepClimate(w: World) {
  const c = w.climate
  const fossilTWh = sum(w.regions.map(r => r.r.energyTWh * r.mixCap.fossil / Math.max(r.capacityTWh, 1)))
  const fossilShare = sum(w.regions.map(r => r.mixCap.fossil)) / Math.max(sum(w.regions.map(r => r.capacityTWh)), 1)
  const gdp = sum(w.regions.map(r => r.r.gdpUsd))
  const power = fossilTWh * MT_PER_FOSSIL_TWH / 1000
  const other = NON_POWER_GT_2026 * Math.sqrt(gdp / Math.max(c.gdp0, 1)) * (fossilShare / Math.max(c.fossilShare0, 0.01))
  c.gtPerYear = power + other
  c.cumGt += c.gtPerYear / 12
  c.anomalyC = START_ANOMALY_C + TCRE_C_PER_GT * c.cumGt
  for (const t of [1.5, 2, 2.5, 3]) if (c.anomalyC >= t && !c.marks.includes(t)) {
    c.marks.push(t)
    link(w, { placeId: 'world', what: `the world passed ${t} C of warming`, value: t, because: `${Math.round(c.cumGt)} Gt of CO2 emitted since 2026 at ${c.gtPerYear.toFixed(1)} Gt a year (IPCC TCRE 0.45 C per 1,000 Gt)`, byWhom: 'core', sig: 0.8 })
  }
}
export const climateYield = (w: World) => 1 - YIELD_LOSS_PER_C * Math.max(0, w.climate.anomalyC - START_ANOMALY_C)

// ---------- climate normals grid (lazy) ----------
let GRID: { buf: Buffer; layers: number } | null | undefined
function grid(): { buf: Buffer; layers: number } | null {
  if (GRID !== undefined) return GRID
  for (const base of [process.cwd(), path.resolve(process.cwd(), '..', 'hypothetical')]) {
    try {
      const idx = JSON.parse(fs.readFileSync(path.join(base, 'data/geo/grid-index.json'), 'utf8'))
      GRID = { buf: zlib.gunzipSync(fs.readFileSync(path.join(base, 'data/geo/grid-025.bin.gz'))), layers: idx.far.layers.length }
      return GRID
    } catch { /* try next */ }
  }
  GRID = null
  return GRID
}
export function normals(lat: number, lon: number, month: number): { tavg: number; precMm: number } {
  const g = grid()
  if (g) {
    const row = clamp(Math.floor((90 - lat) / 0.25), 0, 719), col = clamp(Math.floor((lon + 180) / 0.25), 0, 1439)
    const o = (row * 1440 + col) * g.layers
    const t = g.buf[o + 5 + month], p = g.buf[o + 17 + month]
    if (t || p) return { tavg: t - 60, precMm: p * 4 }
  }
  // ESTIMATE fallback when the grid is missing or the cell is water: latitude band climate
  const north = lat >= 0, season = Math.cos(((month - (north ? 6 : 0)) / 12) * 2 * Math.PI)
  return { tavg: 27 - 0.45 * Math.abs(lat) + 0.2 * Math.abs(lat) * season * 0.5, precMm: 80 }
}
// daily weather, seeded by place and day, from that month's normal plus the warming anomaly
export function weatherAt(w: World, lat: number, lon: number, tick: number, day: number): Weather {
  const month = (10 + tick) % 12 // tick 0 = november
  const n = normals(lat, lon, month)
  const r = mulberry32((hashString(`${lat.toFixed(2)},${lon.toFixed(2)}`) ^ (tick * 31 + day)) >>> 0)
  const tempC = Math.round((n.tavg + (w.climate.anomalyC - START_ANOMALY_C) + (r() + r() + r() - 1.5) * 5) * 10) / 10
  const wetDays = clamp(n.precMm / 8, 0, 25) // ESTIMATE: ~8 mm per rainy day
  const rain = r() < wetDays / 30
  const precipMm = rain ? Math.round(n.precMm / Math.max(wetDays, 1) * (0.5 + r()) * 10) / 10 : 0
  const kind: Weather['kind'] = rain ? (tempC < 0 ? 'snow' : precipMm > 25 ? 'storm' : 'rain') : tempC > 35 ? 'heat' : r() < 0.4 ? 'cloudy' : 'clear'
  return { tempC, precipMm, kind }
}

// ---------- energy mix per country ----------
type PlantRow = [string, string, string, number, number, string, number, number | null]
const PLANTS = (plantsJson as unknown as { plants: PlantRow[]; mixByCountry: Record<string, Mix> })
const FOSSIL_BY_COUNTRY = new Map<string, PlantRow[]>()
for (const p of PLANTS.plants) if (/Coal|Gas|Oil|Petcoke/.test(p[5])) { const l = FOSSIL_BY_COUNTRY.get(p[2]) ?? []; l.push(p); FOSSIL_BY_COUNTRY.set(p[2], l) }
// GPPD (circa 2019) undercounts the 2020-2024 solar and wind buildout, so each country's GPPD mix shape is rescaled
// so its region matches the 2024 regional shares (visuals.START_MIX, from Ember). ESTIMATE, documented in sources.md.
export function initCountryMix(w: World) {
  for (const rs of w.regions) {
    const cs = countriesOf(w, rs.r.id)
    const twh = (c: CountryState) => c.seed.kwhPerCapita * c.seed.population / 1e9
    const agg: Mix = { solar: 0, wind: 0, nuclear: 0, fossil: 0, hydro: 0 }
    for (const c of cs) { const m = PLANTS.mixByCountry[c.id] ?? START_MIX[rs.r.id]; for (const k of SOURCES) agg[k] += m[k] * twh(c) }
    const tot = sum(SOURCES.map(k => agg[k])) || 1
    for (const c of cs) {
      const m = PLANTS.mixByCountry[c.id] ?? START_MIX[rs.r.id]
      const adj = Object.fromEntries(SOURCES.map(k => [k, m[k] * (START_MIX[rs.r.id][k] + 1e-3) / (agg[k] / tot + 1e-3)])) as Mix
      const s = sum(SOURCES.map(k => adj[k])) || 1
      w.countryMix[c.id] = Object.fromEntries(SOURCES.map(k => [k, adj[k] / s])) as Mix
      w.countryMix0[c.id] = { ...w.countryMix[c.id] }
    }
  }
}

// country mix follows its region's mix change; plants retire or get built as diffs
export function stepCountryInfra(w: World) {
  for (const rs of w.regions) {
    const regionNow = Object.fromEntries(SOURCES.map(k => [k, rs.mixCap[k] / Math.max(rs.capacityTWh, 1)])) as Mix
    for (const c of countriesOf(w, rs.r.id)) {
      const m0 = w.countryMix0[c.id]
      if (!m0) continue
      const raw = Object.fromEntries(SOURCES.map(k => [k, m0[k] * (regionNow[k] + 1e-3) / (START_MIX[rs.r.id][k] + 1e-3)])) as Mix
      const s = sum(SOURCES.map(k => raw[k])) || 1
      const mix = Object.fromEntries(SOURCES.map(k => [k, raw[k] / s])) as Mix
      w.countryMix[c.id] = mix
      const twh = c.seed.kwhPerCapita * countryPop(c) / 1e9 * (rs.r.energyTWh / Math.max(rs.r.energyTWh, 1))
      // fossil capacity falling: retire the oldest fossil plants it no longer needs
      const fossilGw = mix.fossil * twh / 8.76 / 0.5
      const live = (FOSSIL_BY_COUNTRY.get(c.id) ?? []).filter(p => !w.retiredPlants.includes(p[0]))
      const liveGw = sum(live.map(p => p[6])) / 1000
      if (liveGw > fossilGw * 1.15 && live.length) {
        const oldest = live.slice().sort((a, b) => (a[7] ?? 1990) - (b[7] ?? 1990) || a[0].localeCompare(b[0]))[0]
        w.retiredPlants.push(oldest[0])
        const because = `fossil share ${Math.round(mix.fossil * 100)}%`
        // location, fuel and size of a retired plant are in data/geo/plants.json under its id
        w.infraAcc.push({ tick: w.tick, kind: 'plant', op: 'retired', id: oldest[0], countryId: c.id, because } as InfraDiff)
        if (oldest[6] >= 500) link(w, { placeId: c.regionId, what: `${oldest[1]} (${oldest[6]} MW ${oldest[5].toLowerCase()}) in ${c.name} was retired`, value: oldest[6], because, byWhom: 'market', sig: 0.35 })
      }
      // clean capacity growing: a new plant near the biggest city every ~1 GW added (ESTIMATE siting)
      for (const k of ['solar', 'wind', 'nuclear'] as const) {
        const gw = (mix[k] - m0[k]) * twh / 8.76 / (k === 'nuclear' ? 0.85 : k === 'solar' ? 0.18 : 0.3)
        const built = w.builtPlants[`${c.id}:${k}`] ?? 0
        if (gw - built >= 1) {
          w.builtPlants[`${c.id}:${k}`] = built + 1
          const city = CITY_SEEDS.filter(x => x.countryId === c.id).sort((a, b) => b.pop - a.pop)[0]
          const jitter = (hashString(`${c.id}${k}${built}`) % 1000) / 1000
          const lat = (city?.lat ?? c.seed.lat) + (jitter - 0.5) * 1.5, lon = (city?.lon ?? c.seed.lon) + (((jitter * 7) % 1) - 0.5) * 1.5
          w.infraAcc.push({ tick: w.tick, kind: 'plant', op: 'built', id: `new-${c.id}-${k}-${built}`, fuel: k, mw: 1000, lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, countryId: c.id, because: `${k} share ${Math.round(mix[k] * 100)}%` })
        }
      }
    }
  }
}

// ---------- cities ----------
export type CityState = { id: string; pop: number; damage: number; lastDiffPop: number; adminIdx: number }
export function initCities(w: World) {
  w.realCities = CITY_SEEDS.map(c => ({ id: c.id, pop: c.pop, damage: 0, lastDiffPop: c.pop, adminIdx: ADMIN_SEEDS.findIndex(a => a.countryId === c.countryId && a.name === c.adminName) }))
}
// yearly: real cities grow with their country's urban population (ESTIMATE elasticity 1.3, cities outgrow countries
// while urbanizing, UN World Urbanization Prospects), damaged by disasters located in their country
export function stepRealCities(w: World) {
  const byCountry = new Map(w.countries.map(c => [c.id, c]))
  w.realCities.forEach((cs, i) => {
    const seed = CITY_SEEDS[i]
    const c = byCountry.get(seed.countryId)
    if (!c) return
    const g = countryPop(c) / Math.max(c.seed.population * (sum(countriesOf(w, c.regionId).map(countryPop)) / Math.max(sum(countriesOf(w, c.regionId).map(x => x.seed.population)), 1)), 1)
    const urbanG = Math.pow(Math.max(g, 0.01), 1.3) * (1 - 0.3 * c.damage)
    cs.pop = Math.round(seed.pop * urbanG)
    cs.damage = Math.max(cs.damage * 0.85, i === w.citiesHitIdx[c.id] ? c.damage : 0)
    const ch = cs.pop / Math.max(cs.lastDiffPop, 1) - 1
    if (Math.abs(ch) >= 0.25) {
      w.infraAcc.push({ tick: w.tick, kind: 'city', op: ch > 0 ? 'grew' : 'shrank', id: cs.id, population: cs.pop, because: `${c.name} urban growth` })
      cs.lastDiffPop = cs.pop
    }
  })
}
// a disaster in a country hits one of its cities (largest-weighted by a stable hash)
export function damageCity(w: World, countryId: string, sev: number, because: string) {
  const idx = CITY_SEEDS.map((c, i) => [c, i] as const).filter(([c]) => c.countryId === countryId)
  if (!idx.length) return
  const tot = sum(idx.map(([c]) => c.pop))
  let x = ((hashString(`${countryId}${w.tick}`) % 10000) / 10000) * tot
  let pickI = idx[0][1]
  for (const [c, i] of idx) { x -= c.pop; if (x <= 0) { pickI = i; break } }
  const cs = w.realCities[pickI]
  cs.damage = clamp(cs.damage + sev)
  w.citiesHitIdx[countryId] = pickI
  w.infraAcc.push({ tick: w.tick, kind: 'city', op: 'damaged', id: cs.id, population: cs.pop, damage: Math.round(cs.damage * 100) / 100, because })
}

// ---------- traffic ----------
// relative volumes per country, 0..1. hourly shape per mode is fixed (rush hours for roads and rail, flat-ish for
// ports, day-heavy for airports); the ui multiplies segment/hub base weight x country volume x hourly profile.
export const HOURLY = {
  road: [0.15, 0.1, 0.08, 0.08, 0.12, 0.3, 0.6, 0.95, 1, 0.75, 0.6, 0.6, 0.65, 0.62, 0.6, 0.65, 0.8, 1, 0.95, 0.7, 0.5, 0.4, 0.3, 0.2],
  rail: [0.05, 0.02, 0.02, 0.02, 0.05, 0.25, 0.7, 1, 0.95, 0.5, 0.4, 0.4, 0.45, 0.4, 0.4, 0.5, 0.8, 1, 0.9, 0.55, 0.35, 0.25, 0.15, 0.08],
  port: [0.7, 0.7, 0.7, 0.7, 0.75, 0.8, 0.9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.7],
  air: [0.2, 0.1, 0.05, 0.05, 0.1, 0.4, 0.8, 1, 1, 0.95, 0.9, 0.9, 0.9, 0.9, 0.9, 0.95, 1, 1, 0.95, 0.85, 0.7, 0.55, 0.4, 0.3],
}
// country order is w.countries (listed once, on the first frame); later frames carry only the numbers
export function trafficFrame(w: World): { countries?: string[]; road: number[]; rail: number[]; port: number[]; air: number[] } {
  const r2 = (x: number) => Math.round(x * 10) / 10
  const out = { countries: [] as string[], road: [] as number[], rail: [] as number[], port: [] as number[], air: [] as number[] }
  for (const c of w.countries) {
    const rs = w.regions.find(r => r.r.id === c.regionId)!
    const activity = clamp((1 - c.unemployment) * (1 - 0.5 * Math.max(0, c.unrest - 0.3)) * (1 + rs.growth * 5) * (1 - 0.5 * c.damage) * (rs.inRevolt ? 0.6 : 1))
    const inc = incomeIdx(c.gdpUsd / Math.max(countryPop(c), 1))
    if (w.tick === 0) out.countries.push(c.id)
    out.road.push(r2(activity * clamp(c.seed.local.carsPer1000 / 600 + 0.2)))
    out.rail.push(r2(activity * clamp(c.seed.local.commuteShare.transit * 2 + (rs.railLinks.length ? 0.2 : 0))))
    out.port.push(r2(activity * clamp(0.3 + 0.7 * inc)))
    out.air.push(r2(activity * clamp(0.1 + 0.9 * inc * inc)))
  }
  if (w.tick !== 0) delete (out as { countries?: string[] }).countries
  return out
}

// ---------- pips: local life ----------
const unit = (seed: number, salt: string) => mulberry32((seed ^ hashString(salt)) >>> 0)()
const JOB_BY_WORKPLACE: Record<Workplace, string[]> = {
  farm: ['farmer', 'farm hand', 'fisher'], factory: ['machinist', 'assembly worker', 'mechanic', 'tailor'], construction: ['builder', 'electrician', 'welder'],
  power_plant: ['plant operator'], office: ['accountant', 'software engineer', 'civil servant', 'designer', 'logistics manager'], shop: ['shopkeeper', 'market trader', 'cook', 'retail worker', 'driver'],
  clinic: ['nurse', 'doctor'], school: ['teacher'], lab: ['lab technician', 'researcher'], launch_site: ['launch technician'], none: ['retired'],
}
export function placeCitizen(w: World, c: Citizen) {
  const rs = w.regions.find(r => r.r.id === c.regionId)
  if (!rs) return
  const cs = countriesOf(w, rs.r.id)
  if (!cs.length) return
  const tot = sum(cs.map(countryPop))
  let x = unit(c.personalitySeed, `country:${c.regionId}`) * tot
  let country = cs[cs.length - 1]
  for (const k of cs) { x -= countryPop(k); if (x <= 0) { country = k; break } }
  const cities = CITY_SEEDS.filter(k => k.countryId === country.id)
  let cityId: string | undefined
  if (cities.length) {
    const ct = sum(cities.map(k => k.pop))
    let y = unit(c.personalitySeed, `city:${country.id}`) * ct
    cityId = cities[cities.length - 1].id
    for (const k of cities) { y -= k.pop; if (y <= 0) { cityId = k.id; break } }
  }
  Object.assign(c, { countryId: country.id, ...(cityId ? { cityId } : {}) })
}

// the local job for a working-age pip, drawn from the country's real job mix (World Bank sector shares)
export function localWorkplace(w: World, c: Citizen): Workplace {
  if (c.age < 18) return c.age >= 6 ? 'school' : 'none'
  if (c.age >= 67) return 'none'
  const country = w.countries.find(k => k.id === (c as Citizen & { countryId?: string }).countryId)
  const mix = country?.seed.local.jobMix ?? { agriculture: 0.26, industry: 0.23, services: 0.51 }
  const u = unit(c.personalitySeed, 'sector')
  const launch = w.companies.some(k => k.sector === 'launch' && k.regionId === c.regionId && !k.failed)
  if (u < mix.agriculture) return 'farm'
  if (u < mix.agriculture + mix.industry) { const v = unit(c.personalitySeed, 'ind'); return v < 0.55 ? 'factory' : v < 0.9 ? 'construction' : 'power_plant' }
  const v = unit(c.personalitySeed, 'srv')
  return launch && v < 0.02 ? 'launch_site' : v < 0.35 ? 'shop' : v < 0.65 ? 'office' : v < 0.8 ? 'school' : v < 0.95 ? 'clinic' : 'lab'
}

// the state part of local life (job, workplace, employment, income, spending, commute): once a year in the tick body,
// so the world never depends on when frames are written
export function localLife(w: World, c: Citizen) {
  const cc = c as Citizen & { countryId?: string; cityId?: string }
  const country = w.countries.find(k => k.id === cc.countryId)
  const rs = w.regions.find(r => r.r.id === c.regionId)!
  const workplace = localWorkplace(w, c)
  // adults get a job title that matches their workplace (a school's adults are teachers)
  if (workplace !== 'none' && (c.age >= 18 || workplace !== 'school') && !JOB_BY_WORKPLACE[workplace].includes(c.job)) {
    const jobs = JOB_BY_WORKPLACE[workplace]
    c.job = jobs[Math.floor(unit(c.personalitySeed, `job:${workplace}`) * jobs.length) % jobs.length]
  }
  if (workplace === 'school' && c.age < 18) c.job = 'student'
  const working = c.age >= 18 && c.age < 67
  const unemp = country?.unemployment ?? 0.06
  // employed: the country's job rate, rolled per pip per year
  const employed = working ? unit(c.personalitySeed, `emp${Math.floor(w.tick / 12)}`) >= unemp * (1 + 0.5 * (rs.behavior.idle - 0.04) * 10) : false
  // income (USD/month): GDP per capita x labor share (~0.55, ILO), spread by income band and the country's Gini
  const gdppc = country ? country.gdpUsd / Math.max(countryPop(country), 1) : rs.r.gdpUsd / Math.max(regionPop(rs), 1)
  const gini = country?.seed.gini ?? 0.38
  const band = c.group?.incomeBand ?? 'mid'
  const bandMult = band === 'low' ? 0.5 - 0.4 * gini : band === 'high' ? 1.8 + 4 * gini : 1
  const income = Math.round((employed ? gdppc * 0.55 * bandMult : working ? gdppc * 0.08 : c.age >= 67 ? gdppc * 0.25 : 0) / 12)
  // spending: most of income, more of it on food when prices are up (ESTIMATE)
  const spending = Math.round(income * clamp(0.92 - (band === 'high' ? 0.25 : 0) + 0.1 * Math.max(0, rs.priceIdx - 1)))
  // commute from the country's mode shares
  let commuteMode: CommuteMode = 'none'
  if (employed || (c.age >= 6 && c.age < 18)) {
    const share = country?.seed.local.commuteShare ?? { walk: 0.3, bike: 0.05, transit: 0.25, car: 0.3, motorbike: 0.1 }
    let u = unit(c.personalitySeed, 'commute'), mode = 'walk'
    for (const [k, v] of Object.entries(share)) { u -= v; if (u <= 0) { mode = k; break } }
    commuteMode = (c.age < 18 && (mode === 'car' || mode === 'motorbike')) ? 'transit' : mode as CommuteMode
  }
  // faith: stable per pip, from the country's Pew 2020 mix (sets worship days in the day plan)
  const cf = c as Citizen & { faith?: Faith }
  if (!cf.faith || cf.faith === 'unaffiliated' && c.belief !== 'secular') cf.faith = faithOf(cc.countryId, c.belief, unit(c.personalitySeed, 'faith'))
  // home: stable per pip (drawn once from the country's tenure mix for its income band), moved by evictions
  const cx = c as Citizen & { home?: HomeKind; rentShare?: number }
  if (country?.housing) {
    const h = country.housing
    const year = Math.floor(w.tick / 12)
    if (!cx.home) cx.home = homeOf(country, band, unit(c.personalitySeed, 'home'))
    // evicted this year: the country's eviction rate, doubled for the poorest (Eviction Lab: low-income renters most at risk)
    const evRate = h.evictedYear / Math.max(h.rented, 1) * (band === 'low' ? 2 : band === 'high' ? 0.3 : 1)
    if (cx.home === 'rented' && c.age >= 18 && unit(c.personalitySeed, `evict${year}`) < evRate) {
      cx.home = unit(c.personalitySeed, `evicted-to${year}`) < 0.3 ? 'family' : homeOf(country, band, unit(c.personalitySeed, `rehome${year}`))
      if (cx.home === 'owned') cx.home = 'rented'
      addLifeEvent(w, c, `evicted, ${cx.home === 'family' ? 'moved in with family' : cx.home === 'informal' ? 'moved to an informal settlement' : cx.home === 'camp' ? 'ended up in a camp' : 'found another rental'}`)
    }
    // rent (renters, social at about half), mortgage (owners ~ a fifth), nothing for family or camps. ESTIMATE
    cx.rentShare = Math.round((cx.home === 'rented' ? h.rentBurden * (band === 'low' ? 1.4 : band === 'high' ? 0.6 : 1) : cx.home === 'social' ? 0.5 * h.rentBurden : cx.home === 'owned' ? 0.2 : cx.home === 'informal' ? 0.1 : 0) * 20) / 20 // steps of 5%: fewer frame deltas
  }
  Object.assign(c, { workplace: employed || workplace === 'school' ? workplace : 'none', employed, income, spending, commuteMode })
}

// clothes for today: pure (no sim state changes), computed whenever a frame is written
export function dressCitizen(w: World, c: Citizen) {
  const cc = c as Citizen & { countryId?: string; cityId?: string; workplace?: Workplace; employed?: boolean }
  const country = w.countries.find(k => k.id === cc.countryId)
  const workplace = cc.workplace ?? 'none', employed = !!cc.employed
  const band = c.group?.incomeBand ?? 'mid'
  // weather at home today (the 15th of the month) and clothes for it: same base character, never costume
  const city = CITY_SEEDS.find(k => k.id === cc.cityId)
  const weather = weatherAt(w, city?.lat ?? country?.seed.lat ?? 0, city?.lon ?? country?.seed.lon ?? 0, w.tick, 15)
  const layer: Clothing['layer'] = weather.tempC < 0 ? 'heavy' : weather.tempC < 10 ? 'warm' : weather.tempC < 20 ? 'medium' : 'light'
  const workCloth: Clothing['work'] = !employed ? 'none' : workplace === 'construction' ? 'hi_vis' : workplace === 'clinic' ? 'scrubs' : workplace === 'lab' ? 'lab_coat' : workplace === 'farm' ? 'farm' : workplace === 'factory' || workplace === 'power_plant' || workplace === 'launch_site' ? 'uniform' : workplace === 'office' && band === 'high' ? 'suit' : 'none'
  // a typical outfit for this month here: rain gear where the month is wet (over ~100 mm), not a daily dice roll
  const wet = normals(city?.lat ?? country?.seed.lat ?? 0, city?.lon ?? country?.seed.lon ?? 0, (10 + w.tick) % 12).precMm > 100
  const clothing: Clothing = { layer, rain: wet && weather.tempC > 0, work: workCloth }
  Object.assign(c, { clothing })
}

// ---------- states and cities: yearly stats into a compact lazy file ----------
export const PLACE_KEYS = ['population', 'happiness', 'economy', 'livability', 'foodSecurity', 'safety', 'health', 'jobs', 'housingCost', 'airQuality'] as const
const TREND_CODE: Record<Trend, number> = { stable: 0, rising: 1, declining: 2 }
export type PlacesAcc = { years: { tick: number; bin: Buffer; stories: Record<string, string> }[]; hist: Map<string, { tick: number; livability: number; population: number }[]> }

function encodeRow(buf: Buffer, o: number, s: PlaceStats) {
  buf.writeFloatLE(s.population, o)
  let k = 4
  for (const key of PLACE_KEYS.slice(1)) {
    const v = key === 'housingCost' ? Math.round(s.housingCost * 10) : Math.round(clamp(s[key] as number) * 250)
    buf[o + k++] = Math.min(255, v)
  }
  buf[o + k] = TREND_CODE[s.trend]
}
export const ROW_BYTES = 4 + (PLACE_KEYS.length - 1) + 1

export function recordPlacesYear(w: World, acc: PlacesAcc) {
  const nC = w.countries.length, nA = ADMIN_SEEDS.length, nT = CITY_SEEDS.length
  const buf = Buffer.alloc((nC + nA + nT) * ROW_BYTES)
  const stories: Record<string, string> = {}
  const byC = new Map(w.countries.map(c => [c.id, c]))
  const adminPop0 = new Map<string, number>()
  for (const a of ADMIN_SEEDS) adminPop0.set(a.countryId, (adminPop0.get(a.countryId) ?? 0) + a.population)
  const histFor = (id: string) => { const h = acc.hist.get(id) ?? []; acc.hist.set(id, h); return h }
  const push = (id: string, s: Omit<PlaceStats, 'trend'>, idx: number, storyIfNotable: () => string | null) => {
    const h = histFor(id)
    const trend = trendOf(h, s, w.tick)
    encodeRow(buf, idx * ROW_BYTES, { ...s, trend })
    const prev = h[h.length - 1]
    h.push({ tick: w.tick, livability: s.livability, population: s.population }); if (h.length > 6) h.shift()
    if (prev && Math.abs(s.livability - prev.livability) > 0.03) { const st = storyIfNotable(); if (st) stories[id] = st }
  }
  w.countries.forEach((c, i) => push(c.id, c.stats, i, () => countryStory(w, c)))
  const adminDamage = new Float64Array(nA)
  w.realCities.forEach(rc => { if (rc.adminIdx >= 0 && rc.damage > adminDamage[rc.adminIdx]) adminDamage[rc.adminIdx] = rc.damage })
  // states: their country's stats, moved by local brightness (a proxy for local income) and damage
  ADMIN_SEEDS.forEach((a, i) => {
    const c = byC.get(a.countryId)
    if (!c) return
    const share = a.population / Math.max(adminPop0.get(a.countryId) ?? 1, 1)
    const pop = countryPop(c) * share
    const lights = (a.meanLights ?? 0) / 255
    const dmg = adminDamage[i]
    const econ = clamp(c.stats.economy + 0.15 * (lights - 0.3))
    const s: Omit<PlaceStats, 'trend'> = { ...c.stats, population: Math.round(pop), economy: Math.round(econ * 1000) / 1000, jobs: clamp(c.stats.jobs + 0.1 * (lights - 0.3)), safety: clamp(c.stats.safety - 0.3 * dmg), livability: clamp(c.stats.livability + 0.05 * (lights - 0.3) - 0.25 * dmg), happiness: clamp(c.stats.happiness - 0.2 * dmg), airQuality: clamp(c.stats.airQuality - 0.15 * lights) }
    push(a.id, s, nC + i, () => dmg > 0.1 ? `${a.name}, ${c.name}: livability ${Math.round(s.livability * 100)}% after damage in the region's cities (${Math.round(dmg * 100)}% damage)` : `${a.name}, ${c.name}: livability ${Math.round(s.livability * 100)}%, following ${c.name}: ${countryStory(w, c) ?? 'no single cause'}`)
  })
  CITY_SEEDS.forEach((t, i) => {
    const c = byC.get(t.countryId)
    const st = w.realCities[i]
    if (!c || !st) return
    const dens = st.pop / 600 // ESTIMATE: ~600 km2 per metro area for housing pressure
    const s: Omit<PlaceStats, 'trend'> = { ...c.stats, population: st.pop, housingCost: Math.round(housingMultiple(1, dens, 0) * 10) / 10, safety: clamp(c.stats.safety - 0.3 * st.damage), livability: clamp(c.stats.livability - 0.3 * st.damage + 0.03), economy: clamp(c.stats.economy + 0.08), airQuality: clamp(c.stats.airQuality - 0.1) }
    push(t.id, s, nC + nA + i, () => st.damage > 0.1 ? `${t.name}: ${Math.round(st.damage * 100)}% damaged, livability ${Math.round(s.livability * 100)}%` : null)
  })
  acc.years.push({ tick: w.tick, bin: buf, stories })
}

function countryStory(w: World, c: CountryState): string | null {
  const story = w.regions.find(r => r.r.id === c.regionId)?.story
  const own = w.causes.filter(l => l.tick >= w.tick - 12 && l.what.includes(c.name)).sort((a, b) => (b.sig ?? 0) - (a.sig ?? 0))[0]
  if (own) return `${own.what} (${own.because.split(', after ')[0]}).`
  return story?.sentences[0] ?? null
}

export function writePlaces(file: string, runId: string, acc: PlacesAcc, w: World) {
  const header = {
    runId, rowBytes: ROW_BYTES, keys: PLACE_KEYS, trendCodes: ['stable', 'rising', 'declining'],
    encoding: 'per year: rows in order countries, admin1, cities. population float32 LE, then each stat 0..1 as byte/250 (housingCost as byte/10), then trend code',
    countries: w.countries.map(c => ({ id: c.id, name: c.name, regionId: c.regionId })),
    admin1: ADMIN_SEEDS.map(a => ({ id: a.id, countryId: a.countryId, name: a.name })),
    cities: CITY_SEEDS.map(t => ({ id: t.id, countryId: t.countryId, name: t.name })),
    years: acc.years.map(y => ({ tick: y.tick, stories: y.stories })),
  }
  fs.writeFileSync(`${file}.json`, JSON.stringify(header))
  fs.writeFileSync(`${file}.bin.gz`, zlib.gzipSync(Buffer.concat(acc.years.map(y => y.bin)), { level: 9 }))
}
void COUNTRY_SEEDS
