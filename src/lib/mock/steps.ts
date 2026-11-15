// MOCK: the steps view. per-world impact of each decision, and the cross-world recipe used when
// GET /api/steps is not there yet. impact is an ESTIMATE: how much a score proxy (life expectancy, approval,
// population growth) changed in the 2 years after a step, compared with the 2 years before it.
import type { Frame, RunRecord, Step } from '@/lib/types'

export type WorldStep = {
  key: string // stable across worlds: law id, "city:<name>", "research:<topic>", "budget:<line>"
  text: string
  kind: Step['kind']
  tick: number
  effect: number // + helped, - hurt
  deathsUp: boolean // yearly deaths rose after it
  why: string
}

const WINDOW = 24

function at(fs: Frame[], tick: number): Frame | null {
  let best: Frame | null = null
  for (const f of fs) { if (f.tick <= tick) best = f; else break }
  return best ?? fs[0] ?? null
}

const deathsRate = (a: Frame, b: Frame) => Math.max(0, (b.humanCost.deaths - a.humanCost.deaths) / Math.max(1, (b.tick - a.tick) / 12))

function impact(fs: Frame[], tick: number) {
  const before = at(fs, tick - WINDOW), now = at(fs, tick), after = at(fs, tick + WINDOW)
  if (!before || !now || !after || after.tick <= now.tick) return null
  const d = (a: Frame, b: Frame) => ({
    ple: b.globalPeriodLifeExpectancy - a.globalPeriodLifeExpectancy,
    appr: (b.humanCost.approval ?? 0) - (a.humanCost.approval ?? 0),
    grow: a.globalPopulation ? b.globalPopulation / a.globalPopulation - 1 : 0,
  })
  const pre = now.tick > before.tick ? d(before, now) : { ple: 0, appr: 0, grow: 0 }
  const post = d(now, after)
  const score = (x: typeof post) => x.ple / 2 + x.appr * 3 + x.grow * 10
  const deathsBefore = now.tick > before.tick ? deathsRate(before, now) : 0
  const deathsAfter = deathsRate(now, after)
  return { effect: score(post) - score(pre), post, deathsBefore, deathsAfter }
}

const sign = (v: number, digits = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`
const people = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}b` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`)

function whyOf(i: NonNullable<ReturnType<typeof impact>>) {
  const parts = [`life expectancy ${sign(i.post.ple)}y`, `approval ${sign(i.post.appr * 100, 0)} pts`]
  if (i.deathsAfter > i.deathsBefore * 1.15 && i.deathsAfter > 1000) parts.push(`deaths up to ${people(i.deathsAfter)} a year`)
  else if (i.deathsBefore > i.deathsAfter * 1.15 && i.deathsBefore > 1000) parts.push(`deaths down to ${people(i.deathsAfter)} a year`)
  return `in the 2 years after: ${parts.join(', ')}`
}

export function worldSteps(rec: RunRecord): WorldStep[] {
  const fs = [...rec.frames].sort((a, b) => a.tick - b.tick)
  const out: WorldStep[] = []
  const seen = new Set<string>()
  const push = (key: string, text: string, kind: Step['kind'], tick: number) => {
    if (seen.has(key)) return
    const i = impact(fs, tick)
    if (!i) return
    seen.add(key)
    out.push({ key, text, kind, tick, effect: i.effect, deathsUp: i.deathsAfter > i.deathsBefore * 1.15 && i.deathsAfter > 1000, why: whyOf(i) })
  }
  let prevBudget = fs[0]?.budget
  for (const f of fs) {
    const d = f.decision
    if (!d) continue
    for (const l of d.laws) if (!l.vetoed) push(l.id, l.title, 'law', d.tick)
    for (const c of d.foundCities) push(`city:${c.name}`, `found ${c.name}`, 'city', d.tick)
    for (const c of d.charterCompanies) push(`company:${c.name}`, `charter ${c.name}`, 'policy', d.tick)
    for (const r of d.researchFocus) push(`research:${r}`, `research ${r.replace(/_/g, ' ')}`, 'research', d.tick)
    if (prevBudget) {
      // the biggest budget swing of the decision, if it moved at least 5 points
      const lines = Object.keys(d.budget) as (keyof typeof d.budget)[]
      const big = lines.map((k) => ({ k, dv: d.budget[k] - prevBudget![k] })).sort((a, b) => Math.abs(b.dv) - Math.abs(a.dv))[0]
      if (big && Math.abs(big.dv) >= 0.05) push(`budget:${big.k}:${Math.sign(big.dv)}`, `${big.dv > 0 ? 'raise' : 'cut'} the ${big.k} budget to ${Math.round(d.budget[big.k] * 100)}%`, 'budget', d.tick)
    }
    prevBudget = d.budget
  }
  return out.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
}

const ok = (rec: RunRecord) => rec.summary.status !== 'destroyed'

// group the same step across worlds: who it helped, who it hurt, and how sure we are
export function mockSteps(records: RunRecord[]): Step[] {
  const groups = new Map<string, { text: string; kind: Step['kind']; effects: number[]; helped: string[]; hurt: string[] }>()
  for (const rec of records) {
    for (const s of worldSteps(rec)) {
      const g = groups.get(s.key) ?? { text: s.text, kind: s.kind, effects: [], helped: [], hurt: [] }
      g.effects.push(s.effect)
      if (ok(rec) && s.effect >= 0) g.helped.push(rec.runId)
      else if (!ok(rec) || s.effect < 0) g.hurt.push(rec.runId)
      groups.set(s.key, g)
    }
  }
  return [...groups.entries()]
    .map(([id, g]) => ({
      id, text: g.text, kind: g.kind, helpedWorlds: g.helped, hurtWorlds: g.hurt,
      effect: Math.round((g.effects.reduce((a, b) => a + b, 0) / g.effects.length) * 1000) / 1000,
      confidence: Math.min(1, g.effects.length / 4),
    }))
    .sort((a, b) => b.effect * b.confidence - a.effect * a.confidence)
}
