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
import type { Lesson } from '../types'
import { readLessons } from './lessons'
import { readJson, readRunIndex, writeJson } from './store'
import { goodnessOf, readFeatures, type RunFeatures } from './steps'

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

export function computePlaybook(lessons: Lesson[], features: RunFeatures[], versionOf: (runId: string) => string, prev: Playbook | null, generation: number | null): Playbook {
  const good = goodnessOf(features)
  const pairs = pairsOf(features, versionOf)
  const before = new Map((prev?.lessons ?? []).map(l => [l.id, l.confidence]))
  const out: PlaybookLesson[] = lessons.map(l => {
    const t = testOf(l.rule)
    const base = { id: l.id, rule: l.rule, learnedFrom: l.fromRunId, generation: l.generation, mistake: l.mistake, testedAs: t?.text ?? null }
    if (!t) return { ...base, supported: 0, contradicted: 0, tests: 0, confidence: null, previous: null, trend: 'untested' as const, examples: [] }
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
    const s = tests.filter(x => x.supported).length, c = tests.length - s
    const confidence = conf(s, c)
    const p = before.get(l.id) ?? null
    const trend = p === null ? 'new' : confidence > p ? 'up' : confidence < p ? 'down' : 'same'
    return { ...base, supported: s, contradicted: c, tests: tests.length, confidence, previous: p, trend, examples: tests.slice(-6) }
  })
  // best supported first, untested last
  out.sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1) || b.tests - a.tests)
  return { computedAt: new Date().toISOString(), generation, worlds: features.length, pairs: pairs.length, lessons: out }
}

// after each generation: recompute over every real world's features and save
export function writePlaybook(generation: number | null): Playbook {
  const versions = new Map(readRunIndex().map(r => [r.runId, r.simVersion ?? '?']))
  const pb = computePlaybook(readLessons(), Object.values(readFeatures()), id => versions.get(id) ?? '?', readPlaybook(), generation)
  fs.mkdirSync(path.dirname(playbookFile()), { recursive: true })
  writeJson(playbookFile(), pb)
  return pb
}

// one line for a person: "ensure basic needs before space goals: 71% sure (5 of 7 a/b tests agree, up from 60%)"
export function lessonLine(l: PlaybookLesson): string {
  const rule = l.rule.replace(/[.\s]+$/, '').replace(/^./, c => c.toLowerCase())
  if (l.confidence === null) return `${rule}: not tested yet (no budget decision matches it)`
  if (!l.tests) return `${rule}: no a/b test yet (no two worlds on the same seed differed on it)`
  const was = l.previous !== null && l.previous !== l.confidence ? `, ${l.trend} from ${Math.round(l.previous * 100)}%` : ''
  return `${rule}: ${Math.round(l.confidence * 100)}% sure (${l.supported} of ${l.tests} a/b tests agree${was})`
}
