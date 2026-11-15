// generational search over constitutions. every generation runs every candidate on the same 2 seeds,
// keeps the top 2 plus the protected long now charter, and refills the population with mutations and
// crossovers. deaths feed lessons back into data/lessons.json. evolution runs until a world achieves the goal.
import fs from 'node:fs'
import path from 'node:path'
import type { Frame, Lesson, RunRecord, RunSummary } from '../types'
import { extractLessons, runWorld } from './core'
import { LONG_NOW_TEXT, SEEDS } from './seeds'
import { crossover, mutate } from './mutate'
import { crossoverName, mutationName, slug } from './names'
import {
  dirs, indexRun, isWin, leaderboardFile, placeholderSummary, readJson, readLeaderboard, writeJson, writeShowcase,
  type Candidate, type GenerationFile, type LeaderboardEntry,
} from './store'
import { lessonsForPrompt, matchesKnownLesson, mergeLessons, readLearning, readLessons, writeLearning } from './lessons'
import { notifyGeneration, notifyGoal, notifyWorldDied, send } from '../notify/telegram'
import { isTransient, realClock, runQueue, type Clock } from './queue'
import { trackWorld } from './usage'
import { sendDigest, sendGoalReport } from '../notify/email'

export type EvolveOptions = {
  // generations to run; default keeps going until a world achieves the goal
  gens?: number
  concurrency: number
  popSize?: number
  log?: (line: string) => void
  // test seams
  runWorld?: typeof runWorld
  extractLessons?: typeof extractLessons
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
  goalReached: false,
}

const genFile = (n: number) => path.join(dirs.generations, `gen-${n}.json`)
// each generation gets its own pair of seeds, shared by every candidate in it
const seedsFor = (n: number) => [1000 + n * 2, 1001 + n * 2]
const runIdFor = (g: GenerationFile, c: Candidate, seed: number) => `g${g.generation}-${c.id}-s${seed}`

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function generationNumbers(): number[] {
  let files: string[] = []
  try { files = fs.readdirSync(dirs.generations) } catch {}
  return files.map(f => /^gen-(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b)
}
function lastGeneration(): GenerationFile | null {
  const ns = generationNumbers()
  for (let i = ns.length - 1; i >= 0; i--) {
    const g = readJson<GenerationFile>(genFile(ns[i]))
    if (g) return g
  }
  return null
}
// every name ever used, so a new mutation never reuses one
function takenNames(): Set<string> {
  const names = new Set(SEEDS.map(s => s.name))
  for (const n of generationNumbers()) for (const c of readJson<GenerationFile>(genFile(n))?.population ?? []) names.add(c.name)
  return names
}

const protectedSeed = () => SEEDS.find(s => s.protected)!

async function breed(prev: GenerationFile, popSize: number, log: (l: string) => void): Promise<Candidate[]> {
  const n = prev.generation + 1
  const ranked = [...prev.population].sort((a, b) => (b.score ?? -1e9) - (a.score ?? -1e9))
  const rng = mulberry32(n * 7919)
  const keep = (c: Candidate): Candidate => ({ id: c.id, name: c.name, origin: 'elite', parents: [c.id], changes: 'kept unchanged', constitution: c.constitution, ...(c.protected ? { protected: true } : {}) })
  const next: Candidate[] = ranked.slice(0, 2).map(keep)
  // the long now charter always competes with its original text
  if (!next.some(c => c.protected)) {
    const s = protectedSeed()
    next.push({ id: s.id, name: s.name, origin: 'elite', parents: [s.id], changes: 'protected, original text', constitution: LONG_NOW_TEXT, protected: true })
  }
  const taken = takenNames()
  const pool = ranked.slice(0, Math.max(3, Math.ceil(ranked.length / 2)))
  // crossover splices sections; the charter has none, so it only takes part as a mutation parent
  const crossPool = pool.filter(c => !c.protected).length >= 2 ? pool.filter(c => !c.protected) : ranked.filter(c => !c.protected)
  for (let i = next.length; i < popSize; i++) {
    if (i % 2 === 1 || crossPool.length < 2) {
      const p = pool[Math.floor(rng() * pool.length)]
      const name = mutationName(p.name, taken); taken.add(name)
      log(`  breeding ${name}: mutate ${p.name}`)
      const m = await mutate(p, i, lessonsForPrompt(p.runs ?? []))
      next.push({ id: slug(name), name, origin: 'mutation', parents: [p.id], ...m })
    } else {
      const a = crossPool[Math.floor(rng() * crossPool.length)]
      let b = crossPool[Math.floor(rng() * crossPool.length)]
      if (b.id === a.id) b = crossPool[(crossPool.indexOf(a) + 1) % crossPool.length]
      const name = crossoverName(a.name, b.name, taken); taken.add(name)
      log(`  breeding ${name}: cross ${a.name} x ${b.name}`)
      next.push({ id: slug(name), name, origin: 'crossover', parents: [a.id, b.id], ...crossover(a, b, i) })
    }
  }
  return next
}

function firstGeneration(): GenerationFile {
  return {
    generation: 1, seeds: seedsFor(1), status: 'running', startedAt: new Date().toISOString(),
    population: SEEDS.map(s => ({ id: s.id, name: s.name, origin: 'seed', parents: [], constitution: s.text, ...(s.protected ? { protected: true } : {}) })),
  }
}

// runWorld owns data/runs. evolve only reads what it wrote, and writes a record itself only when runWorld throws
function recordFor(runId: string, seed: number, gen: number, constitution: string, frames: Frame[], summary: RunSummary): RunRecord {
  return readJson<RunRecord>(path.join(dirs.runs, `${runId}.json`)) ?? { runId, generation: gen, seed, constitution, frames, baseline: [], summary, agentId: summary.agentId, snapshots: [] }
}

function crashedSummary(runId: string, gen: number, agentId: string, constitution: string, frames: Frame[], err: Error): RunSummary {
  const last = frames[frames.length - 1]
  return placeholderSummary({
    runId, generation: gen, agentId, status: 'destroyed', endDate: last?.date ?? '2026-11', ticks: last?.tick ?? 0,
    causeOfDeath: `runner error: ${err.message}`, constitution,
    peakPopulation: Math.max(0, ...frames.map(f => f.regions.reduce((a, r) => a + r.population, 0))),
    moonStage: last?.moonStage ?? 'none',
  })
}

type RunWorld = typeof runWorld
type Deps = { run: RunWorld; extract: typeof extractLessons; log: (l: string) => void }

// per-death learning: lessons from the run (B extracts them on death), merged into data/lessons.json
async function learnFromDeath(g: GenerationFile, record: RunRecord, deps: Deps): Promise<{ added: Lesson[]; repeat: Lesson | null }> {
  const s = record.summary
  const known = readLessons()
  const repeat = matchesKnownLesson(s.causeOfDeath, known)
  let lessons = s.lessonsLearned ?? []
  if (!lessons.length) {
    try { lessons = await deps.extract(record) } catch (e) { deps.log(`  lessons pending for ${s.runId}: ${(e as Error).message}`) }
  }
  const { added, bumped } = mergeLessons(lessons)
  g.stats = g.stats ?? { deaths: 0, repeatDeaths: 0, newLessons: [] }
  g.stats.deaths++
  if (repeat) g.stats.repeatDeaths++
  g.stats.newLessons.push(...added)
  deps.log(`  lessons: ${added.length} new, ${bumped.length} already known${repeat ? `, repeats known mistake ${repeat.id}` : ''}`)
  return { added, repeat }
}

async function runOne(g: GenerationFile, c: Candidate, seed: number, deps: Deps): Promise<{ summary: RunSummary; record: RunRecord }> {
  const runId = runIdFor(g, c, seed)
  const frames: Frame[] = []
  let summary: RunSummary
  let record: RunRecord
  try {
    summary = await trackWorld(runId, g.generation, () => deps.run({
      runId, generation: g.generation, seed, constitution: c.constitution, frameEvery: 12, agentId: c.id,
      onFrame: f => { if (f.tick % 12 === 0 || f.status !== 'alive') frames.push(f) },
    }), r => (r.ok ? 'finished' : isTransient(r.err) ? 'interrupted' : 'crashed'))
    record = recordFor(runId, seed, g.generation, c.constitution, frames, summary)
  } catch (e) {
    // rate limits, timeouts and network errors are not deaths: hand back to the queue unscored
    if (isTransient(e)) throw e
    deps.log(`gen ${g.generation} ${runId} runWorld threw: ${(e as Error).message}`)
    summary = crashedSummary(runId, g.generation, c.id, c.constitution, frames, e as Error)
    record = { runId, generation: g.generation, seed, constitution: c.constitution, frames, baseline: [], summary, agentId: c.id, snapshots: [] }
    writeJson(path.join(dirs.runs, `${runId}.json`), record)
  }
  indexRun(summary, seed)
  const learning = readLearning()
  learning.worldsRun++
  writeLearning(learning)
  control.worldsDone++
  deps.log(`gen ${g.generation} #${learning.worldsRun} ${runId.padEnd(30)} ${summary.status.padEnd(13)} ${summary.endDate}  score ${summary.score}  frontier ${summary.frontier}${summary.causeOfDeath ? `  (${summary.causeOfDeath})` : ''}`)

  // a runner crash is a bug, not a death worth a lesson or a telegram
  if (summary.status === 'destroyed' && !summary.causeOfDeath?.startsWith('runner error')) {
    const { added, repeat } = await learnFromDeath(g, record, deps)
    await notifyWorldDied(summary, record, { generation: g.generation, worldNo: learning.worldsRun, agentName: c.name, added, repeat })
  }
  if (isWin(summary)) {
    control.goalReached = true
    writeShowcase(record)
    await notifyGoal(summary, record, { generation: g.generation, agentName: c.name })
    await sendGoalReport(record, c.name)
  }
  return { summary, record }
}

// v2 scores are fractions, so keep 4 significant decimals instead of rounding them away
const round4 = (x: number) => Math.round(x * 1e4) / 1e4
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
  writeJson(leaderboardFile(), top)
  return top
}

async function runGeneration(g: GenerationFile, concurrency: number, deps: Deps, clock: Clock) {
  const { log } = deps
  const file = genFile(g.generation)
  writeJson(file, g)
  const records = new Map<string, RunRecord>()
  const tasks = g.population.flatMap(c => g.seeds.filter(s => !c.runs?.some(r => r.runId === runIdFor(g, c, s))).map(s => ({ c, s })))
  control.generation = g.generation
  control.worldsTotal = g.population.length * g.seeds.length
  control.worldsDone = control.worldsTotal - tasks.length

  await runQueue(tasks, {
    concurrency,
    clock,
    shouldStop: () => control.stopRequested,
    isPaused: () => control.paused,
    run: async ({ c, s }) => {
      const { summary, record } = await runOne(g, c, s, deps)
      records.set(summary.runId, record)
      c.runs = [...(c.runs ?? []), summary].sort((a, b) => a.runId.localeCompare(b.runId))
      if (c.runs.length === g.seeds.length) c.score = round4(c.runs.reduce((a, r) => a + r.score, 0) / c.runs.length)
      writeJson(file, g)
    },
    onInterrupted: ({ c, s }, err, attempt, retryAt) => {
      control.worldsInterrupted++
      c.interrupted = (c.interrupted ?? 0) + 1
      writeJson(file, g)
      log(`gen ${g.generation} ${runIdFor(g, c, s).padEnd(30)} interrupted (${(err as Error).message}), attempt ${attempt}, retry at ${hhmm(retryAt)}`)
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
  const allRuns = g.population.flatMap(c => c.runs ?? [])
  const bestRun = [...allRuns].sort((a, b) => b.score - a.score)[0]
  const stats = g.stats ?? { deaths: 0, repeatDeaths: 0, newLessons: [] }
  const lessonsKnown = readLessons().length
  const repeatRate = stats.deaths ? stats.repeatDeaths / stats.deaths : 0
  const goals = allRuns.filter(isWin).length

  // the best world of every generation goes to the showcase, so the deployed site always has something real
  const bestRecord = (bestRun && (records.get(bestRun.runId) ?? readJson<RunRecord>(path.join(dirs.runs, `${bestRun.runId}.json`)))) || null
  if (bestRecord) writeShowcase(bestRecord)

  const learning = readLearning()
  learning.rows = learning.rows.filter(r => r.generation !== g.generation)
  learning.rows.push({
    generation: g.generation, bestScore: bestRun?.score ?? 0, lessonsKnown, repeatMistakeRate: Math.round(repeatRate * 1000) / 1000,
    worlds: allRuns.length, deaths: stats.deaths, repeatDeaths: stats.repeatDeaths, goalAchieved: goals, champion: best?.name, at: new Date().toISOString(),
  })
  writeLearning(learning)

  const line = `gen ${g.generation} done: best ${best.name} avg ${best.score} (top world ${round4(bestRun?.score ?? 0)}) | lessons known ${lessonsKnown} | repeat-mistake rate ${Math.round(repeatRate * 100)}% (${stats.repeatDeaths}/${stats.deaths} deaths)${goals ? ` | ${goals} goal achieved` : ''}`
  log(line)
  await notifyGeneration(line)
  await sendDigest({ generation: g, leaderboard, bestRecord, allRuns, learning: learning.rows, lessonsKnown })
}

export async function evolve(opts: EvolveOptions) {
  const deps: Deps = { run: opts.runWorld ?? runWorld, extract: opts.extractLessons ?? extractLessons, log: opts.log ?? console.log }
  const popSize = Math.max(3, opts.popSize ?? SEEDS.length)
  const gens = opts.gens ?? Infinity
  control.running = true
  control.goalReached = false
  try {
    let last = lastGeneration()
    let current: GenerationFile
    if (!last) current = firstGeneration()
    else if (last.status === 'running') { current = last; deps.log(`resuming gen ${current.generation}`) }
    else current = { generation: last.generation + 1, seeds: seedsFor(last.generation + 1), status: 'running', startedAt: new Date().toISOString(), population: await breed(last, popSize, deps.log) }

    for (let done = 0; done < gens && !control.stopRequested; done++) {
      deps.log(`gen ${current.generation} start: ${current.population.length} constitutions x seeds ${current.seeds.join(', ')}`)
      await runGeneration(current, opts.concurrency, deps, opts.clock ?? realClock)
      // the mission is done: finish this generation, then stop
      if (control.goalReached) { deps.log('goal achieved, evolution stops'); break }
      if (control.stopRequested || done === gens - 1) break
      last = current
      current = { generation: last.generation + 1, seeds: seedsFor(last.generation + 1), status: 'running', startedAt: new Date().toISOString(), population: await breed(last, popSize, deps.log) }
    }
  } finally {
    control.running = false
  }
}
