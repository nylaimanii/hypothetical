// the cross-world recipe (GET /api/steps, data/steps.json): which decisions show up in the worlds that did best
// for everyone, and which show up in the dead ones. only real llm runs count.
//
// every finished world gets a small feature row in data/runs/features.json (so the big records are parsed once):
//   features: budget shifts vs the typical world, laws by policyKind (and whether enacted in the first 10 years),
//   religion and school policy, cities founded (and how early), research focus
//   outcome: score, period life expectancy, population trend, human cost, approval, survival
// worlds are compared inside their own horizon (50-year screening vs 100-year full runs), as z-scores.
import fs from 'node:fs'
import path from 'node:path'
import type { Budget, RunRecord, Step } from '../types'
import { dirs, readJson, readRunIndex, readRunRecord, writeJson } from './store'
import { isRealLlmRun } from './showcase'
import { currentVersion, versionedPath } from './version'

const BUDGET_KEYS: (keyof Budget)[] = ['food', 'energy', 'education', 'space', 'security', 'welfare', 'research']
const featuresFile = () => path.join(process.cwd(), 'data', 'runs', 'features.json')
const stepsFile = (v?: string | null) => versionedPath('steps.json', v)

export type RunFeatures = {
  runId: string; agentId: string; generation: number; horizon: 'screen' | 'full'
  budget: Budget; lawFirstTick: Record<string, number>; religion: string; schoolYearsMax: number
  citiesFirstTick: number | null; research: Record<string, number>; decisions: number
  outcome: { score: number; le: number; popTrend: number; deathRatio: number; approval: number; destroyed: boolean }
}
export type StepsFile = { computedAt: string; worlds: number; helped: Step[]; hurt: Step[] }

const words = (s: string) => s.replace(/[_-]+/g, ' ').trim()
const pct = (x: number) => `${Math.round(x * 100)}%`

export function featuresOf(rec: RunRecord): RunFeatures {
  const decided = rec.frames.filter(f => f.decision).sort((a, b) => a.tick - b.tick).map(f => f.decision!)
  const budget = Object.fromEntries(BUDGET_KEYS.map(k => [k, decided.length ? decided.reduce((a, d) => a + (d.budget[k] ?? 0), 0) / decided.length : 0])) as Budget
  const lawFirstTick: Record<string, number> = {}
  for (const d of decided) for (const l of d.laws) if (l.policyKind && lawFirstTick[l.policyKind] === undefined) lawFirstTick[l.policyKind] = d.tick
  const rel = new Map<string, number>()
  for (const d of decided) rel.set(d.religionPolicy, (rel.get(d.religionPolicy) ?? 0) + 1)
  const research: Record<string, number> = {}
  for (const d of decided) for (const r of new Set(d.researchFocus ?? [])) research[r] = (research[r] ?? 0) + 1
  const cityTick = decided.find(d => d.foundCities?.length)?.tick ?? null
  const s = rec.summary
  const last = rec.frames[rec.frames.length - 1]
  return {
    runId: rec.runId, agentId: rec.agentId, generation: rec.generation, horizon: s.ticks > 600 || /-full-s\d+$/.test(rec.runId) ? 'full' : 'screen',
    budget, lawFirstTick, religion: [...rel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'free',
    schoolYearsMax: Math.max(0, ...decided.map(d => d.schoolPolicy.yearsRequired)), citiesFirstTick: cityTick, research, decisions: decided.length,
    outcome: {
      score: s.score, le: s.peakPeriodLifeExpectancy ?? 0,
      popTrend: s.peakPopulation ? (s.finalPopulation || last?.globalPopulation || 0) / s.peakPopulation : 0,
      deathRatio: s.peakPopulation ? (s.humanCost?.deaths ?? 0) / s.peakPopulation : 0,
      approval: s.humanCost?.approval ?? 0, destroyed: s.status === 'destroyed',
    },
  }
}

export function readFeatures(): Record<string, RunFeatures> {
  return readJson<Record<string, RunFeatures>>(featuresFile()) ?? {}
}

// called after every finished world. offline-fallback worlds are not real evidence and are skipped
export function indexFeatures(rec: RunRecord) {
  if (!isRealLlmRun(rec)) return
  const all = readFeatures()
  all[rec.runId] = featuresOf(rec)
  writeJson(featuresFile(), all)
}

// fills in any real run that finished before the feature index existed
function backfill(all: Record<string, RunFeatures>): Record<string, RunFeatures> {
  let changed = false
  const v = currentVersion()
  for (const r of readRunIndex()) {
    if (all[r.runId] || (r.simVersion && r.simVersion !== v) || (r.status === 'alive' && r.ticks < 600)) continue
    const rec = readRunRecord(r.runId)
    if (rec && isRealLlmRun(rec)) { all[r.runId] = featuresOf(rec); changed = true }
  }
  if (changed) writeJson(featuresFile(), all)
  return all
}

type Feature = { key: string; text: string; kind: Step['kind'] }

// which recipe features a world has, given the typical world's budget
function featureList(f: RunFeatures, median: Budget): Feature[] {
  const out: Feature[] = []
  for (const k of BUDGET_KEYS) {
    const v = f.budget[k], m = median[k]
    if (v >= m * 1.2 && v - m >= 0.02) out.push({ key: `budget-high-${k}`, kind: 'budget', text: `spend more on ${k} than most worlds (about ${pct(v)} of the budget)` })
    if (v <= m * 0.8 && m - v >= 0.02) out.push({ key: `budget-low-${k}`, kind: 'budget', text: `spend less on ${k} than most worlds (about ${pct(v)} of the budget)` })
  }
  for (const [kind, tick] of Object.entries(f.lawFirstTick)) {
    out.push({ key: `law-${kind}`, kind: 'law', text: `pass a ${words(kind)} law` })
    if (tick < 120) out.push({ key: `law-early-${kind}`, kind: 'law', text: `pass a ${words(kind)} law in the first 10 years` })
  }
  out.push({ key: `religion-${f.religion}`, kind: 'policy', text: `keep religion policy ${words(f.religion)}` })
  if (f.schoolYearsMax >= 12) out.push({ key: 'school-long', kind: 'policy', text: 'require 12 or more years of school' })
  if (f.schoolYearsMax > 0 && f.schoolYearsMax <= 9) out.push({ key: 'school-short', kind: 'policy', text: 'require 9 or fewer years of school' })
  if (f.citiesFirstTick !== null) {
    out.push({ key: 'cities', kind: 'city', text: 'found new cities' })
    if (f.citiesFirstTick < 240) out.push({ key: 'cities-early', kind: 'city', text: 'found new cities in the first 20 years' })
  }
  for (const [r, n] of Object.entries(f.research)) if (f.decisions && n / f.decisions >= 0.3) out.push({ key: `research-${r}`, kind: 'research', text: `keep research focused on ${words(r)}` })
  return out
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0 }
function z(xs: number[]): number[] {
  const m = mean(xs), sd = Math.sqrt(mean(xs.map(x => (x - m) ** 2)))
  return xs.map(x => (sd > 1e-9 ? (x - m) / sd : 0))
}
const r2 = (x: number) => Math.round(x * 100) / 100

// "did best for everyone": mission score, lifespan and a population that holds, minus the human cost, plus approval
function goodness(runs: RunFeatures[]): Map<string, number> {
  const g = new Map<string, number>()
  for (const horizon of ['screen', 'full'] as const) {
    const group = runs.filter(r => r.horizon === horizon)
    if (!group.length) continue
    const [s, le, pop, dead, ap] = (['score', 'le', 'popTrend', 'deathRatio', 'approval'] as const).map(k => z(group.map(r => r.outcome[k])))
    group.forEach((r, i) => g.set(r.runId, s[i] + 0.5 * le[i] + 0.5 * pop[i] - 0.5 * dead[i] + 0.25 * ap[i] - (r.outcome.destroyed ? 1 : 0)))
  }
  return g
}

export function computeSteps(runs: RunFeatures[], top = 15): StepsFile {
  const at = new Date().toISOString()
  if (runs.length < 2) return { computedAt: at, worlds: runs.length, helped: [], hurt: [] }
  const med = Object.fromEntries(BUDGET_KEYS.map(k => [k, median(runs.map(r => r.budget[k]))])) as Budget
  const g = goodness(runs)
  const gMed = median([...g.values()])
  const has = new Map<string, { f: Feature; runs: RunFeatures[] }>()
  for (const r of runs) for (const f of featureList(r, med)) {
    const e = has.get(f.key) ?? { f, runs: [] }
    e.runs.push(r)
    has.set(f.key, e)
  }
  const dead = runs.filter(r => r.outcome.destroyed), alive = runs.filter(r => !r.outcome.destroyed)
  const scored = [...has.values()].map(({ f, runs: withF }) => {
    const ids = new Set(withF.map(r => r.runId))
    const without = runs.filter(r => !ids.has(r.runId))
    const effect = mean(withF.map(r => g.get(r.runId)!)) - mean(without.map(r => g.get(r.runId)!))
    // confidence grows with the smaller of the two samples
    const confidence = r2(1 - 1 / Math.sqrt(1 + Math.min(withF.length, without.length)))
    const lift = (dead.length ? dead.filter(r => ids.has(r.runId)).length / dead.length : 0) - (alive.length ? alive.filter(r => ids.has(r.runId)).length / alive.length : 0)
    const step: Step = {
      id: f.key, text: f.text, kind: f.kind, effect: r2(effect), confidence,
      helpedWorlds: withF.filter(r => !r.outcome.destroyed && g.get(r.runId)! >= gMed).map(r => r.runId),
      hurtWorlds: withF.filter(r => r.outcome.destroyed || g.get(r.runId)! < gMed).map(r => r.runId),
    }
    return { step, n: withF.length, nOut: without.length, lift }
  }).filter(x => x.n >= 2 && x.nOut >= 1)
  const helped = scored.filter(x => x.step.effect > 0).sort((a, b) => b.step.effect * b.step.confidence - a.step.effect * a.step.confidence).slice(0, top).map(x => x.step)
  const taken = new Set(helped.map(s => s.id))
  const hurt = scored.filter(x => x.lift > 0 && !taken.has(x.step.id)).sort((a, b) => b.lift * b.step.confidence - a.lift * a.step.confidence || a.step.effect - b.step.effect).slice(0, top).map(x => x.step)
  return { computedAt: at, worlds: runs.length, helped, hurt }
}

// after every generation: recompute over every real world and save
export function recomputeSteps(): StepsFile {
  const all = backfill(readFeatures())
  const out = computeSteps(Object.values(all))
  writeJson(stepsFile(), out)
  return out
}

export function readSteps(v?: string | null): StepsFile | null {
  return readJson<StepsFile>(stepsFile(v))
}

// a recipe over just these worlds (the ui's open tabs). unknown ids are ignored
export function stepsFor(runIds: string[]): StepsFile {
  const all = readFeatures()
  return computeSteps(runIds.map(id => all[id]).filter((r): r is RunFeatures => !!r))
}

// the saved recipe, refreshed when worlds have finished since it was computed (so the api stays current even
// when the evolve process running right now predates the per-generation recompute)
export function freshSteps(allowWrite: boolean): StepsFile | null {
  const saved = readSteps()
  if (!allowWrite) return saved
  let indexAt = 0
  try { indexAt = fs.statSync(path.join(dirs.runs, 'index.json')).mtimeMs } catch { return saved }
  if (saved && Date.parse(saved.computedAt) >= indexAt) return saved
  return recomputeSteps()
}
