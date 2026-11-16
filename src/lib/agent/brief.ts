// the observation the governor sees. only public state: no rng, no future events, no hidden formulas
// beyond the published rules of the world.
import { housingLine } from '../sim/housing'
import { dailyLines } from '../sim/daily'
import { powerLines } from '../sim/power'
import { physicalLines } from '../sim/physical'
import type { Override, WorldEvent } from '../types'
import { dateOf } from '../sim/constants'
import { monthlyRevenue } from '../sim/physics'
import { SPACE_ABSORB_USD_YEAR, STAGE_SPECS, STAGES, globalTech, moonProgress, nextSpec } from '../sim/space'
import { effectiveBudget, popWeighted, regionPop, worldPop, type World } from '../sim/state'
import { globalPLE, popTrend } from '../sim/end'
import { DOSE_LIMIT_SV, SYNODIC_MONTHS, lifeSupportClosure, missionDoseSv } from '../sim/requirements'
import { frontierAbsorbCap } from '../sim/frontier'

export type Brief = ReturnType<typeof buildBrief>

const r2 = (x: number) => Math.round(x * 100) / 100

export function buildBrief(w: World, overridesSinceLast: Override[], lastRationale: string | undefined) {
  const recent: WorldEvent[] = w.events.filter(e => e.tick >= w.tick - 12 && e.kind !== 'law')
  const spec = nextSpec(w.space)
  return {
    date: dateOf(w.tick),
    tick: w.tick,
    monthsLeft: 1200 - w.tick,
    world: {
      population: Math.round(worldPop(w)),
      peakPopulation: Math.round(w.peakPop),
      foodKcalPerCapita: Math.round(popWeighted(w, r => r.r.foodKcalPerCapita)),
      unrest: r2(popWeighted(w, r => r.r.unrest)),
      techLevel: r2(globalTech(w)),
      yearlyRevenueUsd: Math.round(monthlyRevenue(w) * 12),
      regionsInRevolt: w.regions.filter(r => r.inRevolt).map(r => r.r.id),
      seceded: w.regions.filter(r => r.seceded).map(r => r.r.id),
      warTension: r2(w.warTension),
      periodLifeExpectancy: Math.round(globalPLE(w) * 10) / 10,
      populationTrend10y: r2(popTrend(w)),
      approval: r2(w.humanCost.approval),
      humanCost: { deaths: Math.round(w.humanCost.deaths), famineDeaths: Math.round(w.humanCost.famineDeaths), displaced: Math.round(w.humanCost.displaced) },
    },
    frontier: {
      reached: w.frontier, achieved: w.frontierState.achieved, fundUsd: Math.round(w.frontierState.fund), marsPopulation: Math.round(w.frontierState.marsPop),
      nextMarsWindowInMonths: Math.ceil(SYNODIC_MONTHS - (w.tick % SYNODIC_MONTHS)), crewDoseSv: r2(missionDoseSv(w)), doseLimitSv: DOSE_LIMIT_SV,
      lifeSupportClosure: Math.round(lifeSupportClosure(w) * 1000) / 1000, usefulSpaceSpendPerYearAfterMoon: Math.round(frontierAbsorbCap(w, 0)),
    },
    requirements: w.requirements.filter(r => r.progress < 1 && r.prereqs.every(p => (w.requirements.find(x => x.id === p)?.progress ?? 0) >= 1))
      .map(r => ({ id: r.id, track: r.track, tier: r.tier, progress: r2(r.progress), costUsd: r.costUsd, stalled: r.stall !== 'none' })),
    requirementsDone: w.requirements.filter(r => r.progress >= 1).map(r => r.id),
    cities: w.cities.map(c => ({ name: c.name, region: c.regionId, population: c.population, offWorld: c.offWorld ?? null })),
    companies: w.companies.filter(c => !c.failed).map(c => ({ name: c.name, sector: c.sector, region: c.regionId, workers: c.workers })),
    factions: w.factions.map(f => ({ id: f.id, kind: f.kind, power: r2(f.power), hostility: r2(f.hostility), wants: f.wants })),
    regions: w.regions.map(rs => ({
      id: rs.r.id, name: rs.r.name,
      population: Math.round(regionPop(rs)),
      gdpPerCapitaUsd: Math.round(rs.r.gdpUsd / Math.max(rs.r.population, 1)),
      foodKcalPerCapita: Math.round(rs.r.foodKcalPerCapita),
      energyDemandMet: r2(rs.energyRatio),
      education: r2(rs.r.education), faith: r2(rs.r.faith), unrest: r2(rs.r.unrest),
      techLevel: r2(rs.r.techLevel), compliance: r2(rs.r.compliance), share65plus: r2(rs.r.share65plus),
      inRevolt: rs.inRevolt, seceded: rs.seceded,
      approval: r2(rs.r.approval), periodLifeExpectancy: Math.round(rs.periodLE * 10) / 10, fertility: r2(rs.r.fertility),
      crowds: rs.crowds.filter(c => c.phase !== 'unaware').map(c => `${c.topic}: ${c.phase} ${r2(c.intensity)}`),
    })),
    moon: {
      stage: w.space.stage,
      nextStage: spec?.stage ?? null,
      progress: r2(moonProgress(w.space)),
      nextStageNeeds: spec ? { techLevel: spec.techGate, stageSpendUsd: spec.costUsd, spentSoFarUsd: Math.round(w.space.stageSpend), minMonths: spec.minMonths, monthsSoFar: w.space.stageMonths } : null,
      stagesRemaining: STAGE_SPECS.slice(STAGES.indexOf(w.space.stage)).map(s => ({ stage: s.stage, techLevel: s.techGate, costUsd: s.costUsd, minMonths: s.minMonths })),
      maxUsefulSpaceSpendUsdPerYear: SPACE_ABSORB_USD_YEAR,
      launchFailures: w.space.failures,
      crewKilled: w.crewDeaths,
    },
    budget: effectiveBudget(w),
    religionPolicy: w.religionPolicy,
    schoolPolicy: w.schoolPolicy,
    laws: w.laws.map(l => ({ id: l.id, title: l.title, layer: l.layer, policyKind: l.policyKind, enactedTick: l.enactedTick, support: r2(l.support), compliance: r2(l.compliance), vetoed: !!l.vetoed, hatedBy: l.hatedBy })),
    recentEvents: recent.slice(-30).map(e => ({ date: dateOf(e.tick), kind: e.kind, region: e.regionId, text: e.text, severity: r2(e.severity) })),
    overridesSinceLastDecision: overridesSinceLast,
    lastRationale: lastRationale ?? null,
  }
}

// ---------- compact text brief for the llm (~2k tokens) ----------
const p2 = (x: number) => x.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.')
const usd = (x: number) => (x >= 1e12 ? `$${(x / 1e12).toFixed(1)}T` : x >= 1e9 ? `$${(x / 1e9).toFixed(0)}B` : `$${(x / 1e6).toFixed(0)}M`)
const ppl = (x: number) => (x >= 1e9 ? `${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `${(x / 1e6).toFixed(0)}M` : `${Math.round(x)}`)

function briefLines(w: World, b: Brief, cut: number): string[] {
  const L: string[] = []
  const wd = b.world
  L.push(`date ${b.date} (tick ${b.tick}), ${b.monthsLeft} months to the 2126 horizon. revenue ${usd(wd.yearlyRevenueUsd)}/yr.`)
  L.push(`world: pop ${ppl(wd.population)} (peak ${ppl(wd.peakPopulation)}, 10y trend ${(wd.populationTrend10y * 100).toFixed(1)}%), food ${wd.foodKcalPerCapita} kcal, unrest ${p2(wd.unrest)}, approval ${p2(wd.approval)}, tech ${p2(wd.techLevel)}, life expectancy ${wd.periodLifeExpectancy}, war tension ${p2(wd.warTension)}, in revolt: ${wd.regionsInRevolt.join(' ') || 'none'}, seceded: ${wd.seceded.join(' ') || 'none'}. human cost so far: ${ppl(wd.humanCost.deaths)} excess deaths (${ppl(wd.humanCost.famineDeaths)} hunger), ${ppl(wd.humanCost.displaced)} displaced.`)
  L.push(`budget now: ${Object.entries(b.budget).map(([k, v]) => `${k} ${p2(v)}`).join(' ')}. religion ${b.religionPolicy}. school: ${b.schoolPolicy.purpose} (${b.schoolPolicy.yearsRequired} yrs: ${b.schoolPolicy.curriculum.join(', ')}).`)
  L.push('regions: id pop kcal unrest approval lifeExp fertility edu tech compliance powerMet | loudest crowd')
  for (const r of b.regions) {
    const rs = w.regions.find(x => x.r.id === r.id)!
    const crowd = rs.crowds.filter(c => c.phase !== 'unaware').sort((x, y) => y.intensity - x.intensity)[0]
    L.push(`${r.id} ${ppl(r.population)} ${r.foodKcalPerCapita} ${p2(r.unrest)} ${p2(r.approval)} ${r.periodLifeExpectancy} ${r.fertility.toFixed(1)} ${p2(r.education)} ${p2(r.techLevel)} ${p2(r.compliance)} ${p2(r.energyDemandMet)}${r.inRevolt ? ' REVOLT' : ''}${r.seceded ? ' SECEDED' : ''} | ${crowd ? `${crowd.topic} (${crowd.phase})` : '-'}`)
  }
  const m = b.moon
  L.push(`moon program: ${m.stage}${m.nextStageNeeds ? `, next ${m.nextStage} needs tech ${m.nextStageNeeds.techLevel} (world ${p2(wd.techLevel)}), ${usd(m.nextStageNeeds.stageSpendUsd)} (spent ${usd(m.nextStageNeeds.spentSoFarUsd)}), ${m.nextStageNeeds.minMonths} months (${m.nextStageNeeds.monthsSoFar} so far)` : ''}. useful space spend max ${usd(m.maxUsefulSpaceSpendUsdPerYear)}/yr before the landing. launch failures ${m.launchFailures}, crew killed ${m.crewKilled}.`)
  const f = b.frontier
  L.push(`frontier: ${f.reached} (achieved: ${f.achieved.join(', ') || 'none'}). fund ${usd(f.fundUsd)}, mars pop ${f.marsPopulation}, next mars window in ${f.nextMarsWindowInMonths} months, crew dose ${f.crewDoseSv} Sv (limit ${f.doseLimitSv}), life support closure ${(f.lifeSupportClosure * 100).toFixed(1)}%.`)
  const open = b.requirements.slice().sort((x, y) => y.progress - x.progress).slice(0, cut >= 2 ? 6 : 14)
  L.push(`open requirements (id tier progress): ${open.map(r => `${r.id} ${r.tier[0]} ${p2(r.progress)}${r.stalled ? ' STALLED' : ''}`).join('; ')}`)
  L.push(`done: ${b.requirementsDone.join(', ') || 'none'}`)
  // countries: the 10 that moved most since last year (one line, the brief stays region-level)
  const moved = w.countries.filter(c => c.hist.length >= 2).map(c => { const a = c.hist[c.hist.length - 2], b = c.hist[c.hist.length - 1]; return { c, dl: b.livability - a.livability, dp: b.population / Math.max(a.population, 1) - 1 } })
    .sort((x, y) => Math.abs(y.dl) + Math.abs(y.dp) - Math.abs(x.dl) - Math.abs(x.dp)).slice(0, 10)
  if (moved.length) L.push(`countries moving most: ${moved.map(m => `${m.c.name} livability ${m.dl >= 0 ? '+' : ''}${Math.round(m.dl * 100)}pt${m.c.damage > 0.1 ? ' (damaged)' : ''}`).join(', ')}`)
  L.push(`climate: +${w.climate.anomalyC.toFixed(2)} C, ${w.climate.gtPerYear.toFixed(1)} Gt CO2 a year`)
  const hl = housingLine(w)
  if (hl) L.push(hl)
  L.push(...dailyLines(w))
  L.push(...powerLines(w))
  L.push(...physicalLines(w))
  // what health and social spending is doing to deaths, so a governor can see the cost of cutting it
  if (Math.abs(w.welfareDeathsYear) > 1e5) L.push(`health and social spending vs 2026: ${w.welfareDeathsYear > 0 ? `cuts cost ~${(w.welfareDeathsYear / 1e6).toFixed(1)}M extra deaths` : `~${(-w.welfareDeathsYear / 1e6).toFixed(1)}M lives saved`} last year`)
  // crowding: growth since 2026 in regions without a new city (one line)
  const crowded = w.regions.filter(rs => !w.cities.some(c => c.regionId === rs.r.id && !c.offWorld) && rs.r.population > rs.pop0 * 1.05).map(rs => `${rs.r.id} +${Math.round((rs.r.population / rs.pop0 - 1) * 100)}%`)
  if (crowded.length) L.push(`growing with no new city since 2026: ${crowded.join(', ')}`)
  if (w.lastConverted.length) L.push(`last time, new laws in covered kinds became amendments: ${w.lastConverted.join('; ')}`)
  if (w.lastRepeated.length) L.push(`last time these changed nothing: ${w.lastRepeated.map(t => `"${t}"`).join(', ')}`)
  if (b.cities.length) L.push(`cities: ${b.cities.map(c => `${c.name} (${c.offWorld ?? c.region}, ${ppl(c.population)})`).join('; ')}`)
  if (b.companies.length) L.push(`companies: ${b.companies.map(c => `${c.name} ${c.sector} ${c.region} ${ppl(c.workers)}`).join('; ')}`)
  L.push(`factions power/hostility: ${b.factions.map(x => `${x.id} ${p2(x.power)}/${p2(x.hostility)}`).join(', ')}`)
  // active laws by short id (L1, L2...): amend or repeal them by that id; one active law per policy kind
  const active = b.laws.filter(l => !l.vetoed)
  L.push('ACTIVE LAWS (short id | title | kind | support | compliance):')
  active.forEach((l, k) => { if (cut >= 3 && k < active.length - 8) return; L.push(`L${k + 1} | ${l.title} | ${l.policyKind} | ${p2(l.support)} | ${p2(l.compliance)}`) })
  if (active.length) L.push(`kinds already covered (amend these, do not add new ones): ${[...new Set(active.map(l => l.policyKind))].join(', ')}`)
  const ev = w.events.filter(e => e.tick >= w.tick - 12 && e.significance >= (cut >= 1 ? 0.6 : 0.4) && e.kind !== 'law').slice(cut >= 1 ? -5 : -12)
  L.push(`events, last 12 months, significance >= .4: ${ev.length ? '' : 'none'}`)
  for (const e of ev) L.push(`${dateOf(e.tick)} ${e.kind}${e.regionId ? ` ${e.regionId}` : ''}: ${e.text}`)
  L.push(`overrides since last decision: ${b.overridesSinceLastDecision.length ? JSON.stringify(b.overridesSinceLastDecision) : 'none'}`)
  if (b.lastRationale && cut < 4) L.push(`your last rationale: ${b.lastRationale.slice(0, 500)}`)
  return L
}

// hard cap: ~2,000 tokens. ESTIMATE ~3.6 characters per token for this mixed text/number brief (llama/qwen
// tokenizers). if over, compress step by step: older events, open requirements, oldest laws, last rationale.
export const BRIEF_TOKEN_CAP = 2000
export const estimateTokens = (s: string) => Math.ceil(s.length / 3.6)
export const briefStats = { calls: 0, maxTokens: 0, totalTokens: 0, compressed: 0 }
export function briefText(w: World, b: Brief): string {
  let text = ''
  for (let cut = 0; cut <= 4; cut++) {
    text = briefLines(w, b, cut).join('\n')
    if (estimateTokens(text) <= BRIEF_TOKEN_CAP) { if (cut) briefStats.compressed++; break }
  }
  const t = estimateTokens(text)
  briefStats.calls++; briefStats.totalTokens += t; briefStats.maxTokens = Math.max(briefStats.maxTokens, t)
  return text
}

// short id (L1, L2...) -> real law id, in the order the brief lists them
export function shortIdMap(w: World): Map<string, string> {
  return new Map(w.laws.filter(l => !l.vetoed).map((l, k) => [`L${k + 1}`, l.id]))
}
