// one month of the world, decision application, and public snapshots.
import type { BaselineFrame, Decision, Frame, Law, Region } from '../types'
import { dateOf } from './constants'
import { stepDemography } from './biology'
import { migrateCitizens } from './citizens'
import { checkEnd } from './end'
import { stepEvents } from './events'
import { allocate, monthlyRevenue, scheduleMigrations, stepArrivals, stepEconomy, stepEnergy, stepFood, type ScheduledMigration } from './physics'
import { stepLaws, stepSociety } from './society'
import { moonProgress, stepSpace } from './space'
import { clamp, effectiveBudget, event, normalizeBudget, regionPop, sum, type World } from './state'

export const MAX_LAWS_PER_DECISION = 5
export const MAX_ACTIVE_LAWS = 25

export function stepWorld(w: World) {
  if (w.status !== 'alive') return
  const { space, research } = allocate(w)
  const fx = stepLaws(w)
  stepEvents(w)
  stepEnergy(w, fx)
  stepFood(w, fx)
  const popBefore = w.regions.map(regionPop)
  stepDemography(w, fx)
  const arrivals = w.transit.filter(t => t.arriveTick <= w.tick)
  stepArrivals(w)
  stepEconomy(w, popBefore)
  stepSociety(w, fx, research)
  const landed = stepSpace(w, space, research)
  w.tick++
  derive(w)
  for (const t of arrivals) migrateCitizens(w, t.from, t.to, t.people)
  checkEnd(w, landed)
}

// sync public Region fields from internal state
export function derive(w: World) {
  for (const rs of w.regions) {
    const pop = regionPop(rs)
    rs.r.population = Math.round(pop)
    rs.r.share65plus = pop ? sum(rs.bands.slice(13)) / pop : 0
  }
}

export function applyDecision(w: World, d: Decision): { migrations: ScheduledMigration[] } {
  // repeals first, then new laws
  if (d.repeal.length) {
    const gone = w.laws.filter(l => d.repeal.includes(l.id))
    w.laws = w.laws.filter(l => !d.repeal.includes(l.id))
    for (const l of gone) event(w, { kind: 'law', text: `repealed: ${l.title}`, severity: 0.1 })
  }
  const fresh: Law[] = d.laws.slice(0, MAX_LAWS_PER_DECISION).map((l, i) => ({
    ...l, id: l.id && !w.laws.some(x => x.id === l.id) ? l.id : `L${w.tick}-${i}`, enactedTick: w.tick, support: 0.5, compliance: 0.5, vetoed: false,
  }))
  w.laws.push(...fresh)
  // oldest laws lapse past the cap
  while (w.laws.length > MAX_ACTIVE_LAWS) w.laws.shift()
  for (const l of fresh) event(w, { kind: 'law', text: `enacted: ${l.title}`, severity: 0.2 })
  w.budget = normalizeBudget(d.budget)
  w.forcedBudget = undefined
  if (d.religionPolicy !== w.religionPolicy) event(w, { kind: 'law', text: `religion policy changed from ${w.religionPolicy} to ${d.religionPolicy}`, severity: 0.3 })
  w.religionPolicy = d.religionPolicy
  w.schoolPolicy = { purpose: d.schoolPolicy.purpose, curriculum: [...d.schoolPolicy.curriculum].slice(0, 12), yearsRequired: clamp(Math.round(d.schoolPolicy.yearsRequired), 0, 16) }
  stepLaws(w) // fresh laws get real support numbers immediately
  const migrations = scheduleMigrations(w, d.migrations, monthlyRevenue(w), effectiveBudget(w).welfare)
  return { migrations }
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4

export function publicRegions(w: World): Region[] {
  return w.regions.map(rs => ({
    ...rs.r,
    gdpUsd: Math.round(rs.r.gdpUsd), energyTWh: Math.round(rs.r.energyTWh * 10) / 10, foodKcalPerCapita: Math.round(rs.r.foodKcalPerCapita),
    share65plus: r4(rs.r.share65plus), education: r4(rs.r.education), faith: r4(rs.r.faith), unrest: r4(rs.r.unrest),
    techLevel: r4(rs.r.techLevel), compliance: r4(rs.r.compliance), provenance: rs.r.provenance,
  }))
}

export function snapshot(w: World, newEvents: Frame['newEvents'], decision?: Decision): Frame {
  return {
    tick: w.tick, date: dateOf(w.tick), regions: publicRegions(w),
    citizens: w.citizens.map(c => ({ ...c })),
    laws: w.laws.map(l => ({ ...l, support: r4(l.support), compliance: r4(l.compliance) })),
    budget: { ...effectiveBudget(w) }, religionPolicy: w.religionPolicy, schoolPolicy: { ...w.schoolPolicy, curriculum: [...w.schoolPolicy.curriculum] },
    moonStage: w.space.stage, moonProgress: r4(moonProgress(w.space)), status: w.status, newEvents,
    ...(decision ? { decision } : {}),
  }
}

export function baselineFrame(w: World): BaselineFrame {
  return {
    tick: w.tick,
    regions: w.regions.map(rs => ({ id: rs.r.id, population: Math.round(rs.r.population), foodKcalPerCapita: Math.round(rs.r.foodKcalPerCapita), unrest: r4(rs.r.unrest), techLevel: r4(rs.r.techLevel), education: r4(rs.r.education) })),
    moonProgress: r4(moonProgress(w.space)), status: w.status,
  }
}
