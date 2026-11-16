// starting a new live world from a moment of an existing one (POST /api/branch and POST /api/whatif share this)
import fs from 'node:fs'
import path from 'node:path'
import type { RunRecord } from '../types'
import { liveFile, liveRecord } from './live'
import { dirs, readJson, readRunIndex, readShowcase, writeJson } from './store'
import { runningSimVersion } from './version'

export type BranchSource = { ok: true; src: RunRecord } | { ok: false; status: number; error: string }

// the world to branch from, checked: it exists, was made by the sim version on disk (a snapshot from another
// version may lack state the current sim needs), has a snapshot at or before tick, and had not ended by then.
// the sim reads plain json, so a gzipped showcase world is unpacked into data/runs first
export function branchSource(runId: string, tick: number): BranchSource {
  const runsFile = path.join(dirs.runs, `${runId}.json`)
  let src = readJson<RunRecord>(runsFile) ?? readJson<RunRecord>(path.join(dirs.live, `${runId}.json`))
  if (!src) {
    src = readShowcase(runId)
    if (src) writeJson(runsFile, src)
  }
  if (!src) return { ok: false, status: 404, error: `run ${runId} not found` }
  const made = readRunIndex().find(r => r.runId === runId)?.simVersion
  const now = runningSimVersion()
  if (made && made !== now) return { ok: false, status: 409, error: `run ${runId} was made by sim ${made}; the sim is now ${now}, so its snapshots cannot be restored` }
  if (!(src.snapshots ?? []).some(s => s.tick <= tick)) return { ok: false, status: 409, error: `run ${runId} has no snapshot at or before tick ${tick}` }
  if (src.summary.status !== 'alive' && tick >= src.summary.ticks) return { ok: false, status: 409, error: `run ${runId} had already ended by tick ${tick}` }
  return { ok: true, src }
}

// the placeholder live file the ui can poll until the first frame lands
export function writeLivePlaceholder(runId: string, seed: number, constitution: string, agentId: string) {
  fs.mkdirSync(dirs.live, { recursive: true })
  writeJson(liveFile(runId), liveRecord(runId, seed, constitution, [], undefined, agentId))
}
