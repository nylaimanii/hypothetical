// npm run controls -- --backfill: clean a/b pairs for the reruns made before controls existed (src/lib/evolve/controls.ts).
// a rerun whose own sim is not the runner's is started again with the same request on the runner's sim (the old one
// keeps its sim-version caveat and points to the new one, supersededBy), and every rerun whose source ran on another
// sim gets its control. both take the model like evolution worlds (priority 0, oldest first)
import '../src/lib/evolve/env'
import fs from 'node:fs'
import path from 'node:path'
import { ensureControl, runnerSim } from '../src/lib/evolve/controls'
import { liveFile, liveRecord } from '../src/lib/evolve/live'
import { planRerun, requestFile, saveRequest, simCompare } from '../src/lib/evolve/rerun'
import { newRunId, runnerRoot, spawnRunner } from '../src/lib/evolve/spawn'
import { dirs, loadRecord, readRunIndex, writeJson } from '../src/lib/evolve/store'

type Req = { sourceRunId?: string; asked?: Record<string, number>; sim?: { source: string | null; rerun: string; same: boolean }; supersededBy?: string; rerunOf?: string }

function main() {
  if (!process.argv.includes('--backfill')) { console.log('usage: controls --backfill'); return }
  const { sim, why } = runnerSim()
  if (!sim) { console.log(`controls: no runner code (${why})`); return }
  const reqs = fs.existsSync(dirs.live) ? fs.readdirSync(dirs.live).filter(f => f.endsWith('.assumptions.json')) : []
  for (const f of reqs) {
    const runId = f.replace(/\.assumptions\.json$/, '')
    const req = JSON.parse(fs.readFileSync(path.join(dirs.live, f), 'utf8')) as Req
    if (!req.sourceRunId || req.supersededBy) continue
    const source = loadRecord(req.sourceRunId)
    if (!source) { console.log(`controls: ${runId}: its source ${req.sourceRunId} has no record`); continue }
    const srcSim = (source as { simVersion?: string }).simVersion ?? readRunIndex().find(r => r.runId === source.runId)?.simVersion
    let target = runId
    if (req.sim?.rerun !== sim) {
      // the rerun itself ran on another sim: the same request again on the runner's sim
      const plan = planRerun(source as never, req.asked ?? {})
      target = newRunId('rerun')
      const overrides = saveRequest(target, plan, source.runId, simCompare(srcSim, sim))
      const r = JSON.parse(fs.readFileSync(requestFile(target), 'utf8'))
      fs.writeFileSync(requestFile(target), JSON.stringify({ ...r, rerunOf: runId }))
      writeJson(liveFile(target), liveRecord(target, source.seed, source.constitution, [], undefined, source.agentId))
      spawnRunner(target, source.constitution, ['--seed', String(source.seed), '--agentId', source.agentId, '--msPerTick', '0', '--assumptions-file', overrides, '--rerun'], { codeRoot: runnerRoot() })
      fs.writeFileSync(path.join(dirs.live, f), JSON.stringify({ ...req, supersededBy: target }))
      console.log(`controls: ${runId} ran on sim ${req.sim?.rerun ?? '?'}; the same request started again on sim ${sim} as ${target}`)
    }
    if (srcSim !== sim) {
      const c = ensureControl(source)
      console.log(`controls: ${target}: control ${c.runId} for ${source.runId} on sim ${c.sim}: ${c.status}${c.error ? ` (${c.error})` : ''}`)
    }
  }
}
main()
