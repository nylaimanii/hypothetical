import { connection } from 'next/server'
import type { RunRecord } from '@/lib/types'
import { isReadOnly, readJson, runnerOffline, SAFE_ID } from '@/lib/evolve/store'
import { liveFile } from '@/lib/evolve/live'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection()
  if (isReadOnly()) return runnerOffline()
  const { id } = await ctx.params
  const rec = SAFE_ID.test(id) ? readJson<RunRecord>(liveFile(id)) : null
  if (!rec) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(rec)
}
