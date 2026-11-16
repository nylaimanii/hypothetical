// every world's tradeoffs (b's summary.tradeoffs, sim 5.10.1+: lifespan, population, freedom, off-world progress),
// for the tradeoff map. read from the run index locally; the deployed site has no run index, so the promotion writes
// the same rows to data/runs/tradeoffs.json and ships that. worlds from older sims carry tradeoffs: null (they have
// no freedom measure), so the ui can say how many it left out. newest sim version first, then newest generation
import fs from 'node:fs'
import path from 'node:path'
import { readJson, readRunIndex, writeJson } from './store'

export type Tradeoffs = { lifespan: number; population: number; freedom: number; freedomAverage: number; offWorld: number; frontier: string }
export type TradeoffRow = { runId: string; agentId: string; seed: number | null; generation: number; simVersion: string | null; status: string; score: number; tradeoffs: Tradeoffs | null }
export const tradeoffsFile = () => path.join(process.cwd(), 'data', 'runs', 'tradeoffs.json')

const cmpVersion = (a: string | null, b: string | null) => {
  const x = (a ?? '0').split('.').map(Number), y = (b ?? '0').split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

export function tradeoffRows(): TradeoffRow[] {
  const idx = readRunIndex()
  if (!idx.length) return readJson<TradeoffRow[]>(tradeoffsFile()) ?? []
  return idx.map(r => {
    const t = (r as unknown as { tradeoffs?: Tradeoffs }).tradeoffs
    return { runId: r.runId, agentId: r.agentId ?? '', seed: r.seed ?? null, generation: r.generation, simVersion: r.simVersion ?? null, status: r.status, score: r.score, tradeoffs: t ?? null }
  }).sort((a, b) => cmpVersion(b.simVersion, a.simVersion) || b.generation - a.generation || a.runId.localeCompare(b.runId))
}

// written before each promotion so the deploy carries it (src/lib/evolve/deploy.ts)
export function writeTradeoffs(): number {
  if (!readRunIndex().length) return 0
  const rows = tradeoffRows()
  fs.mkdirSync(path.dirname(tradeoffsFile()), { recursive: true })
  writeJson(tradeoffsFile(), rows)
  return rows.length
}
