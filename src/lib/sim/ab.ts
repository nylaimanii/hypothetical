// evidence: proper A/B tests and counterfactual explanations, all fully deterministic.
// abTest: the same seed, one change, both timelines kept. B replays A's own decisions exactly, so the change is the
//   only difference. run on 5 seeds, so a result can say "B won in 4 of 5", not just once.
// explainGap: the 3 decisions that most changed the outcome between two runs on the same seed, found by replaying
//   A with each of B's decisions swapped in (a counterfactual), not guessed.
import fs from 'node:fs'
import path from 'node:path'
import type { Decision, RunRecord } from '../types'
import { loadRun, runWorld, type FlipChange, type RunOpts } from './run'
import { dateOfTick, populationAt } from './truth'

export type Outcome = { population: number; lifeExpectancy: number; excessDeaths: number; freedom: number; offWorld: number }
const outcomeOf = (r: RunRecord, tick?: number): Outcome => {
  const f = tick === undefined ? r.frames.at(-1)! : (r.frames.filter(x => x.tick <= tick).at(-1) ?? r.frames.at(-1)!)
  const x = f as typeof f & { freedom?: number; offWorld?: number }
  return { population: populationAt(r, f.tick), lifeExpectancy: f.globalPeriodLifeExpectancy, excessDeaths: f.humanCost?.deaths ?? 0, freedom: x.freedom ?? 0, offWorld: x.offWorld ?? 0 }
}
const better: Record<keyof Outcome, 1 | -1> = { population: 1, lifeExpectancy: 1, excessDeaths: -1, freedom: 1, offWorld: 1 }
const cleanup = (id: string) => { for (const x of ['.json', '.twin.json', '.lives.json', '.places.json', '.places.bin.gz']) { try { fs.unlinkSync(path.join(process.cwd(), 'data', 'runs', `${id}${x}`)) } catch { /* not written */ } } }

export type AbChange = { decision: { tick: number; change: FlipChange } } | { assumptions: Record<string, number> }
export type AbResult = {
  id: string; change: AbChange; seeds: number[]; untilTick?: number
  perSeed: { seed: number; a: Outcome; b: Outcome; delta: Outcome }[]
  wins: Record<keyof Outcome, { b: number; of: number }> // how many seeds B did better on each measure
  verdict: string
}
// base: the run options of A (constitution, agent, governor); seeds default to 5
export async function abTest(id: string, base: Omit<RunOpts, 'runId' | 'seed' | 'generation'> & { generation?: number }, change: AbChange, seeds = [42, 7, 99, 2026, 1234]): Promise<AbResult> {
  const perSeed: AbResult['perSeed'] = []
  for (const seed of seeds) {
    const aId = `${id}-a-s${seed}`, bId = `${id}-b-s${seed}`
    await runWorld({ ...base, runId: aId, seed, generation: base.generation ?? 0 } as RunOpts)
    const a = loadRun(aId)!
    const flip = 'decision' in change ? change.decision : { tick: 0, change: {} }
    await runWorld({ ...base, runId: bId, seed, generation: base.generation ?? 0, startFrom: { runId: aId, tick: flip.tick }, flipDecision: { ...flip, after: 'replay' }, ...('assumptions' in change ? { assumptions: change.assumptions } : {}) } as RunOpts)
    const b = loadRun(bId)!
    const oa = outcomeOf(a), ob = outcomeOf(b)
    perSeed.push({ seed, a: oa, b: ob, delta: Object.fromEntries(Object.keys(oa).map(k => [k, (ob as Record<string, number>)[k] - (oa as Record<string, number>)[k]])) as Outcome })
  }
  const wins = Object.fromEntries((Object.keys(better) as (keyof Outcome)[]).map(k => [k, { b: perSeed.filter(p => p.delta[k] * better[k] > 0).length, of: perSeed.length }])) as AbResult['wins']
  const verdict = `B saved lives in ${wins.population.b} of ${seeds.length} seeds (population), lived longer in ${wins.lifeExpectancy.b} of ${seeds.length}, had fewer excess deaths in ${wins.excessDeaths.b} of ${seeds.length}, was freer in ${wins.freedom.b} of ${seeds.length}, got further off-world in ${wins.offWorld.b} of ${seeds.length}`
  const res: AbResult = { id, change, seeds, perSeed, wins, verdict, ...(base.untilTick !== undefined ? { untilTick: base.untilTick } : {}) }
  fs.writeFileSync(path.join(process.cwd(), 'data', 'runs', `ab-${id}.json`), JSON.stringify(res))
  return res
}

export type GapReason = { tick: number; date: string; aChose: string; bChose: string; effect: Outcome; share: number }
// the decisions of A that, swapped one at a time for B's decision at the same tick, move A furthest toward B on the
// chosen measure. share = the part of the A-B gap that swap alone explains
export async function explainGap(runA: string, runB: string, opts: { measure?: keyof Outcome; top?: number; maxSwaps?: number } = {}): Promise<{ gap: Outcome; reasons: GapReason[]; swaps: number }> {
  const A = loadRun(runA), B = loadRun(runB)
  if (!A || !B) throw new Error(`explainGap: run ${!A ? runA : runB} not found`)
  if (A.seed !== B.seed) throw new Error('explainGap: the two runs must share a seed (the counterfactual needs the same world)')
  const measure = opts.measure ?? 'population'
  const oa = outcomeOf(A), ob = outcomeOf(B)
  const gap = Object.fromEntries(Object.keys(oa).map(k => [k, (ob as Record<string, number>)[k] - (oa as Record<string, number>)[k]])) as Outcome
  const decB = new Map(B.frames.filter(f => f.decision).map(f => [f.decision!.tick, f.decision as Decision]))
  const ticks = A.frames.filter(f => f.decision && decB.has(f.decision.tick)).map(f => f.decision!.tick).slice(0, opts.maxSwaps ?? 60)
  const sum = (d: Decision) => `${d.laws.map(l => l.title).join('; ') || 'no new laws'} | budget ${Object.entries(d.budget).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' ')}`
  const tried: GapReason[] = []
  for (const tick of ticks) {
    const id = `cf-${runA}-${tick}`
    // the counterfactual stops where A stopped, so both are measured at the same moment
    const end = A.frames.at(-1)!.tick
    await runWorld({ runId: id, generation: A.generation, seed: A.seed, constitution: A.constitution, agentId: A.agentId, startFrom: { runId: runA, tick }, flipDecision: { tick, change: { replaceWith: decB.get(tick)! }, after: 'replay' }, ...(A.summary.status === 'alive' ? { untilTick: end } : {}) } as RunOpts)
    const r0 = loadRun(id)!
    if (r0.frames.at(-1)!.tick !== end && A.summary.status === 'alive') throw new Error(`explainGap: counterfactual ended at ${r0.frames.at(-1)!.tick}, A at ${end}`)
    const o = outcomeOf(r0)
    cleanup(id)
    const effect = Object.fromEntries(Object.keys(oa).map(k => [k, (o as Record<string, number>)[k] - (oa as Record<string, number>)[k]])) as Outcome
    const dA = A.frames.find(f => f.decision?.tick === tick)!.decision as Decision
    tried.push({ tick, date: dateOfTick(tick), aChose: sum(dA), bChose: sum(decB.get(tick)!), effect, share: gap[measure] ? effect[measure] / gap[measure] : 0 })
  }
  // toward B: same sign as the gap, biggest first
  const reasons = tried.filter(t => Math.sign(t.effect[measure]) === Math.sign(gap[measure]) && t.effect[measure] !== 0).sort((x, y) => Math.abs(y.effect[measure]) - Math.abs(x.effect[measure])).slice(0, opts.top ?? 3)
  return { gap, reasons, swaps: tried.length }
}
