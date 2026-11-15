// the learning loop on C's side: data/lessons.json (read by B's governor at the start of every world),
// repeat-mistake detection, and the learning curve in data/learning.json.
import path from 'node:path'
import type { Lesson, RunSummary } from '../types'
import { readJson, writeJson } from './store'
import { versionedPath } from './version'

const lessonsFile = () => path.join(process.cwd(), 'data', 'lessons.json')
const learningFile = (v?: string | null) => versionedPath('learning.json', v)

export type LearningRow = {
  simVersion?: string
  generation: number
  // the seed agent this row's worlds descend from; absent on the whole-generation row
  lineage?: string
  bestScore: number
  lessonsKnown: number
  // deaths whose cause matches a lesson that already existed when the world died
  repeatMistakeRate: number
  worlds: number
  deaths: number
  repeatDeaths: number
  goalAchieved: number
  champion?: string
  at: string
}
export type LearningFile = { worldsRun: number; rows: LearningRow[] }

export function readLessons(): Lesson[] {
  const raw = readJson<Lesson[] | { lessons: Lesson[] }>(lessonsFile())
  return Array.isArray(raw) ? raw : raw?.lessons ?? []
}

export function readLearning(v?: string | null): LearningFile {
  return readJson<LearningFile>(learningFile(v)) ?? { worldsRun: 0, rows: [] }
}
export function writeLearning(l: LearningFile) {
  writeJson(learningFile(), l)
}

const STOP = new Set('the a an and or of to in on for with by at from is are was were be been it its this that these those as into than then when while before after over under every all any each not no'.split(' '))
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)))
function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  return inter / (a.size + b.size - inter)
}

// coarse failure categories, so "the world starved" and "food supply under survival" count as the same mistake
const CATEGORIES: [string, RegExp][] = [
  ['food', /famine|starv|food|kcal|harvest|hunger/i],
  ['revolt', /revolt|riot|unrest|uprising|rebellion|fell apart|protest/i],
  ['war', /\bwar\b|crackdown|military|armed/i],
  ['disease', /pandemic|disease|epidemic|plague|outbreak/i],
  ['energy', /energy|blackout|power grid|electric/i],
  ['population', /population|births|fertility|mortality|collapse/i],
]
export function categoryOf(text: string): string | null {
  return CATEGORIES.find(([, re]) => re.test(text))?.[0] ?? null
}

// does this death repeat a mistake an existing lesson already warned about?
export function matchesKnownLesson(cause: string | undefined, known: Lesson[]): Lesson | null {
  if (!cause) return null
  const cat = categoryOf(cause)
  const cw = words(cause)
  let best: { l: Lesson; s: number } | null = null
  for (const l of known) {
    const s = jaccard(cw, words(l.consequence)) + (cat && categoryOf(`${l.consequence} ${l.mistake}`) === cat ? 0.5 : 0)
    if (s >= 0.5 && (!best || s > best.s)) best = { l, s }
  }
  return best?.l ?? null
}

// merges new lessons into data/lessons.json. a lesson whose rule is close to an existing one bumps that
// lesson's timesRelevant instead of adding a duplicate. returns the lessons that were actually added.
export function mergeLessons(incoming: Lesson[]): { added: Lesson[]; bumped: Lesson[]; total: number } {
  const all = readLessons()
  const added: Lesson[] = []
  const bumped: Lesson[] = []
  for (const l of incoming) {
    const lw = words(l.rule)
    const dup = all.find(x => x.id === l.id || jaccard(lw, words(x.rule)) >= 0.6)
    if (dup) { dup.timesRelevant++; bumped.push(dup) }
    else { const n = { ...l, timesRelevant: Math.max(1, l.timesRelevant) }; all.push(n); added.push(n) }
  }
  writeJson(lessonsFile(), all)
  return { added, bumped, total: all.length }
}

// the lessons a mutation prompt should see: those about the parent's failure category first, then the most proven
export function lessonsForPrompt(runs: RunSummary[], n = 8): Lesson[] {
  const all = readLessons()
  const cats = new Set(runs.map(r => categoryOf(r.causeOfDeath ?? '')).filter(Boolean))
  return [...all]
    .map(l => ({ l, s: (cats.has(categoryOf(`${l.consequence} ${l.mistake}`)) ? 10 : 0) + Math.log1p(l.timesRelevant) }))
    .sort((a, b) => b.s - a.s || a.l.id.localeCompare(b.l.id))
    .slice(0, n)
    .map(x => x.l)
}
