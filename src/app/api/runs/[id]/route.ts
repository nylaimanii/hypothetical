import { connection } from 'next/server'
import path from 'node:path'
import type { RunRecord } from '@/lib/types'
import { dirs, isReadOnly, readJson, readShowcase, SAFE_ID } from '@/lib/evolve/store'
import { slimRun } from '@/lib/evolve/slim'

// ?slim=1 returns a SlimRun (no frames) for long runs; frames come from /api/runs/[id]/frames
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await ctx.params
  if (!SAFE_ID.test(id)) return Response.json({ error: 'not found' }, { status: 404 })
  const fromRuns = isReadOnly() ? null : readJson<RunRecord>(path.join(dirs.runs, `${id}.json`))
  const rec = fromRuns ?? readShowcase(id)
  if (!rec) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(new URL(req.url).searchParams.get('slim') === '1' ? slimRun(rec) : rec)
}
