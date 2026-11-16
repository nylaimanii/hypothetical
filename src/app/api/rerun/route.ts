import { connection } from 'next/server'
import { z } from 'zod'
import { isReadOnly, loadRecord, readRunIndex, runnerOffline, SAFE_ID, writeJson } from '@/lib/evolve/store'
import { liveFile, liveRecord } from '@/lib/evolve/live'
import { newRunId, runnerAvailable, runnerRoot, spawnRunner } from '@/lib/evolve/spawn'
import { ensureControl, runnerSim } from '@/lib/evolve/controls'
import { planRerun, saveRequest, simCompare, waitingFor } from '@/lib/evolve/rerun'

const Body = z.object({ runId: z.string().regex(SAFE_ID), assumptions: z.record(z.string(), z.unknown()), msPerTick: z.number().int().min(0).max(10_000).optional() })

// POST /api/rerun { runId, assumptions: { id: value }, msPerTick? } -> { runId, from, overridden, clamped, changes, sim, control, waiting }
// sim = { source, rerun, same, text }: the rerun runs on the runner's sim; text says so in plain words when the source ran on another.
// control = { runId, status, sim } when it did: the source rerun unchanged on the same sim (controls.ts), null otherwise
// local only (503 on the deployed site). reruns that world from 2026 on the same seed, with the same agent and
// constitution, and only the named rules changed (GET /api/assumptions lists them). an unknown rule or a value that
// is not a number is a 400 with the reason; a value outside a rule's range is clamped and said back in `clamped`
// ("you asked 0.9, the limit is 0.6"). the new world is live (GET /api/live/<runId>), stays out of the leaderboard
// and the agent's record, and its record carries what it actually used (record.assumptions)
export async function POST(req: Request) {
  await connection()
  if (isReadOnly()) return runnerOffline()
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const source = loadRecord(parsed.data.runId)
  if (!source) return Response.json({ error: 'run not found' }, { status: 404 })
  if (!runnerAvailable()) return Response.json({ error: 'live runner not available' }, { status: 503 })
  let plan
  try { plan = planRerun(source as typeof source & { assumptions?: { overridden?: Record<string, number> } }, parsed.data.assumptions as Record<string, number>) }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }) }
  const runId = newRunId('rerun')
  // the record's own version (5.10+), else what the run index recorded when it finished
  // the rerun runs on the evolution runner's committed code (the sim evolution is on), never on a dev server's own copy
  const rs = runnerSim()
  if (!rs.sim) return Response.json({ error: `reruns run on the evolution runner's code, which is not available: ${rs.why}` }, { status: 503 })
  const sim = simCompare((source as { simVersion?: string }).simVersion ?? readRunIndex().find(r => r.runId === source.runId)?.simVersion, rs.sim)
  try {
    const overrides = saveRequest(runId, plan, source.runId, sim)
    writeJson(liveFile(runId), liveRecord(runId, source.seed, source.constitution, [], undefined, source.agentId))
    spawnRunner(runId, source.constitution, ['--seed', String(source.seed), '--agentId', source.agentId, '--msPerTick', String(parsed.data.msPerTick ?? 250), '--assumptions-file', overrides, '--rerun'], { codeRoot: runnerRoot() })
  } catch (e) {
    return Response.json({ error: `could not start the rerun: ${(e as Error).message}` }, { status: 500 })
  }
  // why the first frame may take a while: the world that holds the model right now, and about how long it has left
  // the source ran on another sim: its unchanged control on this sim is what the rerun is compared with
  const control = sim.same ? null : ensureControl(source)
  return Response.json({ runId, from: source.runId, overridden: plan.overridden, clamped: plan.clamped, changes: plan.changes, sim, control, waiting: waitingFor() })
}
