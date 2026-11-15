// the observation the governor sees. only public state: no rng, no future events, no hidden formulas
// beyond the published rules of the world.
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
