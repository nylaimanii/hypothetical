import { connection } from 'next/server'
import { loadRecord, SAFE_ID } from '@/lib/evolve/store'
import { evidenceOf, readEvidence } from '@/lib/evolve/evidence'

// GET /api/evidence/[runId] -> { realBaseline, autopsy }: the world against UN projections at the same year, and (for a
// dead world) its autopsy from the cause chain. from data/runs/evidence.json, or worked out from the record
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  await connection()
  const { runId } = await ctx.params
  if (!SAFE_ID.test(runId)) return Response.json({ error: 'bad id' }, { status: 400 })
  const saved = readEvidence()[runId]
  if (saved) return Response.json(saved)
  const rec = loadRecord(runId)
  if (!rec) return Response.json({ error: 'run not found' }, { status: 404 })
  return Response.json(evidenceOf(rec))
}
