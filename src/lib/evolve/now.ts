// data/evolve-now.json: what evolution is doing right now, for mission control (GET /api/evolve/now).
// written on every frame of the running world, at most every 2s, and removed when evolve exits.
import fs from 'node:fs'
import path from 'node:path'
import type { Frame, Lesson, RunSummary } from '../types'
import { readAgents } from './agents'
import { readLessons } from './lessons'
import { readJson, writeJson } from './store'
import { paceStats } from './usage'

export type EvolveNow = {
  pid: number
  updatedAt: string
  generation: number
  agentId: string | null
  runId: string | null
  worldIndex: number
  worldsInGen: number
  latestFrame: Frame | null
  queue: { runId: string; agentId: string; seed: number }[]
  recent: RunSummary[]
  newLessons: Lesson[]
  stats: { worldsLost: number; lessonsKnown: number; bestScore: number; champion: string | null; avgMinutesPerWorld: number | null; estWorldsByMorning: number | null }
}

const nowFile = () => path.join(process.cwd(), 'data', 'evolve-now.json')
const THROTTLE_MS = 2000
let lastWrite = 0
let lastRunId: string | null | undefined

export type NowInput = Omit<EvolveNow, 'pid' | 'updatedAt' | 'stats'> & { concurrency: number }

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
      ...rest, pid: process.pid, updatedAt: new Date(t).toISOString(),
      stats: {
        worldsLost: agents.reduce((a, x) => a + x.deaths, 0),
        lessonsKnown: readLessons().length,
        bestScore: Math.max(0, ...agents.map(a => a.bestScore)),
        champion: agents.find(a => a.champion)?.name ?? null,
        avgMinutesPerWorld: pace?.avgMinutesPerWorld ?? null,
        estWorldsByMorning: pace?.estWorldsByMorning ?? null,
      },
    }
    writeJson(nowFile(), now)
  } catch { /* mission control must never break evolution */ }
}

export function clearNow() {
  try {
    const cur = readJson<EvolveNow>(nowFile())
    if (!cur || cur.pid === process.pid) fs.rmSync(nowFile(), { force: true })
  } catch {}
}

// null unless an evolve process is alive and owns the file
export function readNow(): EvolveNow | null {
  const cur = readJson<EvolveNow>(nowFile())
  if (!cur) return null
  try { process.kill(cur.pid, 0) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EPERM') return null }
  return cur
}
