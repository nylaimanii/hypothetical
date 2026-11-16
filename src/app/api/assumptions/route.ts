import { connection } from 'next/server'
import { ASSUMPTIONS } from '@/lib/sim/assumptions'
import { loadRecord, SAFE_ID } from '@/lib/evolve/store'
import fs from 'node:fs'
import { changeLines, requestFile } from '@/lib/evolve/rerun'
import { controlFor } from '@/lib/evolve/controls'

// GET /api/assumptions -> Assumption[]: b's tunable rules, each with its plain-words label, the value the sim uses,
// the unit, the source (a url, or "our guess"), the range it can be set to, and the file that reads it. read-only safe
// GET /api/assumptions?runId=<id> -> { overridden, clamped, changes, from?, sim? }: what that world ran with ({} = the defaults).
// from = the world a rerun was rerun from (same seed, same agent; the a/b pair splits at tick 0), kept with the
// rerun request (data/live/<id>.assumptions.json). absent for worlds that were not reruns.
// sim = { source, rerun, same, text }: the two sim versions, and in plain words when they differ (src/lib/evolve/rerun.ts).
// control = { runId, status: queued|running|done|failed, sim } | null: the source rerun unchanged on the rerun's sim.
// supersededBy = a rerun of the same request on a newer sim (scripts/controls.ts --backfill), whose pair is clean
export async function GET(req: Request) {
  await connection()
  const runId = new URL(req.url).searchParams.get('runId')
  if (!runId) return Response.json(ASSUMPTIONS)
  if (!SAFE_ID.test(runId)) return Response.json({ error: 'bad runId' }, { status: 400 })
  const rec = loadRecord(runId) as (ReturnType<typeof loadRecord> & { assumptions?: { overridden?: Record<string, number>; clamped?: unknown[] } }) | null
  if (!rec) return Response.json({ error: 'run not found' }, { status: 404 })
  const overridden = rec.assumptions?.overridden ?? {}
  let from: string | undefined, sim: unknown, supersededBy: string | undefined
  try { const r = JSON.parse(fs.readFileSync(requestFile(runId), 'utf8')) as { sourceRunId?: string; sim?: unknown; supersededBy?: string }; if (r.sourceRunId && SAFE_ID.test(r.sourceRunId)) { from = r.sourceRunId; sim = r.sim; if (r.supersededBy && SAFE_ID.test(r.supersededBy)) supersededBy = r.supersededBy } } catch { /* not a rerun */ }
  // the unchanged control of the source on the rerun's sim, when the source ran on another (controls.ts)
  const s = sim as { same?: boolean; rerun?: string } | undefined
  const control = from && s && s.same === false && s.rerun ? controlFor(from, s.rerun) : null
  return Response.json({ overridden, clamped: rec.assumptions?.clamped ?? [], changes: changeLines(overridden), ...(from ? { from, control } : {}), ...(sim ? { sim } : {}), ...(supersededBy ? { supersededBy } : {}) })
}
