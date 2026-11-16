import { connection } from 'next/server'
import { slimRun } from '@/lib/evolve/slim'
import { loadRecord, SAFE_ID } from '@/lib/evolve/store'
import { pairWhatIf, readWhatIf } from '@/lib/evolve/whatif'

// GET /api/whatif/[id] -> { whatif, original: SlimRun, flipped: SlimRun, divergences, through, running }
// the what-if and its original side by side (slim; frames from /api/runs/[id]/frames), with the decisions that
// diverged from the flip up to where the what-if has got to so far
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await ctx.params
  if (!SAFE_ID.test(id)) return Response.json({ error: 'bad id' }, { status: 400 })
  const w = readWhatIf(id)
  if (!w) return Response.json({ error: `what-if ${id} not found` }, { status: 404 })
  const original = loadRecord(w.original)
  const flipped = loadRecord(id)
  if (!original || !flipped) return Response.json({ error: 'run records missing', original: !!original, flipped: !!flipped }, { status: 404 })
  const { divergences, through } = pairWhatIf(original, flipped, w)
  return Response.json({ whatif: w, original: slimRun(original), flipped: slimRun(flipped), divergences, through, running: !!flipped.live })
}
