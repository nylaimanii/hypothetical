// consistency: the tradeoff map's frontier is the worlds nothing beats on every axis. checked on the real worlds'
// recorded tradeoffs (b's summary.tradeoffs) with the same function the page draws with
// run: npx tsx --test tests/consistency/pages/pareto.test.ts (HYP_CONSISTENCY_RUNS picks the worlds)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadWorld, worldIds } from '../sim/load'
import { AXES, dominates, paretoFront, type Tradeoffs } from '../../../src/components/ui/pareto'

const ws = worldIds().map((id) => {
  const r = loadWorld(id)
  const t = (r?.summary as unknown as { tradeoffs?: Tradeoffs } | undefined)?.tradeoffs
  return t ? { runId: id, tradeoffs: t } : null
}).filter((x): x is { runId: string; tradeoffs: Tradeoffs } => !!x)

test('the tradeoff map puts a world on the frontier only when no other world beats it on all four', () => {
  const { front, beatenBy } = paretoFront(ws)
  for (const w of ws) {
    const beaten = ws.some((o) => o !== w && dominates(o.tradeoffs, w.tradeoffs))
    assert.equal(front.has(w.runId), !beaten, `${w.runId} should ${beaten ? 'not ' : ''}be on the frontier`)
    if (beaten) {
      const by = ws.find((o) => o.runId === beatenBy.get(w.runId))!
      for (const k of AXES) assert.ok(by.tradeoffs[k] >= w.tradeoffs[k], `${by.runId} said to beat ${w.runId} but is lower on ${k}`)
    }
  }
  if (ws.length) assert.ok(front.size > 0, 'a non-empty set of worlds always has a frontier')
})

test('the tradeoff map: a world that is better on one axis and equal on the rest beats the other', () => {
  const a: Tradeoffs = { lifespan: 80, population: 9e9, freedom: 0.7, offWorld: 0.3 }
  assert.ok(dominates({ ...a, freedom: 0.8 }, a), 'more freedom, same otherwise, should beat it')
  assert.ok(!dominates(a, a), 'a world does not beat its equal')
  assert.ok(!dominates({ ...a, freedom: 0.8, lifespan: 79 }, a), 'better on one and worse on another is a tradeoff, not a win')
})
