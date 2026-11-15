// runWorld: the only simulation entry point (contract in CLAUDE.md).
// monthly step, governor every 12 ticks for 30 years then every 24, frame every opts.frameEvery ticks
// (default 12, live 1), at every decision and on death. a no-ai baseline twin runs on the same seed with
// 2026 policies frozen and no llm calls. full state snapshots every 60 ticks allow exact branching.
import fs from 'node:fs'
import path from 'node:path'
import type { BaselineFrame, Decision, Frame, Lesson, Override, RunOptions, RunRecord, RunSummary, Snapshot, WorldEvent } from '../types'
import { decide, type GovernorMemory } from '../agent/governor'
import { assertLlmReady, withUsage, type Usage } from '../agent/llm'
import { BASELINE_BUDGET, BASELINE_RELIGION, BASELINE_SCHOOL, dateOf, decisionDue } from './constants'
import { extractLessons, loadLessons } from '../agent/lessons'
import { globalPLE } from './end'
import { ageCitizens, initCitizens, pairPartners, refreshThoughts, syncCitizenCounts, updateMoods } from './citizens'
import { score } from './end'
import { applyEvent } from './events'
import { fmt } from './physics'
import { applyDecision, baselineFrame, lawPrecedents, snapshot, stepWorld } from './step'
import { SNAPSHOT_EVERY, restoreWorld, snapshotWorld } from './snapshot'
import { event, initWorld, regionPop, worldPop, type World } from './state'

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
// agentId stamps the record; startFrom branches from a saved run at a tick.
export type RunOpts = RunOptions & { agentId?: string; startFrom?: { runId: string; tick: number } }

export async function runWorld(opts: RunOpts): Promise<RunSummary> {
  // fail fast: a real run never quietly drops to the offline governor
  await assertLlmReady()
  const usage: Usage = { llmCalls: 0, tokens: 0 }
  const t0 = Date.now()
  const summary = await withUsage(usage, () => runInner(opts, usage))
  console.log(`[usage] ${opts.runId}: ${usage.llmCalls} llm calls, ${usage.tokens} tokens, ${((Date.now() - t0) / 1000).toFixed(1)}s wall`)
  return summary
}

export function loadRun(runId: string): RunRecord | null {
  for (const d of ['runs', 'showcase', 'live']) {
    try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', d, `${runId}.json`), 'utf8')) as RunRecord } catch { /* next */ }
  }
  return null
}

type Ctx = { mem: GovernorMemory; pendingOverrides: Override[]; snapshots: Snapshot[] }

// one month of the main world. shared by live runs, replays and branches so they execute identical code.
async function tickBody(w: World, ctx: Ctx, decideFn: (w: World) => Promise<Decision | undefined>, opts: { overrideDir?: string; llmThoughts: boolean }): Promise<Decision | undefined> {
  if (w.tick % SNAPSHOT_EVERY === 0) ctx.snapshots.push(snapshotWorld(w))
  ctx.pendingOverrides.push(...applyOverrides(w, opts.overrideDir, ctx.mem))
  let decision: Decision | undefined
  if (decisionDue(w.tick)) {
    const d = await decideFn(w)
    if (d) {
      const { migrations } = applyDecision(w, d)
      // record the enacted laws (real ids, metadata, support) and the migrations as ordered; how many really
      // moved is logged as an event. keeping the order (not the outcome) lets a branch replay this exactly.
      decision = { ...d, laws: w.laws.filter(l => l.enactedTick === w.tick).map(l => ({ ...l })) }
      for (const m of migrations) if (m.actual < m.requested) event(w, { kind: 'migration', regionId: m.from, text: `only ${fmt(m.actual)} of ${fmt(m.requested)} ordered to move actually left`, severity: 0.1 })
      ctx.mem.last = decision
      ctx.pendingOverrides = []
    }
  }
  if (w.tick % 12 === 0) {
    // yearly: birthdays, pip counts, partners, one batched thought call (thoughts never touch sim numbers)
    if (w.tick > 0) { ageCitizens(w); syncCitizenCounts(w); pairPartners(w) }
    updateMoods(w)
    await refreshThoughts(w, opts.llmThoughts)
  }
  return decision
}

async function runInner(opts: RunOpts, usage: Usage): Promise<RunSummary> {
  const live = !!opts.live
  const frameEvery = live ? 1 : Math.max(1, opts.frameEvery ?? 12)
  const knownLessons = loadLessons()
  const ctx: Ctx = { mem: { vetoedTitles: new Set(), lessons: knownLessons }, pendingOverrides: [], snapshots: [] }
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
    while (w.tick < target && w.status === 'alive') {
      await tickBody(w, ctx, async x => srcDecisions.get(x.tick), { llmThoughts: false })
      if (srcFrameTicks.has(w.tick)) { for (const rs of w.regions) rs.whyAcc = {}; w.frameCursor = w.events.length }
      stepWorld(w)
      updateMoods(w)
    }
    if (w.status !== 'alive') throw new Error(`startFrom: the source world had already ended by tick ${target}`)
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
  const emit = (decision?: Decision) => {
    const fresh = w.events.slice(w.frameCursor)
    w.frameCursor = w.events.length
    const f = snapshot(w, fresh, decision)
    frames.push(f)
    opts.onFrame?.(f)
    if (live) writeJsonAtomic(path.join(process.cwd(), 'data', 'live', `${opts.runId}.json`), rec(w.status !== 'alive'))
  }

  while (w.status === 'alive') {
    const decision = await tickBody(w, ctx, x => decide(x, opts.constitution, ctx.pendingOverrides, ctx.mem), { overrideDir: opts.overrideDir, llmThoughts: true })
    if (w.tick % frameEvery === 0 || decision) emit(decision)
    stepWorld(w)
    stepTwin()
    updateMoods(w)
    if (w.status !== 'alive') { ctx.snapshots.push(snapshotWorld(w)); emit() }
    else if (live) await sleep(opts.live!.msPerTick)
  }
  while (twin.status === 'alive') stepTwin()
  if (w.status === 'destroyed') lessonsLearned = await extractLessons(rec(true))
  const final = rec(true)
  writeJsonAtomic(path.join(process.cwd(), 'data', 'runs', `${opts.runId}.json`), final)
  if (live) writeJsonAtomic(path.join(process.cwd(), 'data', 'live', `${opts.runId}.json`), final)
  return final.summary
}

function record(opts: RunOpts, w: World, twin: World, frames: Frame[], baseline: BaselineFrame[], liveFlag: boolean, usage: Usage, lessonsLearned: Lesson[], knownLessons: Lesson[], snapshots: Snapshot[], branchedFrom?: RunRecord['branchedFrom']): RunRecord {
  const topEvents: WorldEvent[] = w.events.filter(e => e.kind !== 'law' && e.kind !== 'override').slice().sort((a, b) => b.significance - a.significance || b.severity - a.severity || a.tick - b.tick).slice(0, 8)
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

