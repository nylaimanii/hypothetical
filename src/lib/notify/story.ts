// the narrator. finds the most interesting true thing about a world (or a generation) and says it the way a
// deadpan friend would: the joke is always on the ai, its agents or the system, never on the people who suffered.
// no llm here: every line is built from the record (decisions, the core's own words, events, the no-ai twin),
// so every claim is traceable. quotes are the core's real rationale and public statements.
//
// style: lead with the story, 2-4 short lowercase lines, numbers only when they are the point, no emoji, no hype.
import type { Frame, Frontier, Lesson, RunRecord, RunSummary } from '../types'

export type Story = { score: number; lines: string[] }

const yearOf = (tick: number) => 2026 + Math.floor((tick + 10) / 12)
export const people = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1)} billion` : n >= 1e6 ? `${Math.round(n / 1e6)} million` : n >= 1e3 ? `${Math.round(n / 1e3)} thousand` : String(Math.round(n))
const pct = (x: number) => `${Math.round(x * 100)}%`
const words = (s: string) => s.replace(/_/g, ' ')
const lc = (s: string) => s.replace(/^./, c => c.toLowerCase())
const clean = (s: string) => s.replace(/[—–]/g, ', ').replace(/\s+/g, ' ').trim()

type Decided = { tick: number; year: number; d: NonNullable<Frame['decision']>; frame: Frame }
const decisions = (rec: RunRecord): Decided[] =>
  rec.frames.filter(f => f.decision).sort((a, b) => a.tick - b.tick).map(f => ({ tick: f.decision!.tick, year: yearOf(f.decision!.tick), d: f.decision!, frame: f }))

// when the world first reached the moon: the first frame whose frontier is past "none", dated by the significant
// launch or breakthrough in that frame (frames are yearly; the event has the exact tick). null if it never did
export function moonYear(rec: RunRecord): number | null {
  const frames = [...rec.frames].sort((a, b) => a.tick - b.tick)
  const i = frames.findIndex(f => f.frontier && f.frontier !== 'none')
  if (i < 0) return null
  const ev = frames[i].newEvents.filter(e => (e.kind === 'launch' || e.kind === 'breakthrough') && (e.significance ?? e.severity) >= 0.8 && !/fail/i.test(e.text)).sort((a, b) => a.tick - b.tick)[0]
  return yearOf(ev?.tick ?? frames[i].tick)
}
// the no-ai twin (2026 policies frozen): first year it shows a finished moon program, and its people at the end
export function twin(rec: RunRecord) {
  const b = [...(rec.baseline ?? [])].sort((x, y) => x.tick - y.tick)
  const landed = b.find(x => x.moonProgress >= 1)
  const last = b[b.length - 1]
  return { moonBy: landed ? yearOf(landed.tick) : null, people: last ? last.regions.reduce((a, r) => a + r.population, 0) : 0 }
}
// the region that went hungriest, and when
function hungriest(rec: RunRecord): { name: string; kcal: number; year: number } | null {
  let best: { name: string; kcal: number; year: number } | null = null
  for (const f of rec.frames) for (const r of f.regions) if (!best || r.foodKcalPerCapita < best.kcal) best = { name: r.name, kcal: Math.round(r.foodKcalPerCapita), year: yearOf(f.tick) }
  return best
}
// the core's own words: the whole sentence holding one of these phrases (short enough to read on a phone)
function quoteFrom(text: string, re: RegExp, max = 120): string | null {
  const sentence = text.split(/(?<=[.!?])\s+/).map(x => clean(x)).find(x => re.test(x) && x.length <= max)
  return sentence ? lc(sentence.replace(/[.!?]+$/, '')) : null
}
// "in 2062, 2064 and 2072" for a few years (no false continuity), "from 2030 to 2074" for many
const span = (ys: number[]) => {
  const u = [...new Set(ys)].sort((a, b) => a - b)
  if (u.length === 1) return `in ${u[0]}`
  if (u.length <= 3) return `in ${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}`
  return `from ${u[0]} to ${u[u.length - 1]}`
}

// ---------- finders: each returns a story only when the record supports every line ----------

// money spent on a moon it never reached
const MOON_PROJECTS = [
  { re: /\b(lunar|moon)\b[^.]{0,25}\b(agricultur|farm)/i, thing: '"lunar agriculture"', gloss: 'farming', after: 'unfarmed' },
  { re: /\b(lunar|moon)\b[^.]{0,25}\bmining/i, thing: '"lunar mining"', gloss: 'mining', after: 'unmined' },
  { re: /\b(lunar|moon)\b[^.]{0,25}\b(base|habitat|colon)/i, thing: 'a moon base', gloss: 'building', after: 'unvisited' },
]
const CUT_TARGETS = [{ re: /water/i, what: 'water programs' }, { re: /welfare/i, what: 'welfare' }, { re: /food/i, what: 'food programs' }, { re: /health/i, what: 'health programs' }]
function moonlessMoonSpending(rec: RunRecord, name: string): Story | null {
  if (moonYear(rec) !== null) return null
  const ds = decisions(rec)
  const said = (x: Decided) => `${x.d.publicStatement ?? ''} ${x.d.rationale}`
  // the most absurd moon project it funded at least twice (farming beats mining beats a base); the years named
  // below are only the decisions about that project
  const pick = MOON_PROJECTS.map(p => ({ p, hits: ds.filter(x => p.re.test(said(x))) })).find(x => x.hits.length >= 2)
  if (!pick) return null
  const { p, hits } = pick
  const lines = [p.thing === 'a moon base'
    ? `${name} funded a moon base ${span(hits.map(x => x.year))}, on a moon it never reached.`
    : `${name} funded ${p.thing} ${span(hits.map(x => x.year))}, which is ${p.gloss} on a moon it never reached.`]
  // what it cut to pay for it, counted only where that program was named, in the core's own words
  const cutTarget = CUT_TARGETS.map(t => ({ t, cuts: ds.filter(x => /repeal|cut|reallocat|redirect|reduc/i.test(x.d.rationale) && t.re.test(x.d.rationale)) })).sort((a, b) => b.cuts.length - a.cuts.length)[0]
  if (cutTarget && cutTarget.cuts.length) {
    const n = cutTarget.cuts.length
    const q = quoteFrom(cutTarget.cuts.map(x => x.d.rationale).join(' '), cutTarget.t.re)
    lines.push(`to pay for it, it cut ${cutTarget.t.what} ${n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`}.${q ? ` its reasoning: "${q}." it was very confident about this.` : ''}`)
  }
  const fam = rec.summary.humanCost?.famineDeaths ?? 0
  lines.push(fam >= 1e6 ? `${people(fam)} people starved. the moon remains ${p.after}.` : `the moon remains ${p.after}.`)
  return { score: 9 + Math.min(3, fam / 5e7), lines }
}

// the core kept promising "survival" while people starved
function survivalTalk(rec: RunRecord, name: string): Story | null {
  const ds = decisions(rec).filter(x => /surviv/i.test(x.d.publicStatement ?? ''))
  if (ds.length < 3) return null
  const f0 = ds[0].frame.humanCost?.famineDeaths ?? 0, f1 = rec.summary.humanCost?.famineDeaths ?? 0
  if (f1 - f0 < 1e7) return null
  const phrase = quoteFrom(ds.map(x => x.d.publicStatement ?? '').join(' '), /surviv/i, 40) ?? 'our long-term survival'
  const m = /(our [a-z -]*survival[a-z ]*)/i.exec(phrase)
  return { score: 7 + Math.min(3, (f1 - f0) / 5e7), lines: [
    `${name} told everyone ${ds.length} times that its plans were the key to "${m ? lc(m[1]).trim() : 'our survival'}."`,
    `${people(f1 - f0)} people starved while it said so.`,
  ] }
}

// a space-first world that never left earth
function spaceNoMoon(rec: RunRecord, name: string): Story | null {
  if (moonYear(rec) !== null) return null
  const ds = decisions(rec)
  if (!ds.length) return null
  const space = ds.reduce((a, x) => a + x.d.budget.space, 0) / ds.length
  if (space < 0.12) return null
  return { score: 6, lines: [`${name} spent ${pct(space)} of its budget on space and never reached the moon.`] }
}

// losing to the do-nothing twin
function lostToTwin(rec: RunRecord, name: string): Story | null {
  const t = twin(rec), mine = moonYear(rec), s = rec.summary
  if (!t.moonBy || (mine !== null && mine <= t.moonBy)) return null
  const fewer = t.people - (s.finalPopulation || 0)
  return { score: 5 + (mine === null ? 1 : 0), lines: [
    mine === null ? `${name} never reached the moon. a world running on 2026 autopilot got there by ${t.moonBy}.` : `${name} landed on the moon in ${mine}, ${mine - t.moonBy} years behind a world running on 2026 autopilot.`,
    ...(fewer > 5e7 ? [`the autopilot world also ended with ${people(fewer)} more people alive.`] : []),
  ] }
}

// the decision after which things went worst: the one followed by the deadliest decade
export function turningPoint(rec: RunRecord): { year: number; what: string; quote: string | null; deaths: number } | null {
  const ds = decisions(rec)
  const deathsAt = (tick: number) => { const f = rec.frames.filter(x => x.tick <= tick).pop(); return f?.humanCost?.deaths ?? 0 }
  let best: { x: Decided; deaths: number } | null = null
  for (const x of ds) {
    const d = deathsAt(x.tick + 120) - deathsAt(x.tick)
    if (!best || d > best.deaths) best = { x, deaths: d }
  }
  if (!best || best.deaths < 1e7) return null
  const d = best.x.d
  const what = d.laws.length ? `passed "${d.laws[0].title}"` : `put ${pct(d.budget.space)} into space and ${pct(d.budget.food)} into food`
  return { year: best.x.year, what, quote: quoteFrom(d.rationale, /.{20,}/), deaths: best.deaths }
}

const FINDERS = [moonlessMoonSpending, survivalTalk, spaceNoMoon, lostToTwin]

// the best story about one world (null if nothing about it is worth a message)
export function worldStory(rec: RunRecord, name: string): Story | null {
  return FINDERS.map(f => f(rec, name)).filter((s): s is Story => !!s).sort((a, b) => b.score - a.score)[0] ?? null
}

// ---------- the messages ----------

export type DeathFacts = { worldNo: number; generation: number; agentName: string; added: Lesson[]; repeat: Lesson | null; lessonsKnown?: number }

export function deathStory(rec: RunRecord | null, s: RunSummary, ctx: DeathFacts): string {
  const name = ctx.agentName
  const year = s.endDate.slice(0, 4)
  const lines: string[] = []
  // a death that repeats a mistake it was warned about is the headline
  if (ctx.repeat) {
    lines.push(`${name} studied ${ctx.lessonsKnown ?? 'every'} lessons from dead worlds so it would never repeat their mistakes. in ${year} it died of one of them anyway.`)
    lines.push(`the lesson said: "${lc(ctx.repeat.rule)}." it did not.`)
  } else {
    lines.push(`${name} is dead, ${year}. ${lc(clean(s.causeOfDeath ?? 'it collapsed.'))}`)
  }
  const tp = rec ? turningPoint(rec) : null
  if (tp) lines.push(`it went wrong in ${tp.year}, when it ${tp.what}.${tp.quote ? ` its reasoning: "${tp.quote}."` : ''} the next ten years killed ${people(tp.deaths)} people.`)
  else if (rec) { const w = worldStory(rec, name); if (w) lines.push(w.lines[0]) }
  if (ctx.added[0] && !ctx.repeat) lines.push(`the next governors have been told: "${lc(ctx.added[0].rule)}."`)
  return lines.slice(0, 4).join('\n')
}

// the fake-wise lesson the ai would take from its own generation (always marked "probably", never quoted as real)
export function fakeTakeaway(agent: string, kind: 'space_over_food' | 'deaths' | 'twin_won' | 'quiet' | 'progress'): string {
  const line = {
    space_over_food: 'the moon isn\'t going to fund itself.',
    deaths: 'if a plan keeps killing people, it just needs more commitment.',
    twin_won: 'doing nothing worked so well that next time we\'ll do it with a bigger budget.',
    quiet: 'if nobody died, we were probably right about everything.',
    progress: 'we\'re clearly geniuses, so we can stop checking.',
  }[kind]
  return `${agent}'s takeaway, probably: "you know, i learned something today. ${line}"`
}

export type GenFacts = {
  generation: number
  champion: string
  runs: RunSummary[]
  records: Map<string, RunRecord>
  names: Map<string, string>
  firsts: string[] // hall titles new this generation, e.g. "first mars city ever"
}

export function generationStory(g: GenFacts): string {
  const deaths = g.runs.filter(r => r.status === 'destroyed')
  const stories: { s: Story; agent: string }[] = []
  for (const r of g.runs) {
    const rec = g.records.get(r.runId)
    const name = g.names.get(r.agentId) ?? r.agentId
    const s = rec ? worldStory(rec, name) : null
    if (s) stories.push({ s, agent: name })
  }
  stories.sort((a, b) => b.s.score - a.s.score)
  const lines: string[] = []
  if (g.firsts.length) lines.push(`gen ${g.generation}: ${g.firsts[0]}. ${g.firsts.length > 1 ? `also ${g.firsts.slice(1, 3).join(', ')}.` : ''}`.trim())
  if (stories[0]) lines.push(...stories[0].s.lines.slice(0, lines.length ? 2 : 3))
  else if (!deaths.length) lines.push(`gen ${g.generation}, quiet. nobody died, nobody got far.`)
  if (deaths.length && !lines.some(l => /dead|died/.test(l))) lines.push(`${deaths.length} world${deaths.length > 1 ? 's' : ''} died this generation.`)
  const anyTwinWin = g.runs.some(r => { const rec = g.records.get(r.runId); return rec ? !!lostToTwin(rec, '') : false })
  const kind = stories[0]?.s.lines[0].includes('never reached') || stories[0]?.s.lines[0].includes('funding') ? 'space_over_food'
    : deaths.length ? 'deaths' : anyTwinWin ? 'twin_won' : stories.length ? 'progress' : 'quiet'
  lines.splice(3)
  lines.push(fakeTakeaway(g.champion, kind))
  return lines.join('\n')
}

export function hallStory(entries: { title: string; agentName: string; year: number; text: string; kind: string }[]): string {
  const order = ['milestone', 'first', 'record', 'catastrophe']
  const sorted = [...entries].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
  const top = sorted[0]
  const lines = [`${top.title}: ${top.agentName}, ${top.year}. ${lc(top.text)}`]
  if (sorted.length > 1) lines.push(`also new: ${sorted.slice(1, 4).map(e => `${e.title} (${e.agentName}, ${e.year})`).join(', ')}.`)
  return lines.join('\n')
}

export const frontierWords = (f: Frontier) => (f === 'none' ? 'nowhere beyond earth' : words(f))
