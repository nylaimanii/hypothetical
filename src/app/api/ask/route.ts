import { connection } from 'next/server'
import { z } from 'zod'
import { loadRecord, SAFE_ID } from '@/lib/evolve/store'
import { askCore } from '@/lib/evolve/core'

const Body = z.object({ runId: z.string().regex(SAFE_ID), question: z.string().min(1).max(2000) })

export async function POST(req: Request) {
  await connection()
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const record = loadRecord(parsed.data.runId)
  if (!record) return Response.json({ error: 'run not found' }, { status: 404 })
  try {
    return Response.json({ answer: await askCore(record, parsed.data.question) })
  } catch (e) {
    return Response.json({ error: `ask failed: ${(e as Error).message}` }, { status: 500 })
  }
}
