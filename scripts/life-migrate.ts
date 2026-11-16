// npx tsx scripts/life-migrate.ts: repairs lives recorded before a fix, without rerunning them.
//   1. a sibling who shares the chosen person's first name (or another relative's) gets a fresh name from the same
//      region list, everywhere it appears (kin, events, journal). deterministic: seeded by the life's seed
import path from 'node:path'
import { mulberry32 } from '../src/lib/sim/rng'
import { nameFor } from '../src/lib/life/births'
import { livesRoot, listWorlds, readIndex, readLife, writeLife } from '../src/lib/life/store'

let fixed = 0
for (const w of listWorlds()) {
  for (const s of readIndex(w)) {
    const r = readLife(w, s.lifeId)
    if (!r) continue
    const own = r.name.split(' ')[0]
    const taken = new Set([own, ...r.kin.filter(k => k.relation !== 'sibling').map(k => k.name)])
    const rng = mulberry32(r.seed ^ 0x51b1)
    let changed = false
    for (const k of r.kin.filter(k => k.relation === 'sibling')) {
      if (!taken.has(k.name)) { taken.add(k.name); continue }
      let name = nameFor(rng, r.birthplace.regionId, k.sex).given
      for (let i = 0; i < 20 && taken.has(name); i++) name = nameFor(rng, r.birthplace.regionId, k.sex).given
      const re = new RegExp(`\\b${k.name}\\b(?= died| was born|'s| and i)`, 'g')
      for (const e of r.events) if (e.tick >= (k.diedTick ?? Infinity) - 1 && e.tick <= (k.diedTick ?? -1) + 1) e.text = e.text.replace(new RegExp(`^${k.name} died`), `${name} died`)
      for (const j of r.journal) j.text = j.text.replace(re, name)
      console.log(`${r.lifeId}: sibling ${k.name} -> ${name}`)
      k.name = name
      taken.add(name)
      changed = true
    }
    if (changed) { writeLife(r); fixed++ }
  }
}
console.log(`${fixed} lives repaired in ${path.relative(process.cwd(), livesRoot()) || livesRoot()}`)
