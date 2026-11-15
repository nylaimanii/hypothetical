// the life lessons ledger: data/lives/lessons.json. when a life ends, one llm call writes 1-3 lessons
// (choice -> what it led to -> a rule). the next chosen person gets the most relevant ones at each milestone.
// every lesson tracks whether lives that applied it beat their no-lessons twin (meanGain), so bad lessons sink.
import { z } from 'zod'
import { chat } from '../agent/llm'
import { livesFile, readJsonSafe, writeJsonAtomic } from './store'
import type { LifeLesson, LifeRecord, MilestoneKind } from './types'

export const readLessons = (): LifeLesson[] => readJsonSafe<LifeLesson[]>(livesFile('lessons.json')) ?? []
export const writeLessons = (l: LifeLesson[]) => writeJsonAtomic(livesFile('lessons.json'), l)

// relevance: same kind of milestone first, then shared tags, then the same part of the world, then lessons that
// have measurably helped. a lesson that keeps losing to the twin (meanGain < 0) falls out of the top 3
export function relevantLessons(all: LifeLesson[], kind: MilestoneKind, tags: string[], regionId: string, max = 3): LifeLesson[] {
  const tagSet = new Set(tags)
  return all
    .map(l => {
      let s = l.kind === kind ? 3 : 0
      s += l.tags.filter(t => tagSet.has(t)).length * 0.8
      if (l.regionId === regionId) s += 0.4
      if (l.meanGain !== null) s += Math.max(-3, Math.min(2, l.meanGain * 10))
      s += Math.log1p(l.timesApplied) * 0.2
      return { l, s }
    })
    .filter(x => x.s >= 1.6)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map(x => x.l)
}

// the situations a lesson can apply to (run.ts situationTags + option tags use the same words)
export const SITUATIONS = ['teen', 'young_adult', 'midlife', 'elder', 'poverty', 'wealth', 'famine', 'unrest', 'pandemic', 'disaster', 'migration', 'parent', 'illness', 'grief', 'education', 'money', 'health', 'friends', 'community', 'partner', 'children', 'helping', 'faith', 'risk', 'career', 'smoking', 'drinking', 'exercise', 'long_term']

const KINDS = ['childhood', 'schooling', 'path', 'habits', 'friends', 'first_job', 'move', 'partner', 'children', 'money', 'health', 'career', 'help_others', 'faith', 'protest', 'famine', 'pandemic', 'disaster', 'law', 'job_loss', 'illness', 'loss', 'parents', 'retirement', 'late_life', 'legacy'] as const

const LessonOut = z.object({
  lessons: z.array(z.object({
    kind: z.enum(KINDS),
    choice: z.string().min(3).max(160),
    ledTo: z.string().min(3).max(200),
    rule: z.string().min(5).max(160),
    tags: z.array(z.string().max(24)).max(5),
  })).min(1).max(3),
})

const SCHEMA = {
  type: 'object',
  properties: {
    lessons: {
      type: 'array', minItems: 1, maxItems: 3,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...KINDS] },
          choice: { type: 'string' }, ledTo: { type: 'string' }, rule: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind', 'choice', 'ledTo', 'rule', 'tags'],
        additionalProperties: false,
      },
    },
  },
  required: ['lessons'],
  additionalProperties: false, // groq strict mode needs it on every object
}

export function lifeStoryForLessons(r: LifeRecord): string {
  const s = r.score!
  const lines = [
    `${r.name}, born 2026 in ${r.birthplace.city}, ${r.birthplace.country}. family: ${r.family.story}.`,
    `died at ${r.deathAge} of ${r.deathCause}.`,
    `life score ${s.total.toFixed(3)} (healthy years ${s.healthyYears.toFixed(2)}, relationships ${s.relationships.toFixed(2)}, contribution ${s.contribution.toFixed(2)}, meaning ${s.meaning.toFixed(2)}, wellbeing ${s.wellbeing.toFixed(2)}${s.harm > 0 ? `, harm done to others ${s.harm.toFixed(0)}` : ''}).`,
    r.twin ? `the same person making the usual choices would have scored ${r.twin.score.total.toFixed(3)} and died at ${r.twin.deathAge}.` : '',
    'decisions:',
    ...r.milestones.map(m => `- age ${Math.floor(m.age)} (${m.kind}): ${m.question} chose "${m.options.find(o => o.id === m.choice)?.label}". then: ${m.outcome.join('; ')}`),
    'what happened to them:',
    ...r.events.filter(e => e.severity >= 0.5).slice(0, 25).map(e => `- ${2026 + Math.floor((e.tick + 10) / 12)}: ${e.text}`),
  ]
  return lines.filter(Boolean).join('\n')
}

export async function writeLifeLessons(r: LifeRecord): Promise<{ lessons: LifeLesson[]; byLlm: boolean }> {
  const story = lifeStoryForLessons(r)
  try {
    const raw = await chat({
      system: `you look back on one whole human life and write 1-3 lessons for the next person, who will be born somewhere else, maybe in another world. each lesson: the choice, what it led to (honestly, including luck), and a rule. rules must be general and work anywhere, like "leave before a famine reaches your city, not after" or "keep one close friend through every busy decade". never name a city, country, year, or anything specific to this world. tags: the situations the rule applies to, chosen from: ${SITUATIONS.join(', ')}. favor lessons about relationships, health, helping others and meaning, not only money. never suggest hurting or exploiting anyone. if bad luck, not a choice, decided the outcome, say so instead of inventing a rule. lowercase, plain words, no dashes.`,
      user: story,
      schema: SCHEMA, schemaName: 'life_lessons', temperature: 0.5, maxTokens: 700,
    })
    const parsed = LessonOut.parse(JSON.parse(raw))
    return { lessons: parsed.lessons.map((l, i) => toLesson(r, l, i)).map(l => generalize(l, r)), byLlm: true }
  } catch (e) {
    console.error(`[life lessons] llm failed (${(e as Error).message}), writing a rule-based lesson instead`)
    return { lessons: [ruleLesson(r)], byLlm: false }
  }
}

const clean = (s: string) => s.replace(/[\u2014\u2013]/g, ',').replace(/\s+/g, ' ').trim().toLowerCase()

// lessons must transfer: replace any place name the model slipped in, keep only known situation tags
function generalize(l: LifeLesson, r: LifeRecord): LifeLesson {
  const names = [...new Set(r.places.flatMap(p => [p.city, p.country]))].filter(n => n.length > 2)
  const scrub = (x: string) => names.reduce((a, n) => a.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'your city'), x).replace(/\b(19|20|21)\d\d\b/g, 'that year')
  const tags = l.tags.filter(t => (SITUATIONS as readonly string[]).includes(t))
  return { ...l, choice: scrub(l.choice), ledTo: scrub(l.ledTo), rule: scrub(l.rule), tags: tags.length ? tags : ['long_term'] }
}

function toLesson(r: LifeRecord, l: z.infer<typeof LessonOut>['lessons'][number], i: number): LifeLesson {
  return {
    id: `${r.lifeId}-l${i + 1}`, fromLifeId: r.lifeId, worldId: r.worldId, lifeNo: r.lifeNo, createdAt: new Date().toISOString(),
    kind: l.kind, choice: clean(l.choice), ledTo: clean(l.ledTo), rule: clean(l.rule), tags: l.tags.map(t => clean(t).replace(/\s+/g, '_')),
    regionId: r.birthplace.regionId, lifeScore: r.score!.total, timesGiven: 0, timesApplied: 0, meanGain: null,
    simVersion: r.worldVersion, verified: true,
  }
}

// fallback when the llm fails: the single decision whose option diverged most from the twin's default and is
// tagged with the weakest score part. clearly labeled as rule-made
function ruleLesson(r: LifeRecord): LifeLesson {
  const s = r.score!
  const weakest = (['relationships', 'contribution', 'meaning', 'wellbeing'] as const).reduce((a, b) => (s[b] < s[a] ? b : a))
  const m = r.milestones[r.milestones.length - 1]
  return {
    id: `${r.lifeId}-l1`, fromLifeId: r.lifeId, worldId: r.worldId, lifeNo: r.lifeNo, createdAt: new Date().toISOString(),
    kind: m?.kind ?? 'friends', choice: m ? m.options.find(o => o.id === m.choice)?.label ?? m.choice : 'kept to themselves',
    ledTo: `a life weakest in ${weakest} (${s[weakest].toFixed(2)})`, rule: `(rule-made) protect your ${weakest} early`, tags: [weakest],
    regionId: r.birthplace.regionId, lifeScore: s.total, timesGiven: 0, timesApplied: 0, meanGain: null,
    simVersion: r.worldVersion, verified: true,
  }
}

// after a life: credit the lessons it was given and applied, with the gain over its twin
export function creditLessons(all: LifeLesson[], r: LifeRecord): LifeLesson[] {
  const gain = r.score && r.twin ? r.score.total - r.twin.score.total : 0
  const given = new Set(r.lessonsGiven)
  const applied = new Set(r.milestones.map(m => m.lessonApplied).filter(Boolean) as string[])
  return all.map(l => {
    if (!given.has(l.id)) return l
    const out = { ...l, timesGiven: l.timesGiven + 1 }
    if (applied.has(l.id)) {
      out.timesApplied = l.timesApplied + 1
      out.meanGain = l.meanGain === null ? gain : l.meanGain + (gain - l.meanGain) / out.timesApplied
    }
    return out
  })
}
