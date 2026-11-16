// clean a/b pairs for reruns (the user's call, 2026-11-16: "for every a/b pair, rerun the source world unchanged on
// the current sim too, so the pair differs only by the change. queue those reruns at normal evolve priority").
// a rerun runs on the sim of its day; its source may have run on an older one. the control is the source world run
// again unchanged (same seed, agent and constitution, no overrides) on the current sim, so the a/b view compares the
// rerun with the control and the only difference is the changed numbers. one control per source and sim version,
// shared by every rerun of that source on that version. it runs on the evolution runner's committed code (never the
// shared folder's uncommitted work) and takes the model like any evolution world (priority 0, oldest first).
// what-ifs need none: /api/whatif refuses an original made by another sim (branch.ts), so both sides already match.
// data/controls.json: { "<source>|<sim>": Control }
import fs from 'node:fs'
import path from 'node:path'
import type { RunRecord } from '../types'
import { dirs, readJson, writeJson } from './store'
import { liveFile, liveRecord } from './live'
import { runnerRoot, spawnRunner } from './spawn'
import { simVersionOfRef } from './version'

export type ControlStatus = 'queued' | 'running' | 'done' | 'failed'
export type Control = { runId: string; source: string; sim: string; pid?: number; at: string; error?: string }
export type ControlView = { runId: string; status: ControlStatus; sim: string; error?: string }

export const controlsFile = () => path.join(process.cwd(), 'data', 'controls.json')
const readControls = () => readJson<Record<string, Control>>(controlsFile()) ?? {}
const key = (source: string, sim: string) => `${source}|${sim}`
export const controlId = (source: string, sim: string) => `ctl-${source}-${sim.replace(/[^A-Za-z0-9]/g, '_')}`.slice(0, 80)

const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true } catch { return false } }
const recordOf = (runId: string) => readJson<RunRecord & { live?: boolean }>(path.join(dirs.runs, `${runId}.json`)) ?? readJson<RunRecord & { live?: boolean }>(liveFile(runId))

export function controlStatus(c: Control): ControlView {
  if (c.error) return { runId: c.runId, status: 'failed', sim: c.sim, error: c.error }
  const rec = recordOf(c.runId), frames = rec?.frames?.length ?? 0
  if (rec && frames && !rec.live) return { runId: c.runId, status: 'done', sim: c.sim }
  if (alive(c.pid)) return { runId: c.runId, status: frames ? 'running' : 'queued', sim: c.sim }
  return { runId: c.runId, status: 'failed', sim: c.sim, error: frames ? `the control stopped at tick ${rec!.frames.at(-1)!.tick}` : 'the control never started' }
}

export function controlFor(source: string, sim: string): ControlView | null {
  const c = readControls()[key(source, sim)]
  return c ? controlStatus(c) : null
}

// the sim the runner's committed code is on (the version evolution runs), or null with the reason
export function runnerSim(): { sim: string | null; why?: string } {
  const root = runnerRoot()
  if (!fs.existsSync(path.join(root, 'scripts', 'live.ts'))) return { sim: null, why: `no runner checkout at ${root}` }
  try { return { sim: simVersionOfRef('HEAD', root) } } catch (e) { return { sim: null, why: (e as Error).message.split('\n')[0] } }
}

// starts (or reuses) the control for this source on the runner's sim. a failed control is started again
export function ensureControl(source: Pick<RunRecord, 'runId' | 'seed' | 'constitution' | 'agentId'>): ControlView {
  const { sim, why } = runnerSim()
  if (!sim) return { runId: '', status: 'failed', sim: '?', error: why }
  const all = readControls(), k = key(source.runId, sim), have = all[k]
  if (have) { const v = controlStatus(have); if (v.status !== 'failed') return v }
  const runId = controlId(source.runId, sim)
  for (const x of ['.json', '.twin.json', '.lives.json', '.places.json', '.places.bin.gz']) fs.rmSync(path.join(dirs.runs, `${runId}${x}`), { force: true })
  fs.mkdirSync(dirs.live, { recursive: true })
  writeJson(liveFile(runId), liveRecord(runId, source.seed, source.constitution, [], undefined, source.agentId))
  const pid = spawnRunner(runId, source.constitution, ['--seed', String(source.seed), '--agentId', source.agentId, '--msPerTick', '0', '--rerun'], { codeRoot: runnerRoot() })
  const c: Control = pid ? { runId, source: source.runId, sim, pid, at: new Date().toISOString() } : { runId, source: source.runId, sim, at: new Date().toISOString(), error: 'the runner could not be started' }
  all[k] = c
  writeJson(controlsFile(), all)
  return controlStatus(c)
}
