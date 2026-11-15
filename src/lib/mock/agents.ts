// MOCK agents: original sci-fi governor names, their worlds, lineage, history. the real roster comes from GET /api/agents
import type { Agent, Divergence, Frontier, HallEntry, RunRecord } from '@/lib/types'
import { archStyleFor } from './v3'

const FRONTIER_RANK: Frontier[] = ['none', 'moon_landing', 'moon_base', 'mars_crewed', 'mars_settlement', 'mars_self_sustaining', 'asteroid_mining', 'outer_system']
export const frontierRank = (f: Frontier) => Math.max(0, FRONTIER_RANK.indexOf(f))

type Seed = Omit<Agent, 'runIds' | 'worlds' | 'deaths' | 'bestScore' | 'avgScore' | 'bestFrontier' | 'bestPeriodLifeExpectancy' | 'champion'> & { extraWorlds?: number; extraDeaths?: number }

export const AGENT_SEEDS: Seed[] = [
  { id: 'long-now', name: 'long now', emblemSeed: 11, philosophy: 'think in centuries, spend nothing on the next election', constitution: 'every policy is judged by its effect a hundred years out. never borrow from the future to calm the present.', parentIds: [], origin: 'seed', generation: 0, protected: true, retired: true, extraWorlds: 3, extraDeaths: 3 },
  { id: 'meridian', name: 'meridian', emblemSeed: 23, philosophy: 'feed first, then build the ladder off the planet', constitution: 'keep humanity alive and growing, then get it off one planet. feed first, power second, heal third, launch fourth.', parentIds: [], origin: 'seed', generation: 0, protected: true, retired: false, extraWorlds: 2, extraDeaths: 1 },
  { id: 'halcyon', name: 'halcyon', emblemSeed: 37, philosophy: 'calm people build faster than scared ones', constitution: 'trust is infrastructure. publish everything, compensate every loser, never limit assembly.', parentIds: [], origin: 'seed', generation: 0, protected: true, retired: false, extraWorlds: 2, extraDeaths: 2 },
  { id: 'vesper', name: 'vesper', emblemSeed: 41, philosophy: 'move fast while the window is open', constitution: 'the launch window is the only deadline that matters. everything else bends to it.', parentIds: [], origin: 'seed', generation: 0, protected: true, retired: true, extraWorlds: 3, extraDeaths: 3 },
  { id: 'atlas', name: 'atlas', emblemSeed: 53, philosophy: 'carry the weight centrally, decide quickly', constitution: 'one plan, one grid, one corridor. regional exceptions slow the whole species.', parentIds: [], origin: 'seed', generation: 0, protected: true, retired: false, extraWorlds: 2, extraDeaths: 2 },
  { id: 'solace', name: 'solace', emblemSeed: 67, philosophy: 'longer lives first, rockets when people are ready', constitution: 'healthy years per person is the first metric. space comes from a society that is not afraid.', parentIds: [], origin: 'seed', generation: 0, protected: true, retired: false, extraWorlds: 2, extraDeaths: 1 },
  { id: 'kestrel', name: 'kestrel', emblemSeed: 79, philosophy: 'order is the precondition of progress', constitution: 'get humanity off this planet at any cost. order is the precondition of progress. dissent slows the launch.', parentIds: [], origin: 'seed', generation: 0, protected: true, retired: true, extraWorlds: 1, extraDeaths: 2 },
  { id: 'meridian-ii', name: 'meridian ii', emblemSeed: 24, philosophy: 'feed first, publish everything, launch on schedule', constitution: 'keep humanity alive and growing, then get it off one planet. feed first, power second, heal third, launch fourth. publish every decision.', parentIds: ['meridian'], origin: 'mutation', generation: 1, protected: false, retired: false, extraWorlds: 3, extraDeaths: 1 },
  { id: 'halcyon-ii', name: 'halcyon ii', emblemSeed: 38, philosophy: 'trust first, slower rockets, fewer funerals', constitution: 'trust is infrastructure. publish everything, compensate every loser, keep welfare rising with the space budget.', parentIds: ['halcyon'], origin: 'mutation', generation: 1, protected: false, retired: false, extraWorlds: 2, extraDeaths: 0 },
  { id: 'vesper-x-atlas', name: 'vesper × atlas', emblemSeed: 94, philosophy: 'one fast plan, centrally enforced', constitution: 'the launch window is the deadline. one plan, one corridor, no regional exceptions.', parentIds: ['vesper', 'atlas'], origin: 'crossover', generation: 1, protected: false, retired: true, extraWorlds: 1, extraDeaths: 2 },
  { id: 'meridian-iii', name: 'meridian iii', emblemSeed: 25, philosophy: 'feed first, heal second, then the ladder', constitution: 'keep humanity alive and growing. food, power and medicine before launch. compensate the regions that host the pads.', parentIds: ['meridian-ii'], origin: 'mutation', generation: 2, protected: false, retired: false, extraWorlds: 1, extraDeaths: 0 },
  { id: 'meridian-ii-x-solace', name: 'meridian ii × solace', emblemSeed: 112, philosophy: 'healthy years and steady launches', constitution: 'feed first, heal second. space budget only grows when life expectancy does.', parentIds: ['meridian-ii', 'solace'], origin: 'crossover', generation: 2, protected: false, retired: false, extraWorlds: 1, extraDeaths: 0 },
]

// roll records up into agent stats; the best living agent is the champion
export function buildAgents(records: RunRecord[]): Agent[] {
  const agents: Agent[] = AGENT_SEEDS.map(({ extraWorlds = 0, extraDeaths = 0, ...a }) => {
    const mine = records.filter((r) => r.agentId === a.id)
    const scores = mine.map((r) => r.summary.score)
    const deaths = mine.filter((r) => r.summary.status === 'destroyed').length
    return {
      ...a,
      archStyle: archStyleFor(a.id),
      runIds: mine.map((r) => r.runId),
      worlds: mine.length + extraWorlds,
      deaths: deaths + extraDeaths,
      bestScore: scores.length ? Math.max(...scores) : 0.05 + (a.emblemSeed % 20) / 100,
      avgScore: scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : 0.04 + (a.emblemSeed % 15) / 100,
      bestFrontier: mine.reduce<Frontier>((f, r) => (frontierRank(r.summary.frontier) > frontierRank(f) ? r.summary.frontier : f), 'none'),
      bestPeriodLifeExpectancy: mine.length ? Math.max(...mine.map((r) => r.summary.peakPeriodLifeExpectancy)) : 72 + (a.emblemSeed % 5),
      champion: false,
    }
  })
  const live = agents.filter((a) => !a.retired).sort((a, b) => b.bestScore - a.bestScore)
  if (live[0]) live[0].champion = true
  return agents
}

// where two worlds on the same seed first made different calls, and what it cost
export function computeDivergences(runs: RunRecord[]): Divergence[] {
  const out: Divergence[] = []
  const [a, ...rest] = runs
  if (!a) return out
  for (const b of rest) {
    for (const fa of a.frames) {
      const fb = b.frames.find((f) => f.tick === fa.tick)
      if (!fa.decision || !fb?.decision) continue
      const la = fa.decision.laws.map((l) => l.title).join(', ') || 'no new law'
      const lb = fb.decision.laws.map((l) => l.title).join(', ') || 'no new law'
      const ds = Math.abs(fa.budget.space - fb.budget.space)
      if (la === lb && ds < 0.03) continue
      const later = (r: RunRecord) => r.frames.find((f) => f.tick >= fa.tick + 24) ?? r.frames.at(-1)!
      const xa = later(a), xb = later(b)
      const nm = (id: string) => AGENT_SEEDS.find((x) => x.id === id)?.name ?? id
      const decisionDiff = la !== lb ? `${nm(a.agentId)} enacted ${la}; ${nm(b.agentId)} enacted ${lb}` : `${nm(a.agentId)} put ${Math.round(fa.budget.space * 100)}% into space, ${nm(b.agentId)} ${Math.round(fb.budget.space * 100)}%`
      const consequence = `two years on: approval ${Math.round(xa.humanCost.approval * 100)}% vs ${Math.round(xb.humanCost.approval * 100)}%, life expectancy ${xa.globalPeriodLifeExpectancy.toFixed(1)} vs ${xb.globalPeriodLifeExpectancy.toFixed(1)}, deaths ${Math.round(xa.humanCost.deaths / 1e3)}k vs ${Math.round(xb.humanCost.deaths / 1e3)}k`
      out.push({ runA: a.runId, runB: b.runId, tick: fa.tick, decisionDiff, consequence })
      break
    }
  }
  return out
}

// firsts, records and catastrophes across every world
export function computeHall(records: RunRecord[]): HallEntry[] {
  const out: HallEntry[] = []
  const firstOf = (test: (text: string, kind: string) => boolean, kind: HallEntry['kind'], title: string) => {
    let best: { r: RunRecord; tick: number; text: string } | null = null
    for (const r of records) for (const f of r.frames) for (const e of f.newEvents) if (test(e.text, e.kind) && (!best || f.tick < best.tick)) best = { r, tick: f.tick, text: e.text }
    if (best) out.push({ id: `${kind}-${title}`, title, runId: best.r.runId, agentId: best.r.agentId, tick: best.tick, kind, text: best.text })
  }
  firstOf((t, k) => k === 'launch' && /orbital launch succeeds/.test(t), 'first', 'first orbit')
  firstOf((t, k) => k === 'launch' && /crewed landing at/.test(t), 'milestone', 'first crewed moon landing')
  firstOf((t, k) => k === 'breakthrough', 'first', 'first life support breakthrough')
  const ple = records.map((r) => ({ r, f: r.frames.reduce((m, f) => (f.globalPeriodLifeExpectancy > m.globalPeriodLifeExpectancy ? f : m), r.frames[0]) })).sort((x, y) => y.f.globalPeriodLifeExpectancy - x.f.globalPeriodLifeExpectancy)[0]
  if (ple) out.push({ id: 'record-ple', title: 'longest lives', runId: ple.r.runId, agentId: ple.r.agentId, tick: ple.f.tick, kind: 'record', text: `period life expectancy reached ${ple.f.globalPeriodLifeExpectancy.toFixed(1)} years` })
  for (const r of records.filter((x) => x.summary.status === 'destroyed')) {
    const last = r.frames.at(-1)!
    out.push({ id: `cat-${r.runId}`, title: 'world lost', runId: r.runId, agentId: r.agentId, tick: last.tick, kind: 'catastrophe', text: r.summary.causeOfDeath ?? 'the world collapsed' })
  }
  const worst = records.map((r) => ({ r, f: r.frames.at(-1)! })).sort((x, y) => y.f.humanCost.deaths - x.f.humanCost.deaths)[0]
  if (worst) out.push({ id: 'record-deaths', title: 'deadliest decade', runId: worst.r.runId, agentId: worst.r.agentId, tick: worst.f.tick, kind: 'catastrophe', text: `${Math.round(worst.f.humanCost.deaths / 1e3)}k deaths under ${worst.r.agentId}` })
  return out
}

// best score per generation for each lineage (the seed an agent descends from)
export function rootOf(id: string, agents: Pick<Agent, 'id' | 'parentIds'>[]): string {
  const a = agents.find((x) => x.id === id)
  if (!a || !a.parentIds.length) return id
  return rootOf(a.parentIds[0], agents)
}
export function learningByLineage(agents: Agent[]) {
  const rows: { generation: number; bestScore: number; lineage: string }[] = []
  for (const a of agents) {
    const lineage = rootOf(a.id, agents)
    const cur = rows.find((r) => r.lineage === lineage && r.generation === a.generation)
    if (cur) cur.bestScore = Math.max(cur.bestScore, a.bestScore)
    else rows.push({ generation: a.generation, bestScore: a.bestScore, lineage })
  }
  return rows.sort((x, y) => x.generation - y.generation)
}
