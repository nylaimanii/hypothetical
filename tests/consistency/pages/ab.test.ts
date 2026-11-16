// consistency: the a/b view's split and first difference come from the two records' own rows. a world paired with
// itself has no difference and no split, and a copy changed at one recorded year differs first at exactly that year
// run: npx tsx --test tests/consistency/pages/ab.test.ts (HYP_CONSISTENCY_RUNS picks the worlds)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadWorld, worldIds } from '../sim/load'
import { normalizeRecord } from '../../../src/components/state/normalize'
import { slimFromRecord } from '../../../src/components/state/frames'
import { decisionSplit, firstDifference } from '../../../src/components/ui/ab'

for (const id of worldIds()) {
  const raw = loadWorld(id)
  if (!raw) continue
  const r = normalizeRecord(raw)
  const m = { ...slimFromRecord(r), runId: r.runId }

  test(`${id}: the a/b view finds no difference and no split between a world and itself`, () => {
    assert.equal(firstDifference(m, m, 0), undefined, 'a world compared with itself should show no recorded difference')
    assert.equal(decisionSplit(m, m, 0), undefined, 'a world compared with itself should show no decision where they split')
  })

  test(`${id}: the a/b view dates the first difference at the first year whose numbers differ`, () => {
    if (m.years.length < 3) return
    const k = Math.floor(m.years.length / 2)
    const years = m.years.map((y, i) => (i >= k ? { ...y, globalPopulation: y.globalPopulation + 1000 } : y))
    const d = firstDifference(m, { ...m, years }, 0)
    assert.equal(d?.tick, m.years[k].tick, 'the first difference should be the first year where the populations differ')
    assert.match(d!.text, /1,000 more people/, 'the first difference should say how many more people B has')
  })
}
