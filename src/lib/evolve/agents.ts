// the agents registry (data/agents.json): every constitution is an Agent with a stable id, an original name,
// a lineage, and running stats over every world it has governed.
import path from 'node:path'
import type { Agent, Frontier, RunSummary } from '../types'
import { SEEDS } from './seeds'
import { readJson, writeJson, type Candidate } from './store'

const agentsFile = () => path.join(process.cwd(), 'data', 'agents.json')

export const FRONTIER_ORDER: Frontier[] = ['none', 'moon_landing', 'moon_base', 'mars_crewed', 'mars_settlement', 'mars_self_sustaining', 'asteroid_mining', 'outer_system']
export const frontierRank = (f: Frontier | undefined) => Math.max(0, FRONTIER_ORDER.indexOf(f ?? 'none'))

// stable 32-bit fnv-1a of the name: the ui draws the emblem from it
export function emblemSeed(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return h >>> 0
}

export function readAgents(): Agent[] {
  return readJson<Agent[]>(agentsFile()) ?? []
}
function writeAgents(a: Agent[]) {
  writeJson(agentsFile(), a)
}

function philosophyFor(c: Candidate, byId: Map<string, Agent>): string {
  const seed = SEEDS.find(s => s.id === c.id)
  if (seed) return seed.philosophy
  const parents = c.parents.map(p => byId.get(p)).filter((a): a is Agent => !!a)
  if (c.origin === 'crossover' && parents.length === 2) return `a splice of ${parents[0].name} and ${parents[1].name}`
  if (parents[0]) return `${parents[0].philosophy}, revised after its worlds died`
  return 'unknown lineage'
}

// make sure every candidate in a generation has an agent; new ones start with empty stats
export function registerPopulation(population: Candidate[], generation: number): Agent[] {
  const all = readAgents()
  const byId = new Map(all.map(a => [a.id, a]))
  for (const c of population) {
    if (byId.has(c.id)) continue
    const a: Agent = {
      id: c.id, name: c.name, emblemSeed: emblemSeed(c.name), philosophy: philosophyFor(c, byId), constitution: c.constitution,
      parentIds: c.parents.filter(p => p !== c.id), origin: c.origin === 'mutation' || c.origin === 'crossover' ? c.origin : 'seed',
      generation, protected: !!c.protected,
      runIds: [], worlds: 0, deaths: 0, bestScore: 0, avgScore: 0, bestFrontier: 'none', bestPeriodLifeExpectancy: 0, champion: false, retired: false,
    }
    all.push(a)
    byId.set(a.id, a)
  }
  writeAgents(all)
  return all
}

// fold one finished world into its agent's stats. avgScore averages the 50-year screening worlds only, so
// every agent is compared on the same horizon; full 100-year runs count toward best score, frontier, lifespan
export function recordAgentRun(s: RunSummary, stage: 'screen' | 'full' = 'screen'): Agent | null {
  const all = readAgents()
  const a = all.find(x => x.id === s.agentId)
  if (!a) return null
  if (!a.runIds.includes(s.runId)) {
    if (stage === 'screen') {
      const n = a.runIds.filter(id => !/-full-s\d+$/.test(id)).length
      a.avgScore = Math.round(((a.avgScore * n + s.score) / (n + 1)) * 1e4) / 1e4
    }
    a.runIds.push(s.runId)
    a.worlds++
    if (s.status === 'destroyed') a.deaths++
  }
  a.bestScore = Math.max(a.bestScore, s.score)
  if (frontierRank(s.frontier) > frontierRank(a.bestFrontier)) a.bestFrontier = s.frontier
  a.bestPeriodLifeExpectancy = Math.max(a.bestPeriodLifeExpectancy, s.peakPeriodLifeExpectancy ?? 0)
  writeAgents(all)
  return a
}

// after breeding: agents not in the next population are retired (the protected charter never is).
// the champion comes from the full 100-year runs (championId); before any exist, the best average stands in
export function settleGeneration(activeIds: string[], championId?: string): Agent | null {
  const all = readAgents()
  const active = new Set(activeIds)
  for (const a of all) a.retired = !a.protected && !active.has(a.id)
  const contenders = all.filter(a => !a.retired && a.worlds > 0)
  const champ = (championId ? all.find(a => a.id === championId) : undefined)
    ?? contenders.sort((x, y) => y.avgScore - x.avgScore || y.bestScore - x.bestScore)[0] ?? null
  for (const a of all) a.champion = !!champ && a.id === champ.id
  writeAgents(all)
  return champ
}

export function topAgents(n = 5): Agent[] {
  return readAgents().filter(a => a.worlds > 0).sort((x, y) => Number(x.retired) - Number(y.retired) || y.avgScore - x.avgScore).slice(0, n)
}

// the family tree as an indented list: roots are seeds, children listed under their first parent
export function familyTree(): string[] {
  const all = readAgents()
  const kids = new Map<string, Agent[]>()
  for (const a of all) if (a.parentIds[0]) kids.set(a.parentIds[0], [...(kids.get(a.parentIds[0]) ?? []), a])
  const lines: string[] = []
  const walk = (a: Agent, depth: number) => {
    const tags = [a.champion ? 'champion' : '', a.retired ? 'retired' : '', a.protected ? 'protected' : ''].filter(Boolean).join(', ')
    lines.push(`${'    '.repeat(depth)}${a.name}${a.origin === 'crossover' && a.parentIds[1] ? ` (with ${all.find(x => x.id === a.parentIds[1])?.name ?? a.parentIds[1]})` : ''}   avg ${a.avgScore}, ${a.worlds} worlds${tags ? `, ${tags}` : ''}`)
    for (const k of kids.get(a.id) ?? []) walk(k, depth + 1)
  }
  for (const r of all.filter(a => !a.parentIds.length)) walk(r, 0)
  return lines
}

// agent id -> the seed agent id its lineage starts from (first parent all the way up)
export function lineageRoots(): (agentId: string) => string {
  const parents = new Map(readAgents().map(a => [a.id, a.parentIds[0]]))
  return (agentId: string) => {
    let id = agentId
    for (let i = 0; i < 100 && parents.get(id); i++) id = parents.get(id)!
    return id
  }
}
