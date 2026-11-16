// npm run morning: send the morning digest now (evolve sends it at 8am). --dry: print it, send nothing, mark nothing.
// --if-due: send only if today's digest has not gone out yet (the launchd job runs this at 8:05, and on wake)
import '../src/lib/evolve/env'
import { morningDigest, sendMorning } from '../src/lib/evolve/maintenance'
import { send } from '../src/lib/notify/telegram'

const dry = process.argv.includes('--dry')
if (process.argv.includes('--if-due')) sendMorning(send).then(ok => { console.log(ok ? 'morning digest sent' : 'morning digest not due or already sent'); process.exit(0) })
else morningDigest({ dry }).then(async text => { console.log(text); if (!dry) console.log('telegram:', await send(text)); process.exit(0) })
