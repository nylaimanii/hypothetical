// npm run live -- --runId <id> --seed <n> --constitution-file <path>
import fs from 'node:fs'
// env first, so keys are set before the sim modules load
import '../src/lib/evolve/env'
import { runWorld } from '../src/lib/evolve/core'
import { writeJson, SAFE_ID } from '../src/lib/evolve/store'
import { injectDir, liveFile, liveRecord } from '../src/lib/evolve/live'
import { arg } from './args'

async function main() {
  const runId = arg('runId') ?? `live-${Date.now().toString(36)}`
  if (!SAFE_ID.test(runId)) throw new Error(`bad runId ${runId}`)
  const seed = Number(arg('seed', '1'))
  const file = arg('constitution-file')
  if (!file) throw new Error('--constitution-file is required')
  const constitution = fs.readFileSync(file, 'utf8')
  const msPerTick = Number(arg('msPerTick', '1000'))
  const overrideDir = injectDir(runId)
  fs.mkdirSync(overrideDir, { recursive: true })

  // placeholder until the first frame; from then on runWorld owns data/live/<runId>.json
  if (!fs.existsSync(liveFile(runId))) writeJson(liveFile(runId), liveRecord(runId, seed, constitution, []))
  const summary = await runWorld({ runId, generation: 0, seed, constitution, overrideDir, live: { msPerTick }, frameEvery: 1 })
  console.log(`live ${runId} ${summary.status} ${summary.endDate} score ${summary.score}`)
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
