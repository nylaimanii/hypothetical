import { connection } from 'next/server'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { dirs, readLeaderboard, writeJson } from '@/lib/evolve/store'
import { liveFile, liveRecord } from '@/lib/evolve/live'
import { SEEDS } from '@/lib/evolve/seeds'

const Body = z.object({ constitution: z.string().min(20).max(8000).optional(), seed: z.number().int().nonnegative().optional() })

export async function POST(req: Request) {
  await connection()
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })

  const root = process.cwd()
  const script = path.join(root, 'scripts', 'live.ts')
  const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  if (!fs.existsSync(script) || !fs.existsSync(tsx)) return Response.json({ error: 'live runner not available' }, { status: 404 })

  const constitution = parsed.data.constitution ?? readLeaderboard()[0]?.constitution ?? SEEDS[0].text
  const seed = parsed.data.seed ?? Math.floor(Math.random() * 1e6)
  const runId = `live-${Date.now().toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`
  try {
    fs.mkdirSync(dirs.live, { recursive: true })
    const cfile = path.join(dirs.live, `${runId}.constitution.txt`)
    fs.writeFileSync(cfile, constitution)
    writeJson(liveFile(runId), liveRecord(runId, seed, constitution, []))
    const log = fs.openSync(path.join(dirs.live, `${runId}.log`), 'a')
    const child = spawn(process.execPath, [tsx, script, '--runId', runId, '--seed', String(seed), '--constitution-file', cfile, '--msPerTick', '1000'], {
      cwd: root, detached: true, stdio: ['ignore', log, log], env: process.env,
    })
    child.unref()
  } catch (e) {
    return Response.json({ error: `could not start live runner: ${(e as Error).message}` }, { status: 404 })
  }
  return Response.json({ runId })
}
