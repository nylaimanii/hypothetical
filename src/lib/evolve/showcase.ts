// what the deployed site can replay: at most 20 gzipped worlds, only from real llm runs (never offline-fallback
// worlds). kept: goal worlds, worlds in the hall of history, and the best world of each lineage.
import type { RunRecord } from '../types'
import { readAgents } from './agents'
import { readHall } from './hall'
import { listShowcase, removeShowcase, writeShowcase } from './store'
import { byScore } from './facts'

export const SHOWCASE_MAX = 20
const NON_LLM = /^(offline governor|fallback:)/

// a world counts as a real llm run when it made llm calls and at most a fifth of its decisions fell back
export function llmShare(record: RunRecord): { decisions: number; fallback: number; calls: number } {
  const ds = record.frames.filter(f => f.decision).map(f => f.decision!)
  return { decisions: ds.length, fallback: ds.filter(d => NON_LLM.test(d.rationale)).length, calls: record.summary.usage?.llmCalls ?? 0 }
}
export function isRealLlmRun(record: RunRecord): boolean {
  const { decisions, fallback, calls } = llmShare(record)
  return calls > 0 && decisions > 0 && fallback / decisions <= 0.2
}

function lineageRoot(agentId: string, parents: Map<string, string | undefined>): string {
  let id = agentId
  for (let i = 0; i < 100 && parents.get(id); i++) id = parents.get(id)!
  return id
}

// offers a finished world to the showcase. returns true if it is in the showcase afterwards
export function considerShowcase(record: RunRecord, inHall: boolean): boolean {
  if (!isRealLlmRun(record)) return false
  const parents = new Map(readAgents().map(a => [a.id, a.parentIds[0]]))
  const root = lineageRoot(record.agentId, parents)
  const lineageBest = listShowcase().filter(s => lineageRoot(s.agentId, parents) === root).sort(byScore)[0]
  const wanted = inHall || record.summary.status === 'goal_achieved' || !lineageBest || record.summary.score > lineageBest.score
  if (wanted) writeShowcase(record)
  curate()
  return listShowcase().some(s => s.runId === record.runId)
}

// keeps the 20 that matter most; anything that is neither goal, hall nor best of its lineage is dropped
export function curate() {
  const idx = listShowcase()
  const hallRefs = new Map<string, number>()
  for (const e of readHall().entries) hallRefs.set(e.runId, (hallRefs.get(e.runId) ?? 0) + 1)
  const parents = new Map(readAgents().map(a => [a.id, a.parentIds[0]]))
  const bestOfLineage = new Map<string, { runId: string; score: number }>()
  for (const s of idx) {
    const root = lineageRoot(s.agentId, parents)
    const cur = bestOfLineage.get(root)
    if (!cur || s.score > cur.score) bestOfLineage.set(root, { runId: s.runId, score: s.score })
  }
  const lineageWinners = new Set([...bestOfLineage.values()].map(v => v.runId))
  const rank = (s: (typeof idx)[number]) =>
    (s.status === 'goal_achieved' ? 1e6 : 0) + (hallRefs.get(s.runId) ?? 0) * 1000 + (lineageWinners.has(s.runId) ? 500 : 0) + s.score
  const keep = new Set(
    idx.filter(s => s.status === 'goal_achieved' || hallRefs.has(s.runId) || lineageWinners.has(s.runId))
      .sort((a, b) => rank(b) - rank(a)).slice(0, SHOWCASE_MAX).map(s => s.runId),
  )
  for (const s of idx) if (!keep.has(s.runId)) removeShowcase(s.runId)
}
