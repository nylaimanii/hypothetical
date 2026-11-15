// generational search over constitutions. each generation runs every candidate on the same 2 seeds,
// keeps the top 2, and refills the population with mutations and crossovers.
import fs from 'node:fs'
import path from 'node:path'
import type { Frame, RunRecord, RunSummary } from '../types'
import { runWorld } from './core'
import { SEEDS } from './seeds'
import { crossover, mutate } from './mutate'
import {
  dirs, leaderboardFile, readJson, readLeaderboard, writeJson,
  type Candidate, type GenerationFile, type LeaderboardEntry,
} from './store'
import { notifyGeneration, notifyMoon, notifyWorldDied, send } from '../notify/telegram'
import { isTransient, realClock, runQueue, type Clock } from './queue'
import { trackWorld } from './usage'
import { sendDigest, sendMoonReport } from '../notify/email'

export type EvolveOptions = {
  gens: number
  concurrency: number
  popSize?: number
  log?: (line: string) => void
  // test seams
  runWorld?: typeof runWorld
  clock?: Clock
}

// shared with telegram commands
export const control = {
  paused: false,
  running: false,
  generation: 0,
  worldsDone: 0,
  worldsTotal: 0,
  worldsInterrupted: 0,
  limitPausedUntil: 0,
  stopRequested: false,
}

const genFile = (n: number) => path.join(dirs.generations, `gen-${n}.json`)
// each generation gets its own pair of seeds, shared by every candidate in it
const seedsFor = (n: number) => [1000 + n * 2, 1001 + n * 2]

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function lastGeneration(): GenerationFile | null {
  let files: string[] = []
  try { files = fs.readdirSync(dirs.generations) } catch {}
  const ns = files.map(f => /^gen-(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => b - a)
  for (const n of ns) {
    const g = readJson<GenerationFile>(genFile(n))
    if (g) return g
  }
  return null
}

const root = (name: string) => name.split(' / ')[0].slice(0, 60)

async function breed(prev: GenerationFile, popSize: number, log: (l: string) => void): Promise<Candidate[]> {
  const n = prev.generation + 1
  const ranked = [...prev.population].sort((a, b) => (b.score ?? -1e9) - (a.score ?? -1e9))
  const rng = mulberry32(n * 7919)
  const next: Candidate[] = ranked.slice(0, 2).map((c, i) => ({
    id: `g${n}-${i}`, name: c.name, origin: 'elite', parents: [c.id], changes: 'kept unchanged', constitution: c.constitution,
  }))
  const pool = ranked.slice(0, Math.max(3, Math.ceil(ranked.length / 2)))
  for (let i = next.length; i < popSize; i++) {
    const id = `g${n}-${i}`
    if (i % 2 === 0) {
      const p = pool[Math.floor(rng() * pool.length)]
      log(`  breeding ${id}: mutate ${p.id}`)
      const m = await mutate(p, i)
      next.push({ id, name: `${root(p.name)} / m${n}`, origin: 'mutation', parents: [p.id], ...m })
    } else {
      const a = pool[Math.floor(rng() * pool.length)]
      let b = pool[Math.floor(rng() * pool.length)]
      if (b.id === a.id) b = pool[(pool.indexOf(a) + 1) % pool.length]
      log(`  breeding ${id}: cross ${a.id} x ${b.id}`)
      const x = crossover(a, b, i)
      next.push({ id, name: `${root(a.name).split(' x ')[0]} x ${root(b.name).split(' x ')[0]} / x${n}`, origin: 'crossover', parents: [a.id, b.id], ...x })
    }
  }
  return next
}

function firstGeneration(): GenerationFile {
  return {
    generation: 1, seeds: seedsFor(1), status: 'running', startedAt: new Date().toISOString(),
    population: SEEDS.map(s => ({ id: `g1-${s.id}`, name: s.name, origin: 'seed', parents: [], constitution: s.text })),
  }
}

// runWorld owns data/runs. evolve only reads what it wrote, and writes a record itself only when runWorld throws
function recordFor(runId: string, seed: number, gen: number, constitution: string, frames: Frame[], summary: RunSummary): RunRecord {
  return readJson<RunRecord>(path.join(dirs.runs, `${runId}.json`)) ?? { runId, generation: gen, seed, constitution, frames, baseline: [], summary }
}

function crashedSummary(runId: string, gen: number, constitution: string, frames: Frame[], err: Error): RunSummary {
  const last = frames[frames.length - 1]
  return {
    runId, generation: gen, status: 'destroyed', endDate: last?.date ?? '2026-11', ticks: last?.tick ?? 0, score: 0,
    causeOfDeath: `runner error: ${err.message}`, constitution,
    peakPopulation: Math.max(0, ...frames.map(f => f.regions.reduce((a, r) => a + r.population, 0))),
    moonStage: last?.moonStage ?? 'none', topEvents: [], baselineStatus: 'alive', baselineEndDate: last?.date ?? '2026-11',
  }
}

type RunWorld = typeof runWorld

async function runOne(g: GenerationFile, c: Candidate, seed: number, log: (l: string) => void, run: RunWorld): Promise<{ summary: RunSummary; record: RunRecord }> {
  const runId = `${c.id}-s${seed}`
  const frames: Frame[] = []
  let summary: RunSummary
  let record: RunRecord
  try {
    summary = await trackWorld(runId, g.generation, () => run({
      runId, generation: g.generation, seed, constitution: c.constitution, frameEvery: 12,
      onFrame: f => { if (f.tick % 12 === 0 || f.status !== 'alive') frames.push(f) },
    }), r => (r.ok ? 'finished' : isTransient(r.err) ? 'interrupted' : 'crashed'))
    record = recordFor(runId, seed, g.generation, c.constitution, frames, summary)
  } catch (e) {
    // rate limits, timeouts and network errors are not deaths: hand back to the queue unscored
    if (isTransient(e)) throw e
    log(`gen ${g.generation} ${runId} runWorld threw: ${(e as Error).message}`)
    summary = crashedSummary(runId, g.generation, c.constitution, frames, e as Error)
    record = { runId, generation: g.generation, seed, constitution: c.constitution, frames, baseline: [], summary }
    writeJson(path.join(dirs.runs, `${runId}.json`), record)
  }
  control.worldsDone++
  log(`gen ${g.generation} ${runId.padEnd(22)} ${summary.status.padEnd(9)} ${summary.endDate}  score ${summary.score}  twin ${summary.baselineStatus}${summary.causeOfDeath ? `  (${summary.causeOfDeath})` : ''}`)
  // a runner crash is a bug, not a death worth a telegram
  if (summary.status === 'destroyed' && !summary.causeOfDeath?.startsWith('runner error')) await notifyWorldDied(summary, record, g.generation)
  if (summary.status === 'moon') {
    fs.mkdirSync(dirs.showcase, { recursive: true })
    writeJson(path.join(dirs.showcase, `${runId}.json`), record)
    await notifyMoon(summary, g.generation)
    await sendMoonReport(record)
  }
  return { summary, record }
}

const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5)

function updateLeaderboard(g: GenerationFile): LeaderboardEntry[] {
  const all = [...readLeaderboard()]
  for (const c of g.population) {
    if (c.score === undefined || !c.runs?.length) continue
    const best = [...c.runs].sort((a, b) => b.score - a.score)[0]
    all.push({ candidateId: c.id, name: c.name, generation: g.generation, score: c.score, constitution: c.constitution, origin: c.origin, best })
  }
  // one entry per distinct constitution text, keeping its best score
  const byText = new Map<string, LeaderboardEntry>()
  for (const e of all) {
    const prev = byText.get(e.constitution)
    if (!prev || e.score > prev.score) byText.set(e.constitution, e)
  }
  const top = [...byText.values()].sort((a, b) => b.score - a.score).slice(0, 20)
  writeJson(leaderboardFile, top)
  return top
}

async function runGeneration(g: GenerationFile, concurrency: number, log: (l: string) => void, run: RunWorld, clock: Clock) {
  const file = genFile(g.generation)
  writeJson(file, g)
  const records = new Map<string, RunRecord>()
  const tasks = g.population.flatMap(c => g.seeds.filter(s => !c.runs?.some(r => r.runId === `${c.id}-s${s}`)).map(s => ({ c, s })))
  control.generation = g.generation
  control.worldsTotal = g.population.length * g.seeds.length
  control.worldsDone = control.worldsTotal - tasks.length

  await runQueue(tasks, {
    concurrency,
    clock,
    shouldStop: () => control.stopRequested,
    isPaused: () => control.paused,
    run: async ({ c, s }) => {
      const { summary, record } = await runOne(g, c, s, log, run)
      records.set(summary.runId, record)
      c.runs = [...(c.runs ?? []), summary].sort((a, b) => a.runId.localeCompare(b.runId))
      if (c.runs.length === g.seeds.length) c.score = Math.round((c.runs.reduce((a, r) => a + r.score, 0) / c.runs.length) * 10) / 10
      writeJson(file, g)
    },
    onInterrupted: ({ c, s }, err, attempt, retryAt) => {
      control.worldsInterrupted++
      c.interrupted = (c.interrupted ?? 0) + 1
      writeJson(file, g)
      log(`gen ${g.generation} ${`${c.id}-s${s}`.padEnd(22)} interrupted (${(err as Error).message}), attempt ${attempt}, retry at ${hhmm(retryAt)}`)
    },
    onLimitPause: async resumeAt => {
      control.limitPausedUntil = resumeAt
      const msg = `paused: groq limits, resuming at ${hhmm(resumeAt)}`
      log(msg)
      await send(msg)
    },
  })
  if (control.stopRequested) return

  g.status = 'done'
  g.finishedAt = new Date().toISOString()
  writeJson(file, g)
  const leaderboard = updateLeaderboard(g)

  const ranked = [...g.population].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const best = ranked[0]
  const bestRun = [...(best.runs ?? [])].sort((a, b) => b.score - a.score)[0]
  const allRuns = g.population.flatMap(c => c.runs ?? [])
  const deaths = allRuns.filter(r => r.status === 'destroyed').length
  const moons = allRuns.filter(r => r.status === 'moon').length
  const line = `gen ${g.generation} done: best ${best.name} avg ${best.score}, ${moons} moon, ${deaths} destroyed of ${allRuns.length}`
  log(line)
  await notifyGeneration(line)

  const bestRecord = (bestRun && (records.get(bestRun.runId) ?? readJson<RunRecord>(path.join(dirs.runs, `${bestRun.runId}.json`)))) || null
  await sendDigest({ generation: g, leaderboard, bestRecord, allRuns })
}

export async function evolve(opts: EvolveOptions) {
  const log = opts.log ?? console.log
  const popSize = opts.popSize ?? SEEDS.length
  control.running = true
  try {
    let last = lastGeneration()
    let current: GenerationFile
    if (!last) current = firstGeneration()
    else if (last.status === 'running') { current = last; log(`resuming gen ${current.generation}`) }
    else current = { generation: last.generation + 1, seeds: seedsFor(last.generation + 1), status: 'running', startedAt: new Date().toISOString(), population: await breed(last, popSize, log) }

    for (let done = 0; done < opts.gens && !control.stopRequested; done++) {
      log(`gen ${current.generation} start: ${current.population.length} constitutions x seeds ${current.seeds.join(', ')}`)
      await runGeneration(current, opts.concurrency, log, opts.runWorld ?? runWorld, opts.clock ?? realClock)
      if (control.stopRequested || done === opts.gens - 1) break
      last = current
      current = { generation: last.generation + 1, seeds: seedsFor(last.generation + 1), status: 'running', startedAt: new Date().toISOString(), population: await breed(last, popSize, log) }
    }
  } finally {
    control.running = false
  }
}
