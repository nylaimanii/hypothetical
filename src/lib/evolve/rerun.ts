// reruns with someone's changed numbers (POST /api/rerun, local only). the numbers are b's tunable rules
// (src/lib/sim/assumptions.ts, GET /api/assumptions): same seed, same agent, same constitution, only the rules the
// person changed are different. b's assumptionsFor refuses unknown ids and clamps to each rule's range; what it
// clamped is said back in plain words, never applied quietly. the request is kept next to the live world
// (data/live/<runId>.assumptions.json) so a consistency check can compare it with what the record says it used.
import fs from 'node:fs'
import path from 'node:path'
import type { RunRecord } from '../types'
import { ASSUMPTIONS, assumptionsFor, type Clamped } from '../sim/assumptions'
import { dirs } from './store'

export type RerunPlan = {
  overrides: Record<string, number>
  overridden: Record<string, number>
  clamped: (Clamped & { text: string })[]
  changes: string[]
}
export const requestFile = (runId: string) => path.join(dirs.live, `${runId}.assumptions.json`)
// the plain { id: value } map scripts/live.ts --assumptions-file reads (the values after clamping)
export const overridesFile = (runId: string) => path.join(dirs.live, `${runId}.overrides.json`)

const label = (id: string) => ASSUMPTIONS.find(a => a.id === id)
const num = (v: number) => String(+v.toPrecision(6))
const show = (id: string, v: number) => { const a = label(id); return `${num(v)}${a?.unit && !/^(x|ratio|share|fraction)$/i.test(a.unit) ? ` ${a.unit}` : ''}` }

// the rules a world ran with, against the defaults, in plain words
export function changeLines(overridden: Record<string, number>): string[] {
  return Object.entries(overridden).map(([id, v]) => {
    const a = label(id)
    return a ? `${a.label}: ${show(id, v)} instead of ${show(id, a.value)} (${/^https?:/.test(a.source) ? 'the default is sourced' : 'the default is our guess'})` : `${id}: ${num(v)}`
  })
}

// validates a rerun request. the source world's own overrides carry over unless the person changed the same rule.
// throws b's plain message for an unknown id or a value that is not a number
export function planRerun(source: Pick<RunRecord, 'runId'> & { assumptions?: { overridden?: Record<string, number> } }, asked: Record<string, number>): RerunPlan {
  const overrides = { ...(source.assumptions?.overridden ?? {}), ...asked }
  const r = assumptionsFor(overrides)
  return {
    overrides,
    overridden: r.overridden,
    clamped: r.clamped.map(c => ({ ...c, text: `${label(c.id)?.label ?? c.id}: you asked ${num(c.asked)}, the ${c.asked > c.max ? 'limit' : 'floor'} is ${num(c.asked > c.max ? c.max : c.min)}, so the rerun uses ${num(c.used)}` })),
    changes: changeLines(r.overridden),
  }
}

export function saveRequest(runId: string, plan: RerunPlan, sourceRunId: string) {
  fs.mkdirSync(dirs.live, { recursive: true })
  fs.writeFileSync(requestFile(runId), JSON.stringify({ sourceRunId, asked: plan.overrides, overridden: plan.overridden, clamped: plan.clamped, at: new Date().toISOString() }))
  fs.writeFileSync(overridesFile(runId), JSON.stringify(plan.overridden))
  return overridesFile(runId)
}
