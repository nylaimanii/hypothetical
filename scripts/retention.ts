// npm run retention: one retention pass now (evolve also runs it every hour) and the disk report
import '../src/lib/evolve/env'
import { diskLine, gb, sweep } from '../src/lib/evolve/retention'

const r = sweep()
console.log(`slimmed ${r.slimmed}, gzipped ${r.gzipped}, restored ${r.restored}, deleted ${r.deleted}, freed ${gb(r.freedBytes)}`)
console.log(diskLine())
