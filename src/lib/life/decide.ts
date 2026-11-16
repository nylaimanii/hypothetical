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
import { ageOf, livingKids, medianIncome, monthlyCosts, monthlyIncome, partnerOf, type Person } from './person'
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
// C's evolve opens a gap between worlds for lives (data/.ollama.gap, {until, pid}) whenever data/lives/now.json lists
// a running life: while it is open, nothing is waiting as far as a life is concerned
function evolveGapOpen(): boolean {
  try {
    const g = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', '.ollama.gap'), 'utf8')) as { until?: string }
    return Date.parse(g.until ?? '') > Date.now()
  } catch { return false }
}
function evolveHasWorldWaiting(): boolean {
  if (evolveGapOpen()) return false
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
      await sleep(3_000) // short, so a gap evolve opens between worlds (up to 60s) is never missed
    }
    waitedNote = false
  }
  // at most one ollama ticket per life process: calls queue here, one in flight at a time
  const prev = inFlight
  let done!: () => void
  inFlight = new Promise<void>(r => { done = r })
  await prev
  try {
    const release = await acquireOllamaLock('life-milestone', { priority: 9 }) // the lowest class: lives never jump ahead of evolve
    try { return await fn() } finally { release() }
  } finally { done() }
}
let inFlight: Promise<void> = Promise.resolve()

// everyone in the family by name and relation, so the reason never has to guess who someone is ("halima, my
// neighbor" when halima is the mother)
function familyLine(p: Person, partner: ReturnType<typeof partnerOf>): string {
  const alive = p.kin.filter(k => k.bornTick <= p.tick && (k.diedTick === undefined || k.diedTick > p.tick) && (k.relation !== 'partner' || k === partner))
  const word = (k: (typeof alive)[number]) => k.relation === 'sibling' ? (k.sex === 'female' ? 'sister' : 'brother') : k.relation === 'child' ? (k.sex === 'female' ? 'daughter' : 'son') : k.relation
  const age = (k: (typeof alive)[number]) => Math.floor((p.tick - k.bornTick) / 12)
  const lost = p.kin.filter(k => k.diedTick !== undefined && k.diedTick <= p.tick && k.relation !== 'grandchild').map(k => `${word(k)} ${k.name} (died)`)
  const now = alive.filter(k => k.relation !== 'grandchild').map(k => `${word(k)} ${k.name} (${age(k)})`)
  const g = alive.filter(k => k.relation === 'grandchild').length
  return [...now, ...lost, ...(g ? [`${g} grandchild${g === 1 ? '' : 'ren'}`] : []), ...(partner ? [] : ['no partner'])].join(', ') + '. use these names and relations exactly'
}

// her own month in this world, in dollars: what she earns, what the basics cost at today's prices, what is left, and
// how long her savings would last. the same numbers the monthly step uses (person.ts), so an option's real cost is
// what it would be for her, here, now
function moneyLine(p: Person, env: MonthEnv): string {
  const inc = monthlyIncome(p, env), cost = monthlyCosts(p, env, inc), left = inc - cost
  const months = cost > 0 ? p.savings / cost : 0
  return `you bring in about $${Math.round(inc)} a month; food, rent and the basics cost about $${Math.round(cost)} at today's prices (most people here earn about $${Math.round(medianIncome(env))}), so ${left >= 0 ? `$${Math.round(left)} is left over` : `you are $${Math.round(-left)} short every month`}. ${p.savings < 0 ? `you owe $${Math.round(-p.savings)}` : `your savings would last ${months < 1 ? 'less than a month' : `about ${Math.round(months)} months`}`}.`
}

// how much room her month leaves, said the way it is: short, tight, or with room to spare. (d2 told every life that
// money was short, so a saver in lima chose like a debtor in rio)
export function roomLine(p: Person, env: MonthEnv): string {
  const inc = monthlyIncome(p, env)
  return roomWords(inc, monthlyCosts(p, env, inc), p.savings)
}
export function roomWords(inc: number, cost: number, savings: number): string {
  const left = inc - cost
  const months = cost > 0 ? savings / cost : 0
  if (left < 0 || savings < 0) return 'money is short for you right now: what costs money or hours often loses, even if it is the "right" thing.'
  if (months >= 6 && left >= 0.1 * cost) return 'you have some room right now: an option that costs money or hours is within your reach, if it is what you want.'
  return 'money is tight but you are getting by: a small cost is possible, a big one is a real risk.'
}

// what the llm is given to decide with. bump it when the inputs change, so lives are only compared with lives that
// were decided the same way (tests/consistency/life/decisions.test.ts)
// d2: her month in dollars, every relative by name, the realism line, no example diary line
// d3: the room line follows her real month; lessons only from the same kind of decision, a helped lesson lifts little
export const DECIDE_VERSION = 'd3'

// ---------- the llm call ----------
const clean = (s: string) => s.replace(/[\u2014\u2013]/g, ',').replace(/\s+/g, ' ').trim()

export async function decideLlm(p: Person, env: MonthEnv, question: string, opts: Option[], lessons: LifeLesson[], world: string | undefined, brief?: string): Promise<Decision> {
  const age = Math.floor(ageOf(p))
  const partner = partnerOf(p)
  const kids = livingKids(p)
  const ids = opts.map(o => o.id)
  const lessonIds = lessons.map(l => l.id)
  const who = [
    `you are ${p.name}, ${age}, ${p.sex}, living in ${p.place.city}, ${p.place.country}, in ${env.year}.`,
    `temperament: ${temperamentWords(p.temperament)}.`,
    `${p.job ? `work: ${p.job.title}, about $${Math.round(p.lastIncome)} a month` : p.retired ? 'retired' : p.inSchool ? 'in school' : 'no job'}; ${p.savings < 0 ? `$${Math.round(-p.savings)} in debt` : `$${Math.round(p.savings)} saved`}; ${p.schoolYears.toFixed(0)} years of school.`,
    `family: ${familyLine(p, partner)}. health ${Math.round(p.health * 100)}/100${p.chronic.length ? ` (${p.chronic.join(', ')})` : ''}. habits: ${[...p.habits].join(', ') || 'none'}.`,
    p.marks ? `childhood left: ${p.marks.hungerMonths > 6 ? 'hungry years, ' : ''}${p.marks.displaced ? 'losing a home, ' : ''}${p.marks.lostParent ? 'losing a parent, ' : ''}${p.marks.stableHome > 0.7 ? 'a stable home, ' : ''}trust in others ${Math.round(p.marks.trust * 100)}/100.` : '',
    `the world here: food ${env.food < 0.85 ? 'short' : 'enough'}, prices ${env.prices.toFixed(1)}x normal, unrest ${env.unrest > 0.45 ? 'high' : 'normal'}, life expectancy ${env.lifeExpectancy.toFixed(0)}${world ? `. right now: ${world}` : ''}.`,
    `your month: ${moneyLine(p, env)}`,
    brief ? `what this means for this decision, where you live:\n${brief}` : '',
  ].filter(Boolean).join('\n')
  const lessonText = lessons.length
    ? `things people who lived before you learned (wisdom you half remember; your temperament decides how much you trust it):\n${lessons.map(l => `[${l.id}] ${l.rule} (they chose: ${l.choice}; it led to: ${l.ledTo})${l.verified ? '' : ' (from an older world, unconfirmed)'}`).join('\n')}`
    : 'no advice from earlier lives applies here.'
  // (the options cost different things in different worlds: a tenth of $40 is not a tenth of $900, a week of evenings
  // is not free when you are $60 short. the choice is made inside her month, not in the abstract)
  const real = `you want a good life, but you can only choose what your month allows. weigh what each option really costs you here and now: money, hours, energy, and what the people around you expect. ${roomLine(p, env)}`
  const user = `${who}\n\n${lessonText}\n\n${real}\n\ndecision: ${question}\noptions:\n${opts.map(o => `- ${o.id}: ${o.label}`).join('\n')}\n\nchoose one option id. reasoning: why, in a few plain words, the way you'd say it to a friend. thought: one line from your private diary that day, about your own day: plain and specific, the way real people write (the people above by name, money, your body, the place, what happened). no big statements, no plans, no "i will", nothing inspirational. lessonApplied: the id of the lesson that shaped your choice, or none.`
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
