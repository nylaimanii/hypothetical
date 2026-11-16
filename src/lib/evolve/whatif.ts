// what-if: flip one thing at a moment of a world and run it again from there. the new world starts from the
// original's snapshot at that tick, governed by the same agent, with the change applied as a real override
// (the same kinds the ui can send: inject an event, veto a law, force a budget). data/whatif/<newRunId>.json
// links it back to the original, and GET /api/whatif/[id] pairs the two.
//
// STUB until B ships an exact replay: after the change, the governor decides again with the llm, so later
// decisions can differ for reasons other than the change. exact: false says so. when B's sim can replay the
// original decisions and only flip the change, start() is the only thing that changes.
import fs from 'node:fs'
import path from 'node:path'
import type { Divergence, Override, RunRecord } from '../types'
import { findDivergences } from './core'
import { injectDir } from './live'
import { readJson, writeJson } from './store'

export type WhatIfChange = Omit<Override, 'id' | 'tick'>
export type WhatIf = { id: string; original: string; tick: number; appliedAt: number; change: WhatIfChange; agentId: string; at: string; exact: boolean }

const dir = () => path.join(process.cwd(), 'data', 'whatif')
export const readWhatIf = (id: string) => readJson<WhatIf>(path.join(dir(), `${id}.json`))

// the governor decides every 12 ticks and takes a forced budget back at its next decision. a budget forced on a
// decision tick would be taken back that same month, so it lands one tick later and holds until the next one
export const appliedTick = (tick: number, change: WhatIfChange) => (change.kind === 'force_budget' && tick % 12 === 0 ? tick + 1 : tick)

// records the link and queues the change for the new world (before its runner starts)
export function queueWhatIf(newId: string, original: string, tick: number, change: WhatIfChange, agentId: string): WhatIf {
  const w: WhatIf = { id: newId, original, tick, appliedAt: appliedTick(tick, change), change, agentId, at: new Date().toISOString(), exact: false }
  writeJson(path.join(dir(), `${newId}.json`), w)
  fs.mkdirSync(injectDir(newId), { recursive: true })
  writeJson(path.join(injectDir(newId), `${Date.now()}-whatif.json`), { ...change, id: `whatif-${w.appliedAt}`, tick: w.appliedAt })
  return w
}

// how the two worlds compare from the flip on. the original is cut to the same span as the what-if so far
export function pairWhatIf(original: RunRecord, flipped: RunRecord, w: WhatIf): { divergences: Divergence[]; through: number } {
  const through = Math.max(w.tick, ...flipped.frames.map(f => f.tick))
  const a = { ...original, frames: original.frames.filter(f => f.tick >= w.tick && f.tick <= through) }
  const b = { ...flipped, frames: flipped.frames.filter(f => f.tick >= w.tick) }
  return { divergences: findDivergences(a, b), through }
}
