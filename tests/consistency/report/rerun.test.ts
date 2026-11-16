// consistency (C): a rerun with changed assumptions runs with exactly the numbers it says it used, and never changes
// a number quietly. requests live next to the live world (data/live/<runId>.assumptions.json)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ASSUMPTIONS } from '../../../src/lib/sim/assumptions'
import { planRerun } from '../../../src/lib/evolve/rerun'
import { loadRecord } from '../../../src/lib/evolve/store'

test('a rerun request outside a rule\'s range is said back, never applied quietly', () => {
  for (const a of ASSUMPTIONS) {
    const p = planRerun({ runId: 'check' }, { [a.id]: a.max + Math.max(1, Math.abs(a.max)) })
    assert.equal(p.overridden[a.id], a.max, `asking for more than the limit of "${a.label}" ran with ${p.overridden[a.id]}, not the limit ${a.max}`)
    assert.equal(p.clamped.length, 1, `asking for more than the limit of "${a.label}" was clamped without saying so`)
    assert.match(p.clamped[0].text, /you asked .*, the limit is .*, so the rerun uses/, `the clamp message for "${a.label}" is not in plain words: ${p.clamped[0].text}`)
  }
})

test('an unknown assumption is refused, not ignored', () => {
  assert.throws(() => planRerun({ runId: 'check' }, { 'not-a-real-rule': 1 }), /unknown assumption/, 'a rerun asking for a rule that does not exist was accepted')
})

const live = path.join(process.cwd(), 'data', 'live')
const requests = fs.existsSync(live) ? fs.readdirSync(live).filter(f => f.endsWith('.assumptions.json')) : []
for (const f of requests) {
  const runId = f.replace(/\.assumptions\.json$/, '')
  const rec = loadRecord(runId) as (ReturnType<typeof loadRecord> & { assumptions?: { overridden?: Record<string, number> } }) | null
  test(`the rerun ${runId} ran with exactly the assumptions it was asked for`, { skip: rec?.assumptions ? false : `${runId} has not written its record yet` }, () => {
    const req = JSON.parse(fs.readFileSync(path.join(live, f), 'utf8')) as { overridden: Record<string, number> }
    assert.deepEqual(rec!.assumptions!.overridden, req.overridden, `the rerun ${runId} was asked for ${JSON.stringify(req.overridden)} but its record says it used ${JSON.stringify(rec!.assumptions!.overridden)}`)
  })
}

// the a/b view pairs a rerun with its source from tick 0 (GET /api/assumptions?runId= -> from), so both must be the
// same world apart from the assumptions: same seed, same agent
for (const f of requests) {
  const runId = f.replace(/\.assumptions\.json$/, '')
  const req = JSON.parse(fs.readFileSync(path.join(live, f), 'utf8')) as { sourceRunId?: string }
  const rec = loadRecord(runId), src = req.sourceRunId ? loadRecord(req.sourceRunId) : null
  test(`the rerun ${runId} has the seed and agent of the world it was rerun from`, { skip: rec && src ? false : `${runId} or its source ${req.sourceRunId} has no record` }, () => {
    assert.equal(rec!.seed, src!.seed, `the rerun ${runId} ran on seed ${rec!.seed}, but its source ${req.sourceRunId} ran on seed ${src!.seed}, so the a/b view would compare two different worlds`)
    assert.equal(rec!.agentId, src!.agentId, `the rerun ${runId} was governed by ${rec!.agentId}, but its source ${req.sourceRunId} by ${src!.agentId}`)
  })
}
