// the playbook (data/playbook.json, GET /api/playbook): what the worlds have learned, in plain words, and how sure
// we are of each lesson, from evidence, not a flat number.
//
// a lesson is tested on natural a/b tests: two real worlds on the same seed, the same sim version and the same
// horizon (so the same world, the same luck), run by different agents. a pair counts when one world followed the
// lesson clearly more than the other did; the lesson is supported when the follower did better for everyone
// (steps.ts goodness: mission score, lifespan, people alive, minus human cost) and contradicted when it did worse.
// confidence = (supported + 1) / (supported + contradicted + 2): 50% with no evidence, up with each test that
// agrees, down with each that doesn't. a lesson the sim can't measure yet says so instead of showing a number.
//
// which decision a lesson is about comes from its rule's words, by a fixed table (TOPICS) shown with the lesson
// ("tested as"), so anyone can see what was measured.
import fs from 'node:fs'
import path from 'node:path'
import type { Lesson, RunRecord } from '../types'
import { readLessons } from './lessons'
import { readJson, readRunIndex, writeJson } from './store'
import { goodnessOf, readFeatures, type RunFeatures } from './steps'
import { currentVersion } from './version'
import { people } from './facts'

type BudgetKey = keyof RunFeatures['budget']
// rule words -> the budget lines they are about
const TOPICS: { key: BudgetKey[]; words: RegExp; label: string }[] = [
  { key: ['food', 'welfare'], words: /basic (human )?needs|humanitarian|immediate needs|wellbeing/, label: 'food and welfare' },
  { key: ['food'], words: /\bfood|hunger|famine|starv|agricultur|harvest|crops?\b/, label: 'food' },
  { key: ['welfare'], words: /welfare|health|social (programs?|spending|safety)|public (approval|sentiment)|unrest|rebellion|dissatisf|care\b/, label: 'welfare' },
  { key: ['space'], words: /\bspace|rocket|launch|lunar|moon|mars|orbit/, label: 'space' },
  { key: ['security'], words: /security|military|crackdown|\bforce\b|repress|police|army/, label: 'security' },
  { key: ['education'], words: /educat|school/, label: 'education' },
  { key: ['energy'], words: /energy|power grid|electric/, label: 'energy' },
  { key: ['research'], words: /research|science|technolog/, label: 'research' },
]
const NEGATE = /\b(avoid|don'?t|do not|never|limit|reduce|cut back|stop|less|without over|minimi[sz]e|refrain)\b/
const DEPRIORITIZE = /\b(before|over|instead of|rather than|at the expense of|ahead of)\b/

export type LessonTest = { up: BudgetKey[]; down: BudgetKey[]; text: string }

// what a rule asks for, as budget lines to raise and lower. null when no line matches its words
export function testOf(rule: string): LessonTest | null {
  const r = rule.toLowerCase()
  const split = DEPRIORITIZE.exec(r)
  const main = split ? r.slice(0, split.index) : r, rest = split ? r.slice(split.index) : ''
  const topic = (s: string) => TOPICS.find(t => t.words.test(s))
  const a = topic(main), b = rest ? topic(rest) : undefined
  if (!a && !b) return null
  const negated = NEGATE.test(main)
  let up: BudgetKey[] = [], down: BudgetKey[] = []
  if (a) (negated ? down : up).push(...a.key)
  if (b && b !== a) (negated ? up : down).push(...b.key.filter(k => !up.includes(k) && !down.includes(k)))
  if (!up.length && !down.length) return null
  const lbl = (ks: BudgetKey[]) => TOPICS.find(t => t.key.join() === ks.join())?.label ?? ks.join(' and ')
  const text = up.length && down.length ? `a bigger share of the budget on ${lbl(up)} than on ${lbl(down)}, compared with a rival on the same seed`
    : up.length ? `a bigger share of the budget on ${lbl(up)} than a rival on the same seed` : `a smaller share of the budget on ${lbl(down)} than a rival on the same seed`
  return { up, down, text }
}

// how much a world followed the test (share up minus share down)
const follows = (t: LessonTest, f: RunFeatures) => t.up.reduce((a, k) => a + f.budget[k], 0) - t.down.reduce((a, k) => a + f.budget[k], 0)

export type AbTest = { seed: number; version: string; horizon: string; follower: string; other: string; supported: boolean }
export type PlaybookLesson = {
  id: string; rule: string; learnedFrom: string; generation: number; mistake: string
  testedAs: string | null
  supported: number; contradicted: number; tests: number
  // of those: the natural same-seed pairs, and the controlled sim tests (one per seed)
  natural: { supported: number; contradicted: number }
  controlled: (Controlled & { text: string }) | null
  confidence: number | null; previous: number | null; trend: 'up' | 'down' | 'same' | 'new' | 'untested'
  examples: AbTest[]
}
export type Playbook = { computedAt: string; generation: number | null; worlds: number; pairs: number; lessons: PlaybookLesson[] }
export const playbookFile = () => path.join(process.cwd(), 'data', 'playbook.json')
export const readPlaybook = () => readJson<Playbook>(playbookFile())

const seedOf = (runId: string) => { const m = /-s(\d+)$/.exec(runId); return m ? Number(m[1]) : null }

// every same-seed, same-version, same-horizon pair of real worlds by different agents
export function pairsOf(features: RunFeatures[], versionOf: (runId: string) => string): [RunFeatures, RunFeatures][] {
  const groups = new Map<string, RunFeatures[]>()
  for (const f of features) {
    const seed = seedOf(f.runId)
    if (seed === null) continue
    const k = `${seed}|${versionOf(f.runId)}|${f.horizon}`
    groups.set(k, [...(groups.get(k) ?? []), f])
  }
  const out: [RunFeatures, RunFeatures][] = []
  for (const g of groups.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (g[i].agentId !== g[j].agentId) out.push([g[i], g[j]])
  return out
}

const conf = (s: number, c: number) => Math.round(((s + 1) / (s + c + 2)) * 100) / 100

export function computePlaybook(lessons: Lesson[], features: RunFeatures[], versionOf: (runId: string) => string, prev: Playbook | null, generation: number | null, controlled: Record<string, Controlled> = {}, version?: string): Playbook {
  const good = goodnessOf(features)
  const pairs = pairsOf(features, versionOf)
  const before = new Map((prev?.lessons ?? []).map(l => [l.id, l.confidence]))
  const out: PlaybookLesson[] = lessons.map(l => {
    const t = testOf(l.rule)
    const base = { id: l.id, rule: l.rule, learnedFrom: l.fromRunId, generation: l.generation, mistake: l.mistake, testedAs: t?.text ?? null }
    if (!t) return { ...base, supported: 0, contradicted: 0, tests: 0, natural: { supported: 0, contradicted: 0 }, controlled: null, confidence: null, previous: null, trend: 'untested' as const, examples: [] }
    const tests: AbTest[] = []
    for (const [a, b] of pairs) {
      const d = follows(t, a) - follows(t, b)
      // only a clear difference (2 points of the budget or more) is a test of the lesson
      if (Math.abs(d) < 0.02) continue
      const [fol, oth] = d > 0 ? [a, b] : [b, a]
      const gf = good.get(fol.runId), go = good.get(oth.runId)
      if (gf === undefined || go === undefined || Math.abs(gf - go) < 1e-6) continue
      tests.push({ seed: seedOf(fol.runId)!, version: versionOf(fol.runId), horizon: fol.horizon, follower: fol.runId, other: oth.runId, supported: gf > go })
    }
    const ns = tests.filter(x => x.supported).length, nc = tests.length - ns
    // the controlled test for this version (or the newest one there is)
    const ck = Object.keys(controlled).filter(k => k.startsWith(`${l.id}|${t.up.join('+')}>${t.down.join('+')}|`))
    const ckey = version && controlled[controlledKey(l.id, t, version)] ? controlledKey(l.id, t, version) : ck.sort((x, y) => cmpVersion(x.split('|').pop()!, y.split('|').pop()!)).pop()
    const ct = ckey ? controlled[ckey] : undefined
    const med = ct?.perSeed.length ? [...ct.perSeed.map(p => p.b - p.a)].sort((x, y) => x - y)[Math.floor(ct.perSeed.length / 2)] : 0
    const ctrl = ct ? { ...ct, text: `in the sim, ${ct.shift} left more people alive after ${ct.years} years in ${ct.wins} of ${ct.of} seeds, typically ${people(med)} ${med >= 0 ? 'more' : 'fewer'} (offline governor, sim ${ct.simVersion})` } : null
    const s = ns + (ct?.wins ?? 0), c = nc + (ct?.losses ?? 0)
    const confidence = conf(s, c)
    const p = before.get(l.id) ?? null
    const trend = p === null ? 'new' : confidence > p ? 'up' : confidence < p ? 'down' : 'same'
    return { ...base, supported: s, contradicted: c, tests: s + c, natural: { supported: ns, contradicted: nc }, controlled: ctrl, confidence, previous: p, trend, examples: tests.slice(-6) }
  })
  // best supported first, untested last
  out.sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1) || b.tests - a.tests)
  return { computedAt: new Date().toISOString(), generation, worlds: features.length, pairs: pairs.length, lessons: out }
}

// after each generation: recompute over every real world's features and save
export function writePlaybook(generation: number | null): Playbook {
  const versions = new Map(readRunIndex().map(r => [r.runId, r.simVersion ?? '?']))
  const pb = computePlaybook(readLessons(), Object.values(readFeatures()), id => versions.get(id) ?? '?', readPlaybook(), generation, readControlled(), currentVersion())
  fs.mkdirSync(path.dirname(playbookFile()), { recursive: true })
  writeJson(playbookFile(), pb)
  return pb
}

// one line for a person: "ensure basic needs before space goals: 71% sure (5 of 7 a/b tests agree, up from 60%)"
export function lessonLine(l: PlaybookLesson): string {
  const rule = l.rule.replace(/[.\s]+$/, '').replace(/^./, c => c.toLowerCase())
  if (l.confidence === null) return `${rule}: not tested yet (no budget decision matches it)`
  if (!l.tests) return `${rule}: no a/b test yet (no two worlds on the same seed differed on it, no controlled test run)`
  const was = l.previous !== null && l.previous !== l.confidence ? `, ${l.trend} from ${Math.round(l.previous * 100)}%` : ''
  const parts = [l.natural.supported + l.natural.contradicted ? `${l.natural.supported} of ${l.natural.supported + l.natural.contradicted} same-seed world pairs` : '', l.controlled ? `${l.controlled.wins} of ${l.controlled.of} controlled sim tests` : ''].filter(Boolean)
  return `${rule}: ${Math.round(l.confidence * 100)}% sure (${l.supported} of ${l.tests} a/b tests agree: ${parts.join(', ')}${was})`
}

// ---------- controlled a/b tests (the lesson's mechanism, in the sim) ----------
// for each lesson with a budget test: per seed, world A runs under the offline governor (deterministic, no model);
// world B is A from its first decision with 5 points of the budget moved the way the lesson says (from the "down"
// lines to the "up" lines, or from/to the rest in proportion to their shares), then A's own later decisions replayed, so that one decision's budget (it holds until the governor's next decision, 2 years for the offline governor)
// change is the only difference (b's flipDecision 'replay'). measured: people alive after 20 years (truth.ts). this
// tests what the lesson does in the sim, not whether an agent would choose it. results: data/playbook-ab.json, per
// sim version, folded into the lesson's evidence next to the natural same-seed pairs
export type Controlled = { simVersion: string; seeds: number[]; wins: number; losses: number; of: number; years: number; shift: string; perSeed: { seed: number; a: number; b: number }[]; months?: number; from?: string }
export const controlledFile = () => path.join(process.cwd(), 'data', 'playbook-ab.json')
export const readControlled = () => readJson<Record<string, Controlled>>(controlledFile()) ?? {}
export const controlledKey = (lessonId: string, t: LessonTest, version: string) => `${lessonId}|${t.up.join('+')}>${t.down.join('+')}|${version}`
const SHIFT = 0.05
// '5.10.5' after '5.9.0' (a plain string sort puts 5.10 first)
const cmpVersion = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0 }

// the lesson's budget, 5 points moved, from a decision's own budget (shares stay >= 0 and sum to the same total)
export function shiftedBudget(t: LessonTest, b: RunFeatures['budget']): RunFeatures['budget'] {
  const out = { ...b }
  const all = Object.keys(b) as BudgetKey[]
  const up = t.up.length ? t.up : all.filter(k => !t.down.includes(k))
  const down = t.down.length ? t.down : all.filter(k => !t.up.includes(k))
  const take = Math.min(SHIFT, down.reduce((a, k) => a + out[k], 0))
  const fromEach = (k: BudgetKey) => take * (out[k] / Math.max(1e-9, down.reduce((a, x) => a + out[x], 0)))
  for (const k of down) out[k] = Math.max(0, out[k] - fromEach(k))
  for (const k of up) out[k] += take / up.length
  return out
}

type Run = (opts: Record<string, unknown>) => Promise<unknown>
type Load = (id: string) => RunRecord | null
export async function controlledTest(lessonId: string, t: LessonTest, version: string, deps: { run: Run; load: Load; populationAt: (r: RunRecord, tick: number) => number; cleanup: (id: string) => void }, seeds = [42, 7, 99, 2026, 1234], years = 20): Promise<Controlled> {
  const untilTick = years * 12
  const constitution = 'Govern for the long-term survival and wellbeing of everyone.'
  const perSeed: Controlled['perSeed'] = []
  // how long the shifted budget holds (until the governor's next decision) and the budget it was shifted from
  let months: number | undefined, from: string | undefined
  for (const seed of seeds) {
    const aId = `pb-${lessonId}-a-s${seed}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80), bId = aId.replace('-a-s', '-b-s')
    try {
      await deps.run({ runId: aId, generation: 0, seed, constitution, untilTick })
      const a = deps.load(aId)
      const first = a?.frames.filter(f => f.decision).sort((x, y) => x.tick - y.tick)[0]?.decision
      if (!a || !first) continue
      if (months === undefined) {
        const next = a.frames.filter(f => f.decision && f.decision.tick > first.tick).sort((x, y) => x.tick - y.tick)[0]?.decision
        months = next ? next.tick - first.tick : untilTick - first.tick
        const top = (Object.entries(first.budget) as [BudgetKey, number][]).sort((x, y) => y[1] - x[1])[0]
        from = `the offline governor's opening budget, which already puts ${Math.round(top[1] * 100)}% into ${top[0]}`
      }
      await deps.run({ runId: bId, generation: 0, seed, constitution, untilTick, startFrom: { runId: aId, tick: first.tick }, flipDecision: { tick: first.tick, change: { budget: shiftedBudget(t, first.budget) }, after: 'replay' } })
      const b = deps.load(bId)
      if (!b) continue
      perSeed.push({ seed, a: deps.populationAt(a, untilTick), b: deps.populationAt(b, untilTick) })
    } finally { deps.cleanup(aId); deps.cleanup(bId) }
  }
  const lbl = (ks: BudgetKey[]) => ks.join(' and ')
  const span = months === undefined ? "one decision's budget" : months % 12 === 0 ? `the budget for ${months / 12 === 1 ? 'one year' : `${months / 12} years`}` : `the budget for ${months} months`
  const shift = (t.up.length && t.down.length ? `5 points of ${span} moved from ${lbl(t.down)} to ${lbl(t.up)}` : t.up.length ? `5 more points of ${span} on ${lbl(t.up)} (taken from every other line in proportion to its share)` : `5 fewer points of ${span} on ${lbl(t.down)} (spread over every other line in proportion to its share)`) + (from ? `, starting from ${from}` : '')
  return { simVersion: version, seeds, wins: perSeed.filter(p => p.b > p.a).length, losses: perSeed.filter(p => p.b < p.a).length, of: perSeed.length, years, shift, perSeed, months, from }
}

// runs the missing controlled tests for the current version and saves them. offline only: never uses model time
export async function runControlledTests(version: string, deps: Parameters<typeof controlledTest>[3], log: (l: string) => void = console.log): Promise<number> {
  if ((process.env.LLM_PROVIDER ?? '') !== 'offline') { log('playbook-ab: skipped (runs only with LLM_PROVIDER=offline, so it never uses model time)'); return 0 }
  const saved = readControlled()
  let n = 0
  for (const l of readLessons()) {
    const t = testOf(l.rule)
    if (!t) continue
    const key = controlledKey(l.id, t, version)
    if (saved[key]) continue
    const t0 = Date.now()
    saved[key] = await controlledTest(l.id, t, version, deps)
    writeJson(controlledFile(), saved)
    log(`playbook-ab: "${l.rule.slice(0, 60)}" more people alive in ${saved[key].wins} of ${saved[key].of} seeds (${Math.round((Date.now() - t0) / 1000)}s)`)
    n++
  }
  return n
}
