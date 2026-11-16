// npm run morning: send the morning digest now (evolve sends it at 8am). --dry: print it, send nothing, mark nothing
import '../src/lib/evolve/env'
import { morningDigest } from '../src/lib/evolve/maintenance'
import { send } from '../src/lib/notify/telegram'

const dry = process.argv.includes('--dry')
morningDigest({ dry }).then(async text => { console.log(text); if (!dry) console.log('telegram:', await send(text)); process.exit(0) })
