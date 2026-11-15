// one milestone decision. adults (16+) decide through one llm call via B's client; children's milestones are
// decided by their parents from the family's situation (rules); the no-lessons twin always takes the rule choice.
//
// ollama etiquette (lowest priority on this machine): before every single call, wait until C's evolve has no world
// waiting, then take the shared lock for that one call only and release it right after.
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { acquireOllamaLock, chat, provider } from '../agent/llm'
import type { MonthEnv } from './env'
import type { Option } from './milestones'
import { ageOf, livingKids, partnerOf, type Person } from './person'
import type { LifeLesson, Temperament } from './types'

export type Decision = { choice: string; reasoning: string; thought: string; lessonApplied: string | null; decidedBy: 'llm' | 'rule' | 'parents' }

// ---------- temperament ----------
const TAG_AFFINITY: Record<string, (t: Temperament) => number> = {
  risk: t => (t.openness - 0.5) - (t.neuroticism - 0.5),
  move: t => (t.openness - 0.5),
  migration: t => (t.openness - 0.5) - 0.5 * (t.neuroticism - 0.5),
  business: t => (t.openness - 0.5) + 0.5 * (t.extraversion - 0.5),
  friends: t => (t.extraversion - 0.5),
  community: t => (t.extraversion - 0.5) + 0.5 * (t.agreeableness - 0.5),
  helping: t => (t.agreeableness - 0.5),
  long_term: t => (t.conscientiousness - 0.5),
  health: t => (t.conscientiousness - 0.5),
  exercise: t => (t.conscientiousness - 0.5),
  education: t => (t.conscientiousness - 0.5) + 0.5 * (t.openness - 0.5),
  safety: t => (t.neuroticism - 0.5),
  stability: t => (t.neuroticism - 0.5) - 0.5 * (t.openness - 0.5),
  smoking: t => -(t.conscientiousness - 0.5),
  drinking: t => -(t.conscientiousness - 0.5) + 0.5 * (t.extraversion - 0.5),
  harm: t => -(t.agreeableness - 0.5) * 2 - 0.6, // most people do not exploit others when it's a clear choice
}

// the rule choice: the usual choice in that situation (the option's default flag), shaded by temperament
export function ruleChoice(opts: Option[], t: Temperament): Option {
  let best = opts[0], bestS = -Infinity
  for (const o of opts) {
    const s = (o.default ? 1 : 0) + 0.8 * o.tags.reduce((a, tag) => a + (TAG_AFFINITY[tag]?.(t) ?? 0), 0)
    if (s > bestS) { best = o; bestS = s }
  }
  return best
}

export function temperamentWords(t: Temperament): string {
  const w: string[] = []
  const lvl = (x: number, hi: string, lo: string) => { if (x > 0.65) w.push(hi); else if (x < 0.35) w.push(lo) }
  lvl(t.openness, 'curious and drawn to new things', 'prefers the familiar')
  lvl(t.conscientiousness, 'careful and disciplined', 'impulsive, lives in the moment')
  lvl(t.extraversion, 'outgoing, needs people', 'quiet, needs time alone')
  lvl(t.agreeableness, 'warm and trusting', 'blunt and guarded')
  lvl(t.neuroticism, 'anxious, feels setbacks hard', 'calm under pressure')
  return w.length ? w.join('; ') : 'even-tempered, nothing extreme'
}

// ---------- ollama priority ----------
function evolveHasWorldWaiting(): boolean {
  try {
    const now = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'evolve-now.json'), 'utf8')) as { pid?: number; queue?: unknown[]; updatedAt?: string; lastHeartbeat?: string; running?: boolean }
    if (now.running === false) return false
    const beat = Date.parse(now.lastHeartbeat ?? now.updatedAt ?? '')
    const fresh = Number.isFinite(beat) && Date.now() - beat < 5 * 60_000
    let alive = fresh
    if (now.pid) { try { process.kill(now.pid, 0); alive = true } catch { alive = false } }
    return alive && (now.queue?.length ?? 0) > 0
  } catch { return false }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
let waitedNote = false
export async function politeLlm<T>(fn: () => Promise<T>): Promise<T> {
  if (provider() === 'ollama') {
    while (evolveHasWorldWaiting()) {
      if (!waitedNote) { console.error('[life] evolve has a world waiting, yielding ollama'); waitedNote = true }
      await sleep(15_000)
    }
    waitedNote = false
  }
  const release = await acquireOllamaLock('life-milestone')
  try { return await fn() } finally { release() }
}

// ---------- the llm call ----------
const clean = (s: string) => s.replace(/[\u2014\u2013]/g, ',').replace(/\s+/g, ' ').trim()

export async function decideLlm(p: Person, env: MonthEnv, question: string, opts: Option[], lessons: LifeLesson[], world: string | undefined): Promise<Decision> {
  const age = Math.floor(ageOf(p))
  const partner = partnerOf(p)
  const kids = livingKids(p)
  const ids = opts.map(o => o.id)
  const lessonIds = lessons.map(l => l.id)
  const who = [
    `you are ${p.name}, ${age}, ${p.sex}, living in ${p.place.city}, ${p.place.country}, in ${env.year}.`,
    `temperament: ${temperamentWords(p.temperament)}.`,
    `${p.job ? `work: ${p.job.title}, about $${Math.round(p.lastIncome)} a month` : p.retired ? 'retired' : p.inSchool ? 'in school' : 'no job'}; ${p.savings < 0 ? `$${Math.round(-p.savings)} in debt` : `$${Math.round(p.savings)} saved`}; ${p.schoolYears.toFixed(0)} years of school.`,
    `family: ${partner ? `partner ${partner.name}` : 'no partner'}${kids.length ? `, ${kids.length} ${kids.length === 1 ? 'child' : 'children'}` : ''}. health ${Math.round(p.health * 100)}/100${p.chronic.length ? ` (${p.chronic.join(', ')})` : ''}. habits: ${[...p.habits].join(', ') || 'none'}.`,
    p.marks ? `childhood left: ${p.marks.hungerMonths > 6 ? 'hungry years, ' : ''}${p.marks.displaced ? 'losing a home, ' : ''}${p.marks.lostParent ? 'losing a parent, ' : ''}${p.marks.stableHome > 0.7 ? 'a stable home, ' : ''}trust in others ${Math.round(p.marks.trust * 100)}/100.` : '',
    `the world here: food ${env.food < 0.85 ? 'short' : 'enough'}, prices ${env.prices.toFixed(1)}x normal, unrest ${env.unrest > 0.45 ? 'high' : 'normal'}, life expectancy ${env.lifeExpectancy.toFixed(0)}${world ? `. right now: ${world}` : ''}.`,
  ].filter(Boolean).join('\n')
  const lessonText = lessons.length
    ? `things people who lived before you learned (wisdom you half remember; your temperament decides how much you trust it):\n${lessons.map(l => `[${l.id}] ${l.rule} (they chose: ${l.choice}; it led to: ${l.ledTo})${l.verified ? '' : ' (from an older world, unconfirmed)'}`).join('\n')}`
    : 'no advice from earlier lives applies here.'
  const user = `${who}\n\n${lessonText}\n\ndecision: ${question}\noptions:\n${opts.map(o => `- ${o.id}: ${o.label}`).join('\n')}\n\nchoose one option id. reasoning: one short sentence in your own voice. thought: one journal line, first person, lowercase. lessonApplied: the id of the lesson that shaped your choice, or none.`
  const schema = {
    type: 'object',
    properties: {
      choice: { type: 'string', enum: ids },
      reasoning: { type: 'string' },
      thought: { type: 'string' },
      lessonApplied: { type: 'string', enum: [...lessonIds, 'none'] },
    },
    required: ['choice', 'reasoning', 'thought', 'lessonApplied'],
    additionalProperties: false, // groq strict mode needs it on every object
  }
  const Out = z.object({ choice: z.enum(ids as [string, ...string[]]), reasoning: z.string().min(2).max(400), thought: z.string().min(2).max(300), lessonApplied: z.string() })
  const raw = await politeLlm(() => chat({
    system: 'you are one ordinary human living one life, in a real place, deciding for yourself. you want the best life a person can have: healthy years, deep relationships, helping others, meaning, and feeling well. money only matters for what it does. you would not hurt or exploit anyone. you only know what someone in your place and time could know. answer as json.',
    user, schema, schemaName: 'milestone', temperature: 0.6, maxTokens: 300, timeoutMs: 600_000,
  }))
  const out = Out.parse(JSON.parse(raw))
  return {
    choice: out.choice, reasoning: clean(out.reasoning).toLowerCase(), thought: clean(out.thought).toLowerCase(),
    lessonApplied: lessonIds.includes(out.lessonApplied) ? out.lessonApplied : null, decidedBy: 'llm',
  }
}
