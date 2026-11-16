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

// a rerun runs on today's sim. when its source ran on another version, the rerun said so (request.sim.text), so the
// gap between them is never shown as coming only from the changed assumptions
for (const f of requests) {
  const runId = f.replace(/\.assumptions\.json$/, '')
  const req = JSON.parse(fs.readFileSync(path.join(live, f), 'utf8')) as { sourceRunId?: string; sim?: { source: string | null; rerun: string; same: boolean; text: string | null } }
  const rec = loadRecord(runId) as (ReturnType<typeof loadRecord> & { simVersion?: string }) | null
  test(`the rerun ${runId} says when it ran on a different sim from its source`, { skip: rec?.simVersion ? false : `${runId} has not written its sim version yet` }, () => {
    assert.ok(req.sim, `the rerun ${runId} does not record which sim its source ran on, so a sim change could pass for an effect of the changed assumptions`)
    assert.equal(req.sim!.rerun, rec!.simVersion, `the rerun ${runId} said it would run on sim ${req.sim!.rerun}, but its record says ${rec!.simVersion}`)
    if (req.sim!.source !== rec!.simVersion) assert.match(req.sim!.text ?? '', /comes from changes to the sim/, `the rerun ${runId} ran on sim ${rec!.simVersion} and its source on ${req.sim!.source ?? 'an unrecorded version'}, but it never said so`)
  })
}

// a control is the source world again, unchanged, on the rerun's sim: same seed, agent and constitution, no changed
// assumptions, and the sim it says. otherwise the clean pair would differ by more than the change
const controls = (() => { try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'controls.json'), 'utf8')) as Record<string, { runId: string; source: string; sim: string }> } catch { return {} } })()
for (const c of Object.values(controls)) {
  const rec = loadRecord(c.runId) as (ReturnType<typeof loadRecord> & { simVersion?: string; live?: boolean; assumptions?: { overridden?: Record<string, number> } }) | null
  const src = loadRecord(c.source)
  test(`the control ${c.runId} is ${c.source} unchanged on sim ${c.sim}`, { skip: rec?.simVersion && src ? false : `${c.runId} has not written its record yet` }, () => {
    assert.equal(rec!.seed, src!.seed, `the control ${c.runId} ran on seed ${rec!.seed}, its source ${c.source} on ${src!.seed}`)
    assert.equal(rec!.agentId, src!.agentId, `the control ${c.runId} was governed by ${rec!.agentId}, its source by ${src!.agentId}`)
    assert.equal(rec!.constitution, src!.constitution, `the control ${c.runId} ran with a different constitution from its source ${c.source}`)
    assert.deepEqual(rec!.assumptions?.overridden ?? {}, {}, `the control ${c.runId} changed assumptions: ${JSON.stringify(rec!.assumptions?.overridden)}`)
    assert.equal(rec!.simVersion, c.sim, `the control ${c.runId} says sim ${c.sim}, but its record says ${rec!.simVersion}`)
  })
}
