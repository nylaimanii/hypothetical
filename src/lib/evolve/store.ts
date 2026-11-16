// filesystem layout under data/. every read is safe when files are missing.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import type { Frontier, HallEntry, Lesson, RunRecord, RunSummary } from '../types'
import type { GapExplanation, RealBaseline } from './evidence'

export const DATA = path.join(process.cwd(), 'data')
// paths resolve at call time (statically scoped under data/ so deploy file tracing stays narrow)
export const dirs = {
  get runs() { return path.join(process.cwd(), 'data', 'runs') },
  get showcase() { return path.join(process.cwd(), 'data', 'showcase') },
  get generations() { return path.join(process.cwd(), 'data', 'generations') },
  get live() { return path.join(process.cwd(), 'data', 'live') },
  get inject() { return path.join(process.cwd(), 'data', 'inject') },
  get reports() { return path.join(process.cwd(), 'data', 'reports') },
}
export const leaderboardFile = () => path.join(process.cwd(), 'data', 'leaderboard.json')

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

// one entry in a generation. id is the agent id (see agents.ts); the same agent keeps its id across generations
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
  // the long now charter: always competes with its original text, never mutated in place
  protected?: boolean
  // its full 100-year run, when it was a finalist
  full?: RunSummary
  // extra full runs on the uncertainty seeds (version top 3 only)
  extra?: RunSummary[]
}
export type GenerationFile = {
  generation: number
  seeds: number[]
  // superseded: half-run on an older sim version, its population ran again as the next generation
  status: 'running' | 'done' | 'superseded'
  simVersion?: string
  startedAt: string
  finishedAt?: string
  population: Candidate[]
  // the top 2 by screening, who get a full 100-year run
  finalists?: string[]
  // version top-3 agents not in this population that ran their uncertainty seeds this generation
  guests?: Candidate[]
  // learning this generation: deaths, deaths that repeated a known lesson, lessons added
  stats?: { deaths: number; repeatDeaths: number; newLessons: Lesson[]; newHall?: HallEntry[] }
}
export type LeaderboardEntry = {
  candidateId: string
  name: string
  generation: number
  score: number
  constitution: string
  origin: Candidate['origin']
  best: RunSummary
  // the evidence layer: why it beat the entry ranked below it (the 3 decisive decisions, from the records) and its
  // best world against UN projections at the same year
  explainGap?: GapExplanation | null
  realBaseline?: RealBaseline | null
}

export function readLeaderboard(): LeaderboardEntry[] {
  return readJson<LeaderboardEntry[]>(leaderboardFile()) ?? []
}

// showcase worlds are committed so the deployed site can replay them. records are big, so they are stored
// gzipped with a small summary index next to them.
const showcaseIndexFile = () => path.join(process.cwd(), 'data', 'showcase', 'index.json')

export function listShowcase(): (RunSummary & { seed?: number })[] {
  const idx = readJson<(RunSummary & { seed?: number })[]>(showcaseIndexFile())
  if (idx) return idx
  try {
    // no index (an older copy): read the summaries from the worlds themselves, gzipped or not
    return fs.readdirSync(path.join(process.cwd(), 'data', 'showcase')).filter(f => /\.json(\.gz)?$/.test(f) && f !== 'index.json')
      .map(f => readShowcase(f.replace(/\.json(\.gz)?$/, ''))?.summary)
      .filter((s): s is RunSummary => !!s)
  } catch { return [] }
}

export function readShowcase(id: string): RunRecord | null {
  if (!SAFE_ID.test(id)) return null
  try {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(process.cwd(), 'data', 'showcase', `${id}.json.gz`))).toString('utf8')) as RunRecord
  } catch {
    return readJson<RunRecord>(path.join(process.cwd(), 'data', 'showcase', `${id}.json`))
  }
}

export function writeShowcase(record: RunRecord): boolean {
  const file = path.join(dirs.showcase, `${record.runId}.json.gz`)
  if (fs.existsSync(file)) return false
  fs.mkdirSync(dirs.showcase, { recursive: true })
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(record), { level: 9 }))
  const idx = listShowcase().filter(s => s.runId !== record.runId)
  writeJson(showcaseIndexFile(), [...idx, { ...record.summary, seed: record.seed }])
  return true
}

export function removeShowcase(runId: string) {
  if (!SAFE_ID.test(runId)) return
  fs.rmSync(path.join(dirs.showcase, `${runId}.json.gz`), { force: true })
  fs.rmSync(path.join(dirs.showcase, `${runId}.json`), { force: true })
  writeJson(showcaseIndexFile(), listShowcase().filter(s => s.runId !== runId))
}

// summaries of every local run, so agents and compare never parse the big records
const runIndexFile = () => path.join(process.cwd(), 'data', 'runs', 'index.json')
// milestones: the year each frontier stage was first reached (for ranges across runs)
export type IndexedRun = RunSummary & { seed: number; simVersion?: string; milestones?: Partial<Record<Frontier, number>> }
export function readRunIndex(): IndexedRun[] {
  return readJson<IndexedRun[]>(runIndexFile()) ?? []
}
export function indexRun(summary: RunSummary, seed: number, simVersion?: string, milestones?: IndexedRun['milestones']) {
  const all = readRunIndex().filter(r => r.runId !== summary.runId)
  all.push({ ...summary, seed, ...(simVersion ? { simVersion } : {}), ...(milestones ? { milestones } : {}) })
  writeJson(runIndexFile(), all)
}

// a run's full record from data/runs, plain or gzipped by retention (see retention.ts)
export function readRunRecord(id: string): RunRecord | null {
  if (!SAFE_ID.test(id)) return null
  const plain = readJson<RunRecord>(path.join(dirs.runs, `${id}.json`))
  if (plain) return plain
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dirs.runs, `${id}.json.gz`))).toString('utf8')) as RunRecord } catch { return null }
}

export function loadRecord(id: string): RunRecord | null {
  if (!SAFE_ID.test(id)) return null
  return readRunRecord(id) ?? readShowcase(id) ?? readJson<RunRecord>(path.join(dirs.live, `${id}.json`))
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

export const isWin = (s: { status: string }) => s.status === 'goal_achieved'

// a full summary for worlds runWorld never returned one for (crashes, live placeholders)
export function placeholderSummary(p: Pick<RunSummary, 'runId' | 'generation' | 'status' | 'endDate' | 'ticks' | 'constitution' | 'peakPopulation' | 'moonStage'> & Partial<RunSummary>): RunSummary {
  return {
    score: 0, topEvents: [], baselineStatus: 'alive', baselineEndDate: p.endDate,
    frontier: 'none', peakPeriodLifeExpectancy: 0, finalPopulation: p.peakPopulation, citiesFounded: 0, diseasesEradicated: [],
    humanCost: { deaths: 0, famineDeaths: 0, unrestDeaths: 0, displaced: 0, approval: 0 }, lessonsLearned: [], lessonsApplied: 0,
    agentId: 'unassigned',
    ...p,
  }
}
