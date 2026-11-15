// npm run evolve -- [--gens 10] [--concurrency 1] [--pop 7]
// without --gens it keeps going until a world achieves the goal. concurrency defaults to 1 (one gpu)
// env first, then the fetch counter, so both are in place before the sim modules load
import '../src/lib/evolve/env'
import '../src/lib/evolve/usage'
import { evolve, control } from '../src/lib/evolve/evolve'
import { startCommands } from '../src/lib/notify/commands'
import { arg } from './args'

async function main() {
  const gensArg = arg('gens')
  const gens = gensArg ? Number(gensArg) : undefined
  const concurrency = Number(arg('concurrency', '1'))
  const popSize = Number(arg('pop', '7'))
  const stopCommands = startCommands()
  process.on('SIGINT', () => {
    if (control.stopRequested) process.exit(130)
    console.log('stopping after running worlds finish (ctrl-c again to force)')
    control.stopRequested = true
  })
  try {
    await evolve({ gens, concurrency, popSize, logFile: 'data/evolve.log' })
  } finally {
    stopCommands()
  }
  // a new sim version was pushed: this process stopped at a generation boundary. exit 75 so scripts/run-evolve.sh
  // checks out the new origin/main in its worktree and starts again
  if (control.restartForVersion) {
    console.log(`restarting on sim version ${control.restartForVersion}`)
    return 75
  }
  return 0
}
main().then(code => process.exit(code), e => { console.error(e); process.exit(1) })
