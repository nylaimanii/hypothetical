// npx tsx --test src/lib/evolve/queue.test.ts
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

test('evolve: interrupted worlds are retried, never scored or reported as deaths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyp-evolve-'))
  const cwd = process.cwd()
  process.chdir(dir)
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.GMAIL_USER
  try {
    // store paths resolve from cwd at import time
    const { evolve, control } = await import('./evolve')
    const { readDay } = await import('./usage')
    let calls = 0
    const fake = async (o: RunOptions): Promise<RunSummary> => {
      if (++calls <= 2) throw rateLimit()
      return {
        runId: o.runId, generation: o.generation, status: 'stagnated', endDate: '2076-11', ticks: 600, score: 50,
        constitution: o.constitution, peakPopulation: 8e9, moonStage: 'orbital', topEvents: [], baselineStatus: 'stagnated', baselineEndDate: '2076-11',
      }
    }
    const lines: string[] = []
    await evolve({ gens: 1, concurrency: 1, runWorld: fake, clock: fakeClock(), log: l => lines.push(l) })

    const gen = JSON.parse(fs.readFileSync(path.join(dir, 'data/generations/gen-1.json'), 'utf8'))
    assert.equal(gen.status, 'done')
    assert.equal(calls, 12 + 2, '12 worlds plus 2 retries')
    for (const c of gen.population) {
      assert.equal(c.runs.length, 2)
      assert.equal(c.score, 50)
      assert.ok(c.runs.every((r: RunSummary) => r.status === 'stagnated'))
    }
    assert.equal(gen.population.reduce((a: number, c: { interrupted?: number }) => a + (c.interrupted ?? 0), 0), 2)
    assert.equal(control.worldsInterrupted, 2)
    assert.equal(lines.filter(l => l.includes('interrupted')).length, 2)
    assert.ok(!lines.some(l => l.includes('destroyed') && !l.includes('0 destroyed')))
    assert.ok(!lines.some(l => l.startsWith('paused')))
    const day = readDay()
    assert.equal(day.worldsInterrupted, 2)
    assert.equal(day.worldsFinished, 12)
    assert.ok(fs.existsSync(path.join(dir, 'data/leaderboard.json')))
  } finally {
    process.chdir(cwd)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
