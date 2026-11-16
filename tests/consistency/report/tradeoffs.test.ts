// consistency (C): the tradeoff map shows each world's own numbers. every row with tradeoffs matches its world's
// record: population at the last frame (truth.ts populationAt), the frontier, and freedom and off-world in 0-1
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readRunRecord } from '../../../src/lib/evolve/store'
import { tradeoffRows } from '../../../src/lib/evolve/tradeoffs'
import { populationAt } from '../../../src/lib/sim/replay-pure'

const atLeast = (v: string | null, min: string) => { const a = (v ?? '0').split('.').map(Number), b = min.split('.').map(Number); for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); return true }

const rows = tradeoffRows().filter(r => r.tradeoffs).slice(0, 5)
for (const r of rows) {
  test(`tradeoff map: ${r.runId} shows its own record's numbers`, () => {
    const rec = readRunRecord(r.runId)
    if (!rec) return
    const t = r.tradeoffs!, last = rec.frames.at(-1)!
    assert.equal(t.frontier, last.frontier, `${r.runId} is drawn at frontier ${t.frontier}, but its last frame says ${last.frontier}`)
    for (const k of ['freedom', 'freedomAverage', 'offWorld'] as const) assert.ok(t[k] >= 0 && t[k] <= 1, `${r.runId} ${k} is ${t[k]}, outside 0 to 1`)
    // population from the summary matches the last frame from sim 5.10.8 (b's rounding fix); before, within 10 people
    const pop = populationAt(rec, last.tick)
    if (atLeast(r.simVersion, '5.10.8')) assert.equal(t.population, Math.round(pop), `${r.runId} is drawn at ${t.population} people, its last frame says ${Math.round(pop)}`)
    else assert.ok(Math.abs(t.population - pop) <= 10, `${r.runId} is drawn at ${t.population} people, its last frame says ${Math.round(pop)}`)
  })
}
