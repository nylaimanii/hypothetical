// generational search over constitutions, evaluated in two stages:
//   screening: every candidate runs the same 2 seeds for 50 years (tick 600); its score is the average.
//   finals: the top 2 by screening also get one full 100-year run (tick 1200). the champion, the hall of
//   history and the showcase come from those full runs.
// breeding keeps the top 2 plus the protected long now charter and refills the population with mutations and
// crossovers. deaths in either stage feed lessons into data/lessons.json. runs until a world achieves the goal.
import fs from 'node:fs'
import path from 'node:path'
import type { Frame, Lesson, RunRecord, RunSummary } from '../types'
import { extractLessons, runWorld } from './core'
import { LONG_NOW_TEXT, SEEDS } from './seeds'
import { crossover, mutate } from './mutate'
import { crossoverName, mutationName, slug } from './names'
import {
  dirs, indexRun, isWin, leaderboardFile, placeholderSummary, readJson, readLeaderboard, readRunIndex, readRunRecord, writeJson,
  type Candidate, type GenerationFile, type LeaderboardEntry,
} from './store'
import { lessonsForPrompt, matchesKnownLesson, mergeLessons, readLearning, readLessons, writeLearning } from './lessons'
import { notifyGeneration, notifyGoal, notifyHallBatch, notifyWorldDied, send } from '../notify/telegram'
import { LlmDownError, llmGate, ollamaUp } from './ollama'
import { considerShowcase, isRealLlmRun, llmShare } from './showcase'
import { clearNow, heartbeatNow, writeNow } from './now'
import { readAgents } from './agents'
import { paceStats } from './usage'
import { isTransient, realClock, runQueue, type Clock } from './queue'
import { trackWorld } from './usage'
import { lineageRoots, recordAgentRun, registerPopulation, settleGeneration } from './agents'
import { indexFeatures, recomputeSteps } from './steps'
import { generationStory } from '../notify/story'
import { lifeGap, livesRunning, openGap } from './lifegap'
import { livesSection } from './lives'
import { diskReport, gb, sweep, writeSlim } from './retention'
import { backupDue, backupToGit, consistencyDue, markQuality, qualityDue, sendMorning, stableDue } from './maintenance'
import { codeRoot } from './version'
import { spawn } from 'node:child_process'
import { enterVersion, inRunner, runnerCodeChanged, runningSimVersion, simVersionOnDisk, upstreamSimVersion, verifyLessons } from './version'
import { realityCheckDue, runRealityCheck } from './reality'
import { agentRanges, EXTRA_SEEDS, markUncertaintyDone, milestoneYears, readUncertainty, versionTopAgents } from './uncertainty'
import { checkHall } from './hall'
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
  // is the llm server reachable (default: ollama)
  llmUp?: () => Promise<boolean>
  // tail of this file goes into the stall warning (scripts/evolve.ts passes data/evolve.log)
  logFile?: string
}

// shared with telegram commands
export const control = {
  paused: false,
  running: false,
  generation: 0,
  worldsDone: 0,
  worldsTotal: 0,
  worldsInterrupted: 0,
  concurrency: 1,
  // set while upkeep holds the queue (the weekly quality replay): the stall warning stays quiet
  maintenance: null as string | null,
  // run ids of the generation in progress: retention never touches them
  activeRunIds: new Set<string>(),
  // when the last world finished (or evolve started), for the stall warning
  lastWorldAt: 0,
  // the last 5 finished worlds, newest first, for mission control
  recent: [] as RunSummary[],
  stopRequested: false,
  // the sim version this process runs, and the newer one found on disk at a generation boundary (then evolve exits
  // so scripts/evolve.ts can restart it on the new code)
  simVersion: '',
  restartForVersion: null as string | null,
  goalReached: false,
}

const genFile = (n: number) => path.join(dirs.generations, `gen-${n}.json`)
// each generation gets its own pair of seeds, shared by every candidate in it
const seedsFor = (n: number) => [1000 + n * 2, 1001 + n * 2]
// extra: full 100-year runs on the uncertainty seeds for the version's top 3 agents
export type Stage = 'screen' | 'full' | 'extra'
export const SCREEN_TICKS = 600
export const FULL_TICKS = 1200
const FINALISTS = 2
const runIdFor = (g: GenerationFile, c: Candidate, seed: number, stage: Stage = 'screen') => `g${g.generation}-${c.id}${stage === 'screen' ? '' : '-full'}-s${seed}`
export const isFullRun = (runId: string) => /-full-s\d+$/.test(runId)

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
// screening stops at tick 600 via B's untilTick (the world's status stays 'alive'); full runs go to the 1200 horizon
type RunWorldOpts = Parameters<RunWorld>[0]
type Deps = { run: RunWorld; extract: typeof extractLessons; log: (l: string) => void; llmUp: () => Promise<boolean>; gate: () => Promise<void> }
let warnedFallback = false

// per-death learning: lessons from the run (B extracts them on death), merged into data/lessons.json
async function learnFromDeath(g: GenerationFile, record: RunRecord, deps: Deps): Promise<{ added: Lesson[]; repeat: Lesson | null }> {
  const s = record.summary
  const known = readLessons()
  const repeat = matchesKnownLesson(s.causeOfDeath, known)
  let lessons = s.lessonsLearned ?? []
  if (!lessons.length) {
    try { lessons = await deps.extract(record) } catch (e) { deps.log(`  lessons pending for ${s.runId}: ${(e as Error).message}`) }
  }
  const { added, bumped } = mergeLessons(lessons.map(l => ({ ...l, simVersion: control.simVersion, verified: true, verifiedIn: [control.simVersion] })))
  // dying of a mistake a lesson named confirms that lesson on this sim version
  verifyLessons([...(repeat ? [repeat.id] : []), ...bumped.map(l => l.id)], control.simVersion)
  g.stats = g.stats ?? { deaths: 0, repeatDeaths: 0, newLessons: [] }
  g.stats.deaths++
  if (repeat) g.stats.repeatDeaths++
  g.stats.newLessons.push(...added)
  deps.log(`  lessons: ${added.length} new, ${bumped.length} already known${repeat ? `, repeats known mistake ${repeat.id}` : ''}`)
  return { added, repeat }
}

async function runOne(g: GenerationFile, c: Candidate, seed: number, stage: Stage, deps: Deps): Promise<{ summary: RunSummary; record: RunRecord }> {
  const runId = runIdFor(g, c, seed, stage)
  const frames: Frame[] = []
  let summary: RunSummary
  let record: RunRecord
  try {
    let rec: RunRecord | null = null
    summary = await trackWorld(runId, g.generation, async () => {
      const opts: RunWorldOpts = {
        runId, generation: g.generation, seed, constitution: c.constitution, frameEvery: 12, agentId: c.id,
        ...(stage === 'screen' ? { untilTick: SCREEN_TICKS } : {}),
        onFrame: f => {
          if (f.tick % 12 === 0 || f.status !== 'alive') frames.push(f)
          publishNow(g, { runId, agentId: c.id }, f)
        },
      }
      const s = await deps.run(opts)
      rec = recordFor(runId, seed, g.generation, c.constitution, frames, s)
      // the governor falls back to offline decisions when the llm fails. if that happened because ollama went
      // down mid-world, the world is not a real run: interrupt it and run it again once ollama is back
      if (!isRealLlmRun(rec)) {
        if (!(await deps.llmUp())) throw new LlmDownError('ollama went down during the world')
        const { decisions, fallback } = llmShare(rec)
        if (!warnedFallback) {
          warnedFallback = true
          const msg = `warning: ${runId} ran ${fallback}/${decisions} decisions on the offline fallback while ollama was up. is the model pulled?`
          deps.log(msg); await send(msg)
        }
      }
      return s
    }, r => (r.ok ? 'finished' : isTransient(r.err) ? 'interrupted' : 'crashed'))
    record = rec!
  } catch (e) {
    // rate limits, timeouts and network errors are not deaths: hand back to the queue unscored
    if (isTransient(e)) throw e
    deps.log(`gen ${g.generation} ${runId} runWorld threw: ${(e as Error).message}`)
    summary = crashedSummary(runId, g.generation, c.id, c.constitution, frames, e as Error)
    record = { runId, generation: g.generation, seed, constitution: c.constitution, frames, baseline: [], summary, agentId: c.id, snapshots: [] }
    writeJson(path.join(dirs.runs, `${runId}.json`), record)
  }
  indexRun(summary, seed, control.simVersion, stage === 'screen' ? undefined : milestoneYears(record))
  // applying a lesson and surviving confirms it on this sim version
  if (summary.status !== 'destroyed') verifyLessons([...new Set(record.frames.flatMap(f => f.decision?.lessonsApplied ?? []))], control.simVersion)
  recordAgentRun(summary, stage === 'screen' ? 'screen' : 'full')
  // every world keeps a slim payload forever (retention may retire its full record later)
  try { writeSlim(record) } catch (e) { deps.log(`  could not write slim for ${runId}: ${(e as Error).message}`) }
  // feature row for the steps recipe (real llm runs only)
  try { indexFeatures(record) } catch (e) { deps.log(`  steps: could not index ${runId}: ${(e as Error).message}`) }
  const learning = readLearning()
  learning.worldsRun++
  writeLearning(learning)
  control.worldsDone++
  control.recent = [summary, ...control.recent.filter(r => r.runId !== summary.runId)].slice(0, 5)
  control.lastWorldAt = Date.now()
  deps.log(`gen ${g.generation} #${learning.worldsRun} ${stage.padEnd(6)} ${runId.padEnd(34)} ${summary.status.padEnd(13)} ${summary.endDate}  score ${summary.score}  frontier ${summary.frontier}${summary.causeOfDeath ? `  (${summary.causeOfDeath})` : ''}`)

  // a runner crash is a bug, not a death worth a lesson or a telegram
  if (summary.status === 'destroyed' && !summary.causeOfDeath?.startsWith('runner error')) {
    const { added, repeat } = await learnFromDeath(g, record, deps)
    await notifyWorldDied(summary, record, { generation: g.generation, worldNo: learning.worldsRun, agentName: c.name, added, repeat })
  }
  // hall of history and showcase come from full 100-year runs only. hall is sent as one telegram per generation
  if (stage !== 'screen' && !summary.causeOfDeath?.startsWith('runner error')) {
    const entries = checkHall(record, c.name, control.simVersion)
    if (entries.length) {
      g.stats = g.stats ?? { deaths: 0, repeatDeaths: 0, newLessons: [] }
      g.stats.newHall = [...(g.stats.newHall ?? []), ...entries]
      for (const e of entries) deps.log(`  hall of history: ${e.title} (${c.name})`)
    }
    // showcase: hall worlds, goal worlds and the best of each lineage, real llm runs only, max 20
    considerShowcase(record, entries.length > 0)
  }
  if (isWin(summary)) {
    control.goalReached = true
    await notifyGoal(summary, record, { generation: g.generation, agentName: c.name })
    await sendGoalReport(record, c.name)
  }
  return { summary, record }
}

// v2 scores are fractions, so keep 4 significant decimals instead of rounding them away
const round4 = (x: number) => Math.round(x * 1e4) / 1e4
// mission control snapshot (data/evolve-now.json), throttled to every 2s unless forced
function pendingWorlds(g: GenerationFile): { runId: string; agentId: string; seed: number }[] {
  const done = new Set(g.population.flatMap(c => [...(c.runs ?? []), ...(c.full ? [c.full] : [])].map(r => r.runId)))
  const screen = g.population.flatMap(c => g.seeds.map(s => ({ runId: runIdFor(g, c, s), agentId: c.id, seed: s })))
  const finals = (g.finalists ?? []).map(id => ({ runId: runIdFor(g, { id } as Candidate, g.seeds[0], 'full'), agentId: id, seed: g.seeds[0] }))
  return [...screen, ...finals].filter(q => !done.has(q.runId))
}
function publishNow(g: GenerationFile, current: { runId: string; agentId: string } | null, frame: Frame | null, force = false) {
  writeNow({
    generation: g.generation, agentId: current?.agentId ?? null, runId: current?.runId ?? null,
    worldIndex: Math.min(control.worldsDone + 1, control.worldsTotal), worldsInGen: control.worldsTotal,
    latestFrame: frame,
    queue: pendingWorlds(g).filter(q => q.runId !== current?.runId),
    recent: control.recent, newLessons: g.stats?.newLessons ?? [], concurrency: control.concurrency,
  }, force)
}

const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5)
const bestRunOf = (c: Candidate) => c.full ?? [...(c.runs ?? [])].sort((a, b) => b.score - a.score)[0]

function updateLeaderboard(g: GenerationFile): LeaderboardEntry[] {
  const all = [...readLeaderboard()]
  for (const c of g.population) {
    const best = bestRunOf(c)
    if (c.score === undefined || !best) continue
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

// the champion is the active agent with the best full 100-year world ever run
function championFromFullRuns(activeIds: string[]): string | undefined {
  const active = new Set(activeIds)
  const full = readRunIndex().filter(r => isFullRun(r.runId)).sort((a, b) => b.score - a.score)
  return (full.find(r => active.has(r.agentId)) ?? full[0])?.agentId
}

// one stage of a generation through the queue: llm gate, retries, progress, mission control
async function runStage(g: GenerationFile, stage: Stage, tasks: { c: Candidate; s: number }[], concurrency: number, deps: Deps, clock: Clock, records: Map<string, RunRecord>) {
  const { log } = deps
  const file = genFile(g.generation)
  await runQueue(tasks, {
    concurrency,
    clock,
    shouldStop: () => control.stopRequested,
    isPaused: () => control.paused,
    run: async ({ c, s }) => {
      const { summary, record } = await runOne(g, c, s, stage, deps)
      records.set(summary.runId, record)
      if (stage === 'full') c.full = summary
      else if (stage === 'extra') c.extra = [...(c.extra ?? []).filter(r => r.runId !== summary.runId), summary]
      else {
        c.runs = [...(c.runs ?? []), summary].sort((a, b) => a.runId.localeCompare(b.runId))
        if (c.runs.length === g.seeds.length) c.score = round4(c.runs.reduce((a, r) => a + r.score, 0) / c.runs.length)
      }
      writeJson(file, g)
      publishNow(g, null, record.frames[record.frames.length - 1] ?? null, true)
    },
    onInterrupted: ({ c, s }, err, attempt, retryAt) => {
      control.worldsInterrupted++
      c.interrupted = (c.interrupted ?? 0) + 1
      writeJson(file, g)
      log(`gen ${g.generation} ${runIdFor(g, c, s, stage).padEnd(34)} interrupted (${(err as Error).message}), attempt ${attempt}, retry at ${hhmm(retryAt)}`)
    },
    beforeEach: deps.gate,
  })
}

// weekly: replay the champion's best full world with the bigger model, between worlds (evolve holds ollama anyway)
const QUALITY_MODEL = process.env.QUALITY_MODEL || 'qwen2.5:14b'
async function qualityCheck(deps: Deps) {
  if (!qualityDue()) return
  const champ = readAgents().find(a => a.champion)
  const best = champ && readRunIndex().filter(r => r.agentId === champ.id && isFullRun(r.runId) && (!r.simVersion || r.simVersion === control.simVersion)).sort((a, b) => b.score - a.score)[0]
  // nothing to replay yet: try again between the next worlds instead of waiting a week
  if (!champ || !best) return
  markQuality()
  const runId = `qc${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${best.runId}`.slice(0, 80)
  const prevModel = process.env.LLM_MODEL
  control.maintenance = 'quality check'
  deps.log(`quality check: replaying ${best.runId} (${champ.name}) with ${QUALITY_MODEL}`)
  try {
    process.env.LLM_MODEL = QUALITY_MODEL
    const s = await deps.run({ runId, generation: best.generation, seed: best.seed, constitution: champ.constitution, frameEvery: 12, agentId: champ.id })
    const died = (x: { status: string }) => x.status === 'destroyed'
    const drift = best.score ? (s.score - best.score) / Math.abs(best.score) : 0
    const holds = died(s) === died(best) && Math.abs(drift) <= 0.2
    const verdict = `${holds ? 'holds up' : 'does NOT hold up'}: ${champ.name}'s best world with ${QUALITY_MODEL} scored ${s.score} vs ${best.score} with the screening model (${(drift * 100).toFixed(0)}%), ${s.status} ${s.endDate} vs ${best.status} ${best.endDate}, frontier ${s.frontier.replace(/_/g, ' ')} vs ${best.frontier.replace(/_/g, ' ')}`
    writeJson(path.join(process.cwd(), 'data', 'quality', `${new Date().toISOString().slice(0, 10)}.json`), { at: new Date().toISOString(), model: QUALITY_MODEL, original: best, replay: s, drift, holds, verdict })
    deps.log(`quality check ${verdict}`)
    await send(`weekly quality check ${verdict}`)
  } catch (e) {
    deps.log(`quality check failed: ${(e as Error).message}`)
  } finally {
    if (prevModel === undefined) delete process.env.LLM_MODEL
    else process.env.LLM_MODEL = prevModel
    control.maintenance = null
    control.lastWorldAt = Date.now()
  }
}

async function runUncertainty(g: GenerationFile, concurrency: number, deps: Deps, clock: Clock, records: Map<string, RunRecord>) {
  const done = readUncertainty().done
  const pending = versionTopAgents().filter(id => !done[id])
  if (!pending.length) return
  const agents = readAgents()
  const who = pending.map(id => {
    const inPop = g.population.find(c => c.id === id)
    if (inPop) return inPop
    const known = g.guests?.find(c => c.id === id)
    if (known) return known
    const a = agents.find(x => x.id === id)
    if (!a) return null
    const guest: Candidate = { id: a.id, name: a.name, origin: 'elite', parents: [], constitution: a.constitution, ...(a.protected ? { protected: true } : {}) }
    g.guests = [...(g.guests ?? []), guest]
    return guest
  }).filter((c): c is Candidate => !!c)
  const indexed = new Set(readRunIndex().map(r => r.runId))
  const tasks = who.flatMap(c => EXTRA_SEEDS.filter(s => !indexed.has(runIdFor(g, c, s, 'extra'))).map(s => ({ c, s })))
  if (tasks.length) {
    deps.log(`gen ${g.generation} uncertainty: ${who.map(c => c.name).join(', ')} run ${EXTRA_SEEDS.length} extra seeds`)
    control.worldsTotal += tasks.length
    writeJson(genFile(g.generation), g)
    await runStage(g, 'extra', tasks, concurrency, deps, clock, records)
    if (control.stopRequested) return
  }
  for (const c of who) {
    const runIds = EXTRA_SEEDS.map(s => runIdFor(g, c, s, 'extra'))
    markUncertaintyDone(c.id, runIds)
    const r = agentRanges(c.id)
    if (r) { deps.log(`  ${c.name} across ${r.runs} full runs: ${r.lines.join('; ')}`); await send(`${c.name} across ${r.runs} full runs:\n${r.lines.join('\n')}`) }
  }
}

async function runGeneration(g: GenerationFile, concurrency: number, deps: Deps, clock: Clock) {
  const { log } = deps
  const file = genFile(g.generation)
  writeJson(file, g)
  const records = new Map<string, RunRecord>()
  control.generation = g.generation
  control.activeRunIds = new Set(pendingWorlds(g).map(q => q.runId).concat(g.population.flatMap(c => (c.runs ?? []).map(r => r.runId))))
  control.worldsTotal = g.population.length * g.seeds.length + Math.min(FINALISTS, g.population.length)
  control.worldsDone = control.worldsTotal - pendingWorlds(g).length - (g.finalists ? 0 : Math.min(FINALISTS, g.population.length))

  // stage 1: screening, everyone on the same 2 seeds for 50 years
  const screen = g.population.flatMap(c => g.seeds.filter(s => !c.runs?.some(r => r.runId === runIdFor(g, c, s))).map(s => ({ c, s })))
  await runStage(g, 'screen', screen, concurrency, deps, clock, records)
  if (control.stopRequested) return

  // stage 2: the top 2 by screening average get a full 100-year run on the first seed
  if (!g.finalists) {
    g.finalists = [...g.population].sort((a, b) => (b.score ?? -1e9) - (a.score ?? -1e9)).slice(0, FINALISTS).map(c => c.id)
    writeJson(file, g)
    log(`gen ${g.generation} finals: ${g.finalists.map(id => g.population.find(c => c.id === id)?.name).join(' and ')} get a full 100-year run`)
  }
  const finals = g.finalists.map(id => g.population.find(c => c.id === id)!).filter(c => c && !c.full).map(c => ({ c, s: g.seeds[0] }))
  await runStage(g, 'full', finals, concurrency, deps, clock, records)
  if (control.stopRequested) return

  // uncertainty: the version's top 3 agents (by best full run) each run 5 extra seeds once per version
  await runUncertainty(g, concurrency, deps, clock, records)
  if (control.stopRequested) return

  g.status = 'done'
  g.finishedAt = new Date().toISOString()
  writeJson(file, g)
  const leaderboard = updateLeaderboard(g)

  const ranked = [...g.population].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const best = ranked[0]
  const everyone = [...g.population, ...(g.guests ?? [])]
  const allRuns = everyone.flatMap(c => [...(c.runs ?? []), ...(c.full ? [c.full] : []), ...(c.extra ?? [])])
  const fullRuns = everyone.flatMap(c => [...(c.full ? [c.full] : []), ...(c.extra ?? [])])
  const bestRun = [...(fullRuns.length ? fullRuns : allRuns)].sort((a, b) => b.score - a.score)[0]
  const stats = g.stats ?? { deaths: 0, repeatDeaths: 0, newLessons: [] }
  const lessonsKnown = readLessons().length
  const repeatRate = stats.deaths ? stats.repeatDeaths / stats.deaths : 0
  const goals = allRuns.filter(isWin).length

  const bestRecord = (bestRun && (records.get(bestRun.runId) ?? readJson<RunRecord>(path.join(dirs.runs, `${bestRun.runId}.json`)))) || null

  const champion = settleGeneration(g.population.map(c => c.id), championFromFullRuns(g.population.map(c => c.id)))
  const learning = readLearning()
  const at = new Date().toISOString()
  learning.rows = learning.rows.filter(r => r.generation !== g.generation)
  learning.rows.push({
    simVersion: control.simVersion,
    generation: g.generation, bestScore: bestRun?.score ?? 0, lessonsKnown, repeatMistakeRate: Math.round(repeatRate * 1000) / 1000,
    worlds: allRuns.length, deaths: stats.deaths, repeatDeaths: stats.repeatDeaths, goalAchieved: goals, champion: champion?.name ?? best?.name, at,
  })
  // one row per lineage too (lineage = the seed agent it descends from), scored on the comparable 50-year screening
  const roots = lineageRoots()
  const byLineage = new Map<string, RunSummary[]>()
  for (const c of g.population) for (const r of c.runs ?? []) byLineage.set(roots(c.id), [...(byLineage.get(roots(c.id)) ?? []), r])
  for (const [lineage, runs] of byLineage) {
    learning.rows.push({
      simVersion: control.simVersion, generation: g.generation, lineage, bestScore: Math.max(...runs.map(r => r.score)), lessonsKnown, repeatMistakeRate: Math.round(repeatRate * 1000) / 1000,
      worlds: runs.length, deaths: runs.filter(r => r.status === 'destroyed').length, repeatDeaths: 0, goalAchieved: runs.filter(isWin).length, at,
    })
  }
  writeLearning(learning)

  const steps = recomputeSteps()
  const topStep = steps.helped[0], deadliest = steps.hurt[0]
  const stepLines = [
    topStep ? `top step so far: ${topStep.text} (effect +${topStep.effect}, ${topStep.helpedWorlds.length} worlds helped)` : '',
    deadliest ? `deadliest step so far: ${deadliest.text} (in ${deadliest.hurtWorlds.length} worlds that did worse${deadliest.hurtWorlds.some(id => allRuns.some(r => r.runId === id && r.status === 'destroyed')) ? ' or died' : ''})` : '',
  ].filter(Boolean)
  const champRange = champion ? agentRanges(champion.id) : null
  if (champRange) stepLines.unshift(`champion across ${champRange.runs} full runs: ${champRange.lines.slice(0, 2).join('; ')}`)
  const line = `gen ${g.generation} done: champion ${champion?.name ?? best.name} | best screening ${best.name} avg ${best.score} | best 100-year world ${round4(bestRun?.score ?? 0)} | lessons known ${lessonsKnown} | repeat-mistake rate ${Math.round(repeatRate * 100)}% (${stats.repeatDeaths}/${stats.deaths} deaths)${goals ? ` | ${goals} goal achieved` : ''}`
  log(line)
  for (const l of stepLines) log(`  ${l}`)
  if (g.stats?.newHall?.length) await notifyHallBatch(g.generation, g.stats.newHall)
  // telegram gets the story, not the stats: the most interesting world, the deadliest step if there is room,
  // and the champion's fake-wise takeaway (marked "probably")
  const storyRecords = new Map<string, RunRecord>()
  const interesting = [...allRuns.filter(r => r.status === 'destroyed'), ...[...allRuns].sort((a, b) => (b.humanCost?.famineDeaths ?? 0) - (a.humanCost?.famineDeaths ?? 0)).slice(0, 3), bestRun].filter(Boolean) as RunSummary[]
  for (const r of interesting.slice(0, 6)) { const rec = records.get(r.runId) ?? readRunRecord(r.runId); if (rec) storyRecords.set(r.runId, rec) }
  const story = generationStory({
    generation: g.generation, champion: champion?.name ?? best.name, runs: allRuns.filter(r => storyRecords.has(r.runId)), records: storyRecords,
    names: new Map(readAgents().map(a => [a.id, a.name])), firsts: (g.stats?.newHall ?? []).filter(e => e.kind === 'first' || e.kind === 'milestone').map(e => e.title),
  }).split('\n')
  if (deadliest && story.length < 4) story.splice(story.length - 1, 0, `deadliest habit so far: "${deadliest.text}".`)
  // D's chosen lives: the most interesting one that ended during this generation (2 lines at most)
  const lives = livesSection(Date.parse(g.startedAt))
  await notifyGeneration([...story, ...(lives.length ? ['', ...lives] : [])].join('\n'))
  const worstRun = [...allRuns].sort((a, b) => (b.humanCost?.deaths ?? 0) - (a.humanCost?.deaths ?? 0))[0]
  await sendDigest({ generation: g, leaderboard, bestRecord, allRuns, learning: learning.rows.filter(r => !r.lineage), lessonsKnown, steps,
    story, worstRecord: worstRun ? storyRecords.get(worstRun.runId) ?? readRunRecord(worstRun.runId) : null, champion: champion?.name })
}

// background chores while evolve runs: lastHeartbeat every minute, a telegram heartbeat every hour, a warning
// when no world has finished for 90 minutes, and one "evolution restarted" message once the first world is done
const MIN = 60_000
function startWatchdogs(log: (l: string) => void, logFile?: string) {
  const startedAt = Date.now()
  control.lastWorldAt = startedAt
  let stallWarned = 0
  let lastHourly = startedAt
  let restartSent = false
  let lowDiskWarned = false
  let stableRunning = false
  let consistencyRunning = false
  const tick = async () => {
    try {
      heartbeatNow()
      // paused evolution leaves ollama to the lives (the gap is refreshed every minute and lapses on resume)
      if (control.paused) openGap(90)
      const now = Date.now()
      if (!restartSent && control.lastWorldAt > startedAt) {
        restartSent = true
        const mins = (control.lastWorldAt - startedAt) / MIN
        const perDay = Math.floor((1440 / Math.max(mins, 0.1)) * Math.max(1, control.concurrency))
        await send(`evolution restarted · gen ${control.generation} · first world took ${mins.toFixed(1)} min · est. ${perDay} worlds per day`)
      }
      // monthly: compare the no-ai twin against real published data, flag ESTIMATE parameters that drift
      if (now - lastHourly >= 60 * MIN && realityCheckDue()) {
        const r = await runRealityCheck()
        const drifted = r.rows.filter(x => x.flagged)
        log(`reality check: ${r.rows.length} comparisons, ${drifted.length} drifted, ${r.flags.length} parameters flagged`)
        if (drifted.length) await send(`reality check: the no-ai twin drifted from real data\n${drifted.map(x => `${x.stat} ${x.year}: twin ${x.twin} vs real ${x.real} (${(x.drift * 100).toFixed(1)}%)`).join('\n')}\ntune: ${r.flags.map(f => f.name).join(', ') || 'no matching parameters found'}`)
      }
      if (now - lastHourly >= 60 * MIN) {
        lastHourly = now
        // retention: gzip mediocre full records, delete them after 3 days (slim payloads stay forever)
        const swept = sweep(control.activeRunIds)
        if (swept.gzipped || swept.deleted) log(`retention: ${swept.gzipped} gzipped, ${swept.deleted} deleted, ${swept.restored} restored, ${gb(swept.freedBytes)} freed`)
        const disk = diskReport()
        const pace = paceStats(control.concurrency)
        const agents = readAgents()
        await send(`alive · gen ${control.generation} · world ${Math.min(control.worldsDone + 1, control.worldsTotal)}/${control.worldsTotal} · ${pace ? `${pace.avgMinutesPerWorld} min per world` : 'no world finished yet'} · ${agents.reduce((n, a) => n + a.deaths, 0)} deaths so far · best score ${Math.max(0, ...agents.map(a => a.bestScore))} · data ${gb(disk.dataBytes)}, ${gb(disk.freeBytes)} free`)
        if (disk.low && !lowDiskWarned) { lowDiskWarned = true; await send(`warning: only ${gb(disk.freeBytes)} free disk (under 50GB). data/ uses ${gb(disk.dataBytes)}`) }
        if (!disk.low) lowDiskWarned = false
      }
      // daily upkeep: backup of what the ai learned, the 8am digest, and the stable promotion (in a child process,
      // because a full build would block this loop for minutes)
      if (backupDue()) {
        try { const b = backupToGit(); log(`backup: ${b.note}${b.sha ? ` (${b.sha.slice(0, 7)})` : ''}`) } catch (e) { log(`backup failed: ${(e as Error).message.split('\n')[0]}`) }
      }
      await sendMorning(send, log)
      if (stableDue() && !stableRunning) {
        stableRunning = true
        const child = spawn(process.execPath, [path.join(codeRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(codeRoot(), 'scripts', 'promote-stable.ts')], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
        let out = ''
        child.stdout.on('data', d => { out += d })
        child.on('exit', () => { stableRunning = false; const last = out.trim().split('\n').pop(); if (last) log(last) })
      }
      // the nightly consistency suite on the last day's worlds and lives (telegrams only on a failure, itself)
      if (consistencyDue() && !consistencyRunning) {
        consistencyRunning = true
        const child = spawn(process.execPath, [path.join(codeRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--tsconfig', path.join(codeRoot(), 'tsconfig.json'), path.join(codeRoot(), 'scripts', 'consistency.ts'), '--nightly', '--if-due'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
        let out = ''
        child.stdout.on('data', d => { out += d })
        child.stderr.on('data', d => { out += d })
        child.on('exit', () => { consistencyRunning = false; const first = out.trim().split('\n')[0]; if (first) log(first) })
      }
      // a stall: nothing finished for 90 min (one warning per stall; a finished world resets it)
      if (!control.paused && !control.maintenance && now - control.lastWorldAt >= 90 * MIN && stallWarned !== control.lastWorldAt) {
        stallWarned = control.lastWorldAt
        let tail = ''
        try { if (logFile) tail = fs.readFileSync(logFile, 'utf8').trimEnd().split('\n').slice(-12).join('\n') } catch {}
        const msg = `warning: no world has finished for ${Math.round((now - control.lastWorldAt) / MIN)} min (gen ${control.generation}, world ${Math.min(control.worldsDone + 1, control.worldsTotal)}/${control.worldsTotal}).${tail ? `\nlast log lines:\n${tail}` : ''}`
        log(msg.split('\n')[0])
        await send(msg)
      }
    } catch { /* watchdogs never take evolution down */ }
  }
  const timer = setInterval(() => { void tick() }, MIN)
  timer.unref()
  return () => clearInterval(timer)
}

export async function evolve(opts: EvolveOptions) {
  const log = opts.log ?? console.log
  const llmUp = opts.llmUp ?? ollamaUp
  const clock = opts.clock ?? realClock
  const llmWait = llmGate({ up: llmUp, clock, notify: send, log })
  const deps: Deps = {
    run: opts.runWorld ?? runWorld, extract: opts.extractLessons ?? extractLessons, log, llmUp,
    gate: async () => {
      await llmWait()
      // between worlds: the weekly quality replay (real runs only, never in tests with a fake runWorld)
      if (!opts.runWorld) await qualityCheck(deps)
      // then a short gap for D's chosen lives, only when some are running (evolution keeps priority otherwise)
      if (!opts.runWorld) { const waited = await lifeGap(); if (waited) log(`lives gap: ${waited}s for ${livesRunning()} running lives`) }
    },
  }
  const stopWatchdogs = startWatchdogs(log, opts.logFile)
  control.concurrency = opts.concurrency
  const popSize = Math.max(3, opts.popSize ?? SEEDS.length)
  const gens = opts.gens ?? Infinity
  control.running = true
  control.goalReached = false
  control.recent = readRunIndex().filter(r => r.generation > 0).slice(-5).reverse()
  try {
    control.simVersion = runningSimVersion()
    const previous = enterVersion(control.simVersion)
    if (previous) {
      const carried = readLessons().length
      const msg = `new sim version ${control.simVersion} (was ${previous}): leaderboard, steps, hall and learning curve start fresh. ${carried} lessons carried forward, unverified until worlds confirm them`
      deps.log(msg); await send(msg)
    }
    let last = lastGeneration()
    let current: GenerationFile
    if (!last) current = { ...firstGeneration(), simVersion: control.simVersion }
    else if (last.status === 'running' && last.simVersion && last.simVersion !== control.simVersion) {
      // half-run on an older sim version: same population, run again from scratch as a new generation
      writeJson(genFile(last.generation), { ...last, status: 'superseded' })
      const n = last.generation + 1
      current = { generation: n, seeds: seedsFor(n), status: 'running', startedAt: new Date().toISOString(), simVersion: control.simVersion,
        population: last.population.map(({ runs: _r, score: _s, full: _f, interrupted: _i, ...c }) => c) }
      deps.log(`gen ${last.generation} was half-run on ${last.simVersion}; its population runs again as gen ${n} on ${control.simVersion}`)
    }
    else if (last.status === 'running') { current = last; deps.log(`resuming gen ${current.generation}`) }
    else current = { generation: last.generation + 1, seeds: seedsFor(last.generation + 1), status: 'running', startedAt: new Date().toISOString(), simVersion: control.simVersion, population: await breed(last, popSize, deps.log) }

    for (let done = 0; done < gens && !control.stopRequested; done++) {
      // every active agent runs the same 2 seeds this generation, so compare mode has like-for-like worlds
      registerPopulation(current.population, current.generation)
      settleGeneration(current.population.map(c => c.id))
      deps.log(`gen ${current.generation} start: ${current.population.length} constitutions x seeds ${current.seeds.join(', ')}`)
      await runGeneration(current, opts.concurrency, deps, clock)
      // the mission is done: finish this generation, then stop
      if (control.goalReached) { deps.log('goal achieved, evolution stops'); break }
      if (control.stopRequested || done === gens - 1) break
      // a new sim version: in the runner, only what B pushed to origin/main counts (outside it, the files on disk).
      // stop here, at the generation boundary, and let scripts/run-evolve.sh restart on the new commit
      const next = inRunner() ? upstreamSimVersion() : simVersionOnDisk()
      if (next && next !== control.simVersion) {
        control.restartForVersion = next
        const msg = `sim version changed (${control.simVersion} to ${next}) after gen ${current.generation}: restarting evolution on the new version`
        deps.log(msg); await send(msg)
        break
      }
      // the evolution code itself was updated on origin/main: same sim version, just restart onto the new code
      if (runnerCodeChanged()) {
        control.restartForVersion = control.simVersion
        deps.log(`evolve code updated on origin/main after gen ${current.generation}: restarting onto it (sim version unchanged)`)
        break
      }
      last = current
      current = { generation: last.generation + 1, seeds: seedsFor(last.generation + 1), status: 'running', startedAt: new Date().toISOString(), simVersion: control.simVersion, population: await breed(last, popSize, deps.log) }
    }
  } finally {
    control.running = false
    stopWatchdogs()
    clearNow()
  }
}
