// npm run morning: send the morning digest now (evolve sends it at 8am). --dry: print it, send nothing, mark nothing.
// --if-due: send only if today's digest has not gone out yet (the launchd job runs this at 8:05, and on wake). it
// also catches up on the nightly consistency suite if evolve was not running to start it
import '../src/lib/evolve/env'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { consistencyDue, morningDigest, sendMorning } from '../src/lib/evolve/maintenance'
import { codeRoot } from '../src/lib/evolve/version'
import { send } from '../src/lib/notify/telegram'

const dry = process.argv.includes('--dry')
if (process.argv.includes('--if-due')) {
  sendMorning(send).then(ok => {
    console.log(ok ? 'morning digest sent' : 'morning digest not due or already sent')
    if (consistencyDue()) {
      const r = spawnSync(process.execPath, [path.join(codeRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--tsconfig', path.join(codeRoot(), 'tsconfig.json'), path.join(codeRoot(), 'scripts', 'consistency.ts'), '--nightly', '--if-due'], { cwd: process.cwd(), encoding: 'utf8', timeout: 35 * 60_000 })
      console.log(`${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n')[0] ?? '')
    }
    process.exit(0)
  })
} else morningDigest({ dry }).then(async text => { console.log(text); if (!dry) console.log('telegram:', await send(text)); process.exit(0) })
