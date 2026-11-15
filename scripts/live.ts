// npm run live -- --runId <id> --seed <n> --constitution-file <path>
import fs from 'node:fs'
// env first, so keys are set before the sim modules load
import '../src/lib/evolve/env'
import type { Frame, RunRecord } from '../src/lib/types'
import { runWorld } from '../src/lib/evolve/core'
import { dirs, readJson, writeJson, SAFE_ID } from '../src/lib/evolve/store'
import { injectDir, liveFile, liveRecord } from '../src/lib/evolve/live'
import { arg } from './args'
import path from 'node:path'

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

  const frames: Frame[] = []
  writeJson(liveFile(runId), liveRecord(runId, seed, constitution, frames))
  const summary = await runWorld({
    runId, generation: 0, seed, constitution, overrideDir, live: { msPerTick }, frameEvery: 1,
    onFrame: f => {
      frames.push(f)
      writeJson(liveFile(runId), liveRecord(runId, seed, constitution, frames))
    },
  })
  const saved = readJson<RunRecord>(path.join(dirs.runs, `${runId}.json`))
  const final = liveRecord(runId, seed, constitution, frames, summary)
  if (saved) final.baseline = saved.baseline
  writeJson(liveFile(runId), final)
  console.log(`live ${runId} ${summary.status} ${summary.endDate} score ${summary.score}`)
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
