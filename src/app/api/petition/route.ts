import { after, connection } from 'next/server'
import { z } from 'zod'
import { answerPetition, newPetition } from '@/lib/evolve/petitions'
import { isReadOnly, loadRecord, runnerOffline, SAFE_ID } from '@/lib/evolve/store'

const Body = z.object({ runId: z.string().regex(SAFE_ID), tick: z.number().int().nonnegative(), text: z.string().trim().min(1).max(600) })

// POST /api/petition { runId, tick, text } -> Petition (status 'pending'). the core answers in the background
// (it waits its turn for the local llm); poll GET /api/petitions/[runId] for the answer.
// for now the answer has no effect on the world (effect: null, simulated: false) until the sim supports petitions
export async function POST(req: Request) {
  await connection()
  if (isReadOnly()) return runnerOffline()
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const { runId, tick, text } = parsed.data
  const rec = loadRecord(runId)
  if (!rec) return Response.json({ error: `run ${runId} not found` }, { status: 404 })
  const last = Math.max(0, ...rec.frames.map(f => f.tick))
  if (tick > last) return Response.json({ error: `run ${runId} has no frame at tick ${tick} yet (last is ${last})` }, { status: 409 })
  const p = newPetition(runId, tick, text)
  after(() => answerPetition(rec, p).then(() => undefined))
  return Response.json(p)
}
