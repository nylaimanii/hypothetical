// npm run run-one -- [--seed 1] [--constitution technocrat | --constitution-file path] [--runId id]
import fs from 'node:fs'
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })
import { runWorld } from '../src/lib/evolve/core'
import { SEEDS } from '../src/lib/evolve/seeds'
import { arg } from './args'

async function main() {
  const seed = Number(arg('seed', '1'))
  const file = arg('constitution-file')
  const pick = SEEDS.find(s => s.id === arg('constitution', 'technocrat')) ?? SEEDS[0]
  const constitution = file ? fs.readFileSync(file, 'utf8') : pick.text
  const runId = arg('runId') ?? `one-${file ? 'file' : pick.id}-s${seed}`
  const s = await runWorld({ runId, generation: 0, seed, constitution, frameEvery: 12 })
  console.log(`${runId} ${s.status} ${s.endDate} score ${s.score} peak ${s.peakPopulation} twin ${s.baselineStatus}${s.causeOfDeath ? ` (${s.causeOfDeath})` : ''}`)
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
