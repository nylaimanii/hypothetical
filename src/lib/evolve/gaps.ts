// why one leaderboard entry beat the next, tested by replay (b's explainGap in src/lib/sim/ab.ts): on a seed both
// agents ran, the lower world is replayed with each of the higher world's decisions swapped in at its own tick, one at
// a time. the 3 swaps that move it furthest toward the higher world are the decisive decisions, each with the share of
// the gap it explains alone. pure replays need no model and no ollama lock, but a world is up to ~60 swaps of 5-10s,
// so this runs as a job after each generation (scripts/explain-gaps.ts), never inside a request.
// results: data/gaps.json, keyed "<higher agent>><lower agent>". the leaderboard serves them as explainGap with
// method 'replay'; until a pair has been replayed, the pattern comparison (evidence.ts) stands in, marked 'pattern'.
import fs from 'node:fs'
import path from 'node:path'
import type { Decision, RunRecord } from '../types'
import { people } from './facts'
import { readJson, readLeaderboard, readRunIndex, readRunRecord, writeJson, type LeaderboardEntry } from './store'

export type GapReasonText = { tick: number; date: string; share: number; text: string }
export type ReplayGap = {
  key: string; higher: string; lower: string; seed: number; simVersion?: string; higherRun: string; lowerRun: string
  measure: 'population'; gap: number; year: number; swaps: number; reasons: GapReasonText[]; text: string; at: string
}
export const gapsFile = () => path.join(process.cwd(), 'data', 'gaps.json')
export const readGaps = (): Record<string, ReplayGap> => readJson<Record<string, ReplayGap>>(gapsFile()) ?? {}
export const gapKey = (higher: string, lower: string) => `${higher}>${lower}`

const pct = (x: number) => `${Math.round(x * 100)}%`
const BUDGET = ['food', 'energy', 'education', 'space', 'security', 'welfare', 'research'] as const

// what the higher world's decision did differently at that tick, from the two recorded decisions
export function decisionDiff(higherName: string, hi: Decision, lo: Decision): string {
  const parts: string[] = []
  for (const k of BUDGET) {
    const a = hi.budget[k] ?? 0, b = lo.budget[k] ?? 0
    if (Math.abs(a - b) >= 0.03) parts.push(`put ${pct(a)} of the budget into ${k} (not ${pct(b)})`)
  }
  const loLaws = new Set(lo.laws.map(l => l.title.toLowerCase()))
  const hiLaws = new Set(hi.laws.map(l => l.title.toLowerCase()))
  for (const l of hi.laws) if (!loLaws.has(l.title.toLowerCase())) parts.push(`passed "${l.title}"`)
  for (const l of lo.laws) if (!hiLaws.has(l.title.toLowerCase())) parts.push(`did not pass "${l.title}"`)
  if (hi.religionPolicy !== lo.religionPolicy) parts.push(`kept religion policy ${hi.religionPolicy.replace(/_/g, ' ')}`)
  return parts.length ? `${higherName} ${parts.slice(0, 3).join(', ')}` : `${higherName} made the same call with different details`
}

// a seed both agents ran on the same sim version, preferring screening worlds (half the length, half the swaps)
export function sharedSeed(higher: string, lower: string): { higherRun: string; lowerRun: string; seed: number; simVersion?: string } | null {
  const idx = readRunIndex()
  const runsOf = (agent: string) => idx.filter(r => r.agentId === agent && /-s\d+$/.test(r.runId))
  const hi = runsOf(higher), lo = runsOf(lower)
  const pairs = hi.flatMap(h => lo.filter(l => l.seed === h.seed && (l.simVersion ?? '') === (h.simVersion ?? '') && /-full-/.test(l.runId) === /-full-/.test(h.runId)).map(l => ({ h, l })))
  // newest version first, screening before full, then the pair where the higher one really did better
  pairs.sort((a, b) => (b.h.simVersion ?? '').localeCompare(a.h.simVersion ?? '') || Number(/-full-/.test(a.h.runId)) - Number(/-full-/.test(b.h.runId)) || (b.h.score - b.l.score) - (a.h.score - a.l.score))
  const p = pairs[0]
  return p ? { higherRun: p.h.runId, lowerRun: p.l.runId, seed: p.h.seed, simVersion: p.h.simVersion } : null
}

type ExplainGap = (runA: string, runB: string, opts: { measure?: 'population'; top?: number; maxSwaps?: number }) => Promise<{ gap: { population: number }; reasons: { tick: number; date: string; share: number }[]; swaps: number }>

// replays one pair and writes it to data/gaps.json
export async function replayGap(higher: LeaderboardEntry, lower: LeaderboardEntry, explain: ExplainGap, read: (id: string) => RunRecord | null = readRunRecord): Promise<ReplayGap | null> {
  const s = sharedSeed(higher.candidateId, lower.candidateId)
  if (!s) return null
  // b's explainGap: A is the world being replayed (the lower one), B the one whose decisions are swapped in
  const r = await explain(s.lowerRun, s.higherRun, { measure: 'population', top: 3 })
  const hiRec = read(s.higherRun), loRec = read(s.lowerRun)
  if (!hiRec || !loRec) return null
  const dec = (rec: RunRecord, tick: number) => rec.frames.find(f => f.decision?.tick === tick)?.decision
  const reasons: GapReasonText[] = r.reasons.map(x => {
    const hi = dec(hiRec, x.tick), lo = dec(loRec, x.tick)
    return { tick: x.tick, date: x.date, share: x.share, text: `in ${x.date}, ${hi && lo ? decisionDiff(higher.name, hi, lo) : `${higher.name}'s decision`}, which alone explains ${pct(x.share)} of the gap` }
  })
  const year = Number((loRec.frames.at(-1)?.date || '').slice(0, 4)) || 2026 + Math.floor((loRec.frames.at(-1)!.tick + 10) / 12)
  const gap = r.gap.population
  const head = `on seed ${s.seed}, ${higher.name} ${gap >= 0 ? `had ${people(gap)} more people alive` : `had ${people(gap)} fewer people alive`} than ${lower.name} by ${year}.`
  const body = reasons.length ? ` replaying ${lower.name}'s world with ${higher.name}'s decisions swapped in one at a time, the ones that close the gap most: ${reasons.map(x => x.text).join('; ')}.` : ` no single swapped decision moved ${lower.name}'s world toward ${higher.name}'s (${r.swaps} tried), so the gap comes from many small ones together.`
  const out: ReplayGap = { key: gapKey(higher.candidateId, lower.candidateId), higher: higher.candidateId, lower: lower.candidateId, ...s, measure: 'population', gap, year, swaps: r.swaps, reasons, text: head + body, at: new Date().toISOString() }
  const all = readGaps()
  all[out.key] = out
  fs.mkdirSync(path.dirname(gapsFile()), { recursive: true })
  writeJson(gapsFile(), all)
  return out
}

// the leaderboard's top pairs that have no replay yet on their newest shared seed
export function pairsToReplay(top = 3): [LeaderboardEntry, LeaderboardEntry][] {
  const lb = readLeaderboard(), have = readGaps()
  const out: [LeaderboardEntry, LeaderboardEntry][] = []
  for (let i = 0; i < Math.min(top, lb.length - 1); i++) {
    const [a, b] = [lb[i], lb[i + 1]]
    if (a.candidateId === b.candidateId) continue
    const s = sharedSeed(a.candidateId, b.candidateId), g = have[gapKey(a.candidateId, b.candidateId)]
    if (s && !(g && g.higherRun === s.higherRun && g.lowerRun === s.lowerRun)) out.push([a, b])
  }
  return out
}

// what the leaderboard shows for entry i: the replayed explanation when there is one, else the pattern comparison
export function gapFor(lb: LeaderboardEntry[], i: number, gaps = readGaps()) {
  const a = lb[i], b = lb[i + 1]
  const g = b ? gaps[gapKey(a.candidateId, b.candidateId)] : undefined
  if (g) return { method: 'replay' as const, vs: g.lowerRun, seed: g.seed, gap: g.gap, decisive: g.reasons.map(r => r.text), text: g.text }
  return a.explainGap ? { method: 'pattern' as const, ...a.explainGap, text: `${a.explainGap.text} (from comparing their decisions; not yet tested by replay)` } : null
}
