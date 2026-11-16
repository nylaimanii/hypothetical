import { initHousing, type Housing } from './housing'
import type { Daily } from './daily'
// v4 / phase 1: the sim at country level. ~200 real countries carry their own age bands, mortality,
// fertility, food, economy, unrest and compliance; regions are the sum of their countries and stay as the
// summary layer for the governor brief. states (admin-1) and real cities roll down from their country by
// population share plus local effects. all starting values come from data/geo (see data/geo/sources.md).
import type { PlaceStats, Trend } from '../types'
import countriesJson from '../../../data/geo/countries.json'
import admin1Json from '../../../data/geo/admin1.json'
import citiesJson from '../../../data/geo/cities.json'
import { GOMPERTZ_B } from './constants'
import { BAND_MID, NBANDS, clamp, incomeIdx, sum, type RegionState, type World } from './state'

export type CountrySeed = {
  id: string; name: string; regionId: string; lat: number; lon: number; population: number; gdpUsd: number; share65plus: number; kwhPerCapita: number
  tertiary: number; faith: number; kcal: number; wgiStability: number; wgiRuleOfLaw: number; tfr: number; crudeDeath: number; under5: number
  ageShare: number[] | null; heightF: number; heightM: number; unemployment: number; urban: number; gini: number; homicidePer100k: number
  happiness: number; cpi: number; pm25: number; areaKm2: number; forestShare: number; farmlandShare: number
  local: { commuteShare: Record<string, number>; jobMix: { agriculture: number; industry: number; services: number }; carsPer1000: number; farmType: string; nightlife: number }
  provenance: Record<string, { kind: 'SOURCED' | 'ESTIMATE'; url?: string; note?: string }>
}
export const COUNTRY_SEEDS = (countriesJson as unknown as { countries: CountrySeed[] }).countries
export type AdminSeed = { id: string; name: string; countryId: string; lat: number; lon: number; population: number; popSource: string; meanLights: number | null }
export const ADMIN_SEEDS = (admin1Json as unknown as { admin1: AdminSeed[] }).admin1
export type CitySeed = { id: string; name: string; countryId: string; adminName: string; lat: number; lon: number; pop: number; capital: boolean; regionId: string | null }
export const CITY_SEEDS = (citiesJson as unknown as { cities: CitySeed[] }).cities

export type CountryState = {
  id: string; name: string; regionId: string; seed: CountrySeed
  bands: number[]; tfr: number; gompertzA: number; infantMort: number
  gdpUsd: number; kcalRatio: number; kcal: number; foodMonthsUnder: number
  unrestOffset: number; complianceOffset: number; unrest: number; compliance: number
  unemployment: number; happiness: number; damage: number; shock: number
  stats: PlaceStats; hist: { tick: number; livability: number; population: number }[]
  ple: number
  housing: Housing; housingGdpPrev: number
  daily: Daily
  droughtSev: number; droughtUntil: number
}

export const countryPop = (c: CountryState) => sum(c.bands)

// starting state for every country of a region. regions with no country data keep their own bands.
export function initCountries(regions: RegionState[]): CountryState[] {
  const out: CountryState[] = []
  for (const rs of regions) {
    const seeds = COUNTRY_SEEDS.filter(c => c.regionId === rs.r.id)
    const regionKcal = rs.r.foodKcalPerCapita
    const totalSeedPop = sum(seeds.map(s => s.population)) || 1
    for (const s of seeds) {
      // scale so countries sum exactly to the region's sourced population (microstates are folded in)
      const pop = s.population * rs.r.population / totalSeedPop
      const share = s.ageShare && s.ageShare.every(Number.isFinite) ? s.ageShare : rs.bands.map(b => b / Math.max(sum(rs.bands), 1))
      const ss = sum(share) || 1
      const bands = share.map(x => x / ss * pop)
      const infantMort = s.under5 / 1000 / 5
      // calibrate each country's mortality level to its own sourced crude death rate
      const target = s.crudeDeath / 1000 * pop - bands[0] * infantMort
      const denom = sum(bands.map((b, i) => b * Math.exp(GOMPERTZ_B * (BAND_MID[i] - 60))))
      const gompertzA = Math.max(target / Math.max(denom, 1), 0.002)
      // ESTIMATE: country unrest/compliance offsets from its own WGI scores, same formulas as the region seed
      const unrestC = clamp(0.05 + 0.4 * (0.5 - s.wgiStability / 5)), complianceC = clamp(0.5 + 0.14 * s.wgiRuleOfLaw)
      out.push({
        id: s.id, name: s.name, regionId: rs.r.id, seed: s, bands, tfr: s.tfr, gompertzA, infantMort,
        gdpUsd: s.gdpUsd * rs.r.gdpUsd / Math.max(sum(seeds.map(x => x.gdpUsd)), 1), kcalRatio: clamp(s.kcal / Math.max(regionKcal, 1), 0.6, 1.6), kcal: s.kcal, foodMonthsUnder: 0,
        unrestOffset: unrestC - rs.r.unrest, complianceOffset: complianceC - rs.r.compliance, unrest: unrestC, compliance: complianceC,
        unemployment: s.unemployment, happiness: clamp(s.happiness / 10), damage: 0, shock: 0,
        stats: emptyStats(pop), hist: [], ple: 0, housing: undefined as unknown as Housing, housingGdpPrev: 0, daily: undefined as unknown as Daily, droughtSev: 0, droughtUntil: 0,
      })
      out[out.length - 1].housing = initHousing(out[out.length - 1])
    }
  }
  return out
}

const emptyStats = (pop: number): PlaceStats => ({ population: Math.round(pop), happiness: 0.5, economy: 0.5, livability: 0.5, trend: 'stable', foodSecurity: 0.5, safety: 0.5, health: 0.5, jobs: 0.5, housingCost: 5, airQuality: 0.5 })

export function countriesOf(w: World, regionId: string): CountryState[] {
  return w.countries.filter(c => c.regionId === regionId)
}

// keep region bands equal to the sum of their countries
export function syncRegion(w: World, rs: RegionState) {
  const cs = countriesOf(w, rs.r.id)
  if (!cs.length) return
  const bands = new Array(NBANDS).fill(0)
  for (const c of cs) for (let i = 0; i < NBANDS; i++) bands[i] += c.bands[i]
  rs.bands = bands
}

// take people out of a region (migration departures), spread over its countries by their age structure
export function removeFromRegion(w: World, rs: RegionState, take: number[]) {
  const cs = countriesOf(w, rs.r.id)
  if (!cs.length) { rs.bands = rs.bands.map((b, i) => Math.max(0, b - take[i])); return }
  for (let i = 0; i < NBANDS; i++) {
    const tot = sum(cs.map(c => c.bands[i])) || 1
    for (const c of cs) c.bands[i] = Math.max(0, c.bands[i] - take[i] * c.bands[i] / tot)
  }
  syncRegion(w, rs)
}

// add people (migration arrivals) to a region, by population share (or to one country)
export function addToRegion(w: World, rs: RegionState, add: number[], countryId?: string) {
  const cs = countriesOf(w, rs.r.id)
  if (!cs.length) { rs.bands = rs.bands.map((b, i) => b + add[i]); return }
  const target = countryId ? cs.filter(c => c.id === countryId) : cs
  const tot = sum(target.map(countryPop)) || 1
  for (const c of target) { const s = countryPop(c) / tot; for (let i = 0; i < NBANDS; i++) c.bands[i] += add[i] * s }
  syncRegion(w, rs)
}

// a share of people die (disaster, war), in one country if given, else across the region
export function killInRegion(w: World, rs: RegionState, share: number, countryId?: string): number {
  const cs = countriesOf(w, rs.r.id)
  if (!cs.length) { const dead = sum(rs.bands) * share; rs.bands = rs.bands.map(b => b * (1 - clamp(share))); return dead }
  const target = countryId ? cs.filter(c => c.id === countryId) : cs
  let dead = 0
  // a regional share concentrated in one country: that country loses share x region pop (capped at 20%)
  const regionPop = sum(rs.bands)
  for (const c of target) {
    const cp = countryPop(c)
    const s = countryId ? clamp(share * regionPop / Math.max(cp, 1), 0, 0.2) : share
    dead += cp * s
    c.bands = c.bands.map(b => b * (1 - s))
    if (countryId) { c.damage = Math.max(c.damage, clamp(s * 50)); c.shock += 0.1 }
  }
  syncRegion(w, rs)
  return dead
}

// pick a country inside a region from a uniform draw u, weighted by population
export function pickCountry(w: World, rs: RegionState, u: number): CountryState | undefined {
  const cs = countriesOf(w, rs.r.id)
  const tot = sum(cs.map(countryPop))
  let x = u * tot
  for (const c of cs) { x -= countryPop(c); if (x <= 0) return c }
  return cs[cs.length - 1]
}

// ---------- per-country economy and society (after the region step) ----------
export function stepCountries(w: World) {
  for (const rs of w.regions) {
    const cs = countriesOf(w, rs.r.id)
    if (!cs.length) continue
    const regionGdp0 = sum(cs.map(c => c.gdpUsd)) || 1
    const target = rs.r.gdpUsd
    const regionInc = incomeIdx(target / Math.max(rs.r.population, 1))
    // each country grows at the region's rate plus catch-up toward the region's income (poorer members grow a
    // little faster, ESTIMATE 1%/yr per income-index point) minus its own damage
    const raw = cs.map(c => {
      const inc = incomeIdx(c.gdpUsd / Math.max(countryPop(c), 1))
      return c.gdpUsd * (1 + (0.01 * (regionInc - inc) - 0.05 * c.damage) / 12)
    })
    const scale = target / Math.max(sum(raw), 1)
    cs.forEach((c, i) => { c.gdpUsd = raw[i] * scale })
    void regionGdp0
    for (const c of cs) {
      // a country in its own drought eats less than its region (trade and aid cover ~30% of the loss, ESTIMATE);
      // the region-wide drop already counts its share, so the rest of the region barely notices
      const own = w.tick < c.droughtUntil ? c.droughtSev * 0.7 : 0
      const reg = w.tick < rs.droughtUntil ? rs.droughtSev : 0
      c.kcal = clamp(rs.r.foodKcalPerCapita * c.kcalRatio * (1 - own) / (1 - Math.min(reg, own, 0.9)), 600, 4200)
      if (c.kcal < 1800) c.foodMonthsUnder++
      else c.foodMonthsUnder = Math.max(0, c.foodMonthsUnder - 2)
      c.shock *= 0.9
      c.damage *= 0.97
      // extreme poverty above 2026 adds unrest (ESTIMATE 0.3 per point of share)
      c.unrest = clamp(rs.r.unrest + c.unrestOffset + c.shock + (c.housing?.unrest ?? 0) + (c.daily ? 0.3 * Math.max(0, c.daily.poverty - c.daily.pov0) : 0))
      c.compliance = clamp(rs.r.compliance + c.complianceOffset)
      // ESTIMATE unemployment: drifts with the region's growth (Okun's law, ~0.4 points per growth point) and strikes
      c.unemployment = clamp(c.unemployment + (0.4 * (0.025 - rs.growth) / 12) * 0.1 + 0.02 * rs.behavior.striking - (c.unemployment - c.seed.unemployment / 100) * 0.01, 0.01, 0.5)
    }
  }
}

// ---------- place stats ----------
// documented composites, all 0..1 (higher is better) except population (people) and housingCost (multiple of median income):
//   foodSecurity: 0 at 1,800 kcal, 1 at 3,000 (FAO survival threshold to comfortable supply)
//   safety: from homicides per 100k on a log scale (0.5 -> 1, 50 -> 0) and unrest
//   health: period life expectancy 50 -> 0, 85 -> 1
//   jobs: 1 - 4 x unemployment
//   housingCost: ESTIMATE price-to-income multiple, from urban share, density and growth (3 to 15)
//   airQuality: PM2.5 on a log scale (WHO guideline 5 ug/m3 -> 1, 75 -> 0), worse with fossil power growth
//   economy: income index (log GDP per capita, $316 -> 0, $100k -> 1)
//   livability: 0.2 food + 0.2 safety + 0.2 health + 0.15 jobs + 0.1 (housing affordability) + 0.15 air
//   happiness: World Happiness Report ladder / 10 at the start, then moved by the region's mood and local shocks
//   trend: rising / declining when 5-year livability + population change > 2%, else stable
export function placeStats(pop: number, kcal: number, homicide: number, unrest: number, ple: number, unemployment: number, housing: number, pm25: number, gdppc: number, happiness: number): Omit<PlaceStats, 'trend'> {
  const foodSecurity = clamp((kcal - 1800) / 1200)
  const safety = clamp((1 - Math.log10(Math.max(homicide, 0.5) / 0.5) / 2) * (1 - 0.6 * Math.max(0, unrest - 0.3)))
  const health = clamp((ple - 50) / 35)
  const jobs = clamp(1 - 4 * unemployment)
  const airQuality = clamp(1 - Math.log10(Math.max(pm25, 5) / 5) / Math.log10(15))
  const economy = incomeIdx(gdppc)
  const afford = clamp(1 - (housing - 3) / 12)
  const livability = clamp(0.2 * foodSecurity + 0.2 * safety + 0.2 * health + 0.15 * jobs + 0.1 * afford + 0.15 * airQuality)
  const r3 = (x: number) => Math.round(x * 1000) / 1000
  return { population: Math.round(pop), happiness: r3(happiness), economy: r3(economy), livability: r3(livability), foodSecurity: r3(foodSecurity), safety: r3(safety), health: r3(health), jobs: r3(jobs), housingCost: Math.round(housing * 10) / 10, airQuality: r3(airQuality) }
}

export const housingMultiple = (urban: number, density: number, growth: number) => clamp(3 + 6 * urban + 4 * clamp(Math.log10(Math.max(density, 1)) / 3) + 20 * Math.max(0, growth), 3, 15)

export function trendOf(hist: { tick: number; livability: number; population: number }[], now: { livability: number; population: number }, tick: number): Trend {
  const old = hist.find(h => h.tick <= tick - 60) ?? hist[0]
  if (!old) return 'stable'
  const ch = (now.livability - old.livability) / Math.max(old.livability, 0.01) + (now.population - old.population) / Math.max(old.population, 1) * 0.5
  return ch > 0.02 ? 'rising' : ch < -0.02 ? 'declining' : 'stable'
}

export function updateCountryStats(w: World, valence: (rs: RegionState) => number) {
  for (const c of w.countries) {
    const rs = w.regions.find(r => r.r.id === c.regionId)!
    const pop = countryPop(c)
    const fossilGrowth = Math.max(0, (rs.mixCap.fossil / Math.max(rs.capacityTWh, 1)) - 0.6)
    const pm = c.daily ? c.daily.pm25 : c.seed.pm25 * (1 + 0.5 * fossilGrowth) * (1 - 0.3 * clamp(1 - rs.mixCap.fossil / Math.max(rs.capacityTWh, 1) - 0.4))
    const dens = pop / Math.max(c.seed.areaKm2, 1)
    const growth = c.hist.length ? pop / Math.max(c.hist[c.hist.length - 1].population, 1) - 1 : 0
    c.happiness = clamp(c.seed.happiness / 10 + 0.5 * (valence(rs) - rs.valence0) - 0.3 * c.damage - 0.1 * c.shock)
    const s = placeStats(pop, c.kcal, c.daily ? c.daily.homicide : c.seed.homicidePer100k, c.unrest, c.ple || rs.periodLE, c.unemployment, c.housing ? c.housing.priceIdx : housingMultiple(c.seed.urban, dens, growth), pm, c.gdpUsd / Math.max(pop, 1), c.happiness)
    const trend = trendOf(c.hist, s, w.tick)
    c.stats = { ...s, trend }
    if (w.tick % 12 === 0) { c.hist.push({ tick: w.tick, livability: s.livability, population: s.population }); if (c.hist.length > 12) c.hist.shift() }
  }
}
