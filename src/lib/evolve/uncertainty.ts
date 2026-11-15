// uncertainty: the top 3 agents of each sim version also run 5 extra seeds (full 100-year runs, the same seeds for
// every agent, once per agent per version). wherever an agent has several full runs, reports, telegram and the api
// show ranges ("mars crewed by 2068-2081 in 4 of 5 runs") instead of single numbers.
import type { Frame, Frontier, RunRecord } from '../types'
import { FRONTIER_ORDER } from './agents'
import { readJson, readRunIndex, writeJson, type IndexedRun } from './store'
import { currentVersion, versionedPath } from './version'

export const EXTRA_SEEDS = [9001, 9002, 9003, 9004, 9005]
export const UNCERTAINTY_TOP = 3
const file = () => versionedPath('uncertainty.json')

// agents that already got their extra seeds on this version
export type UncertaintyFile = { done: Record<string, { at: string; runIds: string[] }> }
export const readUncertainty = (): UncertaintyFile => readJson<UncertaintyFile>(file()) ?? { done: {} }
export function markUncertaintyDone(agentId: string, runIds: string[]) {
  const u = readUncertainty()
  u.done[agentId] = { at: new Date().toISOString(), runIds }
  writeJson(file(), u)
}

const isFull = (runId: string) => /-full-s\d+$/.test(runId)
const yearOf = (tick: number) => 2026 + Math.floor((tick + 10) / 12)

// the year each frontier stage was first reached (dated by the launch or breakthrough behind it)
export function milestoneYears(rec: RunRecord): Partial<Record<Frontier, number>> {
  const out: Partial<Record<Frontier, number>> = {}
  const frames = [...rec.frames].sort((a, b) => a.tick - b.tick)
  for (const f of FRONTIER_ORDER.slice(1)) {
    const i = frames.findIndex((fr: Frame) => fr.frontier === f)
    if (i < 0) continue
    const ev = frames[i].newEvents.filter(e => (e.kind === 'launch' || e.kind === 'breakthrough') && (e.significance ?? e.severity) >= 0.8 && !/fail/i.test(e.text)).sort((a, b) => a.tick - b.tick)[0]
    out[f] = yearOf(ev?.tick ?? frames[i].tick)
  }
  return out
}

// the top agents of the current version by their best full 100-year world
export function versionTopAgents(n = UNCERTAINTY_TOP): string[] {
  const v = currentVersion()
  const best = new Map<string, number>()
  for (const r of readRunIndex()) {
    if (!isFull(r.runId) || (r.simVersion && r.simVersion !== v)) continue
    best.set(r.agentId, Math.max(best.get(r.agentId) ?? -Infinity, r.score))
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id)
}

type Span = { min: number; max: number; median: number }
export type AgentRanges = {
  agentId: string; runs: number
  score: Span; lifeExpectancy: Span; finalPopulation: Span; deaths: Span
  died: number
  milestones: { frontier: Frontier; reached: number; of: number; from: number; to: number }[]
  lines: string[] // plain words, e.g. "mars crewed by 2068-2081 in 4 of 5 runs"
}

const span = (xs: number[]): Span => {
  const s = [...xs].sort((a, b) => a - b)
  return { min: s[0], max: s[s.length - 1], median: s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
}
const pop = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${(n / 1e6).toFixed(0)}M`
const words = (s: string) => s.replace(/_/g, ' ')
const range = (a: string, b: string) => (a === b ? a : `${a}-${b}`)

// ranges over an agent's full runs on the current version (null when it has fewer than 2)
export function agentRanges(agentId: string, runs: IndexedRun[] = readRunIndex()): AgentRanges | null {
  const v = currentVersion()
  const mine = runs.filter(r => r.agentId === agentId && isFull(r.runId) && (!r.simVersion || r.simVersion === v))
  if (mine.length < 2) return null
  const n = mine.length
  const score = span(mine.map(r => r.score)), le = span(mine.map(r => r.peakPeriodLifeExpectancy ?? 0))
  const fin = span(mine.map(r => r.finalPopulation ?? 0)), deaths = span(mine.map(r => r.humanCost?.deaths ?? 0))
  const died = mine.filter(r => r.status === 'destroyed').length
  const milestones = FRONTIER_ORDER.slice(1).map(f => {
    const ys = mine.map(r => r.milestones?.[f]).filter((y): y is number => typeof y === 'number')
    return ys.length ? { frontier: f, reached: ys.length, of: n, from: Math.min(...ys), to: Math.max(...ys) } : null
  }).filter((m): m is NonNullable<typeof m> => !!m)
  const lines = [
    ...milestones.map(m => `${words(m.frontier)} by ${range(String(m.from), String(m.to))} in ${m.reached} of ${m.of} runs`),
    `period life expectancy ${range(le.min.toFixed(0), le.max.toFixed(0))} years`,
    `${range(pop(fin.min), pop(fin.max))} people at the end, ${range(pop(deaths.min), pop(deaths.max))} deaths`,
    died ? `died in ${died} of ${n} runs` : `survived all ${n} runs`,
  ]
  return { agentId, runs: n, score, lifeExpectancy: le, finalPopulation: fin, deaths, died, milestones, lines }
}
