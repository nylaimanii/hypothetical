// MOCK: v4 real places + living people. a handful of real countries, states and cities.
// country populations at tick 0 are rounded from UN World Population Prospects 2024 (SOURCED, url below).
// city populations are rounded urban agglomeration figures from UN World Urbanization Prospects 2018 (SOURCED).
// every other stat is an ESTIMATE derived from the mock region it rolls up into.
import type { Activity, AdminArea, Behavior, Citizen, City, Country, Frame, PlaceStats, Region, RunRecord, Trend, Workplace } from '@/lib/types'

const WPP = 'https://population.un.org/wpp/'
const WUP = 'https://population.un.org/wup/'

const COUNTRIES: { id: string; name: string; regionId: string; pop: number }[] = [
  { id: 'USA', name: 'united states', regionId: 'nam', pop: 347e6 },
  { id: 'MEX', name: 'mexico', regionId: 'mes', pop: 131e6 },
  { id: 'BRA', name: 'brazil', regionId: 'sam', pop: 213e6 },
  { id: 'DEU', name: 'germany', regionId: 'weu', pop: 84e6 },
  { id: 'RUS', name: 'russia', regionId: 'eeu', pop: 144e6 },
  { id: 'EGY', name: 'egypt', regionId: 'mena', pop: 118e6 },
  { id: 'NGA', name: 'nigeria', regionId: 'wca', pop: 237e6 },
  { id: 'KEN', name: 'kenya', regionId: 'esa', pop: 57e6 },
  { id: 'IND', name: 'india', regionId: 'sas', pop: 1464e6 },
  { id: 'CHN', name: 'china', regionId: 'eas', pop: 1416e6 },
  { id: 'JPN', name: 'japan', regionId: 'eas', pop: 123e6 },
  { id: 'IDN', name: 'indonesia', regionId: 'sea', pop: 285e6 },
  { id: 'AUS', name: 'australia', regionId: 'oce', pop: 27e6 },
]

const ADMINS: { id: string; countryId: string; name: string; share: number }[] = [
  { id: 'US-CA', countryId: 'USA', name: 'california', share: 0.115 },
  { id: 'US-TX', countryId: 'USA', name: 'texas', share: 0.09 },
  { id: 'BR-SP', countryId: 'BRA', name: 'são paulo', share: 0.22 },
  { id: 'NG-LA', countryId: 'NGA', name: 'lagos', share: 0.07 },
  { id: 'IN-MH', countryId: 'IND', name: 'maharashtra', share: 0.09 },
  { id: 'CN-GD', countryId: 'CHN', name: 'guangdong', share: 0.09 },
  { id: 'DE-BY', countryId: 'DEU', name: 'bavaria', share: 0.16 },
  { id: 'KE-30', countryId: 'KEN', name: 'nairobi', share: 0.09 },
  { id: 'ID-JK', countryId: 'IDN', name: 'jakarta', share: 0.04 },
  { id: 'AU-NSW', countryId: 'AUS', name: 'new south wales', share: 0.31 },
  { id: 'EG-C', countryId: 'EGY', name: 'cairo', share: 0.09 },
  { id: 'JP-13', countryId: 'JPN', name: 'tokyo', share: 0.11 },
]

const CITIES: { id: string; name: string; countryId: string; adminId: string; lat: number; lon: number; pop: number }[] = [
  { id: 'c-los-angeles', name: 'los angeles', countryId: 'USA', adminId: 'US-CA', lat: 34.05, lon: -118.24, pop: 12.7e6 },
  { id: 'c-houston', name: 'houston', countryId: 'USA', adminId: 'US-TX', lat: 29.76, lon: -95.37, pop: 6.7e6 },
  { id: 'c-sao-paulo', name: 'são paulo', countryId: 'BRA', adminId: 'BR-SP', lat: -23.55, lon: -46.63, pop: 22.9e6 },
  { id: 'c-lagos', name: 'lagos', countryId: 'NGA', adminId: 'NG-LA', lat: 6.52, lon: 3.38, pop: 15.9e6 },
  { id: 'c-mumbai', name: 'mumbai', countryId: 'IND', adminId: 'IN-MH', lat: 19.08, lon: 72.88, pop: 22.1e6 },
  { id: 'c-shenzhen', name: 'shenzhen', countryId: 'CHN', adminId: 'CN-GD', lat: 22.54, lon: 114.06, pop: 13.5e6 },
  { id: 'c-munich', name: 'munich', countryId: 'DEU', adminId: 'DE-BY', lat: 48.14, lon: 11.58, pop: 1.6e6 },
  { id: 'c-nairobi', name: 'nairobi', countryId: 'KEN', adminId: 'KE-30', lat: -1.29, lon: 36.82, pop: 5.7e6 },
  { id: 'c-jakarta', name: 'jakarta', countryId: 'IDN', adminId: 'ID-JK', lat: -6.21, lon: 106.85, pop: 11.4e6 },
  { id: 'c-sydney', name: 'sydney', countryId: 'AUS', adminId: 'AU-NSW', lat: -33.87, lon: 151.21, pop: 5.1e6 },
  { id: 'c-cairo', name: 'cairo', countryId: 'EGY', adminId: 'EG-C', lat: 30.04, lon: 31.24, pop: 23.1e6 },
  { id: 'c-tokyo', name: 'tokyo', countryId: 'JPN', adminId: 'JP-13', lat: 35.68, lon: 139.69, pop: 37e6 },
]

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296 }
const clamp = (v: number) => Math.max(0, Math.min(1, v))
const r2 = (v: number) => Math.round(v * 100) / 100

// a place's stats follow its region, nudged by a stable per-place offset
function statsFrom(r: Region, pop: number, key: string, prevScore: number | null): PlaceStats {
  const j = hash(key) - 0.5
  const pollution = r.visual?.pollution ?? 0.3
  const damage = r.visual?.damage.level ?? 0
  const gdpPc = r.gdpUsd / Math.max(1, r.population)
  const economy = clamp(Math.log10(Math.max(500, gdpPc)) / 5 - 0.35 + j * 0.1 - damage * 0.4)
  const foodSecurity = clamp((r.foodKcalPerCapita - 1700) / 1500 + j * 0.05)
  const safety = clamp(1 - r.unrest * 1.1 - damage * 0.5 + j * 0.05)
  const health = clamp((r.periodLifeExpectancy - 50) / 40 - r.diseaseBurden * 0.2)
  const jobs = clamp(economy * 0.8 + 0.15 - r.unrest * 0.3 + j * 0.05)
  const airQuality = clamp(1 - pollution + j * 0.05)
  const happiness = clamp(r.approval * 0.6 + safety * 0.2 + foodSecurity * 0.2 + j * 0.05)
  const livability = clamp((happiness + economy + safety + health + airQuality + foodSecurity) / 6)
  const score = happiness + economy
  const trend: Trend = prevScore === null ? 'stable' : score - prevScore > 0.03 ? 'rising' : score - prevScore < -0.03 ? 'declining' : 'stable'
  return {
    population: Math.round(pop), happiness: r2(happiness), economy: r2(economy), livability: r2(livability), trend,
    foodSecurity: r2(foodSecurity), safety: r2(safety), health: r2(health), jobs: r2(jobs), housingCost: r2(2 + economy * 6 + j), airQuality: r2(airQuality),
  }
}

const WORK: Record<string, Workplace> = {
  farmer: 'farm', fisher: 'farm', nurse: 'clinic', doctor: 'clinic', welder: 'factory', mechanic: 'factory', miner: 'factory', electrician: 'power_plant',
  teacher: 'school', coder: 'office', clerk: 'office', engineer: 'lab', shopkeeper: 'shop', cook: 'shop', driver: 'construction', builder: 'construction',
  student: 'school', retired: 'none',
}

// a day, hour by hour, shaped by what the citizen is doing this year
function dayPlanFor(c: Citizen, workplace: Workplace, employed: boolean): { hour: number; activity: Activity }[] {
  const b: Behavior = c.behavior
  const kid = c.group.ageBand === 'kid'
  const religious = c.belief === 'religious'
  const day: Activity = kid ? 'school' : !employed ? 'aid_line' : b === 'striking' ? 'striking' : b === 'protesting' || b === 'rioting' ? 'protesting' : workplace === 'none' ? 'resting' : 'working'
  const evening: Activity = b === 'celebrating' ? 'celebrating' : b === 'protesting' || b === 'rioting' ? 'protesting' : b === 'hoarding' || b === 'panic_buying' ? 'shopping' : c.mood.joy + c.mood.hope > 0.8 ? 'socializing' : 'resting'
  if (b === 'migrating' || b === 'moving_to_new_city') return [{ hour: 0, activity: 'sleeping' }, { hour: 6, activity: 'moving' }, { hour: 21, activity: 'sleeping' }]
  const plan: { hour: number; activity: Activity }[] = [
    { hour: 0, activity: 'sleeping' },
    { hour: 7, activity: 'eating' },
    { hour: 8, activity: kid || day === 'aid_line' ? day : 'commuting' },
    { hour: 9, activity: day },
    { hour: 12, activity: 'eating' },
    { hour: 13, activity: day },
    { hour: 17, activity: kid ? 'socializing' : 'commuting' },
    { hour: 18, activity: kid ? 'resting' : 'shopping' },
    { hour: 19, activity: evening },
    { hour: 22, activity: 'sleeping' },
  ]
  if (religious) plan.splice(1, 0, { hour: 6, activity: 'praying' })
  return plan
}

function citizensV4(f: Frame, countriesByRegion: Map<string, Country[]>, cities: City[]): Citizen[] {
  return f.citizens.map((c) => {
    const cs = countriesByRegion.get(c.regionId) ?? []
    const country = cs.length ? cs[Math.floor(hash(c.id) * cs.length)] : undefined
    const homeCities = cities.filter((x) => x.countryId === country?.id)
    const city = homeCities.length ? homeCities[Math.floor(hash(c.id + 'c') * homeCities.length)] : cities.find((x) => x.regionId === c.regionId)
    const region = f.regions.find((r) => r.id === c.regionId)
    const workplace: Workplace = WORK[c.job] ?? 'office'
    const employed = workplace === 'none' || c.group.ageBand === 'kid' ? true : hash(c.id + f.tick) > (region ? region.unrest * 0.5 : 0.1) && c.behavior !== 'idle'
    const income = !employed ? 0 : Math.round(((region?.gdpUsd ?? 1e12) / Math.max(1, region?.population ?? 1)) * (0.4 + hash(c.id + 'i') * 1.2))
    const spending = Math.round(income * (c.behavior === 'hoarding' || c.behavior === 'panic_buying' ? 1.4 : 0.7 + hash(c.id + 's') * 0.2))
    return { ...c, countryId: country?.id, cityId: city?.id, workplace, employed, income, spending, dayPlan: dayPlanFor(c, workplace, employed) }
  })
}

export function applyV4(rec: RunRecord): RunRecord {
  const byYear = new Map<number, Map<string, number>>()
  const frames = rec.frames.map((f) => {
    const year = Math.floor(f.tick / 12)
    const prev = byYear.get(year - 1) ?? null
    const scores = new Map<string, number>()
    const rmap = new Map(f.regions.map((r) => [r.id, r]))
    const growth = (r: Region | undefined) => (r && rec.frames[0].regions.find((x) => x.id === r.id) ? r.population / rec.frames[0].regions.find((x) => x.id === r.id)!.population : 1)
    const place = <T,>(key: string, regionId: string, pop: number, make: (stats: PlaceStats) => T) => {
      const r = rmap.get(regionId)!
      const stats = statsFrom(r, pop * growth(r), key, prev?.get(key) ?? null)
      scores.set(key, stats.happiness + stats.economy)
      return make(stats)
    }
    const countries: Country[] = COUNTRIES.filter((c) => rmap.has(c.regionId)).map((c) => place(c.id, c.regionId, c.pop, (stats) => ({
      id: c.id, name: c.name, regionId: c.regionId, stats,
      provenance: { population: { kind: 'SOURCED', url: WPP }, happiness: { kind: 'ESTIMATE' }, economy: { kind: 'ESTIMATE' }, livability: { kind: 'ESTIMATE' } },
    })))
    const regionOf = (countryId: string) => COUNTRIES.find((c) => c.id === countryId)!.regionId
    const adminAreas: AdminArea[] = ADMINS.map((a) => place(a.id, regionOf(a.countryId), COUNTRIES.find((c) => c.id === a.countryId)!.pop * a.share, (stats) => ({ id: a.id, countryId: a.countryId, name: a.name, stats })))
    const real: City[] = CITIES.filter((c) => rmap.has(regionOf(c.countryId))).map((c) => place(c.id, regionOf(c.countryId), c.pop, (stats) => ({
      id: c.id, name: c.name, regionId: regionOf(c.countryId), lat: c.lat, lon: c.lon, foundedTick: 0, population: stats.population,
      reason: `real city, tick 0 population from un world urbanization prospects (${WUP})`, countryId: c.countryId, adminId: c.adminId, real: true, stats,
    })))
    // founded cities belong to the first country in their region
    const founded = f.cities.map((c) => {
      const country = countries.find((x) => x.regionId === c.regionId)
      return { ...c, countryId: country?.id, real: false, stats: place(c.id, c.regionId, c.population, (s) => s) }
    })
    if (f.tick % 12 === 0 || !byYear.has(year)) byYear.set(year, scores)
    const countriesByRegion = new Map<string, Country[]>()
    for (const c of countries) countriesByRegion.set(c.regionId, [...(countriesByRegion.get(c.regionId) ?? []), c])
    const cities = [...real, ...founded]
    return { ...f, countries, adminAreas, cities, citizens: citizensV4(f, countriesByRegion, cities) }
  })
  return { ...rec, frames }
}
