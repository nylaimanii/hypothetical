// npm run run-one -- [--seed 1] [--constitution technocrat | --constitution-file path] [--runId id] [--overrideDir dir]
// one world, one line per year: date, population, food, unrest, moon stage, vs the no-ai twin's population
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })
import type { RunRecord } from '../src/lib/types'
import { runWorld } from '../src/lib/sim/run'
import { SEEDS } from '../src/lib/evolve/seeds'
import { arg } from './args'

const fmt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(3)}B` : `${(n / 1e6).toFixed(1)}M`)

async function main() {
  const seed = Number(arg('seed', '1'))
  const file = arg('constitution-file')
  const pick = SEEDS.find(s => s.id === arg('constitution', 'technocrat')) ?? SEEDS[0]
  const constitution = file ? fs.readFileSync(file, 'utf8') : pick.text
  const runId = arg('runId') ?? `one-${file ? 'file' : pick.id}-s${seed}`
  const overrideDir = arg('overrideDir')
  const s = await runWorld({ runId, generation: 0, seed, constitution, frameEvery: 12, overrideDir })
  const rec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'runs', `${runId}.json`), 'utf8')) as RunRecord
  const twinPop = new Map(rec.baseline.map(b => [b.tick, b.regions.reduce((a, r) => a + r.population, 0)]))
  for (const f of rec.frames) {
    const pop = f.regions.reduce((a, r) => a + r.population, 0)
    const food = f.regions.reduce((a, r) => a + r.foodKcalPerCapita * r.population, 0) / pop
    const unrest = f.regions.reduce((a, r) => a + r.unrest * r.population, 0) / pop
    const tp = twinPop.get(f.tick)
    const vs = tp ? `${pop >= tp ? '+' : ''}${(((pop - tp) / tp) * 100).toFixed(2)}%` : 'n/a'
    console.log(`${f.date}  pop ${fmt(pop).padStart(8)}  food ${Math.round(food)} kcal  unrest ${unrest.toFixed(3)}  moon ${f.moonStage.padEnd(14)} vs twin pop ${vs}`)
  }
  console.log(`${runId} ${s.status} ${s.endDate} score ${s.score} peak ${s.peakPopulation} twin ${s.baselineStatus} ${s.baselineEndDate}${s.causeOfDeath ? ` (${s.causeOfDeath})` : ''}`)
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
