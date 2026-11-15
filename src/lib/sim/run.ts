// runWorld: the only simulation entry point (contract in CLAUDE.md).
// monthly step, governor every 12 ticks, frame every opts.frameEvery ticks (default 12, live 1) and on death.
// a no-ai baseline twin runs on the same seed with 2026 policies frozen and no llm calls.
import fs from 'node:fs'
import path from 'node:path'
import type { BaselineFrame, Decision, Frame, Override, RunOptions, RunRecord, RunSummary, WorldEvent } from '../types'
import { decide, type GovernorMemory } from '../agent/governor'
import { withUsage, type Usage } from '../agent/groq'
import { BASELINE_BUDGET, BASELINE_RELIGION, BASELINE_SCHOOL, GOVERNOR_EVERY, dateOf } from './constants'
import { ageCitizens, initCitizens, refreshThoughts, syncCitizenCounts, updateMoods } from './citizens'
import { score } from './end'
import { applyEvent } from './events'
import { fmt } from './physics'
import { applyDecision, baselineFrame, snapshot, stepWorld } from './step'
import { event, initWorld, regionPop, worldPop, type World } from './state'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const BASELINE_DECISION = (tick: number): Decision => ({
  tick, laws: [], repeal: [], migrations: [], budget: { ...BASELINE_BUDGET }, religionPolicy: BASELINE_RELIGION,
  schoolPolicy: { ...BASELINE_SCHOOL, curriculum: [...BASELINE_SCHOOL.curriculum] }, rationale: 'baseline twin: 2026 policies frozen', respondedToOverrides: [],
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

export async function runWorld(opts: RunOptions): Promise<RunSummary> {
  const usage: Usage = { llmCalls: 0, tokens: 0 }
  const summary = await withUsage(usage, () => runInner(opts, usage))
  console.log(`[usage] ${opts.runId}: ${usage.llmCalls} llm calls, ${usage.tokens} tokens`)
  return summary
}

async function runInner(opts: RunOptions, usage: Usage): Promise<RunSummary> {
  const live = !!opts.live
  const frameEvery = live ? 1 : Math.max(1, opts.frameEvery ?? 12)
  const w = initWorld(opts.seed, false)
  const twin = initWorld(opts.seed, true)
  initCitizens(w)
  const mem: GovernorMemory = { vetoedTitles: new Set() }
  const frames: Frame[] = []
  const baseline: BaselineFrame[] = [baselineFrame(twin)]
  let pendingOverrides: Override[] = []
  let eventCursor = 0

  const writeLive = (done: boolean) => {
    if (!live) return
    const rec = record(opts, w, twin, frames, baseline, !done, usage)
    writeJsonAtomic(path.join(process.cwd(), 'data', 'live', `${opts.runId}.json`), rec)
  }
  const emit = (decision?: Decision) => {
    const fresh = w.events.slice(eventCursor)
    eventCursor = w.events.length
    const f = snapshot(w, fresh, decision)
    frames.push(f)
    opts.onFrame?.(f)
    writeLive(w.status !== 'alive')
  }

  applyDecision(twin, BASELINE_DECISION(0))
  while (w.status === 'alive') {
    pendingOverrides.push(...applyOverrides(w, opts.overrideDir, mem))
    let decision: Decision | undefined
    if (w.tick % GOVERNOR_EVERY === 0) {
      const d = await decide(w, opts.constitution, pendingOverrides, mem)
      const { migrations } = applyDecision(w, d)
      // record what actually happened: real law ids and support, and how many people really moved
      decision = {
        ...d,
        laws: w.laws.filter(l => l.enactedTick === w.tick).map(l => ({ ...l })),
        migrations: migrations.map(m => ({ from: m.from, to: m.to, people: m.actual, reason: d.migrations.find(x => x.from === m.from && x.to === m.to)?.reason ?? '' })),
      }
      for (const m of migrations) if (m.actual < m.requested) event(w, { kind: 'migration', regionId: m.from, text: `only ${fmt(m.actual)} of ${fmt(m.requested)} ordered to move actually left`, severity: 0.1 })
      mem.last = decision
      pendingOverrides = []
      if (w.tick > 0) { ageCitizens(w); syncCitizenCounts(w) }
      updateMoods(w)
      await refreshThoughts(w, true)
    }
    if (w.tick % frameEvery === 0) emit(decision)
    stepWorld(w)
    if (twin.status === 'alive') {
      stepWorld(twin)
      if (twin.tick % 12 === 0 || twin.status !== 'alive') baseline.push(baselineFrame(twin))
    }
    updateMoods(w)
    if (w.status !== 'alive') emit()
    else if (live) await sleep(opts.live!.msPerTick)
  }
  // finish the twin so the ui can compare outcomes
  while (twin.status === 'alive') {
    stepWorld(twin)
    if (twin.tick % 12 === 0 || twin.status !== 'alive') baseline.push(baselineFrame(twin))
  }
  const rec = record(opts, w, twin, frames, baseline, false, usage)
  writeJsonAtomic(path.join(process.cwd(), 'data', 'runs', `${opts.runId}.json`), rec)
  if (live) writeJsonAtomic(path.join(process.cwd(), 'data', 'live', `${opts.runId}.json`), rec)
  return rec.summary
}

function record(opts: RunOptions, w: World, twin: World, frames: Frame[], baseline: BaselineFrame[], liveFlag: boolean, usage: Usage): RunRecord {
  const topEvents: WorldEvent[] = w.events.filter(e => e.kind !== 'law' && e.kind !== 'override').slice().sort((a, b) => b.severity - a.severity || a.tick - b.tick).slice(0, 8)
  const summary: RunSummary = {
    runId: opts.runId, generation: opts.generation, status: w.status, endDate: dateOf(w.tick), ticks: w.tick,
    score: score(w), constitution: opts.constitution, peakPopulation: Math.round(Math.max(w.peakPop, worldPop(w))),
    moonStage: w.space.stage, topEvents,
    baselineStatus: twin.status, baselineEndDate: dateOf(twin.tick),
    ...(w.causeOfDeath ? { causeOfDeath: w.causeOfDeath } : {}),
  }
  // usage is not in A's RunSummary type yet; attached untyped so C's tracker can prefer it (it checks for summary.usage)
  Object.assign(summary, { usage: { ...usage } })
  return { runId: opts.runId, generation: opts.generation, seed: opts.seed, constitution: opts.constitution, frames, baseline, summary, ...(liveFlag ? { live: true } : {}) }
}

function writeJsonAtomic(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data))
  fs.renameSync(tmp, file)
}

