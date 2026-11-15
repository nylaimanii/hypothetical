// npm run seed: creates the data/ folders and writes the starting constitutions to data/seeds.json
import fs from 'node:fs'
import path from 'node:path'
import { SEEDS, wordCount } from '../src/lib/evolve/seeds'
import { DATA, dirs, writeJson } from '../src/lib/evolve/store'

for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })
let ok = true
for (const s of SEEDS) {
  const n = wordCount(s.text)
  if (n >= 250 || /[\u2014\u2013]/.test(s.text)) ok = false
  console.log(`${s.id.padEnd(14)} ${String(n).padStart(3)} words  ${s.name}`)
}
writeJson(path.join(DATA, 'seeds.json'), SEEDS)
if (!ok) { console.error('a seed is 250+ words or has an em-dash'); process.exit(1) }
