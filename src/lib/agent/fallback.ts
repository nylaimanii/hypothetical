// deterministic offline governor, used only when no GROQ_API_KEY is configured. it reads the same brief
// the llm gets and follows simple published rules, so runs stay reproducible without a model.
import type { Budget, Decision, Law, Override } from '../types'
import { normalizeBudget } from '../sim/state'
import type { Brief } from './brief'

export function offlineDecision(b: Brief, overrides: Override[], vetoedTitles: Set<string>): Decision {
  const minKcal = Math.min(...b.regions.filter(r => !r.seceded).map(r => r.foodKcalPerCapita))
  const worstEnergy = Math.min(...b.regions.filter(r => !r.seceded).map(r => r.energyDemandMet))
  const rev = Math.max(b.world.yearlyRevenueUsd, 1)
  const budget: Budget = {
    space: Math.min(0.03, b.moon.maxUsefulSpaceSpendUsdPerYear / rev),
    research: 0.08,
    education: 0.15,
    food: 0.035 + (minKcal < 2300 ? 0.04 : 0) + (minKcal < 2000 ? 0.04 : 0),
    energy: 0.05 + (worstEnergy < 0.97 ? 0.03 : 0),
    security: 0.11,
    welfare: 0,
  }
  budget.welfare = Math.max(0.3, 1 - (budget.space + budget.research + budget.education + budget.food + budget.energy + budget.security))
  if (b.world.unrest > 0.45) { budget.welfare += 0.05; budget.research -= 0.02 }

  const laws: Law[] = []
  const propose = (title: string, text: string, layer: Law['layer']) => {
    if (vetoedTitles.has(title.toLowerCase()) || b.laws.some(l => l.title === title)) return
    laws.push({ id: '', title, text, layer, enactedTick: b.tick, support: 0, compliance: 0, policyKind: '', precedentIds: [], lovedBy: [], hatedBy: [] })
  }
  propose('World Research and Lunar Program Act', 'Funds universities, research laboratories and a civilian lunar program open to every region.', 'tech')
  if (minKcal < 2500) propose('Universal Food Security Program', 'Food aid and farm subsidies for regions with low food supply, paid from the world budget.', 'economy')
  if (worstEnergy < 0.97) propose('Grid Expansion Act', 'Builds solar, wind and grid capacity where electricity demand is not met.', 'physics')

  // repeal laws that most people reject and nobody follows
  const repeal = b.laws.filter(l => !l.vetoed && l.support < 0.3 && l.compliance < 0.25).map(l => l.id)

  const notes: string[] = []
  for (const o of overrides) {
    if (o.kind === 'veto_law') notes.push(`the observer vetoed ${o.lawId}; it stays off and will not be re-proposed`)
    if (o.kind === 'inject_event') { notes.push(`responding to an injected ${o.eventKind ?? 'event'}${o.regionId ? ` in ${o.regionId}` : ''} with more welfare`); budget.welfare += 0.03 }
    if (o.kind === 'force_budget') notes.push('the observer forced a budget; this decision takes the budget back but keeps their priorities in view')
  }
  // research focus: the cheapest open nodes on the path to mars and longer lives
  const open = b.requirements.filter(r => !r.stalled && (r.track === 'mars' || r.track === 'longevity' || r.id === 'super_heavy_lift' || r.id === 'orbital_refueling'))
  const researchFocus = open.sort((x, y) => (y.progress - x.progress) || x.id.localeCompare(y.id)).slice(0, 4).map(r => r.id)
  // one city per decade in the region with the most people per city, on a mid-latitude site (ESTIMATE heuristic)
  const foundCities = b.tick % 120 === 0 && b.tick > 0 && b.cities.length < 6
    ? [{ name: `${['harbor', 'ridge', 'meadow', 'lantern', 'cedar', 'delta'][b.cities.length]} city`, regionId: b.regions.slice().sort((x, y) => y.population - x.population)[0].id, lat: 26, lon: 80, reason: 'room for a growing population near water and power' }]
    : []
  const charterCompanies = b.tick === 0 ? [{ name: 'long horizon medicine', sector: 'medicine' as const, regionId: 'europe', purpose: 'trials for the leading causes of death' }, { name: 'tall stack launch', sector: 'launch' as const, regionId: 'na', purpose: 'reusable heavy lift for the moon and mars' }] : []
  return {
    tick: b.tick, laws, repeal, migrations: [], foundCities, charterCompanies, researchFocus,
    publicStatement: 'Food and power first, then medicine, then the stars. Nothing here comes free.', lessonsApplied: [],
    budget: normalizeBudget(budget),
    religionPolicy: 'free',
    schoolPolicy: { purpose: 'science literacy and skilled work', curriculum: ['literacy', 'mathematics', 'science', 'engineering', 'computer science', 'history'], yearsRequired: 12 },
    rationale: `offline governor (no llm configured): fund research and a lunar program at the most a program can absorb, protect food and power where they are short, keep welfare high enough to hold unrest down.${notes.length ? ' ' + notes.join('; ') + '.' : ''}`,
    respondedToOverrides: overrides.map(o => o.id),
  }
}
