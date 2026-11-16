// the physical world: shipping chokepoints, critical minerals and fossil reserves, black swans at their real base
// rates, sea-level rise on real coastal cities, and aging with pensions. every rate is SOURCED with a link or marked
// ESTIMATE with the reasoning. randomness comes from hashes of (seed, kind, time), so it never shifts any other
// stream: the same seed gives the same eruptions, storms and closures whatever the governor does, while their
// damage depends on what the governor built.
import { link } from './causes'
import { addCrowd } from './behavior'
import { CITY_SEEDS, countryPop, countriesOf, killInRegion, type CountryState } from './places'
import { hashString } from './rng'
import { BAND_MID, NBANDS, clamp, event, regionPop, sum, type RegionState, type World } from './state'
import type { InfraDiff } from '../types-v5'

const u01 = (w: World, s: string) => (hashString(`${w.seed}:${s}`) % 1000003) / 1000003
const pct = (x: number) => `${Math.round(x * 100)}%`
const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`
const strongest = (w: World, rs: RegionState | undefined, kinds: string[]) => { let best = { c: 0, lawId: undefined as string | undefined }; if (!rs) return best; for (const l of w.laws) if (!l.vetoed && kinds.includes(l.policyKind)) { const c = rs.lawCompliance[l.id] ?? 0; if (c > best.c) best = { c, lawId: l.id } } return best }
const worldC = (w: World, kinds: string[]) => { const P = sum(w.regions.map(regionPop)) || 1; return sum(w.regions.map(r => strongest(w, r, kinds).c * regionPop(r))) / P }

// ---------- chokepoints ----------
// EIA World Oil Transit Chokepoints (https://www.eia.gov/international/analysis/special-topics/World_Oil_Transit_Chokepoints):
// Hormuz ~20 mb/d (~20% of world petroleum liquids, ~20% of LNG, mostly to Asia), Malacca ~23.7 mb/d, Bab el-Mandeb
// ~8.8 mb/d and Suez ~9 mb/d before the 2024 Red Sea attacks, Panama ~5% of seaborne trade (2023 drought cut transits
// ~36%), the Bosporus carries Black Sea grain (Russia and Ukraine ~25-30% of world wheat exports). trade shares and
// risks are ESTIMATE from those accounts. importers: who loses when it shuts (weights)
type Choke = { id: string; name: string; lat: number; lon: number; oil: number; lng: number; trade: number; grain: number; near: string[]; importers: Record<string, number>; base: number; months: number }
export const CHOKEPOINTS: Choke[] = [
  { id: 'hormuz', name: 'Strait of Hormuz', lat: 26.57, lon: 56.25, oil: 0.2, lng: 0.2, trade: 0.02, grain: 0, near: ['mideast'], importers: { easia: 1, sasia: 1, seasia: 0.8, europe: 0.4 }, base: 0.01, months: 3 },
  { id: 'malacca', name: 'Strait of Malacca', lat: 1.43, lon: 103.5, oil: 0.24, lng: 0.1, trade: 0.25, grain: 0, near: ['seasia'], importers: { easia: 1, seasia: 0.6, oceania: 0.3 }, base: 0.003, months: 2 },
  { id: 'bab_el_mandeb', name: 'Bab el-Mandeb', lat: 12.6, lon: 43.4, oil: 0.09, lng: 0.05, trade: 0.1, grain: 0.05, near: ['mideast', 'ssa'], importers: { europe: 1, mideast: 0.4, nafrica: 0.6, sasia: 0.3 }, base: 0.02, months: 6 },
  { id: 'suez', name: 'Suez Canal', lat: 30.0, lon: 32.55, oil: 0.09, lng: 0.05, trade: 0.12, grain: 0.05, near: ['nafrica'], importers: { europe: 1, sasia: 0.3, easia: 0.3, nafrica: 0.4 }, base: 0.01, months: 1 },
  { id: 'panama', name: 'Panama Canal', lat: 9.1, lon: -79.7, oil: 0.01, lng: 0.05, trade: 0.05, grain: 0.02, near: ['latam', 'carib_pac'], importers: { na: 0.6, latam: 0.6, easia: 0.3, carib_pac: 0.6 }, base: 0.01, months: 6 },
  { id: 'bosporus', name: 'Bosporus', lat: 41.1, lon: 29.05, oil: 0.03, lng: 0, trade: 0.03, grain: 0.25, near: ['europe', 'rus_ca'], importers: { mideast: 1, nafrica: 1, ssa: 0.3, europe: 0.2 }, base: 0.005, months: 6 },
]
export type ChokeState = { id: string; closedUntil: number; severity: number }

// ---------- minerals ----------
// USGS Mineral Commodity Summaries 2024 (https://pubs.usgs.gov/periodicals/mcs2024/mcs2024.pdf), mine production
// shares 2023; IEA Global Critical Minerals Outlook 2024 (https://www.iea.org/reports/global-critical-minerals-outlook-2024)
// for refining, where China refines ~65% of lithium, ~75% of cobalt and ~90% of rare earths
const MINERALS: Record<string, { mine: Record<string, number>; refineChina: number }> = {
  lithium: { mine: { AUS: 0.47, CHL: 0.24, CHN: 0.18, ARG: 0.05 }, refineChina: 0.65 },
  cobalt: { mine: { COD: 0.74, IDN: 0.05, RUS: 0.04 }, refineChina: 0.75 },
  rare_earths: { mine: { CHN: 0.69, USA: 0.12, MMR: 0.11, AUS: 0.04 }, refineChina: 0.9 },
  nickel: { mine: { IDN: 0.5, PHL: 0.11, RUS: 0.06 }, refineChina: 0.35 },
  copper: { mine: { CHL: 0.23, PER: 0.11, COD: 0.11, CHN: 0.08 }, refineChina: 0.45 },
}
// fossil reserves: proven reserves to production ~50 years for oil and gas, ~140 for coal (Energy Institute
// Statistical Review 2024, https://www.energyinst.org/statistical-review). ESTIMATE: discoveries replace ~70% of what
// is burned until 2050, ~30% after

// ---------- sea level ----------
// global mean rise ~3.7 mm/yr (2006-2018) and IPCC AR6 2100 medians 0.44 / 0.56 / 0.77 m (SSP1-2.6 / 2-4.5 / 5-8.5)
// (https://www.ipcc.ch/report/ar6/wg1/chapter/chapter-9/). ESTIMATE rate = 3.7 mm x (1 + 0.6 x (warming - 1.1 C)),
// which gives ~0.5 m by 2100 on a ~2.7 C path. local sinking (mm/yr) and flood protection (m of margin) ESTIMATE from
// InSAR studies of sinking coastal cities (Tay et al. 2022, https://doi.org/10.1038/s41893-022-00947-z) and the OECD
// port-city exposure ranking (Hanson et al. 2011, https://doi.org/10.1007/s10584-010-9977-4)
const COAST: [string, string, number, number][] = [
  // name, country, subsidence mm/yr, protection margin m
  ['Jakarta', 'IDN', 40, 0.3], ['Semarang', 'IDN', 60, 0.3], ['Ho Chi Minh', 'VNM', 15, 0.3], ['Shanghai', 'CHN', 8, 1.5], ['Tianjin', 'CHN', 20, 0.8],
  ['Bangkok', 'THA', 15, 0.5], ['Manila', 'PHL', 20, 0.3], ['Kolkata', 'IND', 8, 0.4], ['Mumbai', 'IND', 3, 0.5], ['Lagos', 'NGA', 5, 0.2],
  ['Alexandria', 'EGY', 3, 0.3], ['Miami', 'USA', 3, 0.4], ['New Orleans', 'USA', 9, 1.5], ['New York', 'USA', 2, 0.6], ['Tokyo', 'JPN', 1, 2.5],
  ['Rotterdam', 'NLD', 3, 4], ['Karachi', 'PAK', 5, 0.3], ['Yangon', 'MMR', 8, 0.3], ['Guangzhou', 'CHN', 5, 0.8], ['Haiphong', 'VNM', 10, 0.3],
  ['Abidjan', 'CIV', 3, 0.3], ['Dhaka', 'BGD', 10, 0.4], ['Basra', 'IRQ', 3, 0.4], ['Rio de Janeiro', 'BRA', 2, 0.6], ['Lima', 'PER', 1, 1],
]
export type CoastCity = { idx: number; sub: number; protect: number; floods: number; lastFlood: number; retreat: number; sunk?: number }

export type Physical = {
  chokes: ChokeState[]
  minerals: number // supply index 0..1 (1 = 2026)
  fossilReserve: number // share of 2026 proven reserves left
  seaLevelM: number // global rise since 2026
  amoc: boolean; volcanicC: number; storm: { until: number; loss: number }
  coast: CoastCity[]
  swans: { tick: number; text: string }[]
  retirementAge: number
  breadUntil?: number
}

export function initPhysical(w: World) {
  const coast: CoastCity[] = []
  for (const [name, cid, sub, protect] of COAST) {
    const idx = CITY_SEEDS.findIndex(c => c.countryId === cid && c.name.toLowerCase().startsWith(name.toLowerCase().slice(0, 6)))
    if (idx >= 0) coast.push({ idx, sub, protect, floods: 0, lastFlood: -999, retreat: 0 })
  }
  w.phys = { chokes: CHOKEPOINTS.map(c => ({ id: c.id, closedUntil: -1, severity: 0 })), minerals: 1, fossilReserve: 1, seaLevelM: 0, amoc: false, volcanicC: 0, storm: { until: -1, loss: 0 }, coast, swans: [], retirementAge: 65 }
  for (const c of w.countries) c.aging = agingOf(c, 65)
  for (const rs of w.regions) { rs.chokeDrag = 0; rs.chokeEnergy = 0; rs.physFood = 1; rs.demoGrowth = 0; rs.pensionSqueeze = 0; rs.wa0 = workingShare(rs.bands, 65); rs.waPrev = rs.wa0 }
}

// ---------- aging ----------
export type Aging = { dep: number; dep0: number; pensionGdp: number; pension0: number }
const shareAbove = (bands: number[], age: number) => sum(bands.map((b, i) => b * clamp((BAND_MID[i] + 2.5 - age) / 5)))
const workingShare = (bands: number[], ret: number) => { const tot = sum(bands) || 1; return (sum(bands.slice(3)) - 0.5 * bands[3] - shareAbove(bands, ret)) / tot }
function agingOf(c: CountryState, ret: number, prev?: Aging): Aging {
  const old = shareAbove(c.bands, ret), work = sum(c.bands.slice(3)) - 0.5 * c.bands[3] - old
  const dep = old / Math.max(work, 1)
  const inc = clamp(Math.log10(Math.max(c.gdpUsd / Math.max(countryPop(c), 1), 300)) / 5)
  // public pensions ~ 0.26 of GDP per unit of old-age dependency where coverage is full (OECD 2021: dependency ~0.30,
  // pensions ~7.7% of GDP, https://doi.org/10.1787/678055dd-en); ILO: ~20%
  // of elders get a pension in low-income countries. ESTIMATE coverage 0.2 + 0.8 x income index
  const pensionGdp = 0.26 * dep * (0.2 + 0.8 * inc)
  return { dep, dep0: prev?.dep0 ?? dep, pensionGdp, pension0: prev?.pension0 ?? pensionGdp }
}

// ---------- monthly: chokepoints, storms, volcanoes ----------
export function stepPhysicalMonth(w: World) {
  const p = w.phys
  if (!p) return
  const escort = worldC(w, ['naval_escort']), reserve = worldC(w, ['strategic_reserve']), bypass = worldC(w, ['alt_route'])
  // closures: base rate per year, more with war tension and unrest in the nearby regions, drought for Panama
  for (const ch of CHOKEPOINTS) {
    const st = p.chokes.find(s => s.id === ch.id)!
    if (st.closedUntil >= w.tick) continue
    const unrest = Math.max(0, ...ch.near.map(id => w.regions.find(r => r.r.id === id)?.r.unrest ?? 0))
    const drought = ch.id === 'panama' ? Math.max(0, ...ch.near.map(id => { const r = w.regions.find(x => x.r.id === id); return r && w.tick < r.droughtUntil ? r.droughtSev : 0 })) * 3 + 0.01 * Math.max(0, w.climate.anomalyC - 1.3) : 0
    const yearly = ch.base * (1 + 3 * w.warTension + 4 * Math.max(0, unrest - 0.5)) + drought
    if (u01(w, `choke:${ch.id}:${w.tick}`) < yearly / 12) {
      st.severity = clamp((0.4 + 0.6 * u01(w, `chokesev:${ch.id}:${w.tick}`)) * (1 - 0.5 * escort))
      st.closedUntil = w.tick + Math.round(ch.months * (0.5 + u01(w, `chokelen:${ch.id}:${w.tick}`)))
      const why = drought > yearly / 2 ? 'drought lowered the canal lakes' : w.warTension > 0.3 ? 'war tension' : unrest > 0.5 ? 'unrest along the coast' : 'an attack on shipping'
      const k = link(w, { placeId: ch.near[0], what: `${ch.name} ${st.severity > 0.7 ? 'closed' : 'disrupted'}: ${pct(st.severity)} of traffic stopped`, value: 0.4 + 0.5 * st.severity * (ch.oil + ch.trade + ch.grain) * 3, because: why, byWhom: 'nature' })
      event(w, { regionId: ch.near[0], kind: 'disaster', text: `${ch.name} ${st.severity > 0.7 ? 'closed' : 'disrupted'} by ${why}`, severity: 0.3 + 0.4 * st.severity })
      w.infraAcc.push({ tick: w.tick, kind: 'chokepoint', op: 'closed', id: ch.id, severity: Math.round(st.severity * 100) / 100, until: st.closedUntil, because: k.what } as InfraDiff)
      // the hit on the main importer: oil and freight costs while it stays shut (same formula as below)
      const [rid] = Object.entries(ch.importers).sort((a, b) => b[1] - a[1])[0]
      const imp = w.regions.find(r => r.r.id === rid)
      const rise = Math.min(3, ch.oil * st.severity / 0.1) * (1 - 0.7 * reserve)
      const hit = (0.015 * Math.log2(1 + rise) + 0.3 * ch.trade * st.severity) * (st.closedUntil - w.tick) / 12
      if (imp && hit > 0.001) link(w, { placeId: rid, what: `${imp.r.name} lost ~${(hit * 100).toFixed(1)}% of a year's output to dearer fuel and longer shipping`, value: clamp(0.4 + hit * 20), because: k.what, byWhom: 'market', causeIds: [k.id] })
    }
  }
  // what closures do this month to each region: an oil price shock (a doubling costs ~1.5% of GDP over a year,
  // Hamilton 2009, https://doi.org/10.1353/eca.0.0047; strategic reserves cover ~90 days for IEA members), LNG for
  // power, rerouting cost (the Cape route adds 10-14 days), and grain
  for (const rs of w.regions) { rs.chokeDrag = 0; rs.chokeEnergy = 0; rs.chokeFood = 0 }
  for (const ch of CHOKEPOINTS) {
    const st = p.chokes.find(s => s.id === ch.id)!
    if (st.closedUntil < w.tick) continue
    const lost = st.severity * (ch.id === 'hormuz' ? 1 - 0.3 * bypass : 1)
    const oilRise = Math.min(3, ch.oil * lost / 0.1) * (1 - 0.7 * reserve) // short-run elasticity ~0.1 (ESTIMATE)
    for (const [rid, wgt] of Object.entries(ch.importers)) {
      const rs = w.regions.find(r => r.r.id === rid)
      if (!rs) continue
      rs.chokeDrag += (0.015 * Math.log2(1 + oilRise) + 0.3 * ch.trade * lost) * wgt
      rs.chokeEnergy += 0.25 * ch.lng * lost * wgt
      rs.chokeFood += 0.4 * ch.grain * lost * wgt
    }
  }
  // geomagnetic superstorm: a Carrington-class storm ~12% a decade (Riley 2012, https://doi.org/10.1029/2011SW000734).
  // ESTIMATE: high-latitude grids lose 5-25% of capacity (burned transformers take a year or more to replace;
  // Lloyd's 2013 put the US cost at $0.6-2.6 trillion), the core's data centers go dark for months
  if (u01(w, `storm:${w.tick}`) < 0.0127 / 12) {
    const prot = worldC(w, ['grid_hardening'])
    const loss = 0.05 + 0.2 * u01(w, `stormsev:${w.tick}`) * (1 - 0.7 * prot)
    for (const id of ['na', 'europe', 'rus_ca', 'oceania']) { const rs = w.regions.find(r => r.r.id === id); if (rs) rs.capacityTWh *= 1 - loss }
    p.storm = { until: w.tick + 6, loss }
    if (w.core) for (const h of w.core.hubs) h.online *= 0.5
    swan(w, `a solar superstorm burned out transformers: northern grids lost ${pct(loss)} of capacity`, 'na', 0.7)
  }
  // volcanic eruptions: VEI 6 (Pinatubo 1991, ~-0.5 C for 2 years) about 1-2 a century, VEI 7 (Tambora 1815, the year
  // without a summer) about 1 in 600-1,000 years (Smithsonian Global Volcanism Program, https://volcano.si.edu/)
  const vu = u01(w, `volcano:${w.tick}`)
  const vei = vu < 0.0013 / 12 ? 7 : vu < (0.0013 + 0.015) / 12 ? 6 : 0
  if (vei) {
    const SITES: [string, string][] = [['IDN', 'seasia'], ['PHL', 'seasia'], ['JPN', 'easia'], ['ISL', 'europe'], ['ITA', 'europe'], ['CHL', 'latam'], ['MEX', 'latam'], ['USA', 'na'], ['RUS', 'rus_ca'], ['PNG', 'oceania']]
    const [cid, rid] = SITES[Math.floor(u01(w, `vsite:${w.tick}`) * SITES.length)]
    const rs = w.regions.find(r => r.r.id === rid)!
    const c = w.countries.find(k => k.id === cid)
    p.volcanicC = Math.min(p.volcanicC, vei === 7 ? -0.7 : -0.4)
    const dead = killInRegion(w, rs, vei === 7 ? 0.0005 : 0.00005, c?.id)
    w.vital.disasters += dead
    swan(w, `a VEI ${vei} eruption in ${c?.name ?? rs.r.name}${dead >= 1000 ? ` killed ${fmt(dead)} and` : ''} will cool the world ~${Math.abs(p.volcanicC).toFixed(1)} C`, rid, vei === 7 ? 0.9 : 0.6)
  }
  p.volcanicC *= 0.96 // aerosols wash out over ~2-3 years
  // small asteroid (Tunguska class, ~50 m): ESTIMATE ~1 in 300 years, ~3% chance it hits a populated area; detection
  // (planetary defense law, NASA DART 2022) turns a hit city into an evacuated one
  if (u01(w, `rock:${w.tick}`) < 0.0033 / 12 && u01(w, `rockpop:${w.tick}`) < 0.03) {
    const rs = [...w.regions].sort((a, b) => u01(w, `rockr:${a.r.id}:${w.tick}`) - u01(w, `rockr:${b.r.id}:${w.tick}`))[0]
    const warn = worldC(w, ['planetary_defense'])
    const dead = killInRegion(w, rs, 0.0002 * (1 - 0.9 * warn))
    w.vital.disasters += dead
    swan(w, `a 50 m asteroid exploded over ${rs.r.name}, ${fmt(dead)} dead${warn > 0.3 ? ' (warned and evacuated in time)' : ''}`, rs.r.id, 0.8)
  }
  // nuclear accidents: INES 5+ about 5 in 70 years with ~440 reactors (Three Mile Island, Chernobyl, Fukushima...),
  // ESTIMATE ~2%/yr at the 2026 fleet (newer designs are safer than the 1950s-70s plants behind most of those),
  // scaled by nuclear capacity vs 2026 and halving every 25 years as designs improve. Fukushima evacuated ~150,000
  const nuc = sum(w.regions.map(r => r.mixCap.nuclear)), nuc0 = w.nuclear0 || nuc
  if (nuc > 0 && u01(w, `nuke:${w.tick}`) < 0.02 * (nuc / Math.max(nuc0, 1)) * Math.pow(0.5, w.tick / 300) / 12) {
    const rs = [...w.regions].filter(r => r.mixCap.nuclear > 0).sort((a, b) => b.mixCap.nuclear * u01(w, `nr:${b.r.id}:${w.tick}`) - a.mixCap.nuclear * u01(w, `nr:${a.r.id}:${w.tick}`))[0]
    if (rs) { const k = swan(w, `a reactor accident in ${rs.r.name} forced 150k people from their homes`, rs.r.id, 0.6); addCrowd(rs, w, { topic: 'nuclear power', peak: 0.3, outrageMonths: 6, causeId: k.id }) }
  }
  // AMOC collapse: IPCC AR6 has an abrupt collapse before 2100 as very unlikely, but warming raises the odds
  // (Ditlevsen & Ditlevsen 2023, https://doi.org/10.1038/s41467-023-39810-w, argue it could come this century).
  // ESTIMATE hazard 0.4%/yr per C above 1.5 C. effects: colder northern europe, weaker monsoons, faster rise on the US east coast
  if (!p.amoc && w.tick % 12 === 0 && u01(w, `amoc:${w.tick}`) < 0.004 * Math.max(0, w.climate.anomalyC - 1.5)) {
    p.amoc = true
    swan(w, `the Atlantic overturning circulation collapsed: northern europe is cooling and monsoons are weakening`, 'europe', 0.95)
  }
  // multiple breadbasket failure: ESTIMATE ~1%/yr in 2026, rising with warming (Gaupp et al. 2019,
  // https://doi.org/10.1038/s41558-019-0600-z). the main exporters lose ~7% of a year's harvest together (2010-12 style)
  if (w.tick % 12 === 3 && u01(w, `bread:${w.tick}`) < 0.01 * (1 + Math.max(0, w.climate.anomalyC - 1.3))) {
    p.breadUntil = w.tick + 12
    swan(w, 'heat and drought hit several breadbaskets at once, world harvests fall ~7%', 'na', 0.7)
  }
  // food multipliers this month (used by physics stepFood)
  for (const rs of w.regions) {
    const volc = 1 - 0.1 * Math.abs(p.volcanicC) // ESTIMATE ~10% per C of sudden cooling (frosts, short seasons)
    const amoc = p.amoc ? (rs.r.id === 'europe' ? 0.85 : ['sasia', 'ssa', 'seasia'].includes(rs.r.id) ? 0.92 : 1) : 1
    const bread = (p.breadUntil ?? -1) >= w.tick && ['na', 'europe', 'rus_ca', 'easia', 'sasia', 'latam', 'oceania'].includes(rs.r.id) ? 0.93 : 1
    rs.physFood = volc * amoc * bread * (1 - rs.chokeFood)
  }
}
function swan(w: World, text: string, regionId: string, sig: number) {
  w.phys.swans.push({ tick: w.tick, text })
  if (w.phys.swans.length > 12) w.phys.swans.shift()
  event(w, { regionId, kind: 'disaster', text, severity: sig })
  return link(w, { placeId: regionId, what: text, value: sig, because: 'a rare event at its real-world base rate', byWhom: 'nature', sig })
}

// ---------- yearly: minerals, reserves, sea level, aging ----------
export function stepPhysicalYear(w: World) {
  const p = w.phys
  if (!p) return
  // minerals: supply falls when producers are in revolt, wrecked or in unrest (export bans: Indonesia's nickel ore ban
  // 2020, China's gallium, germanium and graphite controls 2023); refining concentration in China doubles the exposure
  const stable = (cid: string) => { const c = w.countries.find(k => k.id === cid); const rs = c && w.regions.find(r => r.r.id === c.regionId); if (!c || !rs) return 1; return clamp(1 - 0.6 * Math.max(0, c.unrest - 0.5) - 0.5 * c.damage - (rs.inRevolt ? 0.5 : 0) - (rs.seceded ? 0.8 : 0)) }
  const recycle = worldC(w, ['recycling'])
  const idx = Object.values(MINERALS).map(m => { const mine = sum(Object.entries(m.mine).map(([cid, s]) => s * stable(cid))) + (1 - sum(Object.values(m.mine))); return clamp(Math.min(mine, 1 - m.refineChina * (1 - stable('CHN'))) + 0.15 * recycle) })
  const prev = p.minerals
  p.minerals = sum(idx) / idx.length
  if (prev - p.minerals > 0.1) link(w, { placeId: 'world', what: `critical mineral supply fell to ${pct(p.minerals)} of 2026`, value: 0.6, because: 'unrest or revolt in producer countries', byWhom: 'market' })
  // fossil reserves: what is burned, minus discoveries
  const burn = w.climate.gtPerYear / 37.4 / 50 // 2026 burn rate = 1/50 of reserves a year (R/P ~50)
  const found = burn * (w.tick < 288 ? 0.7 : 0.3)
  p.fossilReserve = clamp(p.fossilReserve - burn + found, 0, 2)
  // sea level
  const amocBoost = p.amoc ? 1.2 : 1
  p.seaLevelM += 0.0037 * (1 + 0.6 * (w.climate.anomalyC - 1.1)) * amocBoost
  const walls = (c: CountryState) => strongest(w, w.regions.find(r => r.r.id === c.regionId), ['sea_wall', 'climate_adaptation'])
  for (const cc of p.coast) {
    const seed = CITY_SEEDS[cc.idx], city = w.realCities[cc.idx]
    const c = w.countries.find(k => k.id === seed.countryId)
    if (!c || !city) continue
    const wall = walls(c)
    // sea walls: the Delta Works raised Dutch protection over decades (https://en.wikipedia.org/wiki/Delta_Works);
    // ESTIMATE ~10 cm a year at full compliance and funding
    // cities also adapt on their own (raised roads, pumps, local walls): ESTIMATE ~0.5 cm a year, ~1.5 cm in rich ones
    const inc = clamp(Math.log10(Math.max(c.gdpUsd / Math.max(countryPop(c), 1), 300)) / 5)
    cc.protect += 0.1 * wall.c + 0.005 + 0.01 * inc
    // sinking slows as cities stop pumping groundwater (Tokyo's stopped by the 1970s): ESTIMATE -3% a year
    cc.sunk = (cc.sunk ?? 0) + cc.sub / 1000 * Math.pow(0.97, w.tick / 12)
    const rel = p.seaLevelM * (p.amoc && seed.countryId === 'USA' ? 1.3 : 1) + cc.sunk
    const over = rel - cc.protect
    // flood odds: each 0.5 m of rise makes the old 100-year flood ~100x more frequent at most coasts (Tebaldi et al.
    // 2021, https://doi.org/10.1038/s41558-021-01127-1). the margin is how far defenses sit above today's 100-year level
    const pFlood = clamp(0.01 * Math.pow(100, (over + 0.3) / 0.5), 0, 0.9)
    if (u01(w, `flood:${seed.id}:${w.tick}`) < pFlood) {
      cc.floods++; cc.lastFlood = w.tick
      const sev = clamp(0.1 + 0.3 * Math.max(0, over + 0.3))
      city.damage = clamp(city.damage + sev)
      c.damage = Math.max(c.damage, sev * 0.5)
      const rs = w.regions.find(r => r.r.id === c.regionId)!
      const dead = killInRegion(w, rs, Math.min(0.01, city.pop / Math.max(countryPop(c), 1)) * 0.0005, c.id)
      w.vital.disasters += dead
      const k = link(w, { placeId: c.id, what: `the sea flooded ${seed.name}, ${c.name}, ${fmt(dead)} dead`, value: clamp(0.4 + sev), because: `seas ${Math.round(rel * 100)} cm higher there than in 2026 (${Math.round(p.seaLevelM * 100)} cm global rise, the city sinking ${cc.sub} mm a year)${wall.c > 0.2 ? '' : ', no sea wall'}`, byWhom: 'nature' })
      w.infraAcc.push({ tick: w.tick, kind: 'city', op: 'damaged', id: seed.id, population: city.pop, damage: Math.round(city.damage * 100) / 100, because: k.what } as InfraDiff)
    }
    // managed retreat: well past the defenses, people leave (~5%/yr), the city is abandoned past ~2 m
    if (over > 1) {
      cc.retreat = clamp(cc.retreat + 0.05)
      if (over > 2 && cc.retreat < 0.95) { cc.retreat = 0.95; w.infraAcc.push({ tick: w.tick, kind: 'city', op: 'abandoned', id: seed.id, population: Math.round(city.pop * 0.05), because: `${seed.name} is below the sea` } as InfraDiff) }
    }
  }
  // aging and pensions: rising pension bills come out of the same health and social budget (pensionSqueeze),
  // raising the retirement age (laws of kind pension_cut: France 2023, Russia 2018) cuts the bill by 2 years per law
  const raise = w.laws.filter(l => !l.vetoed && l.policyKind === 'pension_cut').length
  p.retirementAge = 65 + 2 * Math.min(3, raise)
  for (const rs of w.regions) {
    const cs = countriesOf(w, rs.r.id)
    for (const c of cs) c.aging = agingOf(c, p.retirementAge, c.aging)
    const gdp = Math.max(sum(cs.map(c => c.gdpUsd)), 1), pop = Math.max(regionPop(rs), 1)
    const extra = sum(cs.map(c => (c.aging.pensionGdp - c.aging.pension0) * c.gdpUsd))
    // half the extra pension bill is paid by squeezing health and social care (ESTIMATE), half by taxes and debt
    rs.pensionSqueeze = Math.max(0, 0.5 * extra / pop)
    // demographic dividend and drag: a falling working-age share slows growth per head about one for one
    // (Bloom & Williamson 1998, https://doi.org/10.1093/wber/12.3.419), counted only beyond the 2026 trend
    const wa = workingShare(rs.bands, p.retirementAge)
    rs.demoGrowth = clamp((wa - rs.waPrev) / Math.max(rs.waPrev, 0.01) - (rs.waTrend0 ??= (wa - rs.waPrev) / Math.max(rs.waPrev, 0.01)), -0.02, 0.02) - 0.1 * Math.max(0, 0.5 * extra / gdp)
    rs.waPrev = wa
  }
  void NBANDS
}

export function physicalLines(w: World): string[] {
  const p = w.phys
  if (!p) return []
  const closed = CHOKEPOINTS.filter(c => (p.chokes.find(s => s.id === c.id)?.closedUntil ?? -1) >= w.tick).map(c => `${c.name} ${pct(p.chokes.find(s => s.id === c.id)!.severity)}`)
  const worst = [...p.coast].sort((a, b) => ((b.sunk ?? 0) - b.protect) - ((a.sunk ?? 0) - a.protect))[0]
  const floodedNow = p.coast.filter(c => w.tick - c.lastFlood < 12).length
  const P = sum(w.countries.map(countryPop)) || 1
  const dep = sum(w.countries.map(c => (c.aging?.dep ?? 0) * countryPop(c))) / P, dep0 = sum(w.countries.map(c => (c.aging?.dep0 ?? 0) * countryPop(c))) / P
  const pen = sum(w.countries.map(c => (c.aging?.pensionGdp ?? 0) * c.gdpUsd)) / Math.max(sum(w.countries.map(c => c.gdpUsd)), 1)
  const last = p.swans.at(-1)
  return [
    `shipping: ${closed.length ? `closed or disrupted: ${closed.join(', ')}` : 'all chokepoints open'}; critical minerals ${pct(p.minerals)} of 2026 supply, fossil reserves ${pct(p.fossilReserve)}`,
    `sea level +${Math.round(p.seaLevelM * 100)} cm since 2026, ${floodedNow} big coastal cities flooded last year${worst ? ` (most exposed ${CITY_SEEDS[worst.idx].name})` : ''}${p.amoc ? '; atlantic circulation collapsed' : ''}`,
    `aging: old-age dependency ${dep.toFixed(2)} (2026 ${dep0.toFixed(2)}), public pensions ${pct(pen)} of gdp, retirement age ${p.retirementAge}${last && w.tick - last.tick < 24 ? `; recent: ${last.text}` : ''}`,
  ]
}
