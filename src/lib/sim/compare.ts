// where two runs chose differently, and what it led to. walks the decision ticks both runs reached and flags
// key choices that differ: any budget line off by more than 10% (relative, and at least 1 point of the budget),
// religion or school policy, the set of laws enacted, or cities founded. the consequence is the stat gap
// five years (60 ticks) later, or how one run ended first.
import type { Budget, Decision, Divergence, Frame, RunRecord } from '../types'
import { dateOf } from './constants'

const KEYS: (keyof Budget)[] = ['food', 'energy', 'education', 'space', 'security', 'welfare', 'research']
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`
const fmtPop = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${(n / 1e6).toFixed(0)}M`)

function decisionDiff(a: Decision, b: Decision): string[] {
  const out: string[] = []
  for (const k of KEYS) {
    const x = a.budget[k], y = b.budget[k]
    if (Math.abs(x - y) >= 0.01 && Math.abs(x - y) / Math.max(x, y, 1e-9) > 0.1) out.push(`${k} ${pct(x)} vs ${pct(y)}`)
  }
  if (a.religionPolicy !== b.religionPolicy) out.push(`religion ${a.religionPolicy} vs ${b.religionPolicy}`)
  const sa = a.schoolPolicy, sb = b.schoolPolicy
  if (sa.yearsRequired !== sb.yearsRequired || sa.purpose !== sb.purpose || sa.curriculum.join('|') !== sb.curriculum.join('|')) out.push(`school "${sa.purpose}" (${sa.yearsRequired} yrs) vs "${sb.purpose}" (${sb.yearsRequired} yrs)`)
  const la = new Set(a.laws.map(l => l.title.toLowerCase())), lb = new Set(b.laws.map(l => l.title.toLowerCase()))
  const onlyA = [...la].filter(t => !lb.has(t)), onlyB = [...lb].filter(t => !la.has(t))
  if (onlyA.length || onlyB.length) out.push(`laws ${onlyA.length ? onlyA.map(t => `"${t}"`).join(', ') : 'none'} vs ${onlyB.length ? onlyB.map(t => `"${t}"`).join(', ') : 'none'}`)
  const ca = (a.foundCities ?? []).map(c => `${c.name} (${c.regionId})`).sort(), cb = (b.foundCities ?? []).map(c => `${c.name} (${c.regionId})`).sort()
  if (ca.join('|') !== cb.join('|')) out.push(`cities ${ca.join(', ') || 'none'} vs ${cb.join(', ') || 'none'}`)
  return out
}

function frameAtOrAfter(r: RunRecord, tick: number): Frame | undefined {
  return r.frames.find(f => f.tick >= tick)
}

function consequence(a: RunRecord, b: RunRecord, tick: number): string {
  const t = tick + 60
  const fa = frameAtOrAfter(a, t), fb = frameAtOrAfter(b, t)
  if (!fa || !fb) {
    const ended = !fa && !fb ? 'both runs' : !fa ? a.runId : b.runId
    const which = !fa ? a.summary : b.summary
    return `${ended} ended before ${dateOf(t)} (${which.status}${which.causeOfDeath ? `: ${which.causeOfDeath}` : ''})`
  }
  const avg = (f: Frame, k: 'unrest' | 'foodKcalPerCapita') => f.regions.reduce((s, r) => s + r[k] * r.population, 0) / Math.max(1, f.globalPopulation)
  const parts = [
    `population ${fmtPop(fa.globalPopulation)} vs ${fmtPop(fb.globalPopulation)} (${fa.globalPopulation >= fb.globalPopulation ? '+' : ''}${(((fa.globalPopulation - fb.globalPopulation) / fb.globalPopulation) * 100).toFixed(1)}%)`,
    `life expectancy ${fa.globalPeriodLifeExpectancy} vs ${fb.globalPeriodLifeExpectancy}`,
    `approval ${pct(fa.humanCost.approval)} vs ${pct(fb.humanCost.approval)}`,
    `unrest ${avg(fa, 'unrest').toFixed(2)} vs ${avg(fb, 'unrest').toFixed(2)}`,
    `food ${Math.round(avg(fa, 'foodKcalPerCapita'))} vs ${Math.round(avg(fb, 'foodKcalPerCapita'))} kcal`,
  ]
  if (fa.frontier !== fb.frontier) parts.push(`frontier ${fa.frontier} vs ${fb.frontier}`)
  if (fa.status !== fb.status) parts.push(`status ${fa.status} vs ${fb.status}`)
  return `five years later (${fa.date}): ${parts.join(', ')}`
}

export function findDivergences(a: RunRecord, b: RunRecord): Divergence[] {
  const da = new Map(a.frames.filter(f => f.decision).map(f => [f.decision!.tick, f.decision!]))
  const out: Divergence[] = []
  for (const f of b.frames) {
    if (!f.decision) continue
    const x = da.get(f.decision.tick)
    if (!x) continue
    const diff = decisionDiff(x, f.decision)
    if (!diff.length) continue
    out.push({ runA: a.runId, runB: b.runId, tick: f.decision.tick, decisionDiff: `${dateOf(f.decision.tick)}: ${diff.join('; ')}`, consequence: consequence(a, b, f.decision.tick) })
  }
  return out.sort((p, q) => p.tick - q.tick)
}
