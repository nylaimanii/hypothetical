// one month of the world, decision application, and public snapshots.
import type { BaselineFrame, Decision, Frame, Law, Region, Why } from '../types'
import { dateOf } from './constants'
import { addCrowd, stepRegionBehavior } from './behavior'
import { stepDemography, stepMedicine } from './biology'
import { migrateCitizens } from './citizens'
import { charterCompanies, foundCities, sectorStrength, stepCities, stepCompanies, stepTravel } from './cities'
import { checkEnd, globalPLE } from './end'
import { stepEvents } from './events'
import { onLawEnacted, stepFactions } from './factions'
import { stepFrontier } from './frontier'
import { allocate, monthlyRevenue, scheduleMigrations, stepArrivals, stepEconomy, stepEnergy, stepFood, type ScheduledMigration } from './physics'
import { lawMeta, publicPrecedents } from './precedents'
import { publicRequirements, reqProgress, stepRequirements } from './requirements'
import { religionBacklash, stepLaws, stepSociety } from './society'
import { moonProgress, stepSpace } from './space'
import { atmosphere, emotionsOf, landmarkForLaw, regionVisual, stepVisuals } from './visuals'
import { clamp, effectiveBudget, event, normalizeBudget, popWeighted, regionPop, sum, worldPop, type World } from './state'

export const MAX_LAWS_PER_DECISION = 5
export const MAX_ACTIVE_LAWS = 25
// ESTIMATE: half the research budget funds the requirement tree, half general tech (techLevel)
const TREE_SHARE = 0.5

const ERADICATION: [string, string][] = [['malaria_eradication', 'malaria'], ['tb_eradication', 'tuberculosis'], ['hiv_cure', 'hiv'], ['polio_endgame', 'polio']]

export function stepWorld(w: World) {
  if (w.status !== 'alive') return
  for (const rs of w.regions) rs.whyAcc = rs.whyAcc ?? {}
  const eventsBefore = w.events.length
  const { space, research } = allocate(w)
  const sectors = sectorStrength(w)
  const fx = stepLaws(w)
  stepEvents(w)
  stepEnergy(w, fx, sectors)
  stepFood(w, fx, sectors)
  stepMedicine(w, sectors.medicine + 0.5 * sectors.longevity)
  const popBefore = w.regions.map(regionPop)
  stepDemography(w, fx)
  const arrivals = w.transit.filter(t => t.arriveTick <= w.tick)
  stepArrivals(w)
  // behavior before society: crowds and moods feed unrest
  const outrage: Record<string, number> = {}
  for (const rs of w.regions) {
    const rb = religionBacklash(w.religionPolicy, rs.r.faith)
    outrage[rs.r.id] = stepRegionBehavior(w, rs, fx[rs.r.id]?.backlash ?? 0, rb).outrage
  }
  stepEconomy(w, popBefore)
  stepSociety(w, fx, research * (1 - TREE_SHARE) * (1 + 0.3 * sectors.computing), outrage)
  stepFactions(w)
  stepCompanies(w)
  stepCities(w)
  stepTravel(w, sectors.transit)
  stepVisuals(w, sectors.transit)
  stepRequirements(w, research * TREE_SHARE, w.researchFocus, popWeighted(w, r => r.r.education), sectors)
  for (const [id, name] of ERADICATION) if (reqProgress(w, id) >= 1 && !w.diseasesEradicated.includes(name)) {
    w.diseasesEradicated.push(name)
    event(w, { kind: 'breakthrough', text: `${name} is eradicated [milestone: eradicated ${name}]`, severity: 0.7 })
  }
  // launch companies make the moon program cheaper to absorb and less failure prone
  stepSpace(w, space * (1 + 0.3 * sectors.launch), research)
  stepFrontier(w, space, research, sectors.launch)
  // big problems become crowd topics (issue-attention cycle): where they hit, or everywhere if global
  for (const e of w.events.slice(eventsBefore)) {
    const big = (e.kind === 'famine' || e.kind === 'pandemic' || e.kind === 'war' || e.kind === 'disaster' || (e.kind === 'launch' && /fail/.test(e.text))) && e.severity >= 0.3
    if (!big) continue
    const topic = e.kind === 'launch' ? 'the failed launch' : e.kind === 'pandemic' ? 'the new pandemic' : e.kind === 'famine' ? 'the food shortage' : e.kind === 'war' ? 'the fighting' : 'the disaster response'
    for (const rs of w.regions) if (!e.regionId || rs.r.id === e.regionId) addCrowd(rs, w, { topic, peak: e.severity * (e.regionId ? 1 : 0.7), outrageMonths: e.kind === 'famine' ? 6 : 3 })
  }
  w.tick++
  derive(w)
  for (const t of arrivals) { migrateCitizens(w, t.from, t.to, t.people); w.humanCost.displaced += t.people }
  checkEnd(w)
}

// sync public Region fields from internal state
export function derive(w: World) {
  for (const rs of w.regions) {
    const pop = regionPop(rs)
    rs.r.population = Math.round(pop)
    rs.r.share65plus = pop ? sum(rs.bands.slice(13)) / pop : 0
    rs.r.periodLifeExpectancy = Math.round(rs.periodLE * 10) / 10
    rs.r.lifeExpectancy = Math.round(rs.cohortLE * 10) / 10
    rs.r.diseaseBurden = Math.round(rs.diseaseBurden * 1e4) / 1e4
    rs.r.crowds = rs.crowds.map(c => ({ topic: c.topic, phase: c.phase, intensity: Math.round(c.intensity * 1e4) / 1e4, sinceTick: c.sinceTick }))
  }
  w.humanCost.approval = popWeighted(w, r => r.r.approval)
}

export function applyDecision(w: World, d: Decision): { migrations: ScheduledMigration[] } {
  if (d.repeal.length) {
    const gone = w.laws.filter(l => d.repeal.includes(l.id))
    w.laws = w.laws.filter(l => !d.repeal.includes(l.id))
    for (const l of gone) event(w, { kind: 'law', text: `repealed: ${l.title}`, severity: 0.1 })
  }
  const fresh: Law[] = d.laws.slice(0, MAX_LAWS_PER_DECISION).map((l, i) => {
    const meta = lawMeta(l)
    const id = l.id && !w.laws.some(x => x.id === l.id) ? l.id : `L${w.tick}-${i}`
    w.lawMeta[id] = meta
    return { ...l, id, enactedTick: w.tick, support: 0.5, compliance: 0.5, vetoed: false, policyKind: meta.policyKind, precedentIds: meta.precedentIds, lovedBy: meta.lovedBy, hatedBy: meta.hatedBy }
  })
  w.laws.push(...fresh)
  while (w.laws.length > MAX_ACTIVE_LAWS) w.laws.shift()
  w.budget = normalizeBudget(d.budget)
  w.forcedBudget = undefined
  if (d.religionPolicy !== w.religionPolicy) event(w, { kind: 'law', text: `religion policy changed from ${w.religionPolicy} to ${d.religionPolicy}`, severity: 0.3 })
  w.religionPolicy = d.religionPolicy
  w.schoolPolicy = { purpose: d.schoolPolicy.purpose, curriculum: [...d.schoolPolicy.curriculum].slice(0, 12), yearsRequired: clamp(Math.round(d.schoolPolicy.yearsRequired), 0, 16) }
  w.researchFocus = (d.researchFocus ?? []).slice(0, 8)
  stepLaws(w) // fresh laws get real support numbers immediately
  // each new law: precedent-sized reaction in every region that dislikes it, factions react
  for (const l of fresh) {
    const meta = w.lawMeta[l.id]
    event(w, { kind: 'law', text: `enacted: ${l.title}${meta.precedentIds.length ? ` (precedents: ${meta.precedentIds.join(', ')})` : ' (no precedent, ESTIMATE reaction)'}`, severity: 0.2 })
    onLawEnacted(w, meta.policyKind)
    landmarkForLaw(w, l)
    for (const rs of w.regions) {
      const s = rs.lawSupport[l.id] ?? 0.5
      const peak = meta.magnitude * 1.5 * Math.max(0, 0.6 - s) / 0.6
      if (peak >= 0.1) addCrowd(rs, w, { topic: l.title.toLowerCase(), peak, outrageMonths: Math.max(1, Math.round(meta.durationMonths / 2)), delay: meta.delayMonths, lawId: l.id })
    }
  }
  foundCities(w, d.foundCities ?? [])
  charterCompanies(w, d.charterCompanies ?? [])
  for (const id of d.lessonsApplied ?? []) w.lessonsApplied.add(id)
  const migrations = scheduleMigrations(w, d.migrations, monthlyRevenue(w), effectiveBudget(w).welfare)
  return { migrations }
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4

// top drivers per stat since the last frame, then reset
function takeWhys(rs: World['regions'][number]): Why[] {
  const out: Why[] = []
  for (const [stat, acc] of Object.entries(rs.whyAcc)) {
    const drivers = Object.entries(acc).map(([label, v]) => ({ label, delta: Math.round(v.delta * 1e4) / 1e4, ...(v.source ? { source: v.source } : {}) }))
      .filter(d => d.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5)
    const value = (rs.r as unknown as Record<string, number>)[stat]
    if (drivers.length) out.push({ stat, value: typeof value === 'number' ? r4(value) : 0, drivers })
  }
  rs.whyAcc = {}
  return out
}

export function publicRegions(w: World): Region[] {
  return w.regions.map(rs => ({
    ...rs.r,
    gdpUsd: Math.round(rs.r.gdpUsd), energyTWh: Math.round(rs.r.energyTWh * 10) / 10, foodKcalPerCapita: Math.round(rs.r.foodKcalPerCapita),
    share65plus: r4(rs.r.share65plus), education: r4(rs.r.education), faith: r4(rs.r.faith), unrest: r4(rs.r.unrest),
    techLevel: r4(rs.r.techLevel), compliance: r4(rs.r.compliance), approval: r4(rs.r.approval), fertility: Math.round(rs.r.fertility * 1000) / 1000,
    crowds: rs.r.crowds.map(c => ({ ...c })), whys: takeWhys(rs), provenance: rs.r.provenance,
    visual: regionVisual(w, rs), ...emotionsOf(w, rs),
  }))
}

export function snapshot(w: World, newEvents: Frame['newEvents'], decision?: Decision): Frame {
  const regions = publicRegions(w)
  const flows = w.flowAcc.map(f => ({ ...f, people: Math.round(f.people) })).filter(f => f.people > 0)
  w.flowAcc = []
  return {
    tick: w.tick, date: dateOf(w.tick), regions,
    space: w.spaceAssets.map(a => ({ ...a })), atmosphere: atmosphere(w, regions.map(r => r.visual!)), flows,
    // frames carry the visible pips; mood rounded to 2 decimals and the last 4 life events keep records small
    citizens: w.citizens.map(c => ({ ...c, mood: Object.fromEntries(Object.entries(c.mood).map(([k, v]) => [k, Math.round(v * 100) / 100])) as typeof c.mood, group: { ...c.group }, lifeEvents: c.lifeEvents.slice(-4).map(e => ({ ...e })), family: { ...c.family } })),
    laws: w.laws.map(l => ({ ...l, support: r4(l.support), compliance: r4(l.compliance) })),
    budget: { ...effectiveBudget(w) }, religionPolicy: w.religionPolicy, schoolPolicy: { ...w.schoolPolicy, curriculum: [...w.schoolPolicy.curriculum] },
    moonStage: w.space.stage, moonProgress: r4(moonProgress(w.space)), status: w.status, newEvents,
    requirements: publicRequirements(w), cities: w.cities.map(c => ({ ...c })),
    companies: w.companies.filter(c => !c.failed).map(({ health: _h, failed: _f, ...c }) => ({ ...c })),
    frontier: w.frontier, factions: w.factions.map(f => ({ ...f, power: r4(f.power), hostility: r4(f.hostility), regionIds: [...f.regionIds] })),
    humanCost: { deaths: Math.round(w.humanCost.deaths), famineDeaths: Math.round(w.humanCost.famineDeaths), unrestDeaths: Math.round(w.humanCost.unrestDeaths), displaced: Math.round(w.humanCost.displaced), approval: r4(w.humanCost.approval) },
    globalPopulation: Math.round(worldPop(w)), globalPeriodLifeExpectancy: Math.round(globalPLE(w) * 10) / 10, lessonsKnown: w.lessonsKnown,
    ...(decision ? { decision } : {}),
  }
}

export function lawPrecedents(w: World) {
  return publicPrecedents(Object.values(w.lawMeta).flatMap(m => m.precedentIds))
}

export function baselineFrame(w: World): BaselineFrame {
  return {
    tick: w.tick,
    regions: w.regions.map(rs => ({ id: rs.r.id, population: Math.round(rs.r.population), foodKcalPerCapita: Math.round(rs.r.foodKcalPerCapita), unrest: r4(rs.r.unrest), techLevel: r4(rs.r.techLevel), education: r4(rs.r.education) })),
    moonProgress: r4(moonProgress(w.space)), status: w.status,
  }
}
