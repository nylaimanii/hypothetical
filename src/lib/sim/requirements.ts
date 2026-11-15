// requirement tree: ~60 nodes across mars, outer_planets, longevity, population, infrastructure.
// each node has the real 2026 state of the art with a url. progress comes from the research budget,
// the governor's researchFocus, education and companies in the matching sector, with diminishing returns,
// and is capped by real money spent (a node can never finish for less than its costUsd).
// speculative nodes roll a seeded chance to stall for decades or fail outright when they open.
import type { Company, Requirement } from '../types'
import { clamp, event, type World } from './state'

const W = 'https://en.wikipedia.org/wiki/'

type Node = Omit<Requirement, 'progress' | 'unlockedTick'> & { rate: number; start?: number; sector?: Company['sector'] }

// rate: progress per year at reference intensity (spending its cost over 10 years) with average education. ESTIMATE.
export const NODES: Node[] = [
  // ---------- infrastructure ----------
  { id: 'super_heavy_lift', name: 'fully reusable super heavy lift', track: 'infrastructure', prereqs: [], tier: 'emerging', costUsd: 60e9, rate: 0.12, start: 0.35, sector: 'launch', realWorld2026: 'fully reusable super heavy rockets are in flight testing, none certified for crew', url: 'https://www.spacex.com/vehicles/starship/' },
  { id: 'orbital_refueling', name: 'orbital propellant transfer', track: 'infrastructure', prereqs: ['super_heavy_lift'], tier: 'emerging', costUsd: 25e9, rate: 0.1, start: 0.1, sector: 'launch', realWorld2026: 'ship to ship cryogenic propellant transfer in orbit has been demonstrated only at small scale', url: `${W}Orbital_propellant_depot` },
  { id: 'hvdc_global_grid', name: 'intercontinental hvdc grid', track: 'infrastructure', prereqs: [], tier: 'proven', costUsd: 400e9, rate: 0.06, start: 0.1, sector: 'energy', realWorld2026: 'hvdc links of 3,000 km+ run in China and Brazil, no intercontinental grid exists', url: `${W}High-voltage_direct_current` },
  { id: 'grid_storage', name: 'grid scale storage', track: 'infrastructure', prereqs: [], tier: 'proven', costUsd: 300e9, rate: 0.08, start: 0.2, sector: 'energy', realWorld2026: 'battery storage is scaling fast but covers hours, not seasons', url: `${W}Grid_energy_storage` },
  { id: 'advanced_fission', name: 'small modular fission reactors', track: 'infrastructure', prereqs: [], tier: 'emerging', costUsd: 120e9, rate: 0.06, start: 0.15, sector: 'energy', realWorld2026: 'a handful of small modular reactors operate (Russia, China), western designs are still licensing', url: `${W}Small_modular_reactor` },
  { id: 'fusion_power', name: 'commercial fusion power', track: 'infrastructure', prereqs: ['advanced_fission'], tier: 'speculative', costUsd: 300e9, rate: 0.025, start: 0.05, sector: 'energy', realWorld2026: 'NIF reached target gain above 1 in 2022, no fusion plant has delivered net electricity', url: `${W}National_Ignition_Facility` },
  { id: 'high_speed_rail', name: 'continental high speed rail', track: 'infrastructure', prereqs: [], tier: 'proven', costUsd: 800e9, rate: 0.05, start: 0.15, sector: 'transit', realWorld2026: 'China runs over 45,000 km of high speed rail, most regions have little or none', url: `${W}High-speed_rail_in_China` },
  { id: 'hypersonic_transport', name: 'point to point hypersonic travel', track: 'infrastructure', prereqs: ['super_heavy_lift'], tier: 'speculative', costUsd: 150e9, rate: 0.03, sector: 'transit', realWorld2026: 'no passenger aircraft has flown faster than Concorde, retired in 2003', url: `${W}Concorde` },
  { id: 'ai_research_tools', name: 'ai accelerated research', track: 'infrastructure', prereqs: [], tier: 'emerging', costUsd: 80e9, rate: 0.1, start: 0.3, sector: 'computing', realWorld2026: 'AlphaFold predicted structures for most known proteins; ai tools are spreading through labs', url: `${W}AlphaFold` },
  { id: 'climate_adaptation', name: 'climate adaptation at scale', track: 'infrastructure', prereqs: [], tier: 'proven', costUsd: 500e9, rate: 0.05, start: 0.15, sector: 'materials', realWorld2026: 'the Netherlands Delta Works protects land below sea level, most coasts have no comparable defense', url: `${W}Delta_Works` },
  { id: 'desalination', name: 'cheap desalination', track: 'infrastructure', prereqs: [], tier: 'proven', costUsd: 150e9, rate: 0.07, start: 0.3, sector: 'materials', realWorld2026: 'reverse osmosis supplies most drinking water in several Gulf states at about 3 to 4 kWh per cubic meter', url: `${W}Desalination` },
  // ---------- mars ----------
  { id: 'deep_space_life_support', name: 'closed loop life support', track: 'mars', prereqs: [], tier: 'proven', costUsd: 25e9, rate: 0.08, start: 0.45, realWorld2026: 'the ISS recovers about 98% of its water, oxygen and food loops are not closed', url: `${W}ISS_ECLSS` },
  { id: 'radiation_shielding', name: 'deep space radiation protection', track: 'mars', prereqs: [], tier: 'emerging', costUsd: 30e9, rate: 0.05, start: 0.15, realWorld2026: 'Curiosity measured about 0.66 Sv for a round trip transit, above NASA career limits; no shield solves it', url: `${W}Radiation_assessment_detector` },
  { id: 'nuclear_thermal', name: 'nuclear thermal propulsion', track: 'mars', prereqs: ['super_heavy_lift'], tier: 'emerging', costUsd: 40e9, rate: 0.05, start: 0.1, sector: 'launch', realWorld2026: 'NERVA engines were ground tested in the 1960s, none has flown', url: `${W}NERVA` },
  { id: 'mars_edl', name: 'heavy mars entry descent and landing', track: 'mars', prereqs: ['super_heavy_lift'], tier: 'emerging', costUsd: 30e9, rate: 0.06, start: 0.15, realWorld2026: 'the heaviest payload landed on Mars is Perseverance at about 1 tonne; crewed landers need 20 to 100 tonnes', url: `${W}Mars_landing` },
  { id: 'mars_isru_propellant', name: 'make return fuel on mars', track: 'mars', prereqs: ['deep_space_life_support'], tier: 'emerging', costUsd: 20e9, rate: 0.05, start: 0.1, realWorld2026: 'MOXIE made about 122 grams of oxygen on Mars between 2021 and 2023', url: `${W}Mars_Oxygen_ISRU_Experiment` },
  { id: 'mars_ascent', name: 'crewed mars ascent vehicle', track: 'mars', prereqs: ['mars_edl'], tier: 'emerging', costUsd: 25e9, rate: 0.05, realWorld2026: 'no rocket has ever launched from the surface of Mars', url: `${W}Mars_ascent_vehicle` },
  { id: 'space_medicine', name: 'medicine far from earth', track: 'mars', prereqs: ['deep_space_life_support'], tier: 'emerging', costUsd: 12e9, rate: 0.05, start: 0.1, sector: 'medicine', realWorld2026: 'crews rely on first aid and ground support, there is no surgery capability on long missions', url: `${W}Space_medicine` },
  { id: 'mars_habitats', name: 'mars surface habitats', track: 'mars', prereqs: ['radiation_shielding', 'deep_space_life_support'], tier: 'emerging', costUsd: 40e9, rate: 0.04, start: 0.1, sector: 'materials', realWorld2026: 'an inflatable test module has been attached to the ISS since 2016', url: `${W}Bigelow_Expandable_Activity_Module` },
  { id: 'mars_food', name: 'grow food off world', track: 'mars', prereqs: ['deep_space_life_support'], tier: 'emerging', costUsd: 8e9, rate: 0.05, start: 0.2, sector: 'food', realWorld2026: 'astronauts have grown and eaten small crops of leafy greens on the ISS', url: `${W}Vegetable_Production_System` },
  { id: 'mars_power', name: 'surface fission power', track: 'mars', prereqs: ['advanced_fission'], tier: 'emerging', costUsd: 15e9, rate: 0.05, start: 0.1, sector: 'energy', realWorld2026: 'NASA Kilopower tested a 1 kW fission reactor on the ground in 2018', url: `${W}Kilopower` },
  { id: 'mars_manufacturing', name: 'mars industry from local rock', track: 'mars', prereqs: ['mars_habitats', 'mars_power'], tier: 'speculative', costUsd: 80e9, rate: 0.025, sector: 'materials', realWorld2026: 'ISS has a 3D printer; no factory has ever run off Earth', url: `${W}In-situ_resource_utilization` },
  { id: 'mars_reproduction', name: 'safe pregnancy in low gravity', track: 'mars', prereqs: ['space_medicine', 'mars_habitats'], tier: 'speculative', costUsd: 20e9, rate: 0.02, realWorld2026: 'no mammal pregnancy has been carried to term in reduced gravity; effects of 0.38 g are unknown', url: `${W}Effect_of_spaceflight_on_the_human_body` },
  { id: 'mars_self_sustaining_node', name: 'self sustaining mars population', track: 'mars', prereqs: ['mars_manufacturing', 'mars_reproduction', 'mars_food', 'mars_isru_propellant'], tier: 'speculative', costUsd: 500e9, rate: 0.015, realWorld2026: 'no human settlement exists off Earth; estimates of a minimum viable population range from hundreds to thousands', url: `${W}Minimum_viable_population` },
  { id: 'lunar_isru', name: 'water and oxygen from lunar regolith', track: 'mars', prereqs: [], tier: 'emerging', costUsd: 15e9, rate: 0.06, start: 0.1, realWorld2026: 'water ice is confirmed in shadowed polar craters, nobody has mined any', url: `${W}Lunar_water` },
  { id: 'lunar_habitat', name: 'long stay lunar habitat', track: 'mars', prereqs: ['deep_space_life_support', 'radiation_shielding'], tier: 'emerging', costUsd: 30e9, rate: 0.05, start: 0.1, sector: 'materials', realWorld2026: 'the longest stay on the Moon was about 75 hours, Apollo 17 in 1972', url: `${W}Apollo_17` },
  // ---------- outer planets ----------
  { id: 'nuclear_electric', name: 'nuclear electric propulsion', track: 'outer_planets', prereqs: ['advanced_fission'], tier: 'emerging', costUsd: 40e9, rate: 0.03, sector: 'launch', realWorld2026: 'ion engines have flown on Dawn and others with solar power; no reactor-powered drive has flown', url: `${W}Nuclear_electric_rocket` },
  { id: 'asteroid_prospecting', name: 'asteroid prospecting', track: 'outer_planets', prereqs: [], tier: 'emerging', costUsd: 10e9, rate: 0.06, start: 0.2, realWorld2026: 'OSIRIS-REx returned about 120 grams of asteroid Bennu in 2023', url: `${W}OSIRIS-REx` },
  { id: 'asteroid_mining_node', name: 'asteroid mining', track: 'outer_planets', prereqs: ['asteroid_prospecting', 'nuclear_electric', 'orbital_refueling'], tier: 'speculative', costUsd: 200e9, rate: 0.02, sector: 'materials', realWorld2026: 'no material has been mined in space for use', url: `${W}Asteroid_mining` },
  { id: 'fusion_propulsion', name: 'fusion propulsion', track: 'outer_planets', prereqs: ['fusion_power'], tier: 'speculative', costUsd: 250e9, rate: 0.015, sector: 'launch', realWorld2026: 'fusion drives exist only as paper studies', url: `${W}Fusion_rocket` },
  { id: 'jovian_radiation', name: 'survive jupiter radiation belts', track: 'outer_planets', prereqs: ['radiation_shielding'], tier: 'speculative', costUsd: 40e9, rate: 0.02, realWorld2026: 'Juno uses a titanium vault to protect electronics; crews would receive lethal doses near Europa', url: `${W}Juno_(spacecraft)` },
  { id: 'long_duration_crew', name: 'multi year crewed voyages', track: 'outer_planets', prereqs: ['deep_space_life_support', 'space_medicine'], tier: 'emerging', costUsd: 30e9, rate: 0.03, realWorld2026: 'the longest single spaceflight is about 437 days, Valeri Polyakov in 1994 to 1995', url: `${W}Valeri_Polyakov` },
  { id: 'outer_habitats', name: 'outer moon habitats', track: 'outer_planets', prereqs: ['jovian_radiation', 'long_duration_crew', 'fusion_propulsion'], tier: 'speculative', costUsd: 300e9, rate: 0.01, realWorld2026: 'Europa Clipper is on its way to study Europa; no lander is planned', url: `${W}Europa_Clipper` },
  // ---------- longevity ----------
  { id: 'cardio', name: 'cardiovascular disease control', track: 'longevity', prereqs: [], tier: 'proven', costUsd: 90e9, rate: 0.06, start: 0.4, sector: 'medicine', realWorld2026: 'cardiovascular disease is the top cause of death globally, about a third of deaths', url: 'https://www.who.int/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)' },
  { id: 'metabolic', name: 'metabolic health', track: 'longevity', prereqs: [], tier: 'proven', costUsd: 40e9, rate: 0.07, start: 0.35, sector: 'medicine', realWorld2026: 'GLP-1 drugs cut cardiovascular events about 20% in the 2023 SELECT trial', url: `${W}Semaglutide` },
  { id: 'cancer', name: 'cancer control', track: 'longevity', prereqs: [], tier: 'emerging', costUsd: 150e9, rate: 0.04, start: 0.3, sector: 'medicine', realWorld2026: 'cancer causes about one in six deaths worldwide', url: 'https://www.who.int/news-room/fact-sheets/detail/cancer' },
  { id: 'neuro', name: 'neurodegeneration', track: 'longevity', prereqs: [], tier: 'emerging', costUsd: 120e9, rate: 0.035, start: 0.12, sector: 'medicine', realWorld2026: 'antibody drugs approved in 2023 modestly slow early Alzheimer decline', url: `${W}Lecanemab` },
  { id: 'vaccines_next', name: 'rapid vaccine platforms', track: 'longevity', prereqs: [], tier: 'proven', costUsd: 30e9, rate: 0.08, start: 0.5, sector: 'medicine', realWorld2026: 'mRNA vaccines went from sequence to authorization in under a year in 2020', url: `${W}MRNA_vaccine` },
  { id: 'malaria_eradication', name: 'malaria eradication', track: 'longevity', prereqs: ['vaccines_next'], tier: 'emerging', costUsd: 60e9, rate: 0.05, start: 0.3, sector: 'medicine', realWorld2026: 'about 600,000 malaria deaths a year; two vaccines (RTS,S and R21) are being rolled out', url: 'https://www.who.int/news-room/fact-sheets/detail/malaria' },
  { id: 'tb_eradication', name: 'tuberculosis eradication', track: 'longevity', prereqs: ['vaccines_next'], tier: 'emerging', costUsd: 50e9, rate: 0.04, start: 0.25, sector: 'medicine', realWorld2026: 'TB kills about 1.25 million people a year, the top infectious killer', url: 'https://www.who.int/news-room/fact-sheets/detail/tuberculosis' },
  { id: 'hiv_cure', name: 'hiv cure', track: 'longevity', prereqs: ['gene_therapy'], tier: 'emerging', costUsd: 40e9, rate: 0.03, start: 0.15, sector: 'medicine', realWorld2026: 'a handful of people have been cured after stem cell transplants; antiretrovirals control but do not cure', url: `${W}HIV/AIDS_research` },
  { id: 'polio_endgame', name: 'polio eradication', track: 'longevity', prereqs: [], tier: 'proven', costUsd: 5e9, rate: 0.15, start: 0.85, sector: 'medicine', realWorld2026: 'wild polio survives only in Pakistan and Afghanistan', url: `${W}Polio_eradication` },
  { id: 'gene_therapy', name: 'gene editing therapies', track: 'longevity', prereqs: [], tier: 'emerging', costUsd: 60e9, rate: 0.05, start: 0.2, sector: 'longevity', realWorld2026: 'the first CRISPR therapy was approved in 2023 for sickle cell disease', url: `${W}Exagamglogene_autotemcel` },
  { id: 'senescence', name: 'clear senescent cells', track: 'longevity', prereqs: ['gene_therapy'], tier: 'speculative', costUsd: 50e9, rate: 0.03, start: 0.08, sector: 'longevity', realWorld2026: 'senolytic drugs are in early human trials', url: `${W}Senolytic` },
  { id: 'immune_aging', name: 'reverse immune aging', track: 'longevity', prereqs: ['senescence'], tier: 'speculative', costUsd: 45e9, rate: 0.025, start: 0.05, sector: 'longevity', realWorld2026: 'small pilot studies tried to regrow the thymus, results unconfirmed', url: `${W}Immunosenescence` },
  { id: 'reprogramming', name: 'epigenetic reprogramming', track: 'longevity', prereqs: ['gene_therapy'], tier: 'speculative', costUsd: 100e9, rate: 0.02, start: 0.04, sector: 'longevity', realWorld2026: 'partial reprogramming rejuvenates cells in mice, no whole body human trials', url: `${W}Induced_pluripotent_stem_cell` },
  { id: 'organ_regen', name: 'organ replacement on demand', track: 'longevity', prereqs: ['gene_therapy', 'immune_aging'], tier: 'speculative', costUsd: 120e9, rate: 0.025, start: 0.06, sector: 'medicine', realWorld2026: 'gene edited pig kidneys were transplanted into living patients starting in 2024', url: `${W}Xenotransplantation` },
  { id: 'lifespan_200', name: 'healthy 200 year lifespan', track: 'longevity', prereqs: ['cancer', 'cardio', 'neuro', 'reprogramming', 'organ_regen', 'immune_aging', 'metabolic'], tier: 'speculative', costUsd: 1e12, rate: 0.01, sector: 'longevity', realWorld2026: 'the oldest verified human lived to 122', url: `${W}Jeanne_Calment` },
  { id: 'pandemic_preparedness', name: 'pandemic preparedness', track: 'longevity', prereqs: ['vaccines_next'], tier: 'proven', costUsd: 40e9, rate: 0.07, start: 0.3, sector: 'medicine', realWorld2026: 'the 2025 WHO pandemic agreement was adopted, financing and surveillance gaps remain', url: `${W}WHO_Pandemic_Agreement` },
  // ---------- population ----------
  { id: 'affordable_housing', name: 'affordable housing at scale', track: 'population', prereqs: [], tier: 'proven', costUsd: 600e9, rate: 0.05, start: 0.2, sector: 'housing', realWorld2026: 'Vienna houses about half its residents in social or subsidized housing; most cities face rising costs', url: `${W}Social_housing_in_Vienna` },
  { id: 'universal_childcare', name: 'universal childcare', track: 'population', prereqs: [], tier: 'proven', costUsd: 300e9, rate: 0.06, start: 0.2, realWorld2026: 'Nordic countries provide near universal childcare; fertility there still fell after 2010', url: `${W}Parental_leave` },
  { id: 'vertical_farming', name: 'controlled environment farming', track: 'population', prereqs: ['grid_storage'], tier: 'emerging', costUsd: 100e9, rate: 0.05, start: 0.15, sector: 'food', realWorld2026: 'indoor farms grow leafy greens commercially; staple grains are not economical indoors', url: `${W}Vertical_farming` },
  { id: 'drought_crops', name: 'drought and heat tolerant staples', track: 'population', prereqs: [], tier: 'proven', costUsd: 20e9, rate: 0.07, start: 0.3, sector: 'food', realWorld2026: 'drought tolerant maize varieties are planted across Africa; heat remains the main yield threat', url: `${W}Drought_tolerance` },
  { id: 'precision_fermentation', name: 'precision fermentation protein', track: 'population', prereqs: [], tier: 'emerging', costUsd: 30e9, rate: 0.06, start: 0.15, sector: 'food', realWorld2026: 'fermentation-made dairy proteins are on shelves in a few countries at small scale', url: `${W}Precision_fermentation` },
  { id: 'universal_primary_care', name: 'universal primary care', track: 'population', prereqs: [], tier: 'proven', costUsd: 400e9, rate: 0.05, start: 0.3, sector: 'medicine', realWorld2026: 'about half the world lacks full coverage of essential health services (WHO UHC index)', url: 'https://www.who.int/news-room/fact-sheets/detail/universal-health-coverage-(uhc)' },
  { id: 'clean_water_access', name: 'safe water for everyone', track: 'population', prereqs: [], tier: 'proven', costUsd: 150e9, rate: 0.07, start: 0.4, sector: 'materials', realWorld2026: 'about 2.2 billion people lack safely managed drinking water', url: 'https://www.who.int/news-room/fact-sheets/detail/drinking-water' },
  { id: 'off_world_genetics', name: 'off world genetic diversity planning', track: 'population', prereqs: ['mars_reproduction'], tier: 'speculative', costUsd: 10e9, rate: 0.03, realWorld2026: 'conservation biology uses minimum viable population rules; none has been tested for humans', url: `${W}Minimum_viable_population` },
]

const TIER_GATE: Record<Requirement['tier'], number> = { proven: 0.3, emerging: 0.5, speculative: 0.65 }
const TIER_MAX_PER_YEAR: Record<Requirement['tier'], number> = { proven: 0.12, emerging: 0.06, speculative: 0.03 }

export type ReqState = Requirement & { spend: number; stall: 'none' | 'stalled' | 'failed'; stallUntil: number; rolled: boolean; rate: number; sector?: Company['sector'] }

export function initRequirements(): ReqState[] {
  return NODES.map(n => ({ ...n, progress: n.start ?? 0, spend: (n.start ?? 0) * (n.costUsd ?? 0), stall: 'none', stallUntil: -1, rolled: false }))
}

export const isDone = (r: ReqState) => r.progress >= 1
export function reqProgress(w: World, id: string): number {
  return w.requirements.find(r => r.id === id)?.progress ?? 0
}
export const reqDone = (w: World, id: string) => reqProgress(w, id) >= 1

// one month of research. researchUsd is the part of the research budget that funds the tree.
export function stepRequirements(w: World, researchUsd: number, focus: string[], eduGlobal: number, sectorStrength: Record<string, number>) {
  const open = w.requirements.filter(r => !isDone(r) && r.prereqs.every(p => reqDone(w, p)))
  if (!open.length) return
  const isFocused = (r: ReqState) => focus.some(f => f === r.id || f === r.track || (f.length > 3 && r.name.toLowerCase().includes(f.toLowerCase())))
  // focused nodes get 3x weight; with any focus set, unfocused nodes get the remainder
  const weights = open.map(r => (isFocused(r) ? 3 : 1))
  const wsum = weights.reduce((a, b) => a + b, 0)
  const computing = 1 + 0.3 * (sectorStrength.computing ?? 0) + 0.3 * reqProgress(w, 'ai_research_tools')
  const tech = w.regions.reduce((a, r) => a + r.r.techLevel * r.r.population, 0) / Math.max(1, w.regions.reduce((a, r) => a + r.r.population, 0))
  open.forEach((r, i) => {
    // speculative nodes: roll once when they open (ESTIMATE: 30% stall 10-30 years, 10% fail outright)
    if (r.tier === 'speculative' && !r.rolled) {
      r.rolled = true
      const x = w.rng.research(), y = w.rng.research()
      if (x < 0.1) r.stall = 'failed'
      else if (x < 0.4) { r.stall = 'stalled'; r.stallUntil = w.tick + 120 + Math.floor(y * 240) }
    }
    if (r.stall === 'stalled' && w.tick >= r.stallUntil) r.stall = 'none'
    const share = researchUsd * weights[i] / wsum
    r.spend += share
    const cost = r.costUsd ?? 1e10
    // reference intensity 1 = spending the node's cost over 20 years
    const intensity = (share * 12) / (cost / 20)
    const edu = 0.5 + eduGlobal
    const sector = r.sector ? 1 + 0.5 * (sectorStrength[r.sector] ?? 0) : 1
    const stallMult = r.stall === 'failed' ? 0.02 : r.stall === 'stalled' ? 0.1 : 1
    // the world's technical base gates each tier (ESTIMATE): below the gate progress crawls
    const gate = TIER_GATE[r.tier]
    const techMult = clamp((tech - gate + 0.1) / 0.2, 0.05, 1)
    // diminishing returns: progress grows with intensity^0.3, and no amount of money compresses a research
    // timeline past the tier's maximum pace (ESTIMATE: proven 12%/yr, emerging 6%/yr, speculative 3%/yr)
    const dp = Math.min(TIER_MAX_PER_YEAR[r.tier], r.rate * Math.pow(intensity, 0.3) * edu * sector * computing * techMult) * stallMult / 12
    const capBySpend = r.spend / cost
    const before = r.progress
    r.progress = clamp(Math.min(r.progress + dp, Math.max(capBySpend, before)))
    if (before < 1 && r.progress >= 1) {
      r.unlockedTick = w.tick
      event(w, { kind: 'breakthrough', text: `breakthrough: ${r.name} [requirement: ${r.id}]`, severity: r.tier === 'speculative' ? 0.8 : 0.5 })
    }
  })
}

export function publicRequirements(w: World): Requirement[] {
  return w.requirements.map(r => ({
    id: r.id, name: r.name, track: r.track, progress: Math.round(r.progress * 1e4) / 1e4, prereqs: r.prereqs,
    realWorld2026: r.realWorld2026 + (r.stall === 'stalled' && w.tick < r.stallUntil ? ' (stalled: the approach hit a wall)' : r.stall === 'failed' ? ' (failed: this approach did not work)' : ''),
    url: r.url, tier: r.tier, costUsd: r.costUsd, ...(r.unlockedTick !== undefined ? { unlockedTick: r.unlockedTick } : {}),
  }))
}

// ---------- mars physics ----------
// Earth-Mars synodic period 779.9 days = 25.6 months: transfer windows come once per synodic period.
// https://en.wikipedia.org/wiki/Mars_launch_window. the 2026 window opens around November 2026 (tick 0).
export const SYNODIC_MONTHS = 25.62
export const isMarsWindow = (tick: number) => Math.floor(tick / SYNODIC_MONTHS) !== Math.floor((tick - 1) / SYNODIC_MONTHS) || tick === 0
// Hohmann transfer Earth to Mars ~259 days (~8.5 months). https://en.wikipedia.org/wiki/Hohmann_transfer_orbit
export const HOHMANN_MONTHS = 9
// delta-v (km/s): LEO to trans-Mars injection ~3.6, propulsive landing after aerobraking ~0.7,
// Mars surface to low orbit ~4.1, trans-Earth injection ~2.1. https://en.wikipedia.org/wiki/Delta-v_budget
export const MARS_DV = { departure: 3.6 + 0.7, ascentReturn: 4.1 + 2.1 }
// radiation: ~0.66 Sv for a 360 day round trip (Zeitlin et al. 2013, https://doi.org/10.1126/science.1235989)
// plus ~0.67 mSv/day on the surface (Hassler et al. 2014, https://doi.org/10.1126/science.1244797), ~500 day stay.
// NASA career limit 600 mSv (NASA-STD-3001, 2022).
export const MARS_DOSE_SV = 0.66 + 0.00067 * 500
export const DOSE_LIMIT_SV = 0.6

export function missionDoseSv(w: World): number {
  const shield = reqProgress(w, 'radiation_shielding')
  const fast = Math.max(reqProgress(w, 'nuclear_thermal'), reqProgress(w, 'fusion_propulsion'))
  // ESTIMATE: shielding cuts dose up to 50%, faster transit cuts the transit share up to 40%
  return (0.66 * (1 - 0.4 * fast) + 0.335) * (1 - 0.5 * shield)
}

// life support closure: ISS ~0.98 water, oxygen loop ~0.5. overall closure ESTIMATE 0.85 -> 0.995 with progress
export function lifeSupportClosure(w: World): number {
  return 0.85 + 0.145 * reqProgress(w, 'deep_space_life_support')
}
