import { connection } from 'next/server'
import { z } from 'zod'
import { readAgents } from '@/lib/evolve/agents'
import { branchSource, writeLivePlaceholder } from '@/lib/evolve/branch'
import { isReadOnly, runnerOffline, SAFE_ID } from '@/lib/evolve/store'
import { newRunId, runnerAvailable, spawnRunner } from '@/lib/evolve/spawn'
import { queueWhatIf } from '@/lib/evolve/whatif'

const frac = z.number().min(0).max(1)
const Change = z.object({
  kind: z.enum(['inject_event', 'veto_law', 'force_budget']),
  regionId: z.string().max(80).optional(),
  eventKind: z.enum(['famine', 'revolt', 'war', 'disaster', 'pandemic', 'breakthrough', 'launch', 'migration', 'law', 'injected', 'override']).optional(),
  severity: frac.optional(),
  lawId: z.string().max(80).optional(),
  budget: z.object({ food: frac, energy: frac, education: frac, space: frac, security: frac, welfare: frac, research: frac }).partial().optional(),
}).refine(c => (c.kind !== 'veto_law' || !!c.lawId) && (c.kind !== 'force_budget' || !!c.budget) && (c.kind !== 'inject_event' || !!c.eventKind), { message: 'veto_law needs lawId, force_budget needs budget, inject_event needs eventKind' })
const Body = z.object({ runId: z.string().regex(SAFE_ID), tick: z.number().int().nonnegative(), change: Change })

// POST /api/whatif { runId, tick, change } -> { runId, original, appliedAt, exact }
// a new world from that moment of runId, same agent, with the change applied at tick. it runs at full speed in
// the background (the live file fills as it goes); GET /api/whatif/[runId] pairs it with the original.
// appliedAt: a budget forced on a decision tick lands a tick later (the governor would take it back that month).
// exact: false until the sim can replay the original decisions (later decisions are made again by the llm)
export async function POST(req: Request) {
  await connection()
  if (isReadOnly()) return runnerOffline()
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const { runId, tick, change } = parsed.data
  if (!runnerAvailable()) return Response.json({ error: 'live runner not available' }, { status: 404 })
  const source = branchSource(runId, tick)
  if (!source.ok) return Response.json({ error: source.error }, { status: source.status })
  const { src } = source
  const agent = readAgents().find(a => a.id === src.agentId)
  const constitution = agent?.constitution ?? src.constitution

  const newId = newRunId('whatif')
  try {
    const w = queueWhatIf(newId, runId, tick, change, src.agentId)
    writeLivePlaceholder(newId, src.seed, constitution, src.agentId)
    spawnRunner(newId, constitution, ['--seed', String(src.seed), '--agentId', src.agentId, '--start-from', `${runId}:${tick}`, '--msPerTick', '0', '--whatif'])
    return Response.json({ runId: newId, original: runId, appliedAt: w.appliedAt, exact: w.exact })
  } catch (e) {
    return Response.json({ error: `could not start what-if: ${(e as Error).message}` }, { status: 404 })
  }
}
