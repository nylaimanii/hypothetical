import { connection } from 'next/server'
import { z } from 'zod'
import { isReadOnly, readLeaderboard, runnerOffline, writeJson } from '@/lib/evolve/store'
import { liveFile, liveRecord } from '@/lib/evolve/live'
import { SEEDS } from '@/lib/evolve/seeds'
import { newRunId, runnerAvailable, spawnRunner } from '@/lib/evolve/spawn'

const Body = z.object({ constitution: z.string().min(20).max(8000).optional(), seed: z.number().int().nonnegative().optional() })

export async function POST(req: Request) {
  await connection()
  if (isReadOnly()) return runnerOffline()
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  if (!runnerAvailable()) return Response.json({ error: 'live runner not available' }, { status: 404 })

  const constitution = parsed.data.constitution ?? readLeaderboard()[0]?.constitution ?? SEEDS[0].text
  const seed = parsed.data.seed ?? Math.floor(Math.random() * 1e6)
  const runId = newRunId('live')
  try {
    writeJson(liveFile(runId), liveRecord(runId, seed, constitution, []))
    spawnRunner(runId, constitution, ['--seed', String(seed), '--msPerTick', '1000'])
  } catch (e) {
    return Response.json({ error: `could not start live runner: ${(e as Error).message}` }, { status: 404 })
  }
  return Response.json({ runId })
}
