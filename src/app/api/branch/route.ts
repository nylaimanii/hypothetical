import { connection } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { RunRecord } from '@/lib/types'
import { readAgents } from '@/lib/evolve/agents'
import { liveFile, liveRecord } from '@/lib/evolve/live'
import { dirs, isReadOnly, readJson, readShowcase, runnerOffline, SAFE_ID, writeJson } from '@/lib/evolve/store'
import { newRunId, runnerAvailable, spawnRunner } from '@/lib/evolve/spawn'

const Body = z.object({ runId: z.string().regex(SAFE_ID), tick: z.number().int().nonnegative(), agentId: z.string().regex(SAFE_ID) })

// POST /api/branch { runId, tick, agentId }: a new live world starts from that moment of an existing world,
// governed by the chosen agent. the sim restores the nearest snapshot and replays to the exact tick.
export async function POST(req: Request) {
  await connection()
  if (isReadOnly()) return runnerOffline()
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const { runId, tick, agentId } = parsed.data
  if (!runnerAvailable()) return Response.json({ error: 'live runner not available' }, { status: 404 })

  const agent = readAgents().find(a => a.id === agentId)
  if (!agent) return Response.json({ error: `agent ${agentId} not found` }, { status: 404 })
  const runsFile = path.join(dirs.runs, `${runId}.json`)
  let src = readJson<RunRecord>(runsFile) ?? readJson<RunRecord>(path.join(dirs.live, `${runId}.json`))
  if (!src) {
    // the sim reads plain json, so a gzipped showcase world is unpacked into data/runs first
    src = readShowcase(runId)
    if (src) writeJson(runsFile, src)
  }
  if (!src) return Response.json({ error: `run ${runId} not found` }, { status: 404 })
  if (!(src.snapshots ?? []).some(s => s.tick <= tick)) return Response.json({ error: `run ${runId} has no snapshot at or before tick ${tick}` }, { status: 409 })
  if (src.summary.status !== 'alive' && tick >= src.summary.ticks) return Response.json({ error: `run ${runId} had already ended by tick ${tick}` }, { status: 409 })

  const newId = newRunId('branch')
  try {
    fs.mkdirSync(dirs.live, { recursive: true })
    writeJson(liveFile(newId), liveRecord(newId, src.seed, agent.constitution, [], undefined, agentId))
    spawnRunner(newId, agent.constitution, ['--seed', String(src.seed), '--agentId', agentId, '--start-from', `${runId}:${tick}`, '--msPerTick', '1000'])
  } catch (e) {
    return Response.json({ error: `could not start branch: ${(e as Error).message}` }, { status: 404 })
  }
  return Response.json({ runId: newId })
}
