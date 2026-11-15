// npm run morning: send the morning digest now (evolve sends it at 8am)
import '../src/lib/evolve/env'
import { morningDigest } from '../src/lib/evolve/maintenance'
import { send } from '../src/lib/notify/telegram'

morningDigest().then(async text => { console.log(text); console.log('telegram:', await send(text)); process.exit(0) })
