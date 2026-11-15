import { connection } from 'next/server'
import { isReadOnly, readRunRecord, readShowcase, SAFE_ID } from '@/lib/evolve/store'
import { readSlim } from '@/lib/evolve/retention'
import { slimRun } from '@/lib/evolve/slim'

// ?slim=1 returns a SlimRun (no frames) for long runs; frames come from /api/runs/[id]/frames
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await ctx.params
  if (!SAFE_ID.test(id)) return Response.json({ error: 'not found' }, { status: 404 })
  const slim = new URL(req.url).searchParams.get('slim') === '1'
  const rec = (isReadOnly() ? null : readRunRecord(id)) ?? readShowcase(id)
  if (rec) return Response.json(slim ? slimRun(rec) : rec)
  // retention keeps every world's slim payload forever, even after its full record is retired
  const kept = isReadOnly() ? null : readSlim(id)
  if (kept && slim) return Response.json(kept)
  if (kept) return Response.json({ error: 'the full record of this world was retired; ?slim=1 still works' }, { status: 404 })
  return Response.json({ error: 'not found' }, { status: 404 })
}
