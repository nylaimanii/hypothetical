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

test('a world that throws 429 twice then succeeds is retried after 30s and 2m, no pause', async () => {
  const clock = fakeClock()
  const t0 = clock.t
  let calls = 0
  const attempts: number[] = []
  const done: number[] = []
  let paused = false
  await runQueue(['w1'], {
    concurrency: 1, clock,
    run: async () => {
      attempts.push(clock.t - t0)
      if (++calls <= 2) throw rateLimit()
      done.push(clock.t)
    },
    onInterrupted: () => {},
    onLimitPause: () => { paused = true },
  })
  assert.equal(calls, 3)
  assert.equal(done.length, 1)
  assert.equal(paused, false)
  // first try at 0, second after the 30s backoff, third 2m after that
  assert.ok(attempts[1] >= 30_000 && attempts[1] < 31_000, `second attempt at ${attempts[1]}`)
  assert.ok(attempts[2] - attempts[1] >= 2 * MIN && attempts[2] - attempts[1] < 2 * MIN + 1000)
})

test('3 interruptions in a row pause the queue once, then it resumes by itself', async () => {
  const clock = fakeClock()
  const pauses: number[] = []
  let calls = 0
  const finished: string[] = []
  await runQueue(['a', 'b', 'c', 'd'], {
    concurrency: 1, clock,
    run: async t => {
      if (++calls <= 3) throw rateLimit()
      finished.push(t)
    },
    onLimitPause: at => { pauses.push(at - clock.now()) },
  })
  assert.equal(pauses.length, 1)
  assert.ok(pauses[0] >= 10 * MIN, 'pause lasts at least 10 minutes')
  assert.deepEqual([...finished].sort(), ['a', 'b', 'c', 'd'])
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
    try { await fn(dir) } finally { process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }) }
  }
}

test('evolve: interrupted worlds are retried, never scored or reported as deaths', inTempDir(async dir => {
  // store paths resolve from cwd at import time
  const { evolve, control } = await import('./evolve')
  const { readDay } = await import('./usage')
  const { placeholderSummary } = await import('./store')
  let calls = 0
  const fake = async (o: RunOptions): Promise<RunSummary> => {
    if (++calls <= 2) throw rateLimit()
    return placeholderSummary({
      runId: o.runId, generation: o.generation, status: 'complete', endDate: '2126-11', ticks: 1200, score: 50,
      constitution: o.constitution, peakPopulation: 8e9, moonStage: 'orbital',
    })
  }
  const lines: string[] = []
  await evolve({ gens: 1, concurrency: 1, runWorld: fake, clock: fakeClock(), log: l => lines.push(l) })

  const gen = JSON.parse(fs.readFileSync(path.join(dir, 'data/generations/gen-1.json'), 'utf8'))
  assert.equal(gen.status, 'done')
  assert.equal(gen.population.length, 7, 'six philosophies plus the long now charter')
  assert.equal(calls, 14 + 2, '14 worlds plus 2 retries')
  for (const c of gen.population) {
    assert.equal(c.runs.length, 2)
    assert.equal(c.score, 50)
    assert.ok(c.runs.every((r: RunSummary) => r.status === 'complete'))
  }
  assert.equal(gen.population.reduce((a: number, c: { interrupted?: number }) => a + (c.interrupted ?? 0), 0), 2)
  assert.equal(control.worldsInterrupted, 2)
  assert.equal(lines.filter(l => l.includes('interrupted')).length, 2)
  assert.ok(!lines.some(l => l.startsWith('paused')))
  const day = readDay()
  assert.equal(day.worldsInterrupted, 2)
  assert.equal(day.worldsFinished, 14)
  assert.ok(fs.existsSync(path.join(dir, 'data/leaderboard.json')))
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
  await evolve({ gens: 2, concurrency: 1, runWorld: fake, clock: fakeClock(), log: () => {} })
  const lessons = JSON.parse(fs.readFileSync(path.join(dir, 'data/lessons.json'), 'utf8'))
  assert.equal(lessons.length, 1, 'same rule is merged, not duplicated')
  assert.ok(lessons[0].timesRelevant > 1)
  const learning = JSON.parse(fs.readFileSync(path.join(dir, 'data/learning.json'), 'utf8'))
  assert.equal(learning.rows.length, 2)
  assert.ok(learning.rows[0].deaths > 0)
  assert.ok(learning.rows[0].repeatMistakeRate > 0, 'second starvation repeats the first lesson')
  const gen2 = JSON.parse(fs.readFileSync(path.join(dir, 'data/generations/gen-2.json'), 'utf8'))
  const charter = gen2.population.find((c: { id: string }) => c.id === 'long-now')
  assert.ok(charter, 'long now competes every generation')
  assert.ok(charter.constitution.startsWith('your mission is the long-term survival'))
  assert.ok(gen2.population.some((c: { name: string }) => / ii$/.test(c.name)), 'mutations are named <parent> ii')
  assert.ok(gen2.population.some((c: { name: string }) => c.name.includes(' × ')), 'crossovers are named a × b')
  assert.ok(fs.readdirSync(path.join(dir, 'data/showcase')).some(f => f.endsWith('.json.gz')), 'best world of each generation is showcased')

  // agents registry: seven seeds plus their children, one champion, retired agents left out of gen 2
  const agents = JSON.parse(fs.readFileSync(path.join(dir, 'data/agents.json'), 'utf8'))
  assert.ok(agents.length > 7)
  assert.equal(agents.filter((a: { champion: boolean }) => a.champion).length, 1)
  const longNow = agents.find((a: { id: string }) => a.id === 'long-now')
  assert.ok(longNow.protected && !longNow.retired && longNow.worlds === 4)
  const inGen2 = new Set(gen2.population.map((c: { id: string }) => c.id))
  for (const a of agents) assert.equal(a.retired, !a.protected && !inGen2.has(a.id), `${a.id} retired flag`)
  assert.ok(agents.every((a: { emblemSeed: number }) => Number.isInteger(a.emblemSeed)))
  // hall: the first world to reach the horizon is a milestone, and it is showcased
  const hall = JSON.parse(fs.readFileSync(path.join(dir, 'data/hall.json'), 'utf8'))
  const horizon = hall.entries.find((e: { title: string }) => e.title === 'first world to reach 2126')
  assert.ok(horizon, 'milestone recorded once')
  assert.equal(hall.entries.filter((e: { title: string }) => e.title === 'first world to reach 2126').length, 1)
  assert.ok(fs.existsSync(path.join(dir, `data/showcase/${horizon.runId}.json.gz`)))
}))
