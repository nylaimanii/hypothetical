import { connection } from 'next/server'
import type { FramesResponse } from '@/lib/types'
import { isReadOnly, readRunRecord, readShowcase, SAFE_ID } from '@/lib/evolve/store'

// GET /api/runs/[id]/frames?from=&to= : the frames with from <= tick <= to (both optional), for lazy loading
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await ctx.params
  if (!SAFE_ID.test(id)) return Response.json({ error: 'not found' }, { status: 404 })
  const q = new URL(req.url).searchParams
  const from = Number(q.get('from') ?? 0), to = Number(q.get('to') ?? Infinity)
  if (!Number.isFinite(from) || Number.isNaN(to) || to < from) return Response.json({ error: 'from and to must be ticks, from <= to' }, { status: 400 })
  const rec = (isReadOnly() ? null : readRunRecord(id)) ?? readShowcase(id)
  if (!rec) return Response.json({ error: 'not found' }, { status: 404 })
  const last = rec.frames.length ? Math.max(...rec.frames.map(f => f.tick)) : 0
  const body: FramesResponse = { runId: rec.runId, from, to: Number.isFinite(to) ? to : last, frames: rec.frames.filter(f => f.tick >= from && f.tick <= to) }
  return Response.json(body)
}
