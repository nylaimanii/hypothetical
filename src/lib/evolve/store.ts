// filesystem layout under data/. every read is safe when files are missing.
import fs from 'node:fs'
import path from 'node:path'
import type { RunRecord, RunSummary } from '../types'

export const DATA = path.join(process.cwd(), 'data')
export const dirs = {
  runs: path.join(process.cwd(), 'data', 'runs'),
  showcase: path.join(process.cwd(), 'data', 'showcase'),
  generations: path.join(process.cwd(), 'data', 'generations'),
  live: path.join(process.cwd(), 'data', 'live'),
  inject: path.join(process.cwd(), 'data', 'inject'),
  reports: path.join(process.cwd(), 'data', 'reports'),
}
export const leaderboardFile = path.join(process.cwd(), 'data', 'leaderboard.json')

export const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/

export function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T } catch { return null }
}
export function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value))
  fs.renameSync(tmp, file)
}

export type Candidate = {
  id: string
  name: string
  origin: 'seed' | 'elite' | 'mutation' | 'crossover'
  parents: string[]
  changes?: string
  constitution: string
  score?: number
  runs?: RunSummary[]
  // times a world of this candidate was interrupted by limits or network (never scored)
  interrupted?: number
}
export type GenerationFile = {
  generation: number
  seeds: number[]
  status: 'running' | 'done'
  startedAt: string
  finishedAt?: string
  population: Candidate[]
}
export type LeaderboardEntry = {
  candidateId: string
  name: string
  generation: number
  score: number
  constitution: string
  origin: Candidate['origin']
  best: RunSummary
}

export function readLeaderboard(): LeaderboardEntry[] {
  return readJson<LeaderboardEntry[]>(leaderboardFile) ?? []
}

export function listShowcase(): RunSummary[] {
  try {
    return fs.readdirSync(path.join(process.cwd(), 'data', 'showcase')).filter(f => f.endsWith('.json'))
      .map(f => readJson<RunRecord>(path.join(process.cwd(), 'data', 'showcase', f))?.summary)
      .filter((s): s is RunSummary => !!s)
  } catch { return [] }
}

export function loadRecord(id: string): RunRecord | null {
  if (!SAFE_ID.test(id)) return null
  for (const d of [dirs.runs, dirs.showcase, dirs.live]) {
    const r = readJson<RunRecord>(path.join(d, `${id}.json`))
    if (r) return r
  }
  return null
}

// deployed (vercel) or READ_ONLY=1: only committed showcase worlds are served, runner routes are off
let readOnly: boolean | undefined
export function isReadOnly(): boolean {
  if (process.env.READ_ONLY === '1') return true
  if (readOnly === undefined) {
    try {
      fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true })
      fs.accessSync(path.join(process.cwd(), 'data'), fs.constants.W_OK)
      readOnly = false
    } catch {
      readOnly = true
    }
  }
  return readOnly
}
export const runnerOffline = () => Response.json({ error: 'runner offline, local only' }, { status: 503 })
