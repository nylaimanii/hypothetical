// npm run explain-gaps [-- --top 3]: the evidence jobs evolve starts after every generation, all without model time
// (run with LLM_PROVIDER=offline; evolve sets it):
//   1. why each of the leaderboard's top entries beat the next, tested by replay (src/lib/evolve/gaps.ts). pure
//      replays, no ollama lock, so it runs next to evolution. pairs already replayed on their newest shared seed are skipped
//   2. the playbook's controlled sim tests (src/lib/evolve/playbook.ts): one per testable lesson and sim version,
//      5 seeds under the offline governor; then the playbook is rewritten with them
import '../src/lib/evolve/env'
import { explainGap } from '../src/lib/sim/ab'
import fs from 'node:fs'
import path from 'node:path'
import { pairsToReplay, replayGap } from '../src/lib/evolve/gaps'
import { readPlaybook, runControlledTests, writePlaybook } from '../src/lib/evolve/playbook'
import { runWorld } from '../src/lib/sim/run'
import { populationAt } from '../src/lib/sim/replay-pure'
import { readRunRecord } from '../src/lib/evolve/store'
// the version of the sim code that runs the tests (not data/version.json, which may lag behind a switch)
import { SIM_VERSION } from '../src/lib/sim/version'
import { arg } from './args'

// a test world's files (never indexed, removed right after it is measured)
const cleanup = (id: string) => { for (const x of ['.json', '.twin.json', '.lives.json', '.places.json', '.places.bin.gz']) fs.rmSync(path.join(process.cwd(), 'data', 'runs', `${id}${x}`), { force: true }) }

async function main() {
  await gaps()
  const n = await runControlledTests(SIM_VERSION, { run: o => runWorld(o as never), load: readRunRecord, populationAt, cleanup }, l => console.log(l))
  if (n) { const pb = writePlaybook(readPlaybook()?.generation ?? null); console.log(`playbook-ab: ${n} controlled tests run, playbook rewritten (${pb.lessons.length} lessons)`) }
}

async function gaps() {
  const pairs = pairsToReplay(Number(arg('top', '3')))
  if (!pairs.length) { console.log('explain-gaps: nothing new to replay'); return }
  for (const [a, b] of pairs) {
    const t0 = Date.now()
    try {
      const g = await replayGap(a, b, explainGap as never)
      console.log(g ? `explain-gaps: ${a.name} over ${b.name} on seed ${g.seed}, ${g.swaps} swaps in ${Math.round((Date.now() - t0) / 1000)}s` : `explain-gaps: ${a.name} and ${b.name} share no seed yet`)
    } catch (e) { console.log(`explain-gaps: ${a.name} over ${b.name} failed: ${(e as Error).message.split('\n')[0]}`) }
  }
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
