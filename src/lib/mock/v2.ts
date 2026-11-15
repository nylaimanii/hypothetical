// MOCK v2 libraries: precedents, requirements, factions, lessons. the real ones come from the sim (agent B).
// real-world claims carry a url. magnitudes and costs here are ESTIMATE placeholders for the mock only.
import type { Company, Faction, Lesson, Precedent, Requirement } from '@/lib/types'

const W = 'https://en.wikipedia.org/wiki/'

export const PRECEDENTS: Precedent[] = [
  { id: 'yellow_vests', event: 'fuel tax rise triggers the yellow vests protests', year: 2018, country: 'France', policyKind: 'energy_tax', reaction: 'weekly mass protests, the tax rise was suspended', magnitude: 0.7, durationMonths: 12, url: `${W}Yellow_vests_protests` },
  { id: 'ecuador_2019', event: 'fuel subsidy removal sparks nationwide protests', year: 2019, country: 'Ecuador', policyKind: 'energy_tax', reaction: 'general strike, decree withdrawn within two weeks', magnitude: 0.8, durationMonths: 1, url: `${W}2019_Ecuadorian_protests` },
  { id: 'three_day_week', event: 'electricity rationed to three days a week', year: 1974, country: 'United Kingdom', policyKind: 'energy_rationing', reaction: 'grudging compliance, government lost the next election', magnitude: 0.5, durationMonths: 2, url: `${W}Three-Day_Week` },
  { id: 'india_pds', event: 'public distribution system for staple grain', year: 1965, country: 'India', policyKind: 'food_reserve', reaction: 'broad support, persistent leakage and queues', magnitude: 0.3, durationMonths: 600, url: `${W}Public_distribution_system_(India)` },
  { id: 'alaska_pfd', event: 'permanent fund dividend paid to every resident', year: 1982, country: 'United States', policyKind: 'basic_income', reaction: 'very popular, politically hard to cut', magnitude: 0.2, durationMonths: 500, url: `${W}Alaska_Permanent_Fund` },
  { id: 'mincome', event: 'guaranteed annual income experiment in Dauphin', year: 1974, country: 'Canada', policyKind: 'basic_income', reaction: 'hospital visits fell, work hours barely changed', magnitude: 0.2, durationMonths: 48, url: `${W}Mincome` },
  { id: 'hk_mask', event: 'emergency ban on face coverings at protests', year: 2019, country: 'Hong Kong', policyKind: 'assembly_limit', reaction: 'protests grew the same weekend', magnitude: 0.8, durationMonths: 6, url: `${W}Prohibition_on_Face_Covering_Regulation` },
  { id: 'finland_school', event: 'comprehensive school reform', year: 1972, country: 'Finland', policyKind: 'school_reform', reaction: 'slow, then large long-term attainment gains', magnitude: 0.3, durationMonths: 120, url: `${W}Education_in_Finland` },
  { id: 'porto_alegre', event: 'participatory budgeting published line by line', year: 1989, country: 'Brazil', policyKind: 'transparency', reaction: 'participation and trust rose in poorer districts', magnitude: 0.3, durationMonths: 180, url: `${W}Participatory_budgeting` },
  { id: 'three_gorges', event: 'dam project relocates about 1.3 million people', year: 1994, country: 'China', policyKind: 'relocation', reaction: 'local grievances and petitions for decades', magnitude: 0.6, durationMonths: 200, url: `${W}Three_Gorges_Dam` },
  { id: 'entsoe', event: 'national grids synchronized into one continental grid', year: 1958, country: 'Europe', policyKind: 'grid_integration', reaction: 'low public attention, steady reliability gains', magnitude: 0.1, durationMonths: 400, url: `${W}Synchronous_grid_of_Continental_Europe` },
  { id: 'france_1905', event: 'law separating churches and the state', year: 1905, country: 'France', policyKind: 'secular_state', reaction: 'bitter conflict for a decade, then settled norm', magnitude: 0.5, durationMonths: 120, url: `${W}1905_French_law_on_the_Separation_of_the_Churches_and_the_State` },
  { id: 'zivildienst', event: 'civilian service as an alternative to conscription', year: 1961, country: 'West Germany', policyKind: 'national_service', reaction: 'became normal, care sector came to rely on it', magnitude: 0.2, durationMonths: 600, url: `${W}Zivildienst` },
]

// policyKind, precedents, who loved and hated each mock law
export const LAW_META: Record<string, { policyKind: string; precedentIds: string[]; lovedBy: string[]; hatedBy: string[] }> = {
  'law-grain': { policyKind: 'food_reserve', precedentIds: ['india_pds'], lovedBy: ['low income', 'elders', 'worriers'], hatedBy: ['grain traders', 'hustlers'] },
  'law-grid': { policyKind: 'grid_integration', precedentIds: ['entsoe'], lovedBy: ['science guild', 'rural households'], hatedBy: ['old energy compact'] },
  'law-school': { policyKind: 'school_reform', precedentIds: ['finland_school'], lovedBy: ['parents', 'sharp kids', 'scientists'], hatedBy: ['teenagers', 'religious council'] },
  'law-press': { policyKind: 'transparency', precedentIds: ['porto_alegre'], lovedBy: ['activists', 'gossips'], hatedBy: ['bureaucrats'] },
  'law-faith': { policyKind: 'secular_state', precedentIds: ['france_1905'], lovedBy: ['secular adults'], hatedBy: ['religious council', 'true believers'] },
  'law-launch': { policyKind: 'relocation', precedentIds: ['three_gorges'], lovedBy: ['launch workers', 'scientists'], hatedBy: ['corridor towns', 'regional nationalists'] },
  'law-wage': { policyKind: 'basic_income', precedentIds: ['alaska_pfd', 'mincome', 'yellow_vests'], lovedBy: ['low income', 'young adults'], hatedBy: ['heavy energy users', 'old energy compact'] },
  'law-curfew': { policyKind: 'assembly_limit', precedentIds: ['hk_mask'], lovedBy: ['bureaucrats', 'military bloc'], hatedBy: ['activists', 'young adults', 'labor front'] },
  'law-care': { policyKind: 'national_service', precedentIds: ['zivildienst'], lovedBy: ['elders', 'families'], hatedBy: ['young adults'] },
}

type ReqSeed = Omit<Requirement, 'progress' | 'unlockedTick'> & { start: number; rate: number }
export const REQUIREMENTS: ReqSeed[] = [
  // mars and beyond
  { id: 'heavy_lift', name: 'reusable heavy lift', track: 'mars', prereqs: [], tier: 'emerging', costUsd: 60e9, start: 0.35, rate: 0.07, realWorld2026: 'fully reusable super heavy launchers are in flight testing, none certified for crew to mars', url: 'https://www.spacex.com/vehicles/starship/' },
  { id: 'life_support', name: 'closed loop life support', track: 'mars', prereqs: [], tier: 'proven', costUsd: 25e9, start: 0.45, rate: 0.05, realWorld2026: 'the iss recovers about 98% of its water, oxygen and food loops are not closed', url: `${W}ISS_ECLSS` },
  { id: 'radiation', name: 'radiation shielding', track: 'mars', prereqs: [], tier: 'emerging', costUsd: 30e9, start: 0.15, rate: 0.04, realWorld2026: 'curiosity measured the deep space dose on the way to mars, no shield cuts it enough for long stays', url: `${W}Radiation_assessment_detector` },
  { id: 'propulsion', name: 'fast transit propulsion', track: 'mars', prereqs: ['heavy_lift'], tier: 'speculative', costUsd: 80e9, start: 0.05, rate: 0.025, realWorld2026: 'nuclear thermal rockets were ground tested in the 1960s, none has flown', url: `${W}NERVA` },
  { id: 'isru', name: 'make fuel and air from mars', track: 'mars', prereqs: ['life_support'], tier: 'emerging', costUsd: 20e9, start: 0.1, rate: 0.035, realWorld2026: 'moxie made about 122 grams of oxygen on mars between 2021 and 2023', url: `${W}Mars_Oxygen_ISRU_Experiment` },
  { id: 'habitats', name: 'surface habitats', track: 'mars', prereqs: ['radiation', 'life_support'], tier: 'emerging', costUsd: 40e9, start: 0.12, rate: 0.03, realWorld2026: 'an inflatable test module has been attached to the iss since 2016', url: `${W}Bigelow_Expandable_Activity_Module` },
  { id: 'space_food', name: 'grow food off world', track: 'mars', prereqs: ['life_support'], tier: 'emerging', costUsd: 8e9, start: 0.2, rate: 0.04, realWorld2026: 'astronauts have grown and eaten small crops of leafy greens on the iss', url: `${W}Vegetable_Production_System` },
  { id: 'space_medicine', name: 'medicine far from earth', track: 'mars', prereqs: ['life_support'], tier: 'emerging', costUsd: 12e9, start: 0.1, rate: 0.03, realWorld2026: 'crews rely on first aid and ground support, no surgery capability on long missions', url: `${W}Space_medicine` },
  { id: 'self_sustaining', name: 'self sustaining population', track: 'mars', prereqs: ['isru', 'habitats', 'space_food', 'space_medicine', 'propulsion'], tier: 'speculative', costUsd: 500e9, start: 0, rate: 0.006, realWorld2026: 'no human settlement exists off earth, estimates of a minimum viable population range widely', url: `${W}Minimum_viable_population` },
  { id: 'asteroid_mining', name: 'asteroid mining', track: 'outer_planets', prereqs: ['propulsion', 'isru'], tier: 'speculative', costUsd: 200e9, start: 0, rate: 0.008, realWorld2026: 'sample return missions brought back grams of asteroid material', url: `${W}OSIRIS-REx` },
  // a healthy 200 year lifespan
  { id: 'cancer', name: 'cancer control', track: 'longevity', prereqs: [], tier: 'emerging', costUsd: 150e9, start: 0.3, rate: 0.03, realWorld2026: 'cancer remains a leading cause of death worldwide', url: 'https://www.who.int/news-room/fact-sheets/detail/cancer' },
  { id: 'cardio', name: 'cardiovascular disease', track: 'longevity', prereqs: [], tier: 'proven', costUsd: 90e9, start: 0.4, rate: 0.035, realWorld2026: 'cardiovascular disease is the top cause of death globally', url: 'https://www.who.int/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)' },
  { id: 'metabolic', name: 'metabolic health', track: 'longevity', prereqs: [], tier: 'proven', costUsd: 40e9, start: 0.35, rate: 0.04, realWorld2026: 'glp-1 drugs cut cardiovascular events in a large 2023 trial of people with obesity', url: `${W}Semaglutide` },
  { id: 'neuro', name: 'neurodegeneration', track: 'longevity', prereqs: [], tier: 'emerging', costUsd: 120e9, start: 0.12, rate: 0.025, realWorld2026: 'antibody drugs approved in 2023 modestly slow early alzheimer decline', url: `${W}Lecanemab` },
  { id: 'gene_therapy', name: 'gene editing therapies', track: 'longevity', prereqs: [], tier: 'emerging', costUsd: 60e9, start: 0.2, rate: 0.035, realWorld2026: 'the first crispr therapy was approved in 2023 for sickle cell disease', url: `${W}Exagamglogene_autotemcel` },
  { id: 'senescence', name: 'clear senescent cells', track: 'longevity', prereqs: ['gene_therapy'], tier: 'speculative', costUsd: 50e9, start: 0.08, rate: 0.025, realWorld2026: 'senolytic drugs are in early human trials', url: `${W}Senolytic` },
  { id: 'immune_aging', name: 'reverse immune aging', track: 'longevity', prereqs: ['senescence'], tier: 'speculative', costUsd: 45e9, start: 0.05, rate: 0.02, realWorld2026: 'small pilot studies tried to regrow the thymus, results unconfirmed', url: `${W}Immunosenescence` },
  { id: 'reprogramming', name: 'epigenetic reprogramming', track: 'longevity', prereqs: ['gene_therapy'], tier: 'speculative', costUsd: 100e9, start: 0.04, rate: 0.018, realWorld2026: 'partial reprogramming rejuvenates cells in mice, no human trials of whole body use', url: `${W}Induced_pluripotent_stem_cell` },
  { id: 'organ_regen', name: 'organ replacement', track: 'longevity', prereqs: ['gene_therapy', 'immune_aging'], tier: 'speculative', costUsd: 120e9, start: 0.06, rate: 0.02, realWorld2026: 'gene edited pig kidneys were transplanted into living patients starting in 2024', url: `${W}Xenotransplantation` },
  { id: 'lifespan_200', name: 'healthy 200 year lifespan', track: 'longevity', prereqs: ['cancer', 'cardio', 'neuro', 'reprogramming', 'organ_regen', 'immune_aging', 'metabolic'], tier: 'speculative', costUsd: 1e12, start: 0, rate: 0.004, realWorld2026: 'the oldest verified human lived to 122', url: `${W}Jeanne_Calment` },
]

export const FACTIONS: (Faction & { did: string[] })[] = [
  { id: 'old_energy', name: 'old energy compact', kind: 'old_energy', regionIds: ['mena', 'eeu', 'nam'], power: 0.62, hostility: 0.45, wants: 'keep fossil revenue flowing while the grid changes', did: ['lobbied to delay the one grid law', 'funded ads against the energy levy'] },
  { id: 'faith_council', name: 'religious council', kind: 'religious', regionIds: ['mena', 'wca', 'sas', 'mes'], power: 0.5, hostility: 0.3, wants: 'a voice in what schools teach', did: ['organized prayer vigils during the famine', 'opposed the neutral faith law'] },
  { id: 'corridor_first', name: 'corridor first', kind: 'regional_nationalist', regionIds: ['sam'], power: 0.35, hostility: 0.55, wants: 'local control of land taken for launch pads', did: ['blocked pad construction roads', 'ran candidates on a land back platform'] },
  { id: 'labor_front', name: 'labor front', kind: 'labor', regionIds: ['sas', 'eas', 'wca'], power: 0.55, hostility: 0.35, wants: 'the floor wage indexed to food prices', did: ['called the corridor strike', 'negotiated shorter shifts at the fuel plants'] },
  { id: 'chamber', name: 'merchant chamber', kind: 'business', regionIds: ['nam', 'weu', 'eas'], power: 0.6, hostility: 0.2, wants: 'stable rules and contracts for the space build', did: ['bid on habitat contracts', 'pushed for lower energy levies'] },
  { id: 'science_guild', name: 'science guild', kind: 'science', regionIds: ['weu', 'eas', 'nam', 'oce'], power: 0.4, hostility: 0.05, wants: 'research budget protected from election cycles', did: ['published the life support roadmap', 'staffed the corridor labs'] },
  { id: 'iron_bloc', name: 'iron bloc', kind: 'military', regionIds: ['eeu', 'mena'], power: 0.45, hostility: 0.4, wants: 'security budget kept above a fifth of spending', did: ['enforced quiet hours in two regions'] },
]

export const COMPANY_SEEDS: (Omit<Company, 'id' | 'workers' | 'foundedTick'> & { year: number; growth: number })[] = [
  { name: 'long table foods', sector: 'food', regionId: 'esa', purpose: 'drought resistant staples and regional silos', year: 3, growth: 1.6 },
  { name: 'lattice grid works', sector: 'energy', regionId: 'mena', purpose: 'solar fields and long distance lines', year: 2, growth: 1.5 },
  { name: 'corridor lift', sector: 'launch', regionId: 'sam', purpose: 'reusable boosters for the equatorial pads', year: 4, growth: 1.7 },
  { name: 'second spring bio', sector: 'longevity', regionId: 'weu', purpose: 'senolytic and gene therapy trials', year: 5, growth: 1.4 },
  { name: 'tidewall homes', sector: 'housing', regionId: 'sea', purpose: 'storm proof housing after the typhoon', year: 6, growth: 1.5 },
  { name: 'ferrous bloom', sector: 'materials', regionId: 'oce', purpose: 'light alloys for habitats', year: 7, growth: 1.3 },
]

export const CITY_SEEDS = [
  { year: 4, name: 'corridor one', regionId: 'sam', lat: -3, lon: -52, reason: 'launch corridor workforce near the equatorial pads' },
  { year: 6, name: 'highwater', regionId: 'sea', lat: 14, lon: 106, reason: 'resettle typhoon survivors on higher ground' },
  { year: 7, name: 'meridian labs', regionId: 'oce', lat: -31, lon: 136, reason: 'dark sky observatories and habitat testing' },
]

export const LESSONS: Lesson[] = [
  { id: 'l1', fromRunId: 'mock-g0-0003', generation: 0, mistake: 'cut food below 12% of the budget to fund launches', consequence: 'famine in two regions within three years', rule: 'never fund space by cutting food below 15%', timesRelevant: 4 },
  { id: 'l2', fromRunId: 'mock-g0-0011', generation: 0, mistake: 'banned assemblies everywhere at once', consequence: 'protests tripled and compliance collapsed', rule: 'limits on assembly backfire, publish reasons instead', timesRelevant: 3 },
  { id: 'l3', fromRunId: 'mock-g1-0004', generation: 1, mistake: 'moved 300 million people in one year', consequence: 'camps overflowed, a fever spread', rule: 'move people in waves no larger than housing built that year', timesRelevant: 2 },
  { id: 'l4', fromRunId: 'mock-g1-0019', generation: 1, mistake: 'shut down the public ledger during unrest', consequence: 'trust fell and rumors ran the news cycle', rule: 'keep the ledger open especially when it hurts', timesRelevant: 2 },
  { id: 'l5', fromRunId: 'mock-g2-0008', generation: 2, mistake: 'ignored the grid until year eight', consequence: 'every research track stalled on power', rule: 'energy before research before launch', timesRelevant: 1 },
  { id: 'l6', fromRunId: 'mock-g2-0031', generation: 2, mistake: 'treated outrage as a messaging problem', consequence: 'the corridor towns stopped all construction', rule: 'outrage fades, real losses do not, compensate the losers', timesRelevant: 1 },
]

export const LEARNING_CURVE = [
  { generation: 0, bestScore: 0.08 }, { generation: 1, bestScore: 0.21 }, { generation: 2, bestScore: 0.34 }, { generation: 3, bestScore: 0.52 },
]
