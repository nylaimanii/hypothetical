import { connection } from 'next/server'
import path from 'node:path'
import type { RunRecord } from '@/lib/types'
import { dirs, readJson, SAFE_ID } from '@/lib/evolve/store'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await ctx.params
  if (!SAFE_ID.test(id)) return Response.json({ error: 'not found' }, { status: 404 })
  const rec = readJson<RunRecord>(path.join(dirs.runs, `${id}.json`)) ?? readJson<RunRecord>(path.join(dirs.showcase, `${id}.json`))
  if (!rec) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(rec)
}
