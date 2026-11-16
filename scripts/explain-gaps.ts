// npm run explain-gaps [-- --top 3]: why each of the leaderboard's top entries beat the next, tested by replay (see
// src/lib/evolve/gaps.ts). pure replays: no model, no ollama lock, so it runs next to evolution. evolve starts it after
// every generation; it skips pairs already replayed on their newest shared seed
import '../src/lib/evolve/env'
import { explainGap } from '../src/lib/sim/ab'
import { pairsToReplay, replayGap } from '../src/lib/evolve/gaps'
import { arg } from './args'

async function main() {
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
