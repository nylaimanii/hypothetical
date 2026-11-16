import { connection } from 'next/server'
import { readPetitions } from '@/lib/evolve/petitions'
import { SAFE_ID } from '@/lib/evolve/store'

// GET /api/petitions/[runId] -> Petition[] (oldest first; [] when there are none). read-only safe
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  await connection()
  const { runId } = await ctx.params
  if (!SAFE_ID.test(runId)) return Response.json({ error: 'bad run id' }, { status: 400 })
  return Response.json(readPetitions(runId))
}
