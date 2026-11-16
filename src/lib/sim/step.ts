// one month of the world, decision application, and public snapshots.
import { link } from './causes'
import { offWorldProgress, worldFreedom } from './tradeoffs'
import type { BaselineFrame, Decision, Frame, Law, Region, Why } from '../types'
import { dateOf } from './constants'
import { addCrowd, stepRegionBehavior, valence } from './behavior'
import { stepCountries, updateCountryStats } from './places'
import { stepHousing } from './housing'
import { stepDaily } from './daily'
import { stepPower } from './power'
import { stepPhysicalMonth, stepPhysicalYear } from './physical'
import { stepPeopleMonth, stepPeopleYear } from './people'
import { dressCitizen, stepClimate, stepCountryInfra, stepRealCities, trafficFrame } from './world-layer'
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
import { CAUSE_SIG_MIN, linksSince, recentLink, stepYear } from './causes'
import { clamp, effectiveBudget, event, linkIdOf, normalizeBudget, popWeighted, regionPop, sum, worldPop, type World } from './state'

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
  stepPhysicalMonth(w)
  stepPeopleMonth(w)
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
  stepCountries(w)
  stepClimate(w)
  // research progress per year (the brief flags a stall)
  if (w.tick % 12 === 11) { w.reqHist = [...(w.reqHist ?? []), w.requirements.reduce((a, q) => a + q.progress, 0)].slice(-3) }
  if (w.tick % 12 === 11) { stepCountryInfra(w); stepRealCities(w); stepHousing(w); stepPower(w); stepDaily(w, fx); stepPhysicalYear(w); stepPeopleYear(w) }
  if (w.tick === 0) for (const rs of w.regions) rs.valence0 = valence(rs.mood)
  if (w.tick % 12 === 11) updateCountryStats(w, rs => valence(rs.mood))
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
    for (const rs of w.regions) if (!e.regionId || rs.r.id === e.regionId) addCrowd(rs, w, { topic, peak: e.severity * (e.regionId ? 1 : 0.7), outrageMonths: e.kind === 'famine' ? 6 : 3, causeId: linkIdOf(e) })
  }
  w.tick++
  derive(w)
  if (w.tick % 12 === 0) stepYear(w)
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

// what the core sees at a decision, most urgent first, each with the number and the link that explains it
export function sawOf(w: World): { text: string; linkId?: string }[] {
  const out: { text: string; linkId?: string; urgency: number }[] = []
  const live = w.regions.filter(r => !r.seceded)
  const hungry = live.slice().sort((a, b) => a.r.foodKcalPerCapita - b.r.foodKcalPerCapita)[0]
  if (hungry && hungry.r.foodKcalPerCapita < 2500) out.push({ text: `food in ${hungry.r.name} at ${Math.round(hungry.r.foodKcalPerCapita)} kcal`, linkId: recentLink(w, hungry.r.id, c => /food|harvest|drought|famine/.test(c.what))?.id, urgency: (2500 - hungry.r.foodKcalPerCapita) / 300 })
  const angry = live.slice().sort((a, b) => b.r.unrest - a.r.unrest)[0]
  if (angry && angry.r.unrest > 0.35) out.push({ text: `unrest in ${angry.r.name} at ${angry.r.unrest.toFixed(2)}`, linkId: recentLink(w, angry.r.id, c => /unrest|protest/.test(c.what))?.id, urgency: (angry.r.unrest - 0.3) * 6 })
  for (const r of live.filter(x => x.inRevolt)) out.push({ text: `${r.r.name} in revolt`, linkId: recentLink(w, r.r.id, c => /revolt/.test(c.what), 60)?.id, urgency: 3 })
  const crowd = live.flatMap(r => r.crowds.filter(c => c.phase === 'outraged').map(c => ({ r, c }))).sort((a, b) => b.c.intensity - a.c.intensity)[0]
  if (crowd) out.push({ text: `outrage in ${crowd.r.r.name} over ${crowd.c.topic}`, linkId: recentLink(w, crowd.r.r.id, c => /protested/.test(c.what))?.id, urgency: crowd.c.intensity * 2 })
  const powerShort = live.filter(r => r.energyRatio < 0.97).sort((a, b) => a.energyRatio - b.energyRatio)[0]
  if (powerShort) out.push({ text: `${powerShort.r.name} meeting only ${Math.round(powerShort.energyRatio * 100)}% of power demand`, urgency: (1 - powerShort.energyRatio) * 10 })
  out.push({ text: `moon program at ${w.space.stage}, frontier ${w.frontier}`, urgency: 0.5 })
  out.push({ text: `approval ${Math.round(w.humanCost.approval * 100)}%`, urgency: Math.max(0, 0.5 - w.humanCost.approval) * 4 })
  return out.sort((a, b) => b.urgency - a.urgency).slice(0, 4).map(({ text, linkId }) => (linkId ? { text, linkId } : { text }))
}

// titles match when their meaningful words mostly overlap ("Expand Lifespan Research" ~ "Enhance Lifespan Research")
const FILLER = new Set(['act', 'law', 'program', 'programme', 'initiative', 'plan', 'policy', 'the', 'of', 'for', 'and', 'a', 'an', 'to', 'in', 'on', 'global', 'world', 'universal', 'expand', 'expanded', 'expansion', 'increase', 'increased', 'enhance', 'enhanced', 'boost', 'new', 'national', 'more', 'further', 'support', 'fund', 'funding', 'invest', 'investment', 'strengthen', 'improve', 'accelerate', 'acceleration'])
export function similarTitle(a: string, b: string): boolean {
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(x => x.length > 2 && !FILLER.has(x)).map(x => x.replace(/(ing|s)$/, '')))
  const A = words(a), B = words(b)
  if (!A.size || !B.size) return a.trim().toLowerCase() === b.trim().toLowerCase()
  const inter = [...A].filter(x => B.has(x)).length
  // jaccard: shared words over all words. "lunar habitat" and "lunar lander" are different laws
  return inter / new Set([...A, ...B]).size >= 0.75
}

export type Amend = { id: string; change: string; converted?: boolean; title?: string }

export function applyDecision(w: World, d: Decision): { migrations: ScheduledMigration[]; amended: Amend[]; repealed: string[] } {
  // repeal + a new law of the same kind in one decision is an amendment: the repeal is dropped and the new law
  // rewrites the old one below (stops the repeal-and-re-enact loop)
  const newKinds = d.laws.slice(0, MAX_LAWS_PER_DECISION).map(l => lawMeta(l).policyKind)
  // and repeal + amend of the same law is an amendment (the governor wanted it changed, not gone)
  const amendIds = new Set(((d as Decision & { amend?: Amend[] }).amend ?? []).map(a => a.id))
  const repeal = d.repeal.filter(id => { const l = w.laws.find(x => x.id === id); return !amendIds.has(id) && (!l || l.policyKind === 'other' || !newKinds.includes(l.policyKind)) })
  if (repeal.length) {
    const gone = w.laws.filter(l => repeal.includes(l.id))
    w.laws = w.laws.filter(l => !repeal.includes(l.id))
    for (const l of gone) { event(w, { kind: 'law', text: `repealed: ${l.title}`, severity: 0.1 }); w.recentRepeals.push({ tick: w.tick, title: l.title, policyKind: l.policyKind, law: { ...l } }) }
  }
  w.recentRepeals = w.recentRepeals.filter(r => w.tick - r.tick < 48)
  const fresh: Law[] = []
  w.lastRepeated = []
  w.lastConverted = []
  const applied: Amend[] = []
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  // amend an active law: its text changes, it is re-read (policy kind, precedents, who wins and loses)
  const amend = (law: Law, change0: string, converted: boolean, title?: string) => {
    // a small model sometimes pastes the brief's table row ("L3 | title | kind | 0.5 | 0.4"): keep only the words
    const change = /\|/.test(change0) ? change0.split('|').map(x => x.trim()).filter(x => x && !/^[\d.]+$/.test(x) && !/^[a-z_]+$/.test(x) && !/^L\d+$/.test(x)).join('. ') : change0
    if (!change.trim() || norm(change) === norm(law.text)) {
      w.lawsRepeated++
      w.lastRepeated.push(title ?? law.title)
      event(w, { kind: 'law', text: `repeated: "${title ?? law.title}" changes nothing in "${law.title}" (${law.id})`, severity: 0.05 })
      return
    }
    law.text = change.slice(0, 1200)
    if (converted && title) law.title = title.slice(0, 120) // the law now carries the newer title
    const meta = lawMeta(law)
    w.lawMeta[law.id] = meta
    Object.assign(law, { policyKind: meta.policyKind, precedentIds: meta.precedentIds, lovedBy: meta.lovedBy, hatedBy: meta.hatedBy })
    if (converted) { w.lawsConverted++; w.lastConverted.push(`${title} -> ${law.id}`) } else w.lawsAmended++
    applied.push({ id: law.id, change: law.text, converted, ...(title ? { title } : {}) })
    event(w, { kind: 'law', text: converted ? `amended ${law.id} "${law.title}" (proposed as the new law "${title}")` : `amended ${law.id} "${law.title}"`, severity: 0.15 })
  }
  for (const am of ((d as Decision & { amend?: Amend[] }).amend ?? []).slice(0, MAX_LAWS_PER_DECISION)) {
    const law = w.laws.find(l => l.id === am.id && !l.vetoed)
    if (law) amend(law, am.change, !!am.converted, am.title)
  }
  // a "law" that only moves money ("increase food budget", "space funding to 32%") is a budget change: a small model
  // writes its intent as a law and copies the old budget numbers. it becomes the budget shift it asks for (an explicit
  // share wins, otherwise +5 points, +10 for "double", -5 for cuts; the other lines give or take pro rata), logged
  const budget = { ...d.budget }
  const budgetLaws: string[] = []
  const laws = d.laws.slice(0, MAX_LAWS_PER_DECISION).filter(l => {
    const shift = budgetLawShift(`${l.title}. ${l.text}`)
    if (!shift.length) return true
    for (const s of shift) moveBudget(budget, s.key, s.to, s.delta)
    budgetLaws.push(l.title)
    w.lawsBudget++
    event(w, { kind: 'law', text: `"${l.title}" became a budget change: ${shift.map(s => s.key).join(', ')} now ${shift.map(s => `${Math.round(budget[s.key] / Math.max(Object.values(budget).reduce((a, x) => a + x, 0), 1e-9) * 1000) / 10}%`).join(', ')}`, severity: 0.1 })
    return false
  })
  w.lastBudgetLaws = budgetLaws
  laws.forEach((l, i) => {
    const meta = lawMeta(l)
    w.lawsProposed++
    // one active law per policy kind: a new law in a kind that is already covered amends that law instead
    const covered = meta.policyKind !== 'other' ? [...w.laws, ...fresh].find(x => !x.vetoed && x.policyKind === meta.policyKind) : undefined
    const dup = covered ?? [...w.laws, ...fresh].find(x => !x.vetoed && x.policyKind === meta.policyKind && similarTitle(x.title, l.title))
    if (dup) { amend(dup, l.text, true, l.title); return }
    // re-passing a policy kind repealed in the last 4 years ('other' needs a similar title): the old law comes back
    // with the new text (same id, its compliance history kept), logged as an amendment, so the repeal-and-re-pass loop
    // wastes nothing
    const back = w.recentRepeals.find(r => r.tick < w.tick && r.policyKind === meta.policyKind && (meta.policyKind !== 'other' || similarTitle(r.title, l.title)))
    if (back && back.law && !w.laws.some(x => x.id === back.law!.id)) {
      const old = { ...back.law }
      w.recentRepeals = w.recentRepeals.filter(r => r !== back)
      fresh.push(old)
      event(w, { kind: 'law', text: `restored ${old.id} "${old.title}", repealed ${Math.round((w.tick - back.tick) / 12)} years ago`, severity: 0.05 })
      amend(old, l.text, true, l.title)
      return
    }
    const id = l.id && !w.laws.some(x => x.id === l.id) ? l.id : `L${w.tick}-${i}`
    w.lawMeta[id] = meta
    fresh.push({ ...l, id, enactedTick: w.tick, support: 0.5, compliance: 0.5, vetoed: false, policyKind: meta.policyKind, precedentIds: meta.precedentIds, lovedBy: meta.lovedBy, hatedBy: meta.hatedBy })
  })
  w.laws.push(...fresh)
  while (w.laws.length > MAX_ACTIVE_LAWS) w.laws.shift()
  // budget moves of 5 points or more are decisions in the cause record (an autopsy can start from a cut)
  const nb = normalizeBudget(budget)
  for (const k of Object.keys(nb) as BudgetKey[]) { const d0 = w.budget[k], d1 = nb[k]; if (Math.abs(d1 - d0) >= 0.05) link(w, { placeId: 'world', what: `the core ${d1 < d0 ? 'cut' : 'raised'} ${k === 'welfare' ? 'health and social spending' : k} from ${Math.round(d0 * 100)}% to ${Math.round(d1 * 100)}% of the budget`, value: Math.min(1, 0.4 + Math.abs(d1 - d0) * 2), because: (d.rationale ?? '').split(/(?<=[.!?])\s/)[0].slice(0, 200), byWhom: 'core', sig: Math.min(1, 0.4 + Math.abs(d1 - d0) * 2) }) }
  w.budget = nb
  w.forcedBudget = undefined
  if (d.religionPolicy !== w.religionPolicy) event(w, { kind: 'law', text: `religion policy changed from ${w.religionPolicy} to ${d.religionPolicy}`, severity: 0.3 })
  w.religionPolicy = d.religionPolicy
  w.schoolPolicy = { purpose: d.schoolPolicy.purpose, curriculum: [...d.schoolPolicy.curriculum].slice(0, 12), yearsRequired: clamp(Math.round(d.schoolPolicy.yearsRequired), 0, 16) }
  w.researchFocus = (d.researchFocus ?? []).slice(0, 8)
  stepLaws(w) // fresh laws get real support numbers immediately
  // each new law: precedent-sized reaction in every region that dislikes it, factions react
  for (const l of fresh) {
    const meta = w.lawMeta[l.id]
    // the law answers what the core saw most urgently; chain it to that
    const saw = sawOf(w)[0]
    const ev = event(w, { kind: 'law', text: `enacted: ${l.title}${meta.precedentIds.length ? ` (precedents: ${meta.precedentIds.join(', ')})` : ' (no precedent, ESTIMATE reaction)'}`, severity: 0.2 },
      { byWhom: 'core', lawId: l.id, because: saw ? saw.text : 'the core\'s own program', causeIds: saw?.linkId ? [saw.linkId] : [] })
    const lawLink = linkIdOf(ev)
    onLawEnacted(w, meta.policyKind)
    landmarkForLaw(w, l)
    for (const rs of w.regions) {
      const s = rs.lawSupport[l.id] ?? 0.5
      const peak = meta.magnitude * 1.5 * Math.max(0, 0.6 - s) / 0.6
      if (peak >= 0.1) addCrowd(rs, w, { topic: l.title.toLowerCase(), peak, outrageMonths: Math.max(1, Math.round(meta.durationMonths / 2)), delay: meta.delayMonths, lawId: l.id, causeId: lawLink })
    }
  }
  foundCities(w, d.foundCities ?? [])
  charterCompanies(w, d.charterCompanies ?? [])
  for (const id of d.lessonsApplied ?? []) w.lessonsApplied.add(id)
  const migrations = scheduleMigrations(w, d.migrations, monthlyRevenue(w), effectiveBudget(w).welfare)
  return { migrations, amended: applied, repealed: repeal }
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4
const q05 = (x: number) => Math.round(x * 20) / 20

// top drivers per stat since the last frame, then reset
function takeWhys(rs: World['regions'][number]): Why[] {
  const out: Why[] = []
  for (const [stat, acc] of Object.entries(rs.whyAcc)) {
    // sources are looked up by label (WHY_SOURCES in types-v5) instead of repeated in every frame
    const drivers = Object.entries(acc).map(([label, v]) => ({ label, delta: Math.round(v.delta * 1e4) / 1e4 }))
      .filter((d, _i, all) => d.delta !== 0 && Math.abs(d.delta) >= 0.05 * all.reduce((t, x) => t + Math.abs(x.delta), 0)).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 2)
    const value = (rs.r as unknown as Record<string, number>)[stat]
    if (drivers.length) out.push({ stat, value: typeof value === 'number' ? r4(value) : 0, drivers })
  }
  rs.whyAcc = {}
  return out
}

export function publicRegions(w: World): Region[] {
  return w.regions.map(rs => ({
    ...rs.r,
    // the region's full age pyramid (17 five-year bands, people): pyramids and child shares come from here, never from pips
    // population is the sum of those bands, so pyramid, region and world totals can never disagree
    ...({ ageBands: rs.bands.map(b => Math.round(b)) } as object), population: rs.bands.reduce((a, b) => a + Math.round(b), 0),
    // food price index (2026 = 1), the same number the sim prices food with
    ...({ foodPrice: r4(rs.priceIdx) } as object),
    gdpUsd: Math.round(rs.r.gdpUsd), energyTWh: Math.round(rs.r.energyTWh * 10) / 10, foodKcalPerCapita: Math.round(rs.r.foodKcalPerCapita),
    share65plus: r4(rs.r.share65plus), education: r4(rs.r.education), faith: r4(rs.r.faith), unrest: r4(rs.r.unrest),
    techLevel: r4(rs.r.techLevel), compliance: r4(rs.r.compliance), approval: r4(rs.r.approval), fertility: Math.round(rs.r.fertility * 1000) / 1000,
    // provenance never changes: it rides on the first frame only, later frames carry {}
    crowds: rs.r.crowds.map(c => ({ ...c })), whys: takeWhys(rs), provenance: w.tick === 0 || !w.provenanceSent ? rs.r.provenance : {},
    visual: regionVisual(w, rs), ...emotionsOf(w, rs),
  }))
}

export function snapshot(w: World, newEvents: Frame['newEvents'], decision?: Decision): Frame {
  // ages are derived from the stored birth tick, never kept separately (truth.ts ageAt)
  for (const c of w.citizens) { const b = (c as typeof c & { birthTick?: number }).birthTick; if (b !== undefined) c.age = Math.floor((w.tick - b) / 12); dressCitizen(w, c) }
  const regions = publicRegions(w)
  w.provenanceSent = true
  const infra = w.infraAcc
  w.infraAcc = []
  const flows = w.flowAcc.map(f => ({ ...f, people: Math.round(f.people) })).filter(f => f.people > 0)
  w.flowAcc = []
  // cause chains (not yet in A's Frame type, attached as extra fields): links since the last frame, and each
  // region's yearly story + trends
  // only links above the significance floor go into frames, plus every link a region story is built from
  const storyIds = new Set(w.regions.flatMap(r => r.story?.chainIds.flat() ?? []))
  const causes = linksSince(w, w.lastFrameTick).filter(c => (c.sig ?? 0) >= CAUSE_SIG_MIN || storyIds.has(c.id))
  w.lastFrameTick = w.tick
  regions.forEach((r, i) => Object.assign(r, { story: w.regions[i].story ?? null, trends: w.regions[i].trends }))
  return {
    tick: w.tick, date: dateOf(w.tick), regions,
    space: w.spaceAssets.map(a => ({ ...a })), atmosphere: atmosphere(w, regions.map(r => r.visual!)), flows,
    // frames carry the visible pips; mood and opinion quantized to 0.05 (so tiny drifts are not deltas) and the last 4 life events keep records small
    // (every pip's full history is written once per run to data/runs/<runId>.lives.json)
    citizens: w.citizens.map(c => ({ ...c, mood: Object.fromEntries(Object.entries(c.mood).map(([k, v]) => [k, q05(v)])) as typeof c.mood, opinionOfCore: q05(c.opinionOfCore), group: { ...c.group }, lifeEvents: c.lifeEvents.slice(-4).map(e => ({ ...e })), family: { ...c.family } })),
    laws: w.laws.map(l => ({ ...l, support: r4(l.support), compliance: r4(l.compliance) })),
    budget: { ...effectiveBudget(w) }, religionPolicy: w.religionPolicy, schoolPolicy: { ...w.schoolPolicy, curriculum: [...w.schoolPolicy.curriculum] },
    moonStage: w.space.stage, moonProgress: r4(moonProgress(w.space)), status: w.status, newEvents,
    requirements: publicRequirements(w), cities: w.cities.map(c => ({ ...c })),
    companies: w.companies.filter(c => !c.failed).map(k => { const { health, failed, ...c } = k; void health; void failed; return { ...c } }),
    frontier: w.frontier, factions: w.factions.map(f => ({ ...f, power: r4(f.power), hostility: r4(f.hostility), regionIds: [...f.regionIds] })),
    humanCost: { deaths: Math.round(w.humanCost.deaths), famineDeaths: Math.round(w.humanCost.famineDeaths), unrestDeaths: Math.round(w.humanCost.unrestDeaths), displaced: Math.round(w.humanCost.displaced), approval: r4(w.humanCost.approval) },
    // cumulative deaths by cause (truth.ts deathsAt reads these)
    ...({ vital: Object.fromEntries(Object.entries(w.vital).map(([k, v]) => [k, Math.round(v)])), causeDeaths: { air: Math.round(w.causeDeaths.air), water: Math.round(w.causeDeaths.water), despair: Math.round(w.causeDeaths.despair ?? 0), housing: Math.round(w.housingDeaths) } } as object),
    // tradeoffs: freedom (defined index) and off-world progress, per frame
    ...({ freedom: Math.round(worldFreedom(w) * 1000) / 1000, offWorld: Math.round(offWorldProgress(w) * 1000) / 1000 } as object),
    globalPopulation: regions.reduce((a, r) => a + r.population, 0), globalPeriodLifeExpectancy: Math.round(globalPLE(w) * 10) / 10, lessonsKnown: w.lessonsKnown,
    ...(decision ? { decision } : {}),
    ...({ causes, infra, traffic: trafficFrame(w), climate: { anomalyC: Math.round(w.climate.anomalyC * 100) / 100, gtCo2PerYear: Math.round(w.climate.gtPerYear * 10) / 10 } } as object),
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

type BudgetKey = keyof Decision['budget']
const BUDGET_WORDS: [BudgetKey, RegExp][] = [['food', /\bfood|agricultur|famine relief|hunger/], ['welfare', /health|welfare|social|pension|care\b/], ['education', /educat|school/], ['energy', /energy|power|electric/], ['research', /research|science/], ['space', /space|lunar|moon|mars|rocket/], ['security', /security|police|defen[cs]e|military/]]
// ("increase food budget", "space research funding to 32%", "cut security spending") -> shifts. only texts that are about
// a budget line (budget, funding, spending, share, money, allocation) count
export function budgetLawShift(text: string): { key: BudgetKey; to?: number; delta?: number }[] {
  const t = text.toLowerCase()
  if (!/\b(budget|funding|spending|share|money|allocation|appropriation)s?\b/.test(t)) return []
  // laws that also set up a program (a mission, a city, a reform...) stay laws
  if (/\b(program|programme|mission|act to|establish|create|build|ban|require|mandate)\b/.test(t) && !/^(increase|boost|raise|cut|reduce|double|expand|lower)/.test(t)) return []
  const up = /\b(increase|boost|raise|expand|double|more|grow|prioriti[sz]e)\b/.test(t), down = /\b(cut|reduce|lower|decrease|trim|slash)\b/.test(t)
  if (!up && !down) return []
  // which budget lines it names ("space research" is space), and an explicit "to N%" goes to the line named just before it
  const hits = BUDGET_WORDS.map(([key, re]) => ({ key, at: t.search(re) })).filter(h => h.at >= 0).filter(h => !(h.key === 'research' && /space research/.test(t)))
  const pctM = /\bto (\d{1,2}(?:\.\d)?)\s?%/.exec(t)
  const target = pctM ? hits.filter(h => h.at < pctM.index).sort((a, b) => b.at - a.at)[0]?.key : undefined
  const delta = down && !up ? -0.05 : /double/.test(t) ? 0.1 : 0.05
  const out: { key: BudgetKey; to?: number; delta?: number }[] = hits.sort((a, b) => a.at - b.at).map(h => h.key === target ? { key: h.key, to: Number(pctM![1]) / 100 } : { key: h.key, delta })
  return out.slice(0, 2)
}
function moveBudget(b: Decision['budget'], key: BudgetKey, to?: number, delta?: number) {
  const tot = Object.values(b).reduce((a, x) => a + x, 0) || 1
  for (const k of Object.keys(b) as BudgetKey[]) b[k] /= tot
  const target = Math.max(0, Math.min(0.8, to ?? b[key] + (delta ?? 0)))
  const diff = target - b[key]
  const others = (Object.keys(b) as BudgetKey[]).filter(k => k !== key)
  const pool = others.reduce((a, k) => a + b[k], 0) || 1
  for (const k of others) b[k] = Math.max(0, b[k] - diff * b[k] / pool)
  b[key] = target
}
