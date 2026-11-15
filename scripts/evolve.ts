// npm run evolve -- --gens 10 --concurrency 2 [--pop 6]
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })
import { evolve, control } from '../src/lib/evolve/evolve'
import { startCommands } from '../src/lib/notify/commands'
import { arg } from './args'

async function main() {
  const gens = Number(arg('gens', '10'))
  const concurrency = Number(arg('concurrency', '2'))
  const popSize = Number(arg('pop', '6'))
  const stopCommands = startCommands()
  process.on('SIGINT', () => {
    if (control.stopRequested) process.exit(130)
    console.log('stopping after running worlds finish (ctrl-c again to force)')
    control.stopRequested = true
  })
  try {
    await evolve({ gens, concurrency, popSize })
  } finally {
    stopCommands()
  }
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
