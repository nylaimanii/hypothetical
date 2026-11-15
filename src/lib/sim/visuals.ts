// v3: what each world looks like. everything here is derived deterministically from sim state and the
// governor's decisions: energy mix from built capacity, land use, rail, pollution, lights, damage, landmarks,
// space assets, atmosphere, flows, epitaphs. no llm calls.
import type { Epitaph, Flow, Frame, Law, Mood, RegionVisual, SpaceAsset } from '../types'
import { reqProgress } from './requirements'
import { EMOTIONS, clamp, incomeIdx, popWeighted, regionPop, type RegionState, type World } from './state'

export type Source = 'solar' | 'wind' | 'nuclear' | 'fossil' | 'hydro'
export const SOURCES: Source[] = ['solar', 'wind', 'nuclear', 'fossil', 'hydro']
export type Mix = Record<Source, number>

// ESTIMATE 2024 electricity generation shares by region, read off Ember's Global Electricity Review 2025
// country data (world: fossil ~59%, hydro ~14%, nuclear ~9%, wind ~8%, solar ~7%), "other" folded into fossil.
// https://ember-energy.org/latest-insights/global-electricity-review-2025/
export const START_MIX: Record<string, Mix> = {
  na: { solar: 0.05, wind: 0.10, nuclear: 0.18, fossil: 0.56, hydro: 0.11 },
  latam: { solar: 0.07, wind: 0.10, nuclear: 0.02, fossil: 0.36, hydro: 0.45 },
  europe: { solar: 0.10, wind: 0.18, nuclear: 0.22, fossil: 0.35, hydro: 0.15 },
  rus_ca: { solar: 0.01, wind: 0.01, nuclear: 0.18, fossil: 0.62, hydro: 0.18 },
  mideast: { solar: 0.03, wind: 0.01, nuclear: 0.02, fossil: 0.92, hydro: 0.02 },
  nafrica: { solar: 0.04, wind: 0.03, nuclear: 0.0, fossil: 0.88, hydro: 0.05 },
  ssa: { solar: 0.05, wind: 0.03, nuclear: 0.03, fossil: 0.59, hydro: 0.30 },
  sasia: { solar: 0.08, wind: 0.05, nuclear: 0.03, fossil: 0.74, hydro: 0.10 },
  easia: { solar: 0.10, wind: 0.11, nuclear: 0.06, fossil: 0.60, hydro: 0.13 },
  seasia: { solar: 0.05, wind: 0.02, nuclear: 0.0, fossil: 0.78, hydro: 0.15 },
  oceania: { solar: 0.14, wind: 0.12, nuclear: 0.0, fossil: 0.62, hydro: 0.12 },
  carib_pac: { solar: 0.04, wind: 0.03, nuclear: 0.0, fossil: 0.85, hydro: 0.08 },
}

// ESTIMATE share of new capacity by source in 2024 (IEA Renewables 2024: solar dominates additions)
// https://www.iea.org/reports/renewables-2024
const BUILD_BASE: Mix = { solar: 0.45, wind: 0.22, nuclear: 0.05, fossil: 0.22, hydro: 0.06 }

// which source gets built with new money: base additions mix, bent by laws (keywords), research and the
// old energy faction. hydro is resource limited.
export function buildShares(w: World, rs: RegionState): Mix {
  const m: Mix = { ...BUILD_BASE }
  for (const l of w.laws) {
    if (l.vetoed) continue
    const c = rs.lawCompliance[l.id] ?? 0
    const t = `${l.title} ${l.text}`.toLowerCase()
    if (/nuclear|fission|reactor|fusion/.test(t)) m.nuclear *= 1 + 3 * c
    if (/solar/.test(t)) m.solar *= 1 + 2 * c
    if (/wind/.test(t)) m.wind *= 1 + 2 * c
    if (/renewable|clean energy|green/.test(t)) { m.solar *= 1 + c; m.wind *= 1 + c }
    if (/coal|oil|gas|fossil|petroleum/.test(t) && !/(ban|phase out|end|cut|tax)/.test(t)) m.fossil *= 1 + 2 * c
    if (l.policyKind === 'carbon_tax' || l.policyKind === 'energy_tax' || /(ban|phase out|end).{0,20}(coal|fossil|oil|gas)/.test(t)) m.fossil *= 1 - 0.8 * c
  }
  m.nuclear *= 1 + 2 * reqProgress(w, 'advanced_fission') + 3 * reqProgress(w, 'fusion_power')
  m.solar *= 1 + reqProgress(w, 'grid_storage')
  m.wind *= 1 + 0.5 * reqProgress(w, 'grid_storage')
  const oe = w.factions.find(f => f.kind === 'old_energy')
  if (oe && oe.regionIds.includes(rs.r.id)) m.fossil *= 1 + oe.power
  m.hydro = Math.min(m.hydro, 0.08)
  const s = SOURCES.reduce((a, k) => a + m[k], 0)
  for (const k of SOURCES) m[k] /= s
  return m
}

// keep per-source capacity summing to total capacity; extra fossil retirement under carbon pricing
export function settleMix(w: World, rs: RegionState, readyAdds: { twh: number; mix?: Mix }[]) {
  for (const a of readyAdds) for (const k of SOURCES) rs.mixCap[k] += a.twh * (a.mix ?? BUILD_BASE)[k]
  const carbon = Math.max(0, ...w.laws.filter(l => !l.vetoed && (l.policyKind === 'carbon_tax' || l.policyKind === 'energy_tax')).map(l => rs.lawCompliance[l.id] ?? 0))
  rs.mixCap.fossil *= 1 - 0.04 / 12 * carbon // ESTIMATE: strong carbon pricing retires ~4%/yr of fossil early
  const total = SOURCES.reduce((a, k) => a + rs.mixCap[k], 0)
  if (total > 0) for (const k of SOURCES) rs.mixCap[k] *= rs.capacityTWh / total
}

export const mixShares = (rs: RegionState): Mix => {
  const t = SOURCES.reduce((a, k) => a + rs.mixCap[k], 0) || 1
  return Object.fromEntries(SOURCES.map(k => [k, Math.round(rs.mixCap[k] / t * 1e4) / 1e4])) as Mix
}

// ---------- land ----------
// ESTIMATE land area (million km2), farmland (crop + pasture) and forest fractions per region, from FAOSTAT
// land use / World Bank AG.LND.AGRI.ZS and AG.LND.FRST.ZS by eye. https://www.fao.org/faostat/en/#data/RL
export const LAND: Record<string, { areaMkm2: number; farmland: number; forest: number; deforestPerYear: number }> = {
  // deforestPerYear: net forest change, FAO Global Forest Resources Assessment 2020 (negative = gain)
  // https://www.fao.org/forest-resources-assessment/2020/en/
  na: { areaMkm2: 19.8, farmland: 0.25, forest: 0.35, deforestPerYear: 0 },
  latam: { areaMkm2: 20.0, farmland: 0.35, forest: 0.46, deforestPerYear: 0.004 },
  europe: { areaMkm2: 6.0, farmland: 0.40, forest: 0.35, deforestPerYear: -0.001 },
  rus_ca: { areaMkm2: 21.5, farmland: 0.25, forest: 0.38, deforestPerYear: 0 },
  mideast: { areaMkm2: 6.5, farmland: 0.30, forest: 0.04, deforestPerYear: 0 },
  nafrica: { areaMkm2: 8.0, farmland: 0.15, forest: 0.02, deforestPerYear: 0.001 },
  ssa: { areaMkm2: 23.6, farmland: 0.40, forest: 0.27, deforestPerYear: 0.005 },
  sasia: { areaMkm2: 5.1, farmland: 0.55, forest: 0.17, deforestPerYear: -0.001 },
  easia: { areaMkm2: 11.8, farmland: 0.50, forest: 0.23, deforestPerYear: -0.002 },
  seasia: { areaMkm2: 4.5, farmland: 0.30, forest: 0.48, deforestPerYear: 0.004 },
  oceania: { areaMkm2: 8.0, farmland: 0.45, forest: 0.17, deforestPerYear: 0 },
  carib_pac: { areaMkm2: 0.7, farmland: 0.20, forest: 0.60, deforestPerYear: 0.002 },
}
// ESTIMATE: restoring forest costs ~$2,000 per hectare (published restoration costs range ~$1,000 to $5,000/ha)
const REFOREST_USD_PER_HA = 2000

// ---------- rail ----------
// region pairs with a land route. islands (oceania, carib_pac) get none.
const ADJ: [string, string][] = [['na', 'latam'], ['europe', 'rus_ca'], ['europe', 'mideast'], ['mideast', 'nafrica'], ['mideast', 'rus_ca'], ['mideast', 'sasia'], ['nafrica', 'ssa'], ['sasia', 'easia'], ['sasia', 'seasia'], ['easia', 'seasia'], ['easia', 'rus_ca'], ['rus_ca', 'sasia']]
// existing long-distance rail across region borders in 2026 (Trans-Siberian, China-Laos railway, Turkey, US-Mexico)
const START_RAIL = new Set(['europe|rus_ca', 'easia|rus_ca', 'easia|seasia', 'europe|mideast', 'na|latam'])

// rail at tick 0: only the links that exist today
export function initRail(w: World) {
  for (const [a, b] of ADJ) {
    if (!START_RAIL.has(`${a}|${b}`) && !START_RAIL.has(`${b}|${a}`)) continue
    w.regions.find(r => r.r.id === a)!.railLinks.push(b)
    w.regions.find(r => r.r.id === b)!.railLinks.push(a)
  }
}

export function railScore(w: World, rs: RegionState, transit: number): number {
  const inc = incomeIdx(rs.r.gdpUsd / Math.max(rs.r.population, 1))
  const lawC = Math.max(0, ...w.laws.filter(l => !l.vetoed && /rail|train|transit/.test(`${l.title} ${l.text}`.toLowerCase())).map(l => rs.lawCompliance[l.id] ?? 0))
  return 0.6 * reqProgress(w, 'high_speed_rail') * (0.4 + 0.6 * inc) + 0.3 * transit + 0.4 * lawC
}

// ---------- per tick ----------
const LANDMARK_LAW_KINDS: Record<string, string> = {
  big_project: 'monument', research_push: 'research_campus', grid_integration: 'grid_hub', electrification: 'power_plant', school_reform: 'school',
  healthcare_expansion: 'hospital', food_reserve: 'grain_silo', agriculture_push: 'farm_district', relocation: 'new_town', vaccination: 'clinic',
}
const LANDMARK_REQ: Record<string, string> = {
  super_heavy_lift: 'launch_tower', orbital_refueling: 'launch_tower', hvdc_global_grid: 'grid_hub', advanced_fission: 'reactor', fusion_power: 'fusion_plant',
  high_speed_rail: 'rail_station', desalination: 'desalination_plant', climate_adaptation: 'sea_wall', vertical_farming: 'farm_tower', ai_research_tools: 'data_center',
  cancer: 'hospital', lifespan_200: 'longevity_institute', gene_therapy: 'gene_lab', affordable_housing: 'housing_blocks',
}

export function addLandmark(rs: RegionState, kind: string, label: string, tick: number, lawId?: string) {
  rs.landmarks = [...rs.landmarks, { kind, label, tick, ...(lawId ? { lawId } : {}) }].slice(-12)
}

// called from applyDecision for every new law: big laws leave a landmark where they are followed most
export function landmarkForLaw(w: World, l: Law) {
  const kind = LANDMARK_LAW_KINDS[l.policyKind]
  if (!kind) return
  const best = w.regions.filter(r => !r.seceded).sort((a, b) => (b.lawCompliance[l.id] ?? 0) - (a.lawCompliance[l.id] ?? 0))[0]
  if (best) addLandmark(best, kind, l.title, w.tick, l.id)
}

export function stepVisuals(w: World, transit: number) {
  const spaceUsdYear = w.budget.space * w.revenueShare * w.regions.reduce((a, r) => a + (r.seceded ? 0 : r.r.gdpUsd), 0)
  for (const rs of w.regions) {
    const land = LAND[rs.r.id]
    // land use: pressure on food clears forest for farms; reforestation needs money (food budget above 2026 + forest laws)
    const kcal = rs.r.foodKcalPerCapita
    const pressure = clamp((2700 - kcal) / 900)
    let defor = (land.deforestPerYear * (1 - 0.5 * rs.r.compliance) + 0.004 * pressure) / 12
    const forestLaw = Math.max(0, ...w.laws.filter(l => !l.vetoed && /forest|tree|reforest|rewild/.test(`${l.title} ${l.text}`.toLowerCase())).map(l => rs.lawCompliance[l.id] ?? 0))
    if (forestLaw > 0) defor *= 1 - forestLaw
    const reforestUsd = Math.max(0, rs.spend.food - rs.pc0.food * regionPop(rs) / 12) * 0.2 * (forestLaw > 0 ? 1 : 0.25)
    const regrow = reforestUsd / REFOREST_USD_PER_HA / (land.areaMkm2 * 1e8)
    const dForest = clamp(rs.forest - rs.forest * defor + regrow, 0.005, 0.9) - rs.forest
    rs.forest += dForest
    rs.farmland = clamp(rs.farmland - dForest * (dForest < 0 ? 1 : 0.5), 0.02, 0.9)
  }
  // rail links
  for (const rs of w.regions) rs.railLinks = []
  for (const [a, b] of ADJ) {
    const ra = w.regions.find(r => r.r.id === a)!, rb = w.regions.find(r => r.r.id === b)!
    const has = START_RAIL.has(`${a}|${b}`) || START_RAIL.has(`${b}|${a}`) || Math.min(railScore(w, ra, transit), railScore(w, rb, transit)) >= 0.35
    if (has && !ra.seceded && !rb.seceded) { ra.railLinks.push(b); rb.railLinks.push(a) }
  }
  // space assets: dark without money (ESTIMATE: under ~$15B/yr nothing beyond the ground gets operated)
  const funded = spaceUsdYear >= 15e9
  for (const a of w.spaceAssets) if (a.status !== 'destroyed') a.status = funded ? 'active' : 'dark'
  for (const a of w.spaceAssets) {
    if (a.kind === 'moon_base') a.population = Math.round(w.frontierState.moonPop)
    if (a.kind === 'mars_habitat' && a.id === 'mars-hab-0') a.population = Math.round(w.frontierState.marsPop)
  }
}

export function spaceAsset(w: World, a: Omit<SpaceAsset, 'builtTick' | 'status'>) {
  if (w.spaceAssets.some(x => x.id === a.id)) return
  w.spaceAssets.push({ ...a, builtTick: w.tick, status: 'active' })
}

// hooks for unlocked requirements: landmarks on the ground, assets in space
export function onRequirementUnlocked(w: World, id: string) {
  const kind = LANDMARK_REQ[id]
  if (kind) {
    const sector = { super_heavy_lift: 'launch', orbital_refueling: 'launch', advanced_fission: 'energy', fusion_power: 'energy', hvdc_global_grid: 'energy', cancer: 'medicine', lifespan_200: 'longevity', gene_therapy: 'longevity', ai_research_tools: 'computing', affordable_housing: 'housing', vertical_farming: 'food' }[id]
    const co = sector ? w.companies.find(c => c.sector === sector && !c.failed) : undefined
    const rs = (co && w.regions.find(r => r.r.id === co.regionId)) || w.regions.filter(r => !r.seceded).sort((a, b) => b.r.techLevel - a.r.techLevel)[0]
    const name = w.requirements.find(r => r.id === id)?.name ?? id
    addLandmark(rs, kind, name, w.tick)
  }
  if (id === 'orbital_refueling') spaceAsset(w, { id: 'depot-0', kind: 'station', body: 'earth_orbit', label: 'propellant depot' })
  if (id === 'asteroid_prospecting') spaceAsset(w, { id: 'probe-belt-0', kind: 'probe', body: 'asteroid_belt', label: 'prospecting probe' })
  if (id === 'jovian_radiation') spaceAsset(w, { id: 'probe-outer-0', kind: 'probe', body: 'outer', label: 'jupiter radiation probe' })
  if (id === 'long_duration_crew') spaceAsset(w, { id: 'ship-outer-0', kind: 'ship', body: 'outer', label: 'long haul crew ship' })
}

export function onFrontier(w: World, f: string) {
  if (f === 'moon_landing') spaceAsset(w, { id: 'station-0', kind: 'station', body: 'earth_orbit', label: 'crew staging station' })
  if (f === 'moon_base') spaceAsset(w, { id: 'moon-base-0', kind: 'moon_base', body: 'moon', label: 'first light base', population: 12 })
  if (f === 'mars_crewed') spaceAsset(w, { id: 'mars-hab-0', kind: 'mars_habitat', body: 'mars', label: 'jezero station', population: 6 })
  if (f === 'mars_settlement') spaceAsset(w, { id: 'mars-hab-1', kind: 'mars_habitat', body: 'mars', label: 'delta settlement' })
  if (f === 'asteroid_mining') spaceAsset(w, { id: 'mine-0', kind: 'asteroid_mine', body: 'asteroid_belt', label: 'first ore mine' })
  if (f === 'outer_system') spaceAsset(w, { id: 'outer-station-0', kind: 'station', body: 'outer', label: 'jovian outpost' })
}

export function onLaunchFailure(w: World, body: SpaceAsset['body'], label: string) {
  w.spaceAssets.push({ id: `wreck-${w.tick}-${w.spaceAssets.length}`, kind: 'ship', body, label, builtTick: w.tick, status: 'destroyed' })
}

// ---------- flows ----------
export function addFlow(w: World, f: Flow) {
  if (f.people < 1) return
  const k = w.flowAcc.find(x => x.from === f.from && x.to === f.to && x.toCityId === f.toCityId && x.forced === f.forced && x.reason === f.reason)
  if (k) k.people += f.people
  else w.flowAcc.push({ ...f })
}

// ---------- region visual for a frame ----------
function damageOf(w: World, rs: RegionState): RegionVisual['damage'] {
  const recent = w.events.filter(e => e.regionId === rs.r.id && w.tick - e.tick <= 6)
  if (w.warTension >= 0.6 && (rs.inRevolt || rs.seceded)) return { kind: 'war', level: clamp(w.warTension) }
  if (rs.seceded || (rs.growth < -0.05 && rs.r.unrest > 0.6)) return { kind: 'collapse', level: clamp(0.5 + rs.r.unrest / 2) }
  if (rs.foodMonthsUnder > 0) return { kind: 'famine', level: clamp((1800 - rs.r.foodKcalPerCapita) / 600 + 0.3) }
  if (rs.inRevolt) return { kind: 'revolt', level: clamp(rs.r.unrest) }
  const d = recent.filter(e => e.kind === 'disaster' || (e.kind === 'injected' && /disaster|drought/.test(e.text))).sort((a, b) => b.severity - a.severity)[0]
  if (d) return { kind: 'disaster', level: clamp(d.severity * (1 - (w.tick - d.tick) / 7)) }
  return { kind: 'none', level: 0 }
}

export function regionVisual(w: World, rs: RegionState): RegionVisual {
  const mix = mixShares(rs)
  const pop = Math.max(regionPop(rs), 1)
  const inc = incomeIdx(rs.r.gdpUsd / pop)
  const kwhpc = rs.r.energyTWh * 1e9 / pop
  // ESTIMATE pollution: fossil share x electricity intensity, plus industry (middle income peaks), minus forest
  const industry = clamp(4 * inc * (1 - inc))
  const pollution = clamp(0.55 * mix.fossil * (0.4 + 0.6 * clamp(kwhpc / 6000)) + 0.25 * industry * mix.fossil + 0.1 * industry - 0.15 * rs.forest)
  // ESTIMATE urban share ~0.3 + 0.55 x income index (World Bank SP.URB.TOTL.IN.ZS tracks income closely), density by land area
  const urban = clamp(0.3 + 0.55 * inc + 0.5 * rs.newCityPop / pop)
  const density = clamp(Math.log10(1 + pop / (LAND[rs.r.id].areaMkm2 * 1e6)) / 2.7)
  const urbanDensity = clamp(0.6 * urban + 0.4 * density)
  const lightDensity = clamp(urbanDensity * rs.energyRatio * (0.3 + 0.7 * clamp(kwhpc / 5000)) * (rs.inRevolt ? 0.7 : 1))
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4
  return {
    energyMix: mix, railLinks: [...rs.railLinks], farmland: r4(rs.farmland), forest: r4(rs.forest), pollution: r4(pollution),
    urbanDensity: r4(urbanDensity), lightDensity: r4(lightDensity), damage: (({ kind, level }) => ({ kind, level: r4(level) }))(damageOf(w, rs)),
    landmarks: rs.landmarks.map(l => ({ ...l })),
  }
}

// average mood of the region's pips, and by group
export function emotionsOf(w: World, rs: RegionState): { emotionMix: Mood; emotionByGroup: { group: string; mood: Mood }[] } {
  const pips = w.citizens.filter(c => c.regionId === rs.r.id)
  const avg = (list: typeof pips): Mood => {
    const m = {} as Mood
    for (const e of EMOTIONS) m[e] = Math.round((list.length ? list.reduce((a, c) => a + c.mood[e], 0) / list.length : rs.mood[e]) * 20) / 20
    return m
  }
  const groups = new Map<string, typeof pips>()
  for (const c of pips) {
    // age, income and belief groups (archetype groups are left to the pips themselves to keep frames small)
    for (const g of [`age:${c.group.ageBand}`, `income:${c.group.incomeBand}`, `belief:${c.group.belief}`]) {
      const arr = groups.get(g) ?? []
      arr.push(c)
      groups.set(g, arr)
    }
  }
  return { emotionMix: avg(pips), emotionByGroup: [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([group, list]) => ({ group, mood: avg(list) })) }
}

export function atmosphere(w: World, visuals: RegionVisual[]): { tint: string; haze: number } {
  const pops = w.regions.map(regionPop)
  const tot = pops.reduce((a, b) => a + b, 0) || 1
  const pollution = visuals.reduce((a, v, i) => a + v.pollution * pops[i], 0) / tot
  const collapse = w.regions.filter(r => r.seceded || r.inRevolt).length / w.regions.length
  const haze = clamp(0.08 + 0.7 * pollution + 0.3 * clamp(w.warTension) + 0.2 * collapse)
  // clean sky blue -> smog ochre with pollution, -> ash gray with war and collapse
  const mixHex = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i] - x) * clamp(t)))
  let c = mixHex([159, 196, 232], [184, 162, 122], pollution * 1.4)
  c = mixHex(c, [120, 112, 108], clamp(w.warTension) * 0.8 + collapse * 0.5)
  return { tint: `#${c.map(x => x.toString(16).padStart(2, '0')).join('')}`, haze: Math.round(haze * 1e4) / 1e4 }
}

// ---------- epitaph ----------
// one dry, honest line from the cause of death and the governor's biggest mistake. templates only.
export function epitaphFor(w: World, frames: Frame[]): Epitaph | undefined {
  if (w.status !== 'destroyed') return undefined
  const cause = (w.causeOfDeath ?? '').toLowerCase()
  const causeKind: Epitaph['causeKind'] = /war/.test(cause) ? 'war' : /starv|food|famine/.test(cause) ? 'famine' : /revolt/.test(cause) ? 'revolt' : /population/.test(cause) ? 'collapse' : 'disaster'
  const ds = frames.map(f => f.decision).filter((d): d is NonNullable<Frame['decision']> => !!d)
  const avg = (k: keyof Frame['budget']) => (ds.length ? ds.reduce((a, d) => a + d.budget[k], 0) / ds.length : 0)
  const minKcal = Math.min(...frames.map(f => f.regions.reduce((a, r) => a + r.foodKcalPerCapita * r.population, 0) / Math.max(1, f.globalPopulation)))
  const lowSupport = frames.length ? frames[frames.length - 1].laws.filter(l => !l.vetoed && l.support < 0.35).length : 0
  // what it did right (first that applies)
  const good = has(w, 'moon_landing') ? 'reached the moon' : minKcal > 2400 ? 'fed everyone' : avg('research') > 0.08 ? 'funded every lab' : avg('welfare') > 0.55 ? 'paid every pension' : 'kept the lights on'
  // its biggest mistake (worst ratio against the 2026 budget)
  const mistakes: [number, string][] = [
    [avg('space') / Math.max(avg('food'), 1e-3) > 1 ? 3 : 0, 'built rockets on empty stomachs'],
    [avg('education') < 0.1 ? 2.5 : 0, 'taught no one'],
    [avg('security') > 0.2 ? 2.5 : 0, 'policed its people into the streets'],
    [avg('welfare') < 0.4 ? 2 : 0, 'let the clinics close'],
    [ds.some(d => d.religionPolicy === 'discouraged') ? 2.2 : 0, 'picked a fight with every prayer'],
    [lowSupport >= 3 ? 2 : 0, 'wrote laws nobody followed'],
    [avg('food') < 0.03 && causeKind === 'famine' ? 2.8 : 0, 'forgot that people eat'],
    [causeKind === 'war' ? 1.5 : 0, 'answered anger with force'],
    [causeKind === 'revolt' ? 1.2 : 0, 'never asked the regions what they wanted'],
  ]
  const mistake = mistakes.sort((a, b) => b[0] - a[0])[0]
  const line = mistake[0] > 0 ? `it ${good} and ${mistake[1]}` : `it ${good}, and that was not enough`
  return { line, causeKind }
}

function has(w: World, f: string) { return w.frontierState.achieved.includes(f as never) }

export const initMix = (regionId: string, capacityTWh: number): Mix => {
  const m = START_MIX[regionId]
  return Object.fromEntries(SOURCES.map(k => [k, m[k] * capacityTWh])) as Mix
}
void popWeighted
