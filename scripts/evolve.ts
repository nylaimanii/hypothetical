// npm run evolve -- [--gens 10] [--concurrency 1] [--pop 7]
// without --gens it keeps going until a world achieves the goal. concurrency defaults to 1 (one gpu)
// env first, then the fetch counter, so both are in place before the sim modules load
import '../src/lib/evolve/env'
import '../src/lib/evolve/usage'
import { evolve, control } from '../src/lib/evolve/evolve'
import { startCommands } from '../src/lib/notify/commands'
import { arg } from './args'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

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
  // a new sim version landed: this process stopped at a generation boundary. start a fresh one on the new code,
  // still under caffeinate so the mac can't sleep, appending to the same log
  if (control.restartForVersion) {
    const log = fs.openSync('data/evolve.log', 'a')
    const tsx = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
    const child = spawn('caffeinate', ['-i', process.execPath, tsx, 'scripts/evolve.ts', ...process.argv.slice(2)], { detached: true, stdio: ['ignore', log, log], env: process.env })
    child.unref()
    console.log(`restarting on sim version ${control.restartForVersion} (pid ${child.pid})`)
  }
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
