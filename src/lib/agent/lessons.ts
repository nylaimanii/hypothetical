// lessons: what one world's death teaches the next governors.
// extractLessons reads a finished run and writes 1-3 lessons with one llm call (fallback: a rule-based lesson).
// relevantLessons picks the most relevant known lessons for the current situation (data/lessons.json, kept by C).
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { Lesson, RunRecord } from '../types'
import { chat, groqAvailable } from './groq'

const MODEL = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']

const LessonSchema = z.object({ lessons: z.array(z.object({ mistake: z.string().min(5).max(300), consequence: z.string().min(5).max(300), rule: z.string().min(5).max(160) })).min(1).max(3) })

export async function extractLessons(record: RunRecord): Promise<Lesson[]> {
  const make = (l: { mistake: string; consequence: string; rule: string }, i: number): Lesson => ({
    id: `${record.runId}-l${i}`, fromRunId: record.runId, generation: record.generation,
    mistake: clean(l.mistake), consequence: clean(l.consequence), rule: clean(l.rule), timesRelevant: 0,
  })
  const decisions = record.frames.filter(f => f.decision).slice(-6).map(f => ({ date: f.date, rationale: f.decision!.rationale.slice(0, 600), laws: f.decision!.laws.map(l => `${l.title} (support ${l.support.toFixed(2)})`), budget: f.decision!.budget, religionPolicy: f.decision!.religionPolicy }))
  const events = record.frames.flatMap(f => f.newEvents).filter(e => e.severity >= 0.3).slice(-40).map(e => `${e.kind}: ${e.text}`)
  if (groqAvailable()) {
    try {
      const raw = await chat({
        model: MODEL, json: true, temperature: 0.3, maxTokens: 3000,
        system: 'You review a failed or finished simulated world run by an AI world government. Write 1 to 3 lessons for future governors. Each: mistake (what the governor did), consequence (what the simulation did as a result, grounded only in the events given), rule (one imperative line, max 20 words). No em-dashes. Return JSON {"lessons":[{"mistake":"","consequence":"","rule":""}]}.',
        user: JSON.stringify({ status: record.summary.status, endDate: record.summary.endDate, causeOfDeath: record.summary.causeOfDeath ?? null, decisions, events }),
      })
      return LessonSchema.parse(JSON.parse(raw)).lessons.map(make)
    } catch { /* fall through */ }
  }
  return [make(fallbackLesson(record), 0)]
}

function clean(s: string) { return s.replace(/[—–]/g, ', ').trim() }

function fallbackLesson(r: RunRecord): { mistake: string; consequence: string; rule: string } {
  const cause = r.summary.causeOfDeath ?? ''
  const last = r.frames.filter(f => f.decision).slice(-1)[0]?.decision
  if (/food|starv|famine/i.test(cause)) return { mistake: `kept food at ${Math.round((last?.budget.food ?? 0) * 100)}% of the budget while supply fell`, consequence: cause, rule: 'raise food spending before supply drops under 2,100 kcal anywhere' }
  if (/revolt/i.test(cause)) return { mistake: 'enacted laws the regions rejected and kept them', consequence: cause, rule: 'repeal laws under 30% support before regions tip into revolt' }
  if (/war/i.test(cause)) return { mistake: 'answered revolts with crackdowns', consequence: cause, rule: 'never raise security spending against a region already in revolt' }
  if (/population/i.test(cause)) return { mistake: 'let mortality outrun births', consequence: cause, rule: 'protect welfare and food first, then fund the frontier' }
  return { mistake: 'spread research thin across every track', consequence: `the world reached ${r.summary.frontier} by ${r.summary.endDate}`, rule: 'focus research on the next frontier milestone and its prerequisites' }
}

// ---------- relevance ----------
export function loadLessons(): Lesson[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'lessons.json'), 'utf8')) as Lesson[] | { lessons: Lesson[] }
    return Array.isArray(raw) ? raw : raw.lessons ?? []
  } catch { return [] }
}

// keyword overlap between the lesson and a description of the current situation, plus how often it proved relevant
export function relevantLessons(all: Lesson[], situation: string[], n = 10): Lesson[] {
  const sit = new Set(situation.flatMap(s => s.toLowerCase().split(/\W+/)).filter(x => x.length > 3))
  return all
    .map(l => {
      const words = `${l.mistake} ${l.consequence} ${l.rule}`.toLowerCase().split(/\W+/).filter(x => x.length > 3)
      const overlap = words.filter(x => sit.has(x)).length
      return { l, s: overlap + 0.3 * Math.log1p(l.timesRelevant) }
    })
    .sort((a, b) => b.s - a.s || a.l.id.localeCompare(b.l.id))
    .slice(0, n).map(x => x.l)
}
