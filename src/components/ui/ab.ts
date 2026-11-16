// a/b pairs: two worlds on the same seed that differ by one change. everything here reads the two records' slim
// rows (yearly stats and decisions), so the split and the first difference are what the sim recorded, not a story
import type { Budget, DecisionRow, Divergence, Override, YearRow } from '@/lib/types'
import { dateOfTick } from './truth'

// only worlds made by /api/whatif (they have a what-if file) or by /api/rerun (they have a source) pair up;
// a plain branch has no single change, so it isn't an a/b pair
export type ABKind = 'whatif' | 'rerun'
// a: the original, b: the world with the change. splitTick: where the change applies (0 for a rerun with other
// assumptions). exact false: after the change the governor decides again, so later choices can differ for that
// reason too
// sims: set when the two worlds were run by different sim versions, so not only the change differs
export type AB = { a: string; b: string; kind: ABKind; splitTick: number; change: string; exact?: boolean; firstDiff?: { tick: number; text: string }; sims?: { a?: string; b?: string }; simText?: string }

export const simVersionOf = (r: object) => (r as { simVersion?: string }).simVersion

// in an a/b pair the two worlds have the same governor, so they are named by role
export const abName = (ab: AB, runId: string) => (runId === ab.a ? 'A, the original' : 'B, with the change')
// worlds made by /api/whatif or /api/rerun (ids from newRunId); only these can have an original to pair with
export const mayPair = (runId: string) => /^(whatif|rerun)-/.test(runId)

type Rows = { years: YearRow[]; decisions: DecisionRow[] }
const BUDGET_KEYS: (keyof Budget)[] = ['food', 'energy', 'education', 'space', 'security', 'welfare', 'research']
const pct = (n: number) => `${Math.round(n * 100)}%`
const people = (n: number) => Math.round(n).toLocaleString('en-US')

// a what-if's change in plain words. regionName turns a region id into its name from the record
export function describeChange(c: Omit<Override, 'id' | 'tick'>, regionName: (id: string) => string | undefined): string {
  const where = c.regionId ? ` in ${regionName(c.regionId) ?? c.regionId}` : ''
  if (c.kind === 'inject_event') return `a ${c.eventKind ?? 'event'}${where}${c.severity !== undefined ? ` at severity ${pct(c.severity)}` : ''}`
  if (c.kind === 'veto_law') return `the law ${c.lawId} vetoed`
  const parts = BUDGET_KEYS.filter((k) => c.budget?.[k] !== undefined).map((k) => `${k} ${pct(c.budget![k]!)}`)
  return `the budget forced to ${parts.join(', ') || 'a new split'}`
}

// the first recorded year at or after `from` where the two worlds' numbers are not the same
export function firstDifference(a: Rows, b: Rows, from: number): { tick: number; text: string } | undefined {
  const byTick = new Map(b.years.map((y) => [y.tick, y]))
  for (const ya of a.years) {
    if (ya.tick < from) continue
    const yb = byTick.get(ya.tick)
    if (!yb) continue
    const out: string[] = []
    if (ya.globalPopulation !== yb.globalPopulation) {
      const d = yb.globalPopulation - ya.globalPopulation
      out.push(`B has ${people(Math.abs(d))} ${d > 0 ? 'more' : 'fewer'} people`)
    }
    if (ya.deaths !== yb.deaths) out.push(`deaths ${people(ya.deaths)} in A, ${people(yb.deaths)} in B`)
    if (ya.globalPeriodLifeExpectancy > 0 && yb.globalPeriodLifeExpectancy > 0 && ya.globalPeriodLifeExpectancy.toFixed(1) !== yb.globalPeriodLifeExpectancy.toFixed(1)) out.push(`life expectancy ${ya.globalPeriodLifeExpectancy.toFixed(1)} in A, ${yb.globalPeriodLifeExpectancy.toFixed(1)} in B`)
    if (pct(ya.approval) !== pct(yb.approval)) out.push(`approval ${pct(ya.approval)} in A, ${pct(yb.approval)} in B`)
    if (ya.status !== yb.status) out.push(`A is ${ya.status}, B is ${yb.status}`)
    if (out.length) return { tick: ya.tick, text: `first recorded difference, ${dateOfTick(ya.tick)}: ${out.join('; ')}` }
  }
  return undefined
}

// the first decision at or after `from` where the two worlds chose differently (used when the api gives none)
export function decisionSplit(a: Rows & { runId: string }, b: Rows & { runId: string }, from: number): Divergence | undefined {
  const byTick = new Map(b.decisions.map((d) => [d.tick, d]))
  for (const da of a.decisions) {
    if (da.tick < from) continue
    const db = byTick.get(da.tick)
    if (!db) continue
    const la = da.lawsEnacted.join(', ') || 'no new law', lb = db.lawsEnacted.join(', ') || 'no new law'
    const key = BUDGET_KEYS.reduce((k, x) => (Math.abs(da.budget[x] - db.budget[x]) > Math.abs(da.budget[k] - db.budget[k]) ? x : k), BUDGET_KEYS[0])
    const budgetDiffers = pct(da.budget[key]) !== pct(db.budget[key])
    if (la === lb && !budgetDiffers && da.religionPolicy === db.religionPolicy && da.schoolPurpose === db.schoolPurpose) continue
    const decisionDiff = la !== lb ? `A enacted ${la}; B enacted ${lb}`
      : budgetDiffers ? `A put ${pct(da.budget[key])} into ${key}, B ${pct(db.budget[key])}`
      : da.religionPolicy !== db.religionPolicy ? `A set religion to ${da.religionPolicy.replace('_', ' ')}, B to ${db.religionPolicy.replace('_', ' ')}`
      : `A's schools aim to ${da.schoolPurpose}; B's to ${db.schoolPurpose}`
    const later = (rows: YearRow[]) => rows.find((y) => y.tick >= da.tick + 24) ?? rows.at(-1)
    const xa = later(a.years), xb = later(b.years)
    const consequence = xa && xb ? `by ${dateOfTick(Math.min(xa.tick, xb.tick))}: population ${people(xa.globalPopulation)} in A, ${people(xb.globalPopulation)} in B; approval ${pct(xa.approval)} vs ${pct(xb.approval)}; deaths ${people(xa.deaths)} vs ${people(xb.deaths)}` : ''
    return { runA: a.runId, runB: b.runId, tick: da.tick, decisionDiff, consequence }
  }
  return undefined
}
