// npm run live -- --runId <id> --seed <n> --constitution-file <path> [--agentId <id>] [--start-from <runId>:<tick>] [--batch] [--assumptions-file <path>] [--rerun]
// live (default): 1 tick per --msPerTick, overrides from data/inject/<runId>, runWorld writes data/live/<runId>.json
// --batch: runs at full speed with no live file (compare fills in missing worlds this way)
// --whatif: a what-if world (data/whatif/<runId>.json). kept out of the run index and the agent's record, since
//   its conditions were changed by hand
// --assumptions-file <path>: json { id: value } of b's tunable rules (src/lib/sim/assumptions.ts) to run with; the
//   record carries what was actually used (record.assumptions). --rerun: a rerun with changed numbers (POST
//   /api/rerun), kept out of the run index and the agent's record like a what-if
import fs from 'node:fs'
// env first, so keys are set before the sim modules load
import '../src/lib/evolve/env'
import { runWorld } from '../src/lib/evolve/core'
import { indexRun, writeJson, SAFE_ID } from '../src/lib/evolve/store'
import { recordAgentRun } from '../src/lib/evolve/agents'
import { injectDir, liveFile, liveRecord, pendingFile } from '../src/lib/evolve/live'
import { arg } from './args'

async function main() {
  const runId = arg('runId') ?? `live-${Date.now().toString(36)}`
  if (!SAFE_ID.test(runId)) throw new Error(`bad runId ${runId}`)
  const seed = Number(arg('seed', '1'))
  const file = arg('constitution-file')
  if (!file) throw new Error('--constitution-file is required')
  const constitution = fs.readFileSync(file, 'utf8')
  const agentId = arg('agentId')
  const from = arg('start-from')
  const startFrom = from ? { runId: from.slice(0, from.lastIndexOf(':')), tick: Number(from.slice(from.lastIndexOf(':') + 1)) } : undefined
  const batch = process.argv.includes('--batch')
  const whatif = process.argv.includes('--whatif') || process.argv.includes('--rerun')
  const afile = arg('assumptions-file')
  const assumptions = afile ? (JSON.parse(fs.readFileSync(afile, 'utf8')) as Record<string, number>) : undefined
  try {
    if (batch) {
      const summary = await runWorld({ runId, generation: 0, seed, constitution, frameEvery: 12, ...(agentId ? { agentId } : {}), ...(assumptions ? { assumptions } : {}) })
      indexRun(summary, seed)
      if (agentId) recordAgentRun(summary)
      console.log(`batch ${runId} ${summary.status} ${summary.endDate} score ${summary.score}`)
      return
    }
    const msPerTick = Number(arg('msPerTick', '1000'))
    const overrideDir = injectDir(runId)
    fs.mkdirSync(overrideDir, { recursive: true })
    // placeholder until the first frame; from then on runWorld owns data/live/<runId>.json
    if (!fs.existsSync(liveFile(runId))) writeJson(liveFile(runId), liveRecord(runId, seed, constitution, [], undefined, agentId))
    const summary = await runWorld({ runId, generation: 0, seed, constitution, overrideDir, live: { msPerTick }, frameEvery: 1, ...(agentId ? { agentId } : {}), ...(startFrom ? { startFrom } : {}), ...(assumptions ? { assumptions } : {}) })
    if (!whatif) {
      indexRun(summary, seed)
      if (agentId) recordAgentRun(summary)
    }
    console.log(`live ${runId} ${summary.status} ${summary.endDate} score ${summary.score}`)
  } finally {
    fs.rmSync(pendingFile(runId), { force: true })
  }
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
