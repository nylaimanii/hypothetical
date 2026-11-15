// npm run reality-check: compare the no-ai twin with real published data, write data/reality-check.json
import '../src/lib/evolve/env'
import { runRealityCheck } from '../src/lib/evolve/reality'

runRealityCheck().then(r => {
  for (const row of r.rows) console.log(`${row.stat} ${row.year} (${row.kind}): twin ${row.twin} vs real ${row.real}, drift ${(row.drift * 100).toFixed(2)}%${row.flagged ? '  FLAGGED' : ''}`)
  for (const f of r.flags) console.log(`tune ${f.name} = ${f.value} (${f.stat})`)
  for (const e of r.errors) console.log(`error: ${e}`)
  process.exit(0)
}, e => { console.error(e); process.exit(1) })
