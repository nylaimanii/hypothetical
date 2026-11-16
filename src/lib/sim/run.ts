// runWorld: the only simulation entry point (contract in CLAUDE.md).
// monthly step, governor every 24 ticks (live: every 12 for 30 years, then 24), frame every opts.frameEvery ticks
// (default 12, live 1), at every decision and on death. a no-ai baseline twin runs on the same seed with
// 2026 policies frozen and no llm calls. full state snapshots every 60 ticks allow exact branching.
import fs from 'node:fs'
import path from 'node:path'
import type { BaselineFrame, Decision, Frame, Lesson, Override, RunOptions, RunRecord, RunSummary, Snapshot, WorldEvent } from '../types'
import { decide, type GovernorMemory } from '../agent/governor'
import { acquireOllamaLock, assertLlmReady, withUsage, type Usage } from '../agent/llm'
import { BRIEF_TOKEN_CAP, briefStats } from '../agent/brief'
import { BASELINE_BUDGET, BASELINE_RELIGION, BASELINE_SCHOOL, dateOf, decisionDue } from './constants'
import { extractLessons, loadLessons } from '../agent/lessons'
import { globalPLE } from './end'
import { ageCitizens, initCitizens, pairPartners, personalYear, refreshThoughts, syncCitizenCounts, updateMoods } from './citizens'
import { score } from './end'
import { applyEvent } from './events'
import { fmt } from './physics'
import { applyDecision, baselineFrame, lawPrecedents, sawOf, snapshot, stepWorld } from './step'
import { SNAPSHOT_EVERY, restoreWorld, snapshotWorld } from './snapshot'
import { epitaphFor } from './visuals'
import { localLife, recordPlacesYear, writePlaces, type PlacesAcc } from './world-layer'
import { KEYFRAME_EVERY, makeDelta } from './citizens-replay'
import { event, initWorld, popWeighted, regionPop, worldPop, type World } from './state'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const BASELINE_DECISION = (tick: number): Decision => ({
  tick, laws: [], repeal: [], migrations: [], budget: { ...BASELINE_BUDGET }, religionPolicy: BASELINE_RELIGION,
  schoolPolicy: { ...BASELINE_SCHOOL, curriculum: [...BASELINE_SCHOOL.curriculum] }, rationale: 'baseline twin: 2026 policies frozen', respondedToOverrides: [],
  foundCities: [], charterCompanies: [], researchFocus: [], publicStatement: '', lessonsApplied: [],
})

// reads every override file in dir that is due, applies it, deletes it. returns the applied overrides.
export function applyOverrides(w: World, dir: string | undefined, mem: GovernorMemory): Override[] {
  if (!dir || !fs.existsSync(dir)) return []
  const applied: Override[] = []
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  for (const f of files) {
    const p = path.join(dir, f)
    let list: Override[]
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Override | Override[]
      list = Array.isArray(raw) ? raw : [raw]
    } catch {
      continue // partially written file, try next tick
    }
    if (list.some(o => typeof o.tick === 'number' && o.tick > w.tick)) continue // not due yet
    for (const o of list) {
      if (!o || typeof o.id !== 'string') continue
      applyOverride(w, o, mem)
      applied.push(o)
    }
    try { fs.unlinkSync(p) } catch { /* already gone */ }
  }
  return applied
}

function applyOverride(w: World, o: Override, mem: GovernorMemory) {
  if (o.kind === 'veto_law') {
    const law = w.laws.find(l => l.id === o.lawId)
    if (law) { law.vetoed = true; mem.vetoedTitles.add(law.title.toLowerCase()) }
    event(w, { kind: 'override', regionId: o.regionId, text: law ? `observer vetoed law: ${law.title}` : `observer vetoed law ${o.lawId ?? '(none)'}, no such law is active`, severity: 0.3 })
  } else if (o.kind === 'force_budget') {
    const b = o.budget ?? {}
    const clean: Record<string, number> = {}
    for (const [k, v] of Object.entries(b)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) clean[k] = Math.min(v, 1)
    w.forcedBudget = { ...(w.forcedBudget ?? {}), ...clean }
    event(w, { kind: 'override', text: `observer forced the budget: ${Object.entries(clean).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')}`, severity: 0.3 })
  } else if (o.kind === 'inject_event') {
    const kind = o.eventKind ?? 'disaster'
    const sev = typeof o.severity === 'number' ? o.severity : 0.5
    const targets = o.regionId ? w.regions.filter(r => r.r.id === o.regionId) : kind === 'pandemic' ? [w.regions.reduce((a, b) => (regionPop(a) > regionPop(b) ? a : b))] : w.regions
    event(w, { kind: 'override', regionId: o.regionId, text: `observer injected ${kind} (severity ${sev.toFixed(2)})${o.regionId ? ` in ${o.regionId}` : ' worldwide'}`, severity: sev })
    for (const rs of targets) applyEvent(w, rs, kind, sev, `${kind} in ${rs.r.name}`, true)
  }
}

// RunOptions as A defines it, plus fields B accepts ahead of the contract (requested in the report):
// agentId stamps the record; startFrom branches from a saved run at a tick; untilTick stops early (status stays alive).
export type RunOpts = RunOptions & { agentId?: string; startFrom?: { runId: string; tick: number }; untilTick?: number }

// repeated-law rate of the last finished world in this process (logged; not yet in the RunSummary contract)
export let lawStats = { proposed: 0, repeated: 0, amended: 0, converted: 0 }

export async function runWorld(opts: RunOpts): Promise<RunSummary> {
  // fail fast: a real run never quietly drops to the offline governor
  await assertLlmReady()
  // one ollama-heavy job at a time across processes (run-one, evolve, live): data/.ollama.lock
  const release = await acquireOllamaLock(opts.runId)
  const usage: Usage = { llmCalls: 0, tokens: 0 }
  const t0 = Date.now()
  let summary: RunSummary
  lawStats = { proposed: 0, repeated: 0, amended: 0, converted: 0 }
  Object.assign(briefStats, { calls: 0, maxTokens: 0, totalTokens: 0, compressed: 0 })
  try { summary = await withUsage(usage, () => runInner(opts, usage)) } finally { release() }
  console.log(`[usage] ${opts.runId}: ${usage.llmCalls} llm calls, ${usage.tokens} tokens, ${((Date.now() - t0) / 1000).toFixed(1)}s wall, laws: ${lawStats.proposed} new proposed, ${lawStats.converted} converted to amendments, ${lawStats.amended} amended, ${lawStats.repeated} no-op repeats, brief max ${briefStats.maxTokens} avg ${briefStats.calls ? Math.round(briefStats.totalTokens / briefStats.calls) : 0} tokens (cap ${BRIEF_TOKEN_CAP}, compressed ${briefStats.compressed}x)`)
  return summary
}

export function loadRun(runId: string): RunRecord | null {
  for (const d of ['runs', 'showcase', 'live']) {
    try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', d, `${runId}.json`), 'utf8')) as RunRecord } catch { /* next */ }
  }
  return null
}

type Ctx = { mem: GovernorMemory; pendingOverrides: Override[]; snapshots: Snapshot[]; due: (tick: number) => boolean; pendingOutcomes: { d: Decision & { reasoning?: Reasoning }; tick: number; before: Vitals }[] }

// the core's reasoning chain for one decision: what it saw -> what it chose -> what it expected -> what happened
// two years later. not yet in A's Decision type, attached as decision.reasoning.
export type Reasoning = { saw: string[]; chose: string[]; expected: string; outcome?: string }
type Vitals = { pop: number; food: number; unrest: number; approval: number; le: number; frontier: string; stage: string }
const vitals = (w: World): Vitals => ({ pop: worldPop(w), food: popWeighted(w, r => r.r.foodKcalPerCapita), unrest: popWeighted(w, r => r.r.unrest), approval: w.humanCost.approval, le: globalPLE(w), frontier: w.frontier, stage: w.space.stage })

function choseOf(prev: Decision | undefined, d: Decision, enacted: Decision['laws']): string[] {
  const out: string[] = []
  if (prev) for (const [k, v] of Object.entries(d.budget) as [keyof Decision['budget'], number][]) {
    const p = prev.budget[k]
    if (Math.abs(v - p) >= 0.01) out.push(`${k} ${(p * 100).toFixed(1)}% -> ${(v * 100).toFixed(1)}%`)
  } else out.push(`budget ${Object.entries(d.budget).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(', ')}`)
  for (const l of enacted) out.push(`law ${l.id} "${l.title}"`)
  if (d.repeal.length) out.push(`repealed ${d.repeal.join(', ')}`)
  if (prev && prev.religionPolicy !== d.religionPolicy) out.push(`religion ${prev.religionPolicy} -> ${d.religionPolicy}`)
  for (const c of d.foundCities ?? []) out.push(`new city ${c.name} (${c.regionId})`)
  for (const m of d.migrations) out.push(`move ${fmt(m.people)} ${m.from} -> ${m.to}`)
  return out.length ? out : ['kept the previous policy']
}

function outcomeOf(w: World, d: Decision, before: Vitals): string {
  const now = vitals(w)
  const parts = [
    `population ${fmt(before.pop)} -> ${fmt(now.pop)}`, `food ${Math.round(before.food)} -> ${Math.round(now.food)} kcal`,
    `unrest ${before.unrest.toFixed(2)} -> ${now.unrest.toFixed(2)}`, `approval ${Math.round(before.approval * 100)}% -> ${Math.round(now.approval * 100)}%`,
    `life expectancy ${before.le.toFixed(1)} -> ${now.le.toFixed(1)}`,
  ]
  if (before.frontier !== now.frontier) parts.push(`frontier ${before.frontier} -> ${now.frontier}`)
  else if (before.stage !== now.stage) parts.push(`moon program ${before.stage} -> ${now.stage}`)
  for (const l of d.laws) {
    const live = w.laws.find(x => x.id === l.id)
    parts.push(live ? `law ${l.id}: support ${Math.round(live.support * 100)}%, compliance ${Math.round(live.compliance * 100)}%${live.compliance < 0.3 ? ' (mostly ignored)' : ''}` : `law ${l.id} no longer in force`)
  }
  return `2 years later: ${parts.join(', ')}`
}

// one month of the main world. shared by live runs, replays and branches so they execute identical code.
async function tickBody(w: World, ctx: Ctx, decideFn: (w: World) => Promise<Decision | undefined>, opts: { overrideDir?: string; llmThoughts: boolean }): Promise<Decision | undefined> {
  if (w.tick % SNAPSHOT_EVERY === 0) ctx.snapshots.push(snapshotWorld(w))
  ctx.pendingOverrides.push(...applyOverrides(w, opts.overrideDir, ctx.mem))
  let decision: Decision | undefined
  if (ctx.due(w.tick)) {
    const saw = sawOf(w).map(s => s.text)
    const before = vitals(w)
    const d = await decideFn(w)
    if (d) {
      const prev = ctx.mem.last
      const { migrations, amended, repealed } = applyDecision(w, d)
      // record the enacted laws (real ids, metadata, support) and the migrations as ordered; how many really
      // moved is logged as an event. keeping the order (not the outcome) lets a branch replay this exactly.
      // amendments are recorded as applied (real ids, converted ones included) so a replay does exactly the same
      decision = { ...d, laws: w.laws.filter(l => l.enactedTick === w.tick).map(l => ({ ...l })) }
      // laws/amend/repeal show what happened; input keeps exactly what the governor sent, so a replay runs the same code path
      const dx = d as Decision & { amend?: unknown[] }
      Object.assign(decision, { amend: amended, repeal: repealed, input: { laws: d.laws.map(l => ({ ...l })), amend: dx.amend ?? [], repeal: [...d.repeal] } })
      const expected = ((d as Decision & { expectedResult?: string }).expectedResult || d.rationale.split(/(?<=[.!?])\s/)[0] || '').slice(0, 300)
      const reasoning: Reasoning = { saw, chose: choseOf(prev, d, decision.laws), expected }
      Object.assign(decision, { reasoning })
      ctx.pendingOutcomes.push({ d: decision as Decision & { reasoning?: Reasoning }, tick: w.tick, before })
      for (const m of migrations) if (m.actual < m.requested) event(w, { kind: 'migration', regionId: m.from, text: `only ${fmt(m.actual)} of ${fmt(m.requested)} ordered to move actually left`, severity: 0.1 })
      ctx.mem.last = decision
      ctx.pendingOverrides = []
    }
  }
  for (const p of ctx.pendingOutcomes) if (w.tick >= p.tick + 24 && p.d.reasoning && !p.d.reasoning.outcome) p.d.reasoning.outcome = outcomeOf(w, p.d, p.before)
  ctx.pendingOutcomes = ctx.pendingOutcomes.filter(p => !p.d.reasoning?.outcome)
  if (w.tick % 12 === 0) {
    // yearly: birthdays, pip counts, partners, one batched thought call (thoughts never touch sim numbers)
    if (w.tick > 0) { ageCitizens(w); syncCitizenCounts(w); pairPartners(w); personalYear(w) }
    for (const c of w.citizens) localLife(w, c)
    updateMoods(w)
    await refreshThoughts(w, opts.llmThoughts)
  }
  return decision
}

async function runInner(opts: RunOpts, usage: Usage): Promise<RunSummary> {
  const live = !!opts.live
  const frameEvery = live ? 1 : Math.max(1, opts.frameEvery ?? 12)
  const knownLessons = loadLessons()
  const ctx: Ctx = { mem: { vetoedTitles: new Set(), lessons: knownLessons }, pendingOverrides: [], snapshots: [], due: t => decisionDue(t, live), pendingOutcomes: [] }
  const frames: Frame[] = []
  let lessonsLearned: Lesson[] = []
  let branchedFrom: RunRecord['branchedFrom']
  let w: World

  if (opts.startFrom) {
    // branch: restore the nearest snapshot at or before the tick, replay the source's own decisions to the
    // exact tick (no llm, no overrides), then hand over to this run's constitution
    const src = loadRun(opts.startFrom.runId)
    if (!src) throw new Error(`startFrom: run ${opts.startFrom.runId} not found`)
    const target = Math.max(0, Math.floor(opts.startFrom.tick))
    const snap = (src.snapshots ?? []).filter(s => s.tick <= target).sort((a, b) => b.tick - a.tick)[0]
    if (!snap) throw new Error(`startFrom: run ${opts.startFrom.runId} has no snapshot at or before tick ${target}`)
    w = restoreWorld(snap)
    const srcDecisions = new Map(src.frames.filter(f => f.decision).map(f => [f.decision!.tick, f.decision!]))
    ctx.mem.last = [...srcDecisions.values()].filter(d => d.tick < snap.tick).sort((a, b) => b.tick - a.tick)[0]
    // where the source emitted frames, reset the per-frame accumulators (whys, new-event cursor) the same way
    const srcFrameTicks = new Set(src.frames.map(f => f.tick))
    // replay on the source's own cadence (it decided wherever it has a recorded decision)
    ctx.due = t => srcDecisions.has(t)
    while (w.tick < target && w.status === 'alive') {
      await tickBody(w, ctx, async x => { const sd = srcDecisions.get(x.tick) as (Decision & { input?: object }) | undefined; return sd?.input ? { ...sd, ...sd.input } : sd }, { llmThoughts: false })
      if (srcFrameTicks.has(w.tick)) { for (const rs of w.regions) rs.whyAcc = {}; w.frameCursor = w.events.length; w.flowAcc = []; w.infraAcc = []; w.lastFrameTick = w.tick }
      stepWorld(w)
      updateMoods(w)
    }
    if (w.status !== 'alive') throw new Error(`startFrom: the source world had already ended by tick ${target}`)
    ctx.due = t => decisionDue(t, live)
    for (const l of w.laws) if (l.vetoed) ctx.mem.vetoedTitles.add(l.title.toLowerCase())
    ctx.mem.last = [...srcDecisions.values()].filter(d => d.tick < target).sort((a, b) => b.tick - a.tick)[0]
    frames.push(...src.frames.filter(f => f.tick < target))
    ctx.snapshots = (src.snapshots ?? []).filter(s => s.tick < target)
    branchedFrom = { runId: src.runId, tick: target, agentId: src.agentId ?? src.summary.agentId ?? 'unassigned' }
  } else {
    w = initWorld(opts.seed, false)
    initCitizens(w)
  }
  w.lessonsKnown = knownLessons.length

  // the twin always runs from tick 0: it never depends on the governor, so it is identical across branches
  const twin = initWorld(opts.seed, true)
  const baseline: BaselineFrame[] = [baselineFrame(twin)]
  applyDecision(twin, BASELINE_DECISION(0))
  const stepTwin = () => {
    if (twin.status !== 'alive') return
    stepWorld(twin)
    if (twin.tick % 12 === 0 || twin.status !== 'alive') baseline.push(baselineFrame(twin))
  }
  while (twin.tick < w.tick && twin.status === 'alive') stepTwin()

  const rec = (done: boolean) => record(opts, w, twin, frames, baseline, !done, usage, lessonsLearned, knownLessons, ctx.snapshots, branchedFrom)
  let roster: Map<string, import('../types').Citizen> | undefined
  const places: PlacesAcc = { years: [], hist: new Map() }
  let rosterTick = 0
  let keyReqText = new Map<string, string>()
  let prevReq = new Map<string, import('../types').Requirement>()
  const emit = (decision?: Decision) => {
    const fresh = w.events.slice(w.frameCursor)
    w.frameCursor = w.events.length
    const f = snapshot(w, fresh, decision)
    // citizens: full roster on keyframes (first frame, every 5 years, the last frame), deltas in between
    const key = !roster || w.tick % KEYFRAME_EVERY === 0 || w.status !== 'alive' || process.env.HYP_FULL_CITIZENS === '1'
    const full = f.citizens
    const reqNow = new Map(f.requirements.map(q => [q.id, { ...q }]))
    if (key) {
      Object.assign(f, { citizenKeyframe: true })
      keyReqText = new Map(f.requirements.map(q => [q.id, q.realWorld2026]))
      // countries ride on the first and the last frame; every year's country, state and city stats are in the
      // places file (placesAt() in places-replay.ts decodes any year)
      // provenance for every country field lives in data/geo/countries.json (not copied into records)
      if (!frames.length || w.status !== 'alive') Object.assign(f, { countries: w.countries.map(c => ({ id: c.id, name: c.name, regionId: c.regionId, stats: { ...c.stats }, provenance: {} })) })
    }
    else {
      Object.assign(f, { citizenDelta: makeDelta(roster!, full, rosterTick) })
      f.citizens = []
      // emotion by group rides on keyframes (every 5 years); the yearly emotionMix stays on every frame
      for (const reg of f.regions) delete reg.emotionByGroup
      // static requirement fields (name, track, prereqs, tier, cost, 2026 text, url) ride on keyframes only;
      // requirementsAt() restores them. in-between frames carry id, progress and unlock tick
      // (the 2026 text is kept when it differs from the keyframe's, e.g. a node stalled since then)
      // and only the nodes whose progress or text changed since the previous frame are listed
      f.requirements = f.requirements.filter(q => { const p = prevReq.get(q.id); return !p || p.progress !== q.progress || p.realWorld2026 !== q.realWorld2026 || p.unlockedTick !== q.unlockedTick })
        .map(q => ({ id: q.id, progress: q.progress, ...(q.unlockedTick !== undefined ? { unlockedTick: q.unlockedTick } : {}), ...(keyReqText.get(q.id) !== q.realWorld2026 ? { realWorld2026: q.realWorld2026 } : {}) }) as typeof q)
    }
    roster = new Map(full.map(c => [c.id, c]))
    prevReq = reqNow
    rosterTick = w.tick
    frames.push(f)
    opts.onFrame?.(f)
    if (live) writeJsonAtomic(path.join(process.cwd(), 'data', 'live', `${opts.runId}.json`), rec(w.status !== 'alive'))
  }

  while (w.status === 'alive' && (opts.untilTick === undefined || w.tick < opts.untilTick)) {
    const decision = await tickBody(w, ctx, x => decide(x, opts.constitution, ctx.pendingOverrides, ctx.mem), { overrideDir: opts.overrideDir, llmThoughts: live })
    if (w.tick % frameEvery === 0 || decision) emit(decision)
    stepWorld(w)
    if (w.tick % 12 === 0) recordPlacesYear(w, places)
    stepTwin()
    updateMoods(w)
    if (w.status !== 'alive') { ctx.snapshots.push(snapshotWorld(w)); emit() }
    else if (live) await sleep(opts.live!.msPerTick)
  }
  while (twin.status === 'alive' && (opts.untilTick === undefined || twin.tick < opts.untilTick)) stepTwin()
  if (w.status === 'alive' && opts.untilTick !== undefined && frames[frames.length - 1]?.tick !== w.tick) emit()
  lawStats = { proposed: w.lawsProposed, repeated: w.lawsRepeated, amended: w.lawsAmended, converted: w.lawsConverted }
  if (w.status === 'destroyed') lessonsLearned = await extractLessons(rec(true))
  const final = rec(true)
  writeJsonAtomic(path.join(process.cwd(), 'data', 'runs', `${opts.runId}.json`), final)
  // yearly stats, stories and trends for every country, state and real city, loaded lazily by the ui
  writePlaces(path.join(process.cwd(), 'data', 'runs', `${opts.runId}.places`), opts.runId, places, w)
  // full life histories of every pip that ever lived in this world, loaded lazily by the ui
  writeJsonAtomic(path.join(process.cwd(), 'data', 'runs', `${opts.runId}.lives.json`), { runId: opts.runId, lives: w.lifeArchive })
  if (live) writeJsonAtomic(path.join(process.cwd(), 'data', 'live', `${opts.runId}.json`), final)
  return final.summary
}

function record(opts: RunOpts, w: World, twin: World, frames: Frame[], baseline: BaselineFrame[], liveFlag: boolean, usage: Usage, lessonsLearned: Lesson[], knownLessons: Lesson[], snapshots: Snapshot[], branchedFrom?: RunRecord['branchedFrom']): RunRecord {
  const topEvents: WorldEvent[] = w.topEvents.map(e => ({ ...e }))
  const agentId = opts.agentId ?? 'unassigned'
  const summary: RunSummary = {
    runId: opts.runId, generation: opts.generation, status: w.status, endDate: dateOf(w.tick), ticks: w.tick,
    score: score(w), constitution: opts.constitution, peakPopulation: Math.round(Math.max(w.peakPop, worldPop(w))),
    moonStage: w.space.stage, topEvents,
    baselineStatus: twin.status, baselineEndDate: dateOf(twin.tick),
    frontier: w.frontier, peakPeriodLifeExpectancy: Math.round(Math.max(w.peakPLE, globalPLE(w)) * 10) / 10, finalPopulation: Math.round(worldPop(w)),
    citiesFounded: w.cities.length, diseasesEradicated: [...w.diseasesEradicated],
    humanCost: { deaths: Math.round(w.humanCost.deaths), famineDeaths: Math.round(w.humanCost.famineDeaths), unrestDeaths: Math.round(w.humanCost.unrestDeaths), displaced: Math.round(w.humanCost.displaced), approval: Math.round(w.humanCost.approval * 1e4) / 1e4 },
    lessonsLearned, lessonsApplied: w.lessonsApplied.size, usage: { ...usage }, agentId,
    ...(w.status === 'destroyed' ? { epitaph: epitaphFor(w, frames) } : {}),
    ...(w.causeOfDeath ? { causeOfDeath: w.causeOfDeath } : {}),
  }
  return {
    runId: opts.runId, generation: opts.generation, seed: opts.seed, constitution: opts.constitution, frames, baseline, summary,
    agentId, snapshots, precedents: lawPrecedents(w), lessons: knownLessons,
    ...(branchedFrom ? { branchedFrom } : {}),
    ...(liveFlag ? { live: true } : {}),
  }
}

function writeJsonAtomic(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data))
  fs.renameSync(tmp, file)
}

