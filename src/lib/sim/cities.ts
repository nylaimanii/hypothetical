// new cities, companies and travel. the governor proposes; the sim scores sites and people decide whether
// to move. nobody is forced. companies hire, strengthen their sector, and can fail.
import type { City, Company, Decision } from '../types'
import { reqProgress } from './requirements'
import { clamp, event, incomeIdx, regionPop, why, type CompanyState, type World } from './state'
import { has } from './frontier'
import { addFlow, addLandmark } from './visuals'

// ESTIMATE water stress by region, 0 = plenty, 1 = extreme (WRI Aqueduct 4.0 country baseline water stress,
// population-weighted by eye). https://www.wri.org/aqueduct
const WATER_STRESS: Record<string, number> = { na: 0.4, latam: 0.25, europe: 0.35, rus_ca: 0.4, mideast: 0.95, nafrica: 0.9, ssa: 0.35, sasia: 0.8, easia: 0.6, seasia: 0.3, oceania: 0.45, carib_pac: 0.4 }

// documented site heuristic, 0..1:
//   water 35%: 1 - regional water stress, minus a penalty inside the subtropical desert belts (|lat| 18-32)
//   climate 25%: best between |lat| 20 and 50, worse toward the equator (heat) and the poles (cold)
//   energy 20%: share of electricity demand met in the region
//   jobs 20%: income growth of the region plus companies already there
export function scoreSite(w: World, c: Pick<City, 'regionId' | 'lat' | 'lon'>): number {
  const rs = w.regions.find(r => r.r.id === c.regionId)
  if (!rs) return 0
  const alat = Math.abs(c.lat)
  const desert = alat >= 18 && alat <= 32 ? 0.25 : 0
  const water = clamp(1 - (WATER_STRESS[c.regionId] ?? 0.5) - desert + 0.3 * reqProgress(w, 'desalination'))
  const climate = alat >= 20 && alat <= 50 ? 1 : alat < 20 ? 0.6 + 0.02 * alat : clamp(1 - (alat - 50) / 25)
  const energy = rs.energyRatio
  const jobs = clamp(0.5 + rs.growth * 10 + 0.05 * w.companies.filter(x => x.regionId === c.regionId && !x.failed).length)
  return clamp(0.35 * water + 0.25 * climate + 0.2 * energy + 0.2 * jobs)
}

export function foundCities(w: World, list: Decision['foundCities']) {
  for (const c of list.slice(0, 3)) {
    if (c.offWorld === 'moon' && !has(w, 'moon_base')) { event(w, { kind: 'law', text: `${c.name} on the moon rejected: there is no lunar base to build from yet`, severity: 0.1 }); continue }
    if (c.offWorld === 'mars' && !has(w, 'mars_settlement')) { event(w, { kind: 'law', text: `${c.name} on mars rejected: the settlement requirements are not met`, severity: 0.1 }); continue }
    if (!w.regions.some(r => r.r.id === c.regionId)) continue
    const lat = clamp(Number(c.lat) || 0, -70, 75), lon = clamp(Number(c.lon) || 0, -180, 180)
    const city: City = { id: `city-${w.tick}-${w.cities.length}`, name: c.name.slice(0, 60), regionId: c.regionId, lat, lon, foundedTick: w.tick, population: 0, reason: c.reason.slice(0, 200), ...(c.offWorld ? { offWorld: c.offWorld } : {}) }
    const score = c.offWorld ? 0.5 : scoreSite(w, city)
    w.cities.push(city)
    if (!city.offWorld) { const home = w.regions.find(r => r.r.id === city.regionId); if (home) addLandmark(home, 'city', city.name, w.tick) }
    w.cityScores[city.id] = score
    event(w, { regionId: c.regionId, kind: 'migration', text: `new city ${city.name} chartered in ${w.regions.find(r => r.r.id === c.regionId)!.r.name} (site score ${score.toFixed(2)})`, severity: 0.2 })
  }
}

export function stepCities(w: World) {
  for (const rs of w.regions) {
    const cities = w.cities.filter(c => !c.offWorld && c.regionId === rs.r.id)
    if (!cities.length) continue
    const total = cities.reduce((a, c) => a + (w.cityScores[c.id] ?? 0.3), 0)
    // people choose: the moving share of the region is spread across its new cities by site score
    const movers = regionPop(rs) * rs.behavior.moving_to_new_city * 0.05
    for (const c of cities) {
      const s = w.cityScores[c.id] ?? 0.3
      const cap = 25e6 * s // ESTIMATE: a great site can grow into a megacity, a poor one stays a town
      const before = c.population
      c.population = Math.round(Math.min(cap, c.population + movers * s / total * (1 - c.population / Math.max(cap, 1))))
      addFlow(w, { from: rs.r.id, to: rs.r.id, toCityId: c.id, people: c.population - before, reason: `chose to move to ${c.name}`, forced: false })
    }
    rs.newCityPop = cities.reduce((a, c) => a + c.population, 0)
  }
}

// ---------- companies ----------
export function charterCompanies(w: World, list: Decision['charterCompanies']) {
  for (const c of list.slice(0, 3)) {
    if (!w.regions.some(r => r.r.id === c.regionId)) continue
    const co: CompanyState = { id: `co-${w.tick}-${w.companies.length}`, name: c.name.slice(0, 60), sector: c.sector, regionId: c.regionId, foundedTick: w.tick, workers: 500, purpose: c.purpose.slice(0, 200), health: 0.6 }
    w.companies.push(co)
    event(w, { regionId: c.regionId, kind: 'breakthrough', text: `${co.name} chartered (${co.sector}): ${co.purpose}`, severity: 0.15 })
  }
}

export function stepCompanies(w: World) {
  for (const co of w.companies) {
    if (co.failed) continue
    const rs = w.regions.find(r => r.r.id === co.regionId)!
    // ESTIMATE: health drifts with regional growth, unrest, compliance and strikes
    const env = 0.5 + 5 * rs.growth - 0.6 * Math.max(0, rs.r.unrest - 0.35) + 0.2 * (rs.r.compliance - 0.4) - 3 * rs.behavior.striking
    co.health = clamp(co.health + (env - co.health) * 0.05)
    const g = 0.04 * (co.health - 0.35) // monthly hiring rate
    co.workers = Math.max(0, Math.round(co.workers * (1 + g) + (g > 0 ? 50 : 0)))
    co.workers = Math.min(co.workers, Math.round(regionPop(rs) * 0.002))
    // failure: ESTIMATE ~0.4%/month when weak (startups fail at high rates; about 1 in 5 within a year, US BLS)
    const pFail = co.health < 0.3 ? 0.03 : 0.002
    if (w.rng.companies() < pFail) {
      co.failed = true
      event(w, { regionId: co.regionId, kind: 'disaster', text: `${co.name} collapses, ${co.workers.toLocaleString('en-US')} workers laid off`, severity: 0.15 })
      for (const c of w.citizens) if (c.regionId === co.regionId && c.job !== 'retired' && c.job !== 'student' && c.job !== 'child' && w.rng.companies() < 0.05) c.lifeEvents = [...c.lifeEvents, { tick: w.tick, text: `lost a job when ${co.name} went under` }].slice(-8)
    }
  }
}

// sector strength 0..1 from total workers (ESTIMATE: 1 - exp(-workers / 2M))
export function sectorStrength(w: World): Record<Company['sector'], number> {
  const out = { energy: 0, food: 0, transit: 0, medicine: 0, longevity: 0, launch: 0, materials: 0, housing: 0, computing: 0 } as Record<Company['sector'], number>
  const tot: Record<string, number> = {}
  for (const c of w.companies) if (!c.failed) tot[c.sector] = (tot[c.sector] ?? 0) + c.workers
  for (const k of Object.keys(out) as Company['sector'][]) out[k] = 1 - Math.exp(-(tot[k] ?? 0) / 2e6)
  return out
}

// travel time to the nearest other region hub. ESTIMATE: high speed rail can halve it, hypersonic cut 60% more,
// transit companies 10%
export function stepTravel(w: World, transit: number) {
  const hsr = reqProgress(w, 'high_speed_rail'), hyp = reqProgress(w, 'hypersonic_transport')
  for (const rs of w.regions) {
    const base = rs.travelHours
    const t = base * (1 - 0.5 * hsr * (incomeIdx(rs.r.gdpUsd / Math.max(rs.r.population, 1)) * 0.5 + 0.5)) * (1 - 0.6 * hyp) * (1 - 0.1 * transit)
    if (rs.r.travelHoursToNearest && Math.abs(t - rs.r.travelHoursToNearest) > 0.01) why(rs, 'travelHoursToNearest', 'transport infrastructure', t - rs.r.travelHoursToNearest)
    rs.r.travelHoursToNearest = Math.round(t * 100) / 100
  }
}
