import { connection } from 'next/server'
import { z } from 'zod'
import { readAgents } from '@/lib/evolve/agents'
import { branchSource, writeLivePlaceholder } from '@/lib/evolve/branch'
import { isReadOnly, runnerOffline, SAFE_ID } from '@/lib/evolve/store'
import { newRunId, runnerAvailable, spawnRunner } from '@/lib/evolve/spawn'

const Body = z.object({ runId: z.string().regex(SAFE_ID), tick: z.number().int().nonnegative(), agentId: z.string().regex(SAFE_ID) })

// POST /api/branch { runId, tick, agentId }: a new live world starts from that moment of an existing world,
// governed by the chosen agent. the sim restores the nearest snapshot and replays to the exact tick.
export async function POST(req: Request) {
  await connection()
  if (isReadOnly()) return runnerOffline()
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const { runId, tick, agentId } = parsed.data
  if (!runnerAvailable()) return Response.json({ error: 'live runner not available' }, { status: 404 })

  const agent = readAgents().find(a => a.id === agentId)
  if (!agent) return Response.json({ error: `agent ${agentId} not found` }, { status: 404 })
  const source = branchSource(runId, tick)
  if (!source.ok) return Response.json({ error: source.error }, { status: source.status })

  const newId = newRunId('branch')
  try {
    writeLivePlaceholder(newId, source.src.seed, agent.constitution, agentId)
    spawnRunner(newId, agent.constitution, ['--seed', String(source.src.seed), '--agentId', agentId, '--start-from', `${runId}:${tick}`, '--msPerTick', '1000'])
  } catch (e) {
    return Response.json({ error: `could not start branch: ${(e as Error).message}` }, { status: 404 })
  }
  return Response.json({ runId: newId })
}
