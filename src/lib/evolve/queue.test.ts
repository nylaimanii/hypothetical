// npx tsx --test src/lib/evolve/queue.test.ts
// store paths resolve from cwd at import time: never import store (or anything using it) statically here
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RunOptions, RunSummary } from '../types'
import { backoffUntil, isTransient, runQueue, type Clock } from './queue'

const MIN = 60_000
const rateLimit = () => Object.assign(new Error('429 Rate limit reached for model'), { status: 429 })

// virtual time: sleeping advances the clock instantly
function fakeClock(start = Date.UTC(2026, 10, 15, 9, 0, 0)): Clock & { t: number } {
  const c = { t: start, now: () => c.t, sleep: async (ms: number) => { c.t += ms; await Promise.resolve() } }
  return c
}

test('backoff is 30s, 2m, 10m, then parks until the next hour', () => {
  const t0 = Date.UTC(2026, 10, 15, 9, 41, 0)
  assert.equal(backoffUntil(1, t0) - t0, 30_000)
  assert.equal(backoffUntil(2, t0) - t0, 2 * MIN)
  assert.equal(backoffUntil(3, t0) - t0, 10 * MIN)
  assert.equal(new Date(backoffUntil(4, t0)).toISOString(), '2026-11-15T10:00:00.000Z')
})

test('transient vs real errors', () => {
  assert.ok(isTransient(rateLimit()))
  assert.ok(isTransient(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })))
  assert.ok(isTransient(new TypeError('fetch failed')))
  assert.ok(isTransient(Object.assign(new Error('wrapped'), { cause: { status: 429 } })))
  assert.ok(!isTransient(new Error('cannot read properties of undefined')))
})

test('a world that fails transiently twice then succeeds is retried after 30s and 2m', async () => {
  const clock = fakeClock()
  const t0 = clock.t
  let calls = 0
  const attempts: number[] = []
  const done: number[] = []
  await runQueue(['w1'], {
    concurrency: 1, clock,
    run: async () => {
      attempts.push(clock.t - t0)
      if (++calls <= 2) throw rateLimit()
      done.push(clock.t)
    },
    onInterrupted: () => {},
  })
  assert.equal(calls, 3)
  assert.equal(done.length, 1)
  // first try at 0, second after the 30s backoff, third 2m after that
  assert.ok(attempts[1] >= 30_000 && attempts[1] < 31_000, `second attempt at ${attempts[1]}`)
  assert.ok(attempts[2] - attempts[1] >= 2 * MIN && attempts[2] - attempts[1] < 2 * MIN + 1000)
})

test('ollama down: one pause message, a check every 60s, one resume message, then the queue continues', async () => {
  const { llmGate } = await import('./ollama')
  const clock = fakeClock()
  let checks = 0
  const sent: string[] = []
  const finished: string[] = []
  const gate = llmGate({ up: async () => ++checks > 4, clock, notify: async t => { sent.push(t) }, log: () => {} })
  const t0 = clock.t
  await runQueue(['a', 'b'], { concurrency: 1, clock, beforeEach: gate, run: async t => { finished.push(t) } })
  assert.deepEqual(sent, ['paused: ollama not running', 'resumed: ollama is back'])
  assert.equal(clock.t - t0, 3 * 60_000, 'three 60s waits before ollama answered')
  assert.deepEqual(finished, ['a', 'b'])
})

test('a real error is not swallowed', async () => {
  await assert.rejects(runQueue(['x'], { concurrency: 1, clock: fakeClock(), run: async () => { throw new Error('bug') } }), /bug/)
})

function inTempDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyp-evolve-'))
    const cwd = process.cwd()
    process.chdir(dir)
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.GMAIL_USER
    delete process.env.GROQ_API_KEY
    // tests never touch the gpu: mutations use the offline fallback
    process.env.LLM_PROVIDER = 'offline'
    try { await fn(dir) } finally { process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }) }
  }
}

test('evolve: interrupted worlds are retried, never scored or reported as deaths', inTempDir(async dir => {
  // store paths resolve from cwd at import time
  const { evolve, control } = await import('./evolve')
  const { readDay } = await import('./usage')
  const { placeholderSummary } = await import('./store')
  let calls = 0
  const horizons: number[] = []
  const fake = async (o: RunOptions & { untilTick?: number; agentId?: string }): Promise<RunSummary> => {
    if (++calls <= 2) throw rateLimit()
    horizons.push(o.untilTick ?? 1200)
    // like the real runWorld, stamp the agent the world belongs to
    return placeholderSummary({
      runId: o.runId, generation: o.generation, status: 'complete', endDate: '2126-11', ticks: 1200, score: 50,
      constitution: o.constitution, peakPopulation: 8e9, moonStage: 'orbital', agentId: o.agentId,
    })
  }
  const lines: string[] = []
  await evolve({ gens: 1, concurrency: 1, runWorld: fake, clock: fakeClock(), log: l => lines.push(l), llmUp: async () => true })

  const gen = JSON.parse(fs.readFileSync(path.join(dir, 'data/generations/gen-1.json'), 'utf8'))
  assert.equal(gen.status, 'done')
  assert.equal(gen.population.length, 7, 'six philosophies plus the long now charter')
  assert.equal(calls, 14 + 2 + 10 + 2, '14 screening worlds, 2 full finals, 2 x 5 uncertainty seeds, plus 2 retries')
  // two-stage evaluation: 50-year screening for everyone, a 100-year final for the top 2,
  // then the version's top agents (only 2 have full runs yet) run 5 extra seeds each
  assert.equal(horizons.filter(h => h === 600).length, 14)
  assert.equal(horizons.filter(h => h === 1200).length, 2 + 10)
  const { agentRanges } = await import('./uncertainty')
  const ranged = gen.finalists.map((id: string) => agentRanges(id)).filter(Boolean)
  assert.equal(ranged.length, 2)
  assert.equal(ranged[0].runs, 6, 'the final plus 5 extra seeds')
  assert.ok(ranged[0].lines.some((l: string) => l === 'survived all 6 runs'))
  assert.equal(gen.finalists.length, 2)
  for (const c of gen.population) {
    assert.equal(c.runs.length, 2)
    assert.equal(c.score, 50)
    assert.ok(c.runs.every((r: RunSummary) => r.status === 'complete'))
    assert.equal(!!c.full, gen.finalists.includes(c.id), `${c.id} has a full run only if it is a finalist`)
    if (c.full) assert.ok(c.full.runId.endsWith(`-full-s${gen.seeds[0]}`))
  }
  assert.equal(gen.population.reduce((a: number, c: { interrupted?: number }) => a + (c.interrupted ?? 0), 0), 2)
  assert.equal(control.worldsInterrupted, 2)
  assert.equal(lines.filter(l => l.includes('interrupted')).length, 2)
  const day = readDay()
  assert.equal(day.worldsInterrupted, 2)
  assert.equal(day.worldsFinished, 26)
  assert.ok(fs.existsSync(path.join(dir, 'data/leaderboard.json')))
  // mission control file exists only while evolve runs
  assert.ok(!fs.existsSync(path.join(dir, 'data/evolve-now.json')), 'evolve-now is removed when evolve exits')
}))

test('evolve-now: written during a world with the live frame, queue and stats; 404 shape when stale', inTempDir(async dir => {
  const { evolve } = await import('./evolve')
  const { placeholderSummary } = await import('./store')
  const { readNow } = await import('./now')
  let seen = null as import('./now').EvolveNow | null
  const fake = async (o: RunOptions & { agentId?: string }): Promise<RunSummary> => {
    // tick 13: not on a 12-tick boundary, so evolve does not keep this partial frame
    o.onFrame?.({ tick: 13, date: '2027-12', status: 'alive' } as never)
    if (!seen) seen = readNow()
    return placeholderSummary({ runId: o.runId, generation: o.generation, status: 'complete', endDate: '2126-11', ticks: 1200, score: 1, constitution: o.constitution, peakPopulation: 8e9, moonStage: 'none', agentId: o.agentId })
  }
  await evolve({ gens: 1, concurrency: 1, runWorld: fake, clock: fakeClock(), log: () => {}, llmUp: async () => true })
  assert.ok(seen, 'evolve-now was readable during the first world')
  const now = seen as import('./now').EvolveNow
  assert.equal(now.generation, 1)
  assert.equal(now.runId, 'g1-long-now-s1002')
  assert.equal(now.agentId, 'long-now')
  assert.equal(now.worldIndex, 1)
  assert.equal(now.worldsInGen, 16)
  assert.equal(now.queue.length, 13, 'the other 13 screening worlds (finalists are not picked yet)')
  assert.equal(now.latestFrame?.tick, 13)
  assert.ok('worldsLost' in now.stats && 'estWorldsByMorning' in now.stats)
  assert.equal(readNow(), null, 'no evolution running after it exits')
  void dir
}))

test('evolve: deaths write lessons, repeats are counted, the charter survives breeding', inTempDir(async dir => {
  const { evolve } = await import('./evolve')
  const { placeholderSummary } = await import('./store')
  const lesson = (runId: string, rule: string) => ({ id: `${runId}-l0`, fromRunId: runId, generation: 1, mistake: 'kept food spending flat while harvests failed', consequence: 'the world food supply stayed below survival for a year and civilization starved', rule, timesRelevant: 0 })
  let n = 0
  const fake = async (o: RunOptions): Promise<RunSummary> => {
    n++
    // every third world starves; its lesson rule is the same each time, so later ones are repeats
    const dies = n % 3 === 0
    return placeholderSummary({
      runId: o.runId, generation: o.generation, status: dies ? 'destroyed' : 'complete', endDate: dies ? '2040-01' : '2126-11', ticks: dies ? 158 : 1200,
      score: dies ? 10 : 40 + (n % 5), constitution: o.constitution, peakPopulation: 8e9, moonStage: 'orbital',
      causeOfDeath: dies ? 'The world food supply stayed below 1800 kcal per person for a full year and civilization starved.' : undefined,
      lessonsLearned: dies ? [lesson(o.runId, 'raise food spending before supply drops under 2100 kcal anywhere')] : [],
      // like the real runWorld, stamp the agent the world belongs to
      agentId: (o as RunOptions & { agentId?: string }).agentId,
    })
  }
  await evolve({ gens: 2, concurrency: 1, runWorld: fake, clock: fakeClock(), log: () => {}, llmUp: async () => true })
  const lessons = JSON.parse(fs.readFileSync(path.join(dir, 'data/lessons.json'), 'utf8'))
  assert.equal(lessons.length, 1, 'same rule is merged, not duplicated')
  assert.ok(lessons[0].timesRelevant > 1)
  const learning = JSON.parse(fs.readFileSync(path.join(dir, 'data/learning.json'), 'utf8'))
  // one whole-generation row per generation, plus one row per lineage (seed agent id) per generation
  const overall = learning.rows.filter((r: { lineage?: string }) => !r.lineage)
  assert.equal(overall.length, 2)
  const lineages = new Set(learning.rows.filter((r: { lineage?: string }) => r.lineage).map((r: { lineage: string }) => r.lineage))
  assert.ok([...lineages].every(l => ['long-now', 'meridian', 'atlas', 'solace', 'halcyon', 'vesper', 'kestrel'].includes(l as string)), 'lineage is a seed agent id')
  assert.ok(overall[0].deaths > 0)
  assert.ok(overall[0].repeatMistakeRate > 0, 'second starvation repeats the first lesson')
  const gen2 = JSON.parse(fs.readFileSync(path.join(dir, 'data/generations/gen-2.json'), 'utf8'))
  const charter = gen2.population.find((c: { id: string }) => c.id === 'long-now')
  assert.ok(charter, 'long now competes every generation')
  assert.ok(charter.constitution.startsWith('your mission is the long-term survival'))
  assert.ok(gen2.population.some((c: { name: string }) => / ii$/.test(c.name)), 'mutations are named <parent> ii')
  assert.ok(gen2.population.some((c: { name: string }) => c.name.includes(' × ')), 'crossovers are named a × b')
  // these fake worlds made no llm calls, so none of them may reach the showcase
  assert.ok(!fs.existsSync(path.join(dir, 'data/showcase')) || !fs.readdirSync(path.join(dir, 'data/showcase')).some(f => f.endsWith('.json.gz')), 'offline worlds are never showcased')

  // agents registry: seven seeds plus their children, one champion, retired agents left out of gen 2
  const agents = JSON.parse(fs.readFileSync(path.join(dir, 'data/agents.json'), 'utf8'))
  assert.ok(agents.length > 7)
  assert.equal(agents.filter((a: { champion: boolean }) => a.champion).length, 1)
  const longNow = agents.find((a: { id: string }) => a.id === 'long-now')
  assert.ok(longNow.protected && !longNow.retired && longNow.worlds >= 4)
  // the champion is the agent of the best full 100-year world
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'data/runs/index.json'), 'utf8'))
  const bestFull = index.filter((r: RunSummary) => /-full-s\d+$/.test(r.runId)).sort((a: RunSummary, b: RunSummary) => b.score - a.score)[0]
  assert.equal(agents.find((a: { champion: boolean }) => a.champion).id, bestFull.agentId)
  const inGen2 = new Set(gen2.population.map((c: { id: string }) => c.id))
  for (const a of agents) assert.equal(a.retired, !a.protected && !inGen2.has(a.id), `${a.id} retired flag`)
  assert.ok(agents.every((a: { emblemSeed: number }) => Number.isInteger(a.emblemSeed)))
  // hall: the first world to reach the horizon is a milestone, and it is showcased
  const hall = JSON.parse(fs.readFileSync(path.join(dir, 'data/hall.json'), 'utf8'))
  const horizon = hall.entries.find((e: { title: string }) => e.title === 'first world to reach 2126')
  assert.ok(horizon, 'milestone recorded once')
  assert.ok(hall.entries.every((e: { runId: string }) => /-full-s\d+$/.test(e.runId)), 'hall entries come from full runs only')
  assert.equal(hall.entries.filter((e: { title: string }) => e.title === 'first world to reach 2126').length, 1)
  assert.ok(!fs.existsSync(path.join(dir, `data/showcase/${horizon.runId}.json.gz`)), 'hall worlds from offline runs stay out of the showcase')
}))

test('steps: a law common in the best worlds ranks as helped, one common in dead worlds as hurt', async () => {
  const { computeSteps } = await import('./steps')
  const budget = { food: 0.2, energy: 0.15, education: 0.15, space: 0.1, security: 0.1, welfare: 0.2, research: 0.1 }
  const world = (id: string, score: number, destroyed: boolean, laws: string[]) => ({
    runId: id, agentId: 'a', generation: 1, horizon: 'screen' as const, budget, lawFirstTick: Object.fromEntries(laws.map(l => [l, 24])),
    religion: 'free', schoolYearsMax: 10, citiesFirstTick: null, research: {}, decisions: 25,
    outcome: { score, le: 70 + score * 10, popTrend: destroyed ? 0.5 : 1, deathRatio: destroyed ? 0.3 : 0.01, approval: 0.5, destroyed },
  })
  const runs = [
    world('w1', 0.6, false, ['rail']), world('w2', 0.55, false, ['rail']), world('w3', 0.5, false, ['rail', 'crackdown']),
    world('w4', 0.1, true, ['crackdown']), world('w5', 0.12, true, ['crackdown']), world('w6', 0.3, false, []),
  ]
  const out = computeSteps(runs)
  const rail = out.helped.find(s => s.id === 'law-rail')
  assert.ok(rail && rail.effect > 0, 'rail helped')
  assert.deepEqual(rail!.helpedWorlds.sort(), ['w1', 'w2', 'w3'])
  assert.equal(rail!.text, 'pass a rail law')
  const crack = out.hurt.find(s => s.id === 'law-crackdown')
  assert.ok(crack && crack.effect < 0, 'crackdown hurt')
  assert.ok(crack!.hurtWorlds.includes('w4') && crack!.hurtWorlds.includes('w5'))
  assert.ok(crack!.confidence > 0 && crack!.confidence < 1)
  assert.ok(!out.helped.some(s => s.id === 'law-crackdown'))
})

test('learning report: a lesson repeated by a later death is not avoided; epitaph falls back to the cause', inTempDir(async dir => {
  const { learningReport } = await import('./report')
  const { placeholderSummary } = await import('./store')
  const { epitaphOf } = await import('../notify/epitaph')
  const starve = 'The world food supply stayed below 1800 kcal per person for a full year and civilization starved.'
  const sum = (runId: string, status: 'destroyed' | 'complete', cause?: string) => ({
    ...placeholderSummary({ runId, generation: 1, status, endDate: '2040-01', ticks: 158, constitution: 'x', peakPopulation: 8e9, moonStage: 'none', agentId: 'meridian', causeOfDeath: cause }), seed: 1002,
  })
  fs.mkdirSync(path.join(dir, 'data/runs'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'data/runs/index.json'), JSON.stringify([sum('w1', 'destroyed', starve), sum('w2', 'complete'), sum('w3', 'destroyed', starve)]))
  fs.writeFileSync(path.join(dir, 'data/lessons.json'), JSON.stringify([{ id: 'w1-l0', fromRunId: 'w1', generation: 1, mistake: 'kept food spending flat while harvests failed', consequence: starve, rule: 'raise food spending early', timesRelevant: 1 }]))
  const rep = learningReport()
  assert.equal(rep.worlds, 3)
  const first = rep.entries[0]
  assert.equal(first.lesson?.rule, 'raise food spending early')
  assert.deepEqual(first.later.repeatedBy, ['w3'])
  assert.equal(first.later.avoided, false)
  assert.equal(rep.avoidedShare, 0)
  const ep = epitaphOf(sum('w1', 'destroyed', starve), 'meridian', { id: 'x', fromRunId: 'w1', generation: 1, mistake: 'kept food spending flat while harvests failed', consequence: '', rule: '', timesRelevant: 1 })
  assert.equal(ep.causeKind, 'famine')
  assert.equal(ep.line, "here lies meridian's world, 2026 to 2040. it kept food spending flat while harvests failed.")
}))

test('sim versions: a new version archives the old results and carries lessons forward unverified', inTempDir(async dir => {
  const { enterVersion, verifyLessons, readVersion, versionDir } = await import('./version')
  const d = (p: string) => path.join(dir, 'data', p)
  fs.mkdirSync(d('runs'), { recursive: true })
  assert.equal(enterVersion('v1'), null, 'first version: nothing to roll over')
  fs.writeFileSync(d('steps.json'), '{"helped":[]}')
  fs.writeFileSync(d('hall.json'), '{"entries":[],"records":{}}')
  fs.writeFileSync(d('runs/features.json'), '{}')
  fs.writeFileSync(d('lessons.json'), JSON.stringify([{ id: 'l1', fromRunId: 'w1', generation: 1, mistake: 'm', consequence: 'c', rule: 'r', timesRelevant: 1, verified: true, verifiedIn: ['v1'] }]))
  assert.equal(enterVersion('v2'), 'v1')
  assert.ok(fs.existsSync(path.join(versionDir('v1'), 'steps.json')) && fs.existsSync(path.join(versionDir('v1'), 'runs/features.json')))
  assert.ok(!fs.existsSync(d('steps.json')) && !fs.existsSync(d('hall.json')), 'the new version starts clean')
  const carried = JSON.parse(fs.readFileSync(d('lessons.json'), 'utf8'))
  assert.equal(carried[0].verified, false, 'carried lessons wait for re-verification')
  assert.equal(carried[0].simVersion, 'v1')
  verifyLessons(['l1'], 'v2')
  assert.deepEqual(JSON.parse(fs.readFileSync(d('lessons.json'), 'utf8'))[0].verifiedIn, ['v1', 'v2'])
  assert.equal(readVersion()?.current, 'v2')
  assert.equal(readVersion()?.history[0].version, 'v1')
}))

test('retention: hall worlds stay plain, mediocre worlds are gzipped then deleted after 3 days, slims stay', inTempDir(async dir => {
  const { sweep, readSlim } = await import('./retention')
  const { placeholderSummary, readRunRecord } = await import('./store')
  const runs = path.join(dir, 'data/runs')
  fs.mkdirSync(runs, { recursive: true })
  const now = Date.now()
  const rec = (runId: string, score: number) => {
    const summary = placeholderSummary({ runId, generation: 1, status: 'complete', endDate: '2076-11', ticks: 600, score, constitution: 'x', peakPopulation: 8e9, moonStage: 'none', agentId: 'meridian' })
    return { runId, generation: 1, seed: 1002, constitution: 'x', agentId: 'meridian', snapshots: [], baseline: [], summary,
      frames: [{ tick: 0, date: '2026-11', regions: [], citizens: [], laws: [], budget: {}, religionPolicy: 'free', schoolPolicy: { purpose: 'p', curriculum: [], yearsRequired: 10 }, moonStage: 'none', moonProgress: 0, status: 'alive', newEvents: [], globalPopulation: 8e9, globalPeriodLifeExpectancy: 73 }] }
  }
  const ids = { hall: 'g1-hall-s1', old: 'g1-old-s1', recent: 'g1-recent-s1', active: 'g1-active-s1' }
  const index = Object.values(ids).map((id, i) => ({ ...rec(id, i === 0 ? 0.9 : 0.1).summary, seed: 1, simVersion: 'v1' }))
  // 25 better worlds, so the mediocre ones are outside the version's top 20
  for (let i = 0; i < 25; i++) index.push({ ...rec(`g1-top${i}-s1`, 0.5 + i / 100).summary, seed: 1, simVersion: 'v1' })
  fs.writeFileSync(path.join(runs, 'index.json'), JSON.stringify(index))
  for (const id of Object.values(ids)) fs.writeFileSync(path.join(runs, `${id}.json`), JSON.stringify(rec(id, 0.1)))
  fs.writeFileSync(path.join(runs, 'b-test-run.json'), '{"not":"evolve"}')
  fs.writeFileSync(path.join(dir, 'data/hall.json'), JSON.stringify({ entries: [{ id: 'first:x', runId: ids.hall }], records: {} }))
  const ago = (ms: number) => new Date(now - ms)
  fs.utimesSync(path.join(runs, `${ids.old}.json`), ago(4 * 864e5), ago(4 * 864e5))
  fs.utimesSync(path.join(runs, `${ids.recent}.json`), ago(7 * 3600e3), ago(7 * 3600e3))
  fs.utimesSync(path.join(runs, `${ids.hall}.json`), ago(5 * 864e5), ago(5 * 864e5))
  fs.utimesSync(path.join(runs, `${ids.active}.json`), ago(5 * 864e5), ago(5 * 864e5))
  const res = sweep(new Set([ids.active]), now)
  const exists = (f: string) => fs.existsSync(path.join(runs, f))
  assert.ok(exists(`${ids.hall}.json`), 'hall world keeps its plain record')
  assert.ok(!exists(`${ids.recent}.json`) && exists(`${ids.recent}.json.gz`), 'recent mediocre world is gzipped, not deleted')
  assert.ok(readRunRecord(ids.recent), 'gzipped records still read')
  assert.ok(!exists(`${ids.old}.json`) && !exists(`${ids.old}.json.gz`), 'old mediocre world loses its full record')
  assert.ok(readSlim(ids.old), 'but its slim payload stays')
  assert.ok(exists(`${ids.active}.json`), 'the generation in progress is never touched')
  assert.ok(exists('b-test-run.json'), "other agents' records are never touched")
  assert.equal(res.deleted, 1)
}))

test('lives gap: none without lives, ends early once lives stop asking, never longer than the cap', inTempDir(async dir => {
  process.env.LLM_PROVIDER = 'ollama'
  const { lifeGap, gapFile } = await import('./lifegap')
  let t = 0
  const mk = (running: number, asking: (t: number) => boolean) => ({ sleep: async (ms: number) => { t += ms }, now: () => t, running: () => running, asking: () => asking(t) })
  t = 0; assert.equal(await lifeGap(mk(0, () => true), 60), 0, 'no lives running: evolution does not wait')
  t = 0; assert.equal(await lifeGap(mk(3, () => true), 0), 0, 'gap turned off')
  t = 0; assert.equal(await lifeGap(mk(3, () => true), 60), 60, 'lives asking the whole time: capped at the gap')
  t = 0; const quiet = await lifeGap(mk(3, x => x < 10_000), 60)
  assert.ok(quiet >= 20 && quiet < 30, `lives went quiet after 10s: the gap ends soon after 20s (got ${quiet})`)
  assert.ok(!fs.existsSync(gapFile()), 'the gap file is removed afterwards')
  assert.ok(dir)
}))

test('morning digest: one send per day across processes, a failed send gives the claim back', inTempDir(async () => {
  const { sendMorning } = await import('./maintenance')
  const realHour = Date.prototype.getHours
  Date.prototype.getHours = function () { return 9 }
  try {
    let sent = 0
    assert.equal(await sendMorning(async () => false, () => {}), false, 'telegram failed')
    assert.equal(await sendMorning(async () => { sent++; return true }, () => {}), true, 'the retry sends it')
    assert.equal(await sendMorning(async () => { sent++; return true }, () => {}), false, 'already sent today')
    assert.equal(sent, 1)
  } finally { Date.prototype.getHours = realHour }
}))

test('evolve lock: a stale lock (dead pid, or a pid that is not evolve) is taken over', inTempDir(async () => {
  const { acquireEvolveLock } = await import('./instance')
  fs.mkdirSync('data', { recursive: true })
  fs.writeFileSync('data/.evolve.lock', JSON.stringify({ pid: 999999 }))
  const a = acquireEvolveLock(); assert.ok(a.ok, 'dead pid')
  fs.writeFileSync('data/.evolve.lock', JSON.stringify({ pid: process.ppid }))
  const b = acquireEvolveLock(); assert.ok(b.ok, 'a live pid that is not an evolve (a reused pid after a restart)')
}))

test("startup cleanup keeps fresh tickets in b's <prio>-<ms>-<pid> format and reads them right", inTempDir(async () => {
  const { clearPreBootLocks } = await import('./instance')
  const { ollamaQueue } = await import('./lifegap')
  fs.mkdirSync('data/.ollama.queue', { recursive: true })
  const now = Date.now()
  const fresh = `9-${String(now).padStart(15, '0')}-${process.pid}`
  fs.writeFileSync(path.join('data/.ollama.queue', fresh), 'life-milestone')
  const stale = path.join('data/.ollama.queue', `0-${String(now - 864e5).padStart(15, '0')}-${process.pid}`)
  fs.writeFileSync(stale, 'g9-old')
  fs.utimesSync(stale, new Date(now - 864e5), new Date(now - 864e5))
  const cleared = clearPreBootLocks(now - 3600e3)
  assert.deepEqual(cleared, [`.ollama.queue/${path.basename(stale)}`], 'only the ticket written before the boot goes')
  const q = ollamaQueue()
  assert.equal(q.waiting.length, 1)
  assert.equal(q.waiting[0].priority, 9)
  assert.equal(q.waiting[0].label, 'life-milestone')
  assert.ok(Math.abs(Date.parse(q.waiting[0].since) - now) < 1000, 'the time is read from the middle field')
}))

test('digest verdict uses only the current sim version, and says so when it has no worlds yet', async () => {
  const { verdictLine } = await import('./maintenance')
  const pop = (n: number) => [{ population: n }]
  const rec = (ai: number, tw: number) => ({ frames: [{ tick: 100, status: 'alive', regions: pop(ai) }], baseline: [{ tick: 100, status: 'alive', regions: pop(tw), moonProgress: 0 }] })
  const recs: Record<string, unknown> = { a: rec(5e9, 6e9), b: rec(5e9, 5.5e9), c: rec(7e9, 6e9) }
  const read = (id: string) => (recs[id] ?? null) as never
  const runs = [{ runId: 'a', simVersion: '5.1.0' }, { runId: 'b', simVersion: '5.1.0' }] as never[]
  const before = verdictLine(runs, '5.7.0', read)!
  assert.match(before, /no 5\.7\.0 worlds have finished yet/)
  assert.match(before, /before the switch, no: in 0 of 2 worlds on 5\.1\.0/)
  const after = verdictLine([...runs, { runId: 'c', simVersion: '5.7.0' }] as never[], '5.7.0', read)!
  assert.equal(after, 'is the ai beating "do nothing" yet? yes: in the 1 world on 5.7.0 it kept more people alive than the no-ai twin, by 1000 million.')
})
