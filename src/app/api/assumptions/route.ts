import { connection } from 'next/server'
import { ASSUMPTIONS } from '@/lib/sim/assumptions'
import { loadRecord, SAFE_ID } from '@/lib/evolve/store'
import { changeLines } from '@/lib/evolve/rerun'

// GET /api/assumptions -> Assumption[]: b's tunable rules, each with its plain-words label, the value the sim uses,
// the unit, the source (a url, or "our guess"), the range it can be set to, and the file that reads it. read-only safe
// GET /api/assumptions?runId=<id> -> { overridden, clamped, changes }: what that world ran with ({} = the defaults)
export async function GET(req: Request) {
  await connection()
  const runId = new URL(req.url).searchParams.get('runId')
  if (!runId) return Response.json(ASSUMPTIONS)
  if (!SAFE_ID.test(runId)) return Response.json({ error: 'bad runId' }, { status: 400 })
  const rec = loadRecord(runId) as (ReturnType<typeof loadRecord> & { assumptions?: { overridden?: Record<string, number>; clamped?: unknown[] } }) | null
  if (!rec) return Response.json({ error: 'run not found' }, { status: 404 })
  const overridden = rec.assumptions?.overridden ?? {}
  return Response.json({ overridden, clamped: rec.assumptions?.clamped ?? [], changes: changeLines(overridden) })
}
