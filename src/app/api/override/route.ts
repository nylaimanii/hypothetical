import { connection } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { SAFE_ID, writeJson } from '@/lib/evolve/store'
import { injectDir, liveFile } from '@/lib/evolve/live'

const frac = z.number().min(0).max(1)
const OverrideSchema = z.object({
  id: z.string().regex(SAFE_ID).optional(),
  tick: z.number().int().nonnegative().optional(),
  kind: z.enum(['inject_event', 'veto_law', 'force_budget']),
  regionId: z.string().max(80).optional(),
  eventKind: z.enum(['famine', 'revolt', 'war', 'disaster', 'pandemic', 'breakthrough', 'launch', 'migration', 'law', 'injected', 'override']).optional(),
  severity: frac.optional(),
  lawId: z.string().max(80).optional(),
  budget: z.object({ food: frac, energy: frac, education: frac, space: frac, security: frac, welfare: frac, research: frac }).partial().optional(),
})
const Body = z.object({ runId: z.string().regex(SAFE_ID), override: OverrideSchema })

export async function POST(req: Request) {
  await connection()
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const { runId, override } = parsed.data
  if (!fs.existsSync(liveFile(runId))) return Response.json({ error: 'live run not found' }, { status: 404 })
  const id = override.id ?? `ov-${Date.now().toString(36)}`
  try {
    writeJson(path.join(injectDir(runId), `${Date.now()}-${id}.json`), { ...override, id })
  } catch {
    return Response.json({ error: 'could not write override' }, { status: 404 })
  }
  return Response.json({ ok: true })
}
