import { connection } from 'next/server'
import { ASSUMPTIONS } from '@/lib/sim/assumptions'
import { loadRecord, SAFE_ID } from '@/lib/evolve/store'
import fs from 'node:fs'
import { changeLines, requestFile } from '@/lib/evolve/rerun'

// GET /api/assumptions -> Assumption[]: b's tunable rules, each with its plain-words label, the value the sim uses,
// the unit, the source (a url, or "our guess"), the range it can be set to, and the file that reads it. read-only safe
// GET /api/assumptions?runId=<id> -> { overridden, clamped, changes, from?, sim? }: what that world ran with ({} = the defaults).
// from = the world a rerun was rerun from (same seed, same agent; the a/b pair splits at tick 0), kept with the
// rerun request (data/live/<id>.assumptions.json). absent for worlds that were not reruns.
// sim = { source, rerun, same, text }: the two sim versions, and in plain words when they differ (src/lib/evolve/rerun.ts)
export async function GET(req: Request) {
  await connection()
  const runId = new URL(req.url).searchParams.get('runId')
  if (!runId) return Response.json(ASSUMPTIONS)
  if (!SAFE_ID.test(runId)) return Response.json({ error: 'bad runId' }, { status: 400 })
  const rec = loadRecord(runId) as (ReturnType<typeof loadRecord> & { assumptions?: { overridden?: Record<string, number>; clamped?: unknown[] } }) | null
  if (!rec) return Response.json({ error: 'run not found' }, { status: 404 })
  const overridden = rec.assumptions?.overridden ?? {}
  let from: string | undefined, sim: unknown
  try { const r = JSON.parse(fs.readFileSync(requestFile(runId), 'utf8')) as { sourceRunId?: string; sim?: unknown }; if (r.sourceRunId && SAFE_ID.test(r.sourceRunId)) { from = r.sourceRunId; sim = r.sim } } catch { /* not a rerun */ }
  return Response.json({ overridden, clamped: rec.assumptions?.clamped ?? [], changes: changeLines(overridden), ...(from ? { from } : {}), ...(sim ? { sim } : {}) })
}
