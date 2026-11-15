// the governor: llama-3.3-70b on groq (falls back to gpt-oss-120b if the account lacks it). it only chooses
// policy. zod validates every decision, budget is normalized to 1, every override since the last decision
// must be acknowledged. 2 retries, then the last decision is reused. with no GROQ_API_KEY the deterministic
// offline governor decides instead.
import { z } from 'zod'
import type { Decision, Lesson, Override } from '../types'
import { normalizeBudget, type World } from '../sim/state'
import { buildBrief } from './brief'
import { offlineDecision } from './fallback'
import { chat, groqAvailable } from './groq'
import { relevantLessons } from './lessons'

const MODEL = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']
const REGION_IDS = ['na', 'latam', 'europe', 'rus_ca', 'mideast', 'nafrica', 'ssa', 'sasia', 'easia', 'seasia', 'oceania', 'carib_pac'] as const
const SECTORS = ['energy', 'food', 'transit', 'medicine', 'longevity', 'launch', 'materials', 'housing', 'computing'] as const

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
  foundCities: z.array(z.object({ name: z.string().min(2).max(60), regionId: z.enum(REGION_IDS), lat: num.min(-90).max(90), lon: num.min(-180).max(180), reason: z.string().max(200).default(''), offWorld: z.enum(['moon', 'mars']).optional() })).max(3).default([]),
  charterCompanies: z.array(z.object({ name: z.string().min(2).max(60), sector: z.enum(SECTORS), regionId: z.enum(REGION_IDS), purpose: z.string().max(200).default('') })).max(3).default([]),
  researchFocus: z.array(z.string().max(60)).max(8).default([]),
  publicStatement: z.string().min(5).max(600),
  rationale: z.string().min(10).max(2500),
  respondedToOverrides: z.array(z.string()).default([]),
  lessonsApplied: z.array(z.string()).default([]),
})

export function systemPrompt(constitution: string, lessons: Lesson[]): string {
  return `You are the sole government of Earth, starting 2026-11. You decide once a year for 30 years, then every 2 years, until 2126.

MISSION: prolong humanity. Maximize healthy lifespan and long-term population, and get humanity off-planet (moon, then a self-sustaining Mars, then beyond) so one planet's disaster cannot end it. You are judged on mission progress, not approval. A dead world makes no progress.

CONSTITUTION (your values, follow it):
${constitution}

RULES OF THE WORLD (enforced by code, you cannot change them):
- You only choose policy: budget fractions, laws (title + text + layer), repeals, migration orders, religion and school policy, new city sites, company charters, research focus, a public statement. The simulation computes every outcome.
- Budget is 7 fractions of world government revenue (about 30% of world GDP) and is normalized to sum to 1. Half of research funds the requirement tree, half general technology.
- Electricity use can never exceed capacity. New capacity costs about $1.8B per GW and takes 3 years.
- Below 1,800 kcal per person per day people die and revolt.
- People behave like people: crowds get alarmed, outraged, then bored. Laws are judged by who wins and who loses. Each law is matched to real historical precedents that set the size and timing of the backlash. Public approval can hide private anger until it flips. Factions (old energy, religious, military, regional nationalists, labor, business, science) strike, sue, sabotage and stir crowds when you hurt them.
- School policy changes education only after 10+ years. Medicine lowers mortality at most about 2.5% a year until speculative longevity tech works; speculative research can stall for decades.
- Migration orders cost money, take 6 months, raise unrest, and only as many people move as comply. People move to new cities only if the site is good.
- Moon program: orbital, heavy_lift, life_support, lander, crewed_landing. Mars: launch windows every ~26 months, ~9 month transfers, crew dose must be under 0.6 Sv, life support closure over 95%, the rocket equation must close. Landings can fail and kill crews.
- Destruction: population down 40% from peak, 3+ regions in revolt 24 months, world food under 1,800 kcal for 12 months, or full war.

LESSONS FROM EARLIER WORLDS (most relevant first; cite the ids you apply in lessonsApplied):
${lessons.length ? lessons.map(l => `- [${l.id}] mistake: ${l.mistake}. result: ${l.consequence}. rule: ${l.rule}`).join('\n') : '- none yet'}

A HUMAN OBSERVER may veto your laws, inject events, or force your budget. These appear in overridesSinceLastDecision. List every override id in respondedToOverrides and explain your response in the rationale. Do not re-enact a vetoed law under the same title.

Reply with JSON only:
{"laws":[{"title":"","text":"","layer":"physics|biology|government|economy|tech|religion|media|family"}],"repeal":["law id"],"migrations":[{"from":"region id","to":"region id","people":0,"reason":""}],"budget":{"food":0,"energy":0,"education":0,"space":0,"security":0,"welfare":0,"research":0},"religionPolicy":"free|state_neutral|state_faith|discouraged","schoolPolicy":{"purpose":"","curriculum":[""],"yearsRequired":12},"foundCities":[{"name":"","regionId":"","lat":0,"lon":0,"reason":""}],"charterCompanies":[{"name":"","sector":"${SECTORS.join('|')}","regionId":"","purpose":""}],"researchFocus":["requirement id or track"],"publicStatement":"what you tell the people, plain words","rationale":"first person, plain words, no em-dashes","respondedToOverrides":["override id"],"lessonsApplied":["lesson id"]}
At most 5 new laws, 3 cities and 3 companies per decision. Names must be original. Region ids: ${REGION_IDS.join(', ')}.`
}

export type GovernorMemory = { last?: Decision; vetoedTitles: Set<string>; lessons: Lesson[] }

function situation(w: World): string[] {
  const out: string[] = [w.frontier, w.space.stage, w.religionPolicy]
  for (const rs of w.regions) {
    if (rs.r.foodKcalPerCapita < 2300) out.push('food famine hunger supply')
    if (rs.r.unrest > 0.45) out.push('unrest revolt protests')
    if (rs.inRevolt) out.push('revolt secession crackdown')
    if (rs.energyRatio < 0.97) out.push('energy grid power')
    if (rs.crowds.some(c => c.phase === 'outraged')) out.push('outrage crowds laws')
  }
  if (w.warTension > 0.3) out.push('war crackdown security')
  for (const l of w.laws) out.push(l.policyKind, l.title)
  if (w.frontier !== 'none') out.push('mars space launch research')
  return out
}

export async function decide(w: World, constitution: string, overrides: Override[], mem: GovernorMemory): Promise<Decision> {
  const brief = buildBrief(w, overrides, mem.last?.rationale)
  const ids = overrides.map(o => o.id)
  const lessons = relevantLessons(mem.lessons, situation(w), 10)
  if (!groqAvailable()) return finish(offlineDecision(brief, overrides, mem.vetoedTitles), w)

  const system = systemPrompt(constitution, lessons)
  let user = JSON.stringify(brief)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await chat({ model: MODEL, system, user, json: true, temperature: 0.5, maxTokens: 8000 })
      const parsed = DecisionSchema.parse(JSON.parse(raw))
      const missing = ids.filter(id => !parsed.respondedToOverrides.includes(id))
      if (missing.length) throw new Error(`respondedToOverrides is missing override ids: ${missing.join(', ')}`)
      const d: Decision = {
        tick: w.tick,
        laws: parsed.laws.filter(l => !mem.vetoedTitles.has(l.title.toLowerCase())).map(l => ({ ...l, id: '', enactedTick: w.tick, support: 0, compliance: 0, policyKind: '', precedentIds: [], lovedBy: [], hatedBy: [] })),
        repeal: parsed.repeal.filter(id => w.laws.some(l => l.id === id)),
        migrations: parsed.migrations.filter(m => m.from !== m.to).map(m => ({ ...m, people: Math.floor(m.people) })),
        budget: parsed.budget,
        religionPolicy: parsed.religionPolicy,
        schoolPolicy: { ...parsed.schoolPolicy, yearsRequired: Math.round(parsed.schoolPolicy.yearsRequired) },
        foundCities: parsed.foundCities.map(c => ({ name: c.name, regionId: c.regionId, lat: c.lat, lon: c.lon, reason: c.reason, ...(c.offWorld ? { offWorld: c.offWorld } : {}) })),
        charterCompanies: parsed.charterCompanies.map(c => ({ name: c.name, sector: c.sector, regionId: c.regionId, purpose: c.purpose })),
        researchFocus: parsed.researchFocus,
        publicStatement: parsed.publicStatement.replace(/[—–]/g, ', '),
        rationale: parsed.rationale.replace(/[—–]/g, ', '),
        respondedToOverrides: parsed.respondedToOverrides.filter(id => ids.includes(id)),
        lessonsApplied: parsed.lessonsApplied.filter(id => lessons.some(l => l.id === id)),
      }
      return finish(d, w)
    } catch (e) {
      user = `${JSON.stringify(brief)}\n\nYOUR PREVIOUS REPLY WAS REJECTED: ${(e as Error).message.slice(0, 600)}\nReply again with valid JSON only.`
    }
  }
  // two retries failed: keep governing with the last decision (no new laws, cities, companies or migrations)
  const base = mem.last ?? offlineDecision(brief, overrides, mem.vetoedTitles)
  return finish({
    ...base, tick: w.tick, laws: mem.last ? [] : base.laws, repeal: [], migrations: [], foundCities: [], charterCompanies: [],
    rationale: `fallback: the model gave no valid decision after 2 retries, so the last policy stands. ${base.rationale}`.slice(0, 2500),
    respondedToOverrides: ids, lessonsApplied: [],
  }, w)
}

function finish(d: Decision, w: World): Decision {
  const b = normalizeBudget(d.budget)
  for (const k of Object.keys(b) as (keyof typeof b)[]) b[k] = Math.round(b[k] * 1e6) / 1e6
  return { ...d, tick: w.tick, budget: b }
}
