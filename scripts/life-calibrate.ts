// npx tsx scripts/life-calibrate.ts [--n 400]: rule-only twins across seeds in the best world. mean age at death per
// birth region should sit within ~2 years of the region's e0, and under-5 deaths near the un igme rates

process.env.LLM_PROVIDER = 'offline'
import { WorldEnv } from '../src/lib/life/env'
import { twinOnly } from '../src/lib/life/run'
import { bestWorld } from '../src/lib/life/worlds'
const pick = bestWorld()!
const w = new WorldEnv(pick.record)
const by: Record<string, { n: number; age: number; u5: number; le: number; score: number; harm: number }> = {}
const causes: Record<string, number> = {}
const N = Number(process.argv[process.argv.indexOf('--n') + 1]) || 400
;(async () => {
  for (let i = 0; i < N; i++) {
    const { p, score } = await twinOnly(w, 1000 + i * 7919)
    const reg = p.places[0].regionId
    const b = (by[reg] ??= { n: 0, age: 0, u5: 0, le: 0, score: 0, harm: 0 })
    b.n++; b.age += p.tick / 12; if (p.tick < 60) b.u5++; b.le += [50,60,70,80,90].reduce((a,y)=>a+w.month(y*12, reg).lifeExpectancy,0)/5; b.score += score.total; b.harm += score.harm
    const c = p.deathCause!.replace(/:.*/, ''); causes[c] = (causes[c] ?? 0) + 1
  }
  for (const [k, b] of Object.entries(by).sort((a, b) => b[1].n - a[1].n)) console.log(k.padEnd(10), String(b.n).padStart(4), 'mean death age', (b.age / b.n).toFixed(1), 'region e0', (b.le / b.n).toFixed(1), 'under5 per 1000', Math.round(b.u5 / b.n * 1000), 'score', (b.score / b.n).toFixed(3))
  console.log(Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 14))
})()
