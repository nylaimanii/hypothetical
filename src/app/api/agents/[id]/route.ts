import { connection } from 'next/server'
import { readAgents } from '@/lib/evolve/agents'
import { isReadOnly, listShowcase, readRunIndex, SAFE_ID } from '@/lib/evolve/store'
import type { RunSummary } from '@/lib/types'
import { agentRanges } from '@/lib/evolve/uncertainty'

// the agent, the summaries of its worlds (showcase only when read-only), and ranges across its full 100-year runs
// on the current sim version when it has two or more (e.g. "mars crewed by 2068-2081 in 4 of 5 runs")
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await ctx.params
  const agent = SAFE_ID.test(id) ? readAgents().find(a => a.id === id) : undefined
  if (!agent) return Response.json({ error: 'not found' }, { status: 404 })
  const runs: RunSummary[] = isReadOnly() ? [] : readRunIndex().filter(r => r.agentId === id)
  for (const s of listShowcase()) if (s.agentId === id && !runs.some(r => r.runId === s.runId)) runs.push(s)
  const ranges = agentRanges(id, runs.map(r => ({ seed: 0, ...r })))
  return Response.json({ agent, runs: runs.sort((a, b) => b.score - a.score), ...(ranges ? { ranges } : {}) })
}
