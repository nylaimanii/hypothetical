// data/evolve-now.json: what evolution is doing right now, for mission control (GET /api/evolve/now).
// written on every frame of the running world, at most every 2s, stamped with lastHeartbeat every minute even
// when no frame arrives, and removed when evolve exits.
import fs from 'node:fs'
import path from 'node:path'
import type { EvolveNow } from '../types'

export type { EvolveNow }
import { readAgents } from './agents'
import { readLessons } from './lessons'
import { readJson, writeJson } from './store'
import { paceStats } from './usage'

const nowFile = () => path.join(process.cwd(), 'data', 'evolve-now.json')
const THROTTLE_MS = 2000
let lastWrite = 0
let lastRunId: string | null | undefined
let lastSnapshot: EvolveNow | null = null

export type NowInput = Omit<EvolveNow, 'pid' | 'updatedAt' | 'stats' | 'lastHeartbeat'> & { concurrency: number }

export function writeNow(input: NowInput, force = false) {
  const t = Date.now()
  // a new world always shows up at once; frames within the same world are throttled
  if (!force && input.runId === lastRunId && t - lastWrite < THROTTLE_MS) return
  lastWrite = t
  lastRunId = input.runId
  try {
    const agents = readAgents()
    const pace = paceStats(input.concurrency)
    const { concurrency: _c, ...rest } = input
    const now: EvolveNow = {
      ...rest, pid: process.pid, updatedAt: new Date(t).toISOString(), lastHeartbeat: lastSnapshot?.lastHeartbeat ?? new Date(t).toISOString(),
      stats: {
        worldsLost: agents.reduce((a, x) => a + x.deaths, 0),
        lessonsKnown: readLessons().length,
        bestScore: Math.max(0, ...agents.map(a => a.bestScore)),
        champion: agents.find(a => a.champion)?.name ?? null,
        avgMinutesPerWorld: pace?.avgMinutesPerWorld ?? null,
        estWorldsByMorning: pace?.estWorldsByMorning ?? null,
      },
    }
    lastSnapshot = now
    writeJson(nowFile(), now)
  } catch { /* mission control must never break evolution */ }
}

// every minute: proves the process is alive even during a long llm call with no new frame
export function heartbeatNow() {
  try {
    const base = lastSnapshot ?? readJson<EvolveNow>(nowFile())
    if (!base) return
    lastSnapshot = { ...base, pid: process.pid, lastHeartbeat: new Date().toISOString() }
    writeJson(nowFile(), lastSnapshot)
  } catch {}
}

export function clearNow() {
  lastSnapshot = null
  try {
    const cur = readJson<EvolveNow>(nowFile())
    if (!cur || cur.pid === process.pid) fs.rmSync(nowFile(), { force: true })
  } catch {}
}

// the last snapshot on disk, alive or not (an idle runner still has a last heartbeat to show)
export function readNowFile(): EvolveNow | null {
  return readJson<EvolveNow>(nowFile())
}

// null unless an evolve process is alive and owns the file
export function readNow(): EvolveNow | null {
  const cur = readJson<EvolveNow>(nowFile())
  if (!cur?.pid) return null
  try { process.kill(cur.pid, 0) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EPERM') return null }
  return cur
}
