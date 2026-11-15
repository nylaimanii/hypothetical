// the governor: llama-3.3-70b on groq. it only chooses policy. zod validates every decision, budget is
// normalized to 1, every override since the last decision must be acknowledged. 2 retries, then the
// last decision is reused. with no GROQ_API_KEY the deterministic offline governor decides instead.
import { z } from 'zod'
import type { Decision, Override } from '../types'
import { normalizeBudget, type World } from '../sim/state'
import { buildBrief } from './brief'
import { offlineDecision } from './fallback'
import { chat, groqAvailable } from './groq'

const MODEL = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']
const REGION_IDS = ['na', 'latam', 'europe', 'rus_ca', 'mideast', 'nafrica', 'ssa', 'sasia', 'easia', 'seasia', 'oceania', 'carib_pac'] as const

const num = z.coerce.number().refine(Number.isFinite)
const DecisionSchema = z.object({
  laws: z.array(z.object({
    title: z.string().min(3).max(120),
    text: z.string().min(10).max(1200),
    layer: z.enum(['physics', 'biology', 'government', 'economy', 'tech', 'religion', 'media', 'family']),
  })).max(5).default([]),
  repeal: z.array(z.string()).default([]),
  migrations: z.array(z.object({ from: z.enum(REGION_IDS), to: z.enum(REGION_IDS), people: num.min(0), reason: z.string().max(300).default('') })).max(6).default([]),
  budget: z.object({ food: num.min(0), energy: num.min(0), education: num.min(0), space: num.min(0), security: num.min(0), welfare: num.min(0), research: num.min(0) }),
  religionPolicy: z.enum(['free', 'state_neutral', 'state_faith', 'discouraged']),
  schoolPolicy: z.object({ purpose: z.string().min(3).max(300), curriculum: z.array(z.string().max(60)).min(1).max(12), yearsRequired: num.min(0).max(16) }),
  rationale: z.string().min(10).max(2500),
  respondedToOverrides: z.array(z.string()).default([]),
})

export function systemPrompt(constitution: string): string {
  return `You are the sole government of Earth, starting 2026-11. One decision per simulated year.

CONSTITUTION (your values, follow it):
${constitution}

RULES OF THE WORLD (enforced by code, you cannot change them):
- You cannot break physics. You only choose policy: budget fractions, laws (title + text + layer), repeals, migration orders, religion policy, school policy. The simulation computes every outcome.
- Budget is 7 fractions of world government revenue (about 30% of world GDP) and is normalized to sum to 1. Welfare funds health and social protection; cutting it raises mortality and unrest.
- Electricity consumption can never exceed generating capacity. New capacity costs about $1.8B per GW and takes 3 years to come online.
- Food per person depends on energy, the food budget and population. Below 1,800 kcal per person per day people die and revolt.
- People resist bad laws. Each region supports or rejects each law based on its faith, education, income and unrest. Low support means low compliance: the law is mostly ignored and unrest rises. Coercive laws, taxes on rich regions, and religion policy that clashes with local faith cause backlash. Regions in long revolt may secede. Crackdowns can escalate to war.
- School policy changes education only after 10+ years.
- Migration orders cost money, take 6 months, raise unrest on both sides, and only as many people move as comply.
- The moon program goes orbital -> heavy_lift -> life_support -> lander -> crewed_landing. Each stage needs global techLevel, real stage spending, minimum development time, and a test flight that can fail. Space spending above the yearly useful maximum is wasted. Research raises tech and lowers failure odds. A failed crewed landing kills the crew.
- The world ends in destruction if population falls 40% from peak, 3+ regions stay in revolt 24 months, world food stays under 1,800 kcal for 12 months, or war reaches full severity.

GOAL: a crewed moon landing while keeping civilization alive. Earlier is better, but a dead world scores nothing.

A HUMAN OBSERVER may veto your laws, inject events, or force your budget. These appear in overridesSinceLastDecision. You must respond to each one: list every override id in respondedToOverrides and explain your response in the rationale. Do not re-enact a vetoed law under the same title.

Reply with JSON only:
{"laws":[{"title":"","text":"","layer":"physics|biology|government|economy|tech|religion|media|family"}],"repeal":["law id"],"migrations":[{"from":"region id","to":"region id","people":0,"reason":""}],"budget":{"food":0,"energy":0,"education":0,"space":0,"security":0,"welfare":0,"research":0},"religionPolicy":"free|state_neutral|state_faith|discouraged","schoolPolicy":{"purpose":"","curriculum":[""],"yearsRequired":12},"rationale":"first person, plain words, no em-dashes","respondedToOverrides":["override id"]}
At most 5 new laws per year. Region ids: ${REGION_IDS.join(', ')}.`
}

export type GovernorMemory = { last?: Decision; vetoedTitles: Set<string> }

export async function decide(w: World, constitution: string, overrides: Override[], mem: GovernorMemory): Promise<Decision> {
  const brief = buildBrief(w, overrides, mem.last?.rationale)
  const ids = overrides.map(o => o.id)
  if (!groqAvailable()) return finish(offlineDecision(brief, overrides, mem.vetoedTitles), w)

  const system = systemPrompt(constitution)
  let user = JSON.stringify(brief)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await chat({ model: MODEL, system, user, json: true, temperature: 0.5, maxTokens: 8000 })
      const parsed = DecisionSchema.parse(JSON.parse(raw))
      const missing = ids.filter(id => !parsed.respondedToOverrides.includes(id))
      if (missing.length) throw new Error(`respondedToOverrides is missing override ids: ${missing.join(', ')}`)
      const d: Decision = {
        tick: w.tick,
        laws: parsed.laws.filter(l => !mem.vetoedTitles.has(l.title.toLowerCase())).map(l => ({ ...l, id: '', enactedTick: w.tick, support: 0, compliance: 0 })),
        repeal: parsed.repeal.filter(id => w.laws.some(l => l.id === id)),
        migrations: parsed.migrations.filter(m => m.from !== m.to).map(m => ({ ...m, people: Math.floor(m.people) })),
        budget: parsed.budget,
        religionPolicy: parsed.religionPolicy,
        schoolPolicy: { ...parsed.schoolPolicy, yearsRequired: Math.round(parsed.schoolPolicy.yearsRequired) },
        rationale: parsed.rationale.replace(/[—–]/g, ', '),
        respondedToOverrides: parsed.respondedToOverrides.filter(id => ids.includes(id)),
      }
      return finish(d, w)
    } catch (e) {
      user = `${JSON.stringify(brief)}\n\nYOUR PREVIOUS REPLY WAS REJECTED: ${(e as Error).message.slice(0, 600)}\nReply again with valid JSON only.`
    }
  }
  // two retries failed: keep governing with the last decision (no new laws, no new migrations)
  const base = mem.last ?? offlineDecision(brief, overrides, mem.vetoedTitles)
  return finish({
    ...base, tick: w.tick, laws: mem.last ? [] : base.laws, repeal: [], migrations: [],
    rationale: `fallback: the model gave no valid decision after 2 retries, so last year's policy stands. ${base.rationale}`.slice(0, 2500),
    respondedToOverrides: ids,
  }, w)
}

function finish(d: Decision, w: World): Decision {
  const b = normalizeBudget(d.budget)
  for (const k of Object.keys(b) as (keyof typeof b)[]) b[k] = Math.round(b[k] * 1e6) / 1e6
  return { ...d, tick: w.tick, budget: b }
}
