import { connection } from 'next/server'
import { worldReport } from '@/lib/evolve/report'
import { isReadOnly, loadRecord, readShowcase, SAFE_ID } from '@/lib/evolve/store'

// GET /api/report/[runId]: one world in plain words. a summary (5 lines max), then sections, every claim with refs
// (event tick, source url, or another world). read-only deploys report on showcase worlds
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  await connection()
  const { runId } = await ctx.params
  if (!SAFE_ID.test(runId)) return Response.json({ error: 'not found' }, { status: 404 })
  const rec = isReadOnly() ? readShowcase(runId) : loadRecord(runId)
  if (!rec) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(worldReport(rec))
}
