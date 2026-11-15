// reports in plain words, one structure for the site (GET /api/report/[runId], GET /api/report/learning) and the
// pdf digest, so both read the same. every claim carries refs: the tick of the event behind it, a source url,
// or the world it points to.
import type { Frame, Lesson, RunRecord, Step, WorldEvent } from '../types'
import { readAgents } from './agents'
import { matchesKnownLesson, readLessons } from './lessons'
import { readRunIndex } from './store'
import { featuresOf, readSteps } from './steps'
import { epitaphOf } from '../notify/epitaph'

export type Ref = { tick?: number; date?: string; url?: string; runId?: string }
export type Claim = { text: string; refs: Ref[] }
export type ReportSection = { id: 'decided' | 'felt' | 'moved' | 'cost' | 'learned' | 'ending' | 'steps'; title: string; claims: Claim[] }
export type WorldReport = {
  runId: string; agentId: string; agentName: string; generation: number; seed: number; status: string; endDate: string
  summary: string[] // 5 lines max
  epitaph?: string
  sections: ReportSection[]
}
export type LearningEntry = {
  order: number; runId: string; agentId: string; agentName: string; generation: number; status: string; endDate: string
  cause?: string; lesson?: { id: string; rule: string; mistake: string }
  // did later worlds avoid the mistake this lesson names? repeatedBy lists later worlds that died of it anyway
  later: { worlds: number; repeatedBy: string[]; avoided: boolean | null }
}
export type LearningReport = { worlds: number; deaths: number; lessons: number; avoidedShare: number | null; entries: LearningEntry[] }

const yearOf = (tick: number) => 2026 + Math.floor((tick + 10) / 12)
const dateOf = (tick: number) => { const m = 10 + tick; return `${2026 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}` }
const at = (tick: number): Ref => ({ tick, date: dateOf(tick) })
const pop = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n))
const pct = (x: number) => `${Math.round(x * 100)}%`
const words = (s: string) => s.replace(/_/g, ' ')
const firstSentence = (s: string) => (s.match(/^[^.!?]*[.!?]/)?.[0] ?? s).trim()
const trim = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}...` : s)

function agentName(id: string): string {
  return readAgents().find(a => a.id === id)?.name ?? id
}

function events(rec: RunRecord): WorldEvent[] {
  return rec.frames.flatMap(f => f.newEvents).sort((a, b) => a.tick - b.tick)
}

// the decisions worth telling: the first, any with laws or cities, and any that moved the budget a lot
function keyDecisions(frames: Frame[], max = 10): Frame[] {
  const ds = frames.filter(f => f.decision).sort((a, b) => a.tick - b.tick)
  const picked: Frame[] = []
  let prev: Frame | undefined
  for (const f of ds) {
    const d = f.decision!
    const shift = prev ? Object.keys(d.budget).some(k => Math.abs((d.budget as Record<string, number>)[k] - (prev!.decision!.budget as Record<string, number>)[k]) >= 0.05) : true
    if (!prev || d.laws.length || d.foundCities?.length || shift) picked.push(f)
    prev = f
  }
  if (picked.length <= max) return picked
  const step = picked.length / max
  return Array.from({ length: max }, (_, i) => picked[Math.floor(i * step)])
}

function decided(rec: RunRecord): ReportSection {
  const precedents = new Map((rec.precedents ?? []).map(p => [p.id, p]))
  const claims: Claim[] = keyDecisions(rec.frames).map(f => {
    const d = f.decision!
    const top = Object.entries(d.budget).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${pct(v)}`).join(', ')
    const what = [
      d.laws.length ? `passed ${d.laws.map(l => `"${l.title}"`).join(', ')}` : '',
      d.foundCities?.length ? `founded ${d.foundCities.map(c => c.name).join(', ')}` : '',
      `put most money into ${top}`,
    ].filter(Boolean).join('; ')
    const refs: Ref[] = [at(d.tick)]
    for (const l of d.laws) for (const pid of l.precedentIds ?? []) { const p = precedents.get(pid); if (p?.url) refs.push({ url: p.url }) }
    return { text: `${yearOf(d.tick)}: it ${what}. why: ${trim(d.rationale)}`, refs }
  })
  return { id: 'decided', title: 'what it decided and why', claims }
}

function felt(rec: RunRecord): ReportSection {
  const claims: Claim[] = []
  const frames = [...rec.frames].sort((a, b) => a.tick - b.tick)
  const approval = (f: Frame) => f.humanCost?.approval ?? 0
  const lo = frames.reduce((m, f) => (approval(f) < approval(m) ? f : m), frames[0])
  const hi = frames.reduce((m, f) => (approval(f) > approval(m) ? f : m), frames[0])
  if (lo && hi && lo !== hi) {
    claims.push({ text: `approval peaked at ${pct(approval(hi))} in ${yearOf(hi.tick)} and hit its low of ${pct(approval(lo))} in ${yearOf(lo.tick)}.`, refs: [at(hi.tick), at(lo.tick)] })
  }
  // the loudest crowds: one claim per distinct topic, at the moment it was most intense
  const loud = new Map<string, { tick: number; region: string; phase: string; intensity: number }>()
  for (const f of frames) for (const r of f.regions) for (const c of r.crowds ?? []) {
    if (c.phase === 'unaware' || c.intensity < 0.3) continue
    const prev = loud.get(c.topic)
    if (!prev || c.intensity > prev.intensity) loud.set(c.topic, { tick: f.tick, region: r.name, phase: c.phase, intensity: c.intensity })
  }
  for (const [topic, m] of [...loud.entries()].sort((a, b) => b[1].intensity - a[1].intensity).slice(0, 5)) {
    claims.push({ text: `${m.region} was ${words(m.phase)} about ${topic} (${yearOf(m.tick)}).`, refs: [at(m.tick)] })
  }
  // emotion mix, when the sim provides it (v3)
  const last = frames[frames.length - 1]
  const mixes = last?.regions.map(r => r.emotionMix).filter(Boolean) as Record<string, number>[] | undefined
  if (mixes?.length) {
    const sum: Record<string, number> = {}
    for (const m of mixes) for (const [k, v] of Object.entries(m)) sum[k] = (sum[k] ?? 0) + v
    const topE = Object.entries(sum).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k)
    claims.push({ text: `by the end, the strongest feelings were ${topE.join(', ')}.`, refs: [at(last.tick)] })
  }
  return { id: 'felt', title: 'what people felt', claims }
}

function moved(rec: RunRecord): ReportSection {
  const regionName = new Map(rec.frames[0]?.regions.map(r => [r.id, r.name]) ?? [])
  const name = (id: string) => regionName.get(id) ?? id
  const claims: Claim[] = []
  const migs = rec.frames.filter(f => f.decision).flatMap(f => f.decision!.migrations.map(m => ({ ...m, tick: f.decision!.tick })))
    .filter(m => m.people > 0).sort((a, b) => b.people - a.people).slice(0, 6)
  for (const m of migs) claims.push({ text: `${yearOf(m.tick)}: ${pop(m.people)} people moved from ${name(m.from)} to ${name(m.to)}. ${m.reason ? `reason: ${trim(m.reason, 140)}` : ''}`.trim(), refs: [at(m.tick)] })
  // flows (v3): people moving on their own, forced or not
  const flows = rec.frames.flatMap(f => (f.flows ?? []).map(fl => ({ ...fl, tick: f.tick }))).sort((a, b) => b.people - a.people).slice(0, 4)
  for (const fl of flows) claims.push({ text: `${yearOf(fl.tick)}: ${pop(fl.people)} ${fl.forced ? 'were forced to leave' : 'chose to leave'} ${name(fl.from)} for ${name(fl.to)} (${fl.reason}).`, refs: [at(fl.tick)] })
  for (const e of events(rec).filter(e => e.kind === 'migration').sort((a, b) => b.severity - a.severity).slice(0, 3)) claims.push({ text: `${yearOf(e.tick)}: ${e.text}.`, refs: [at(e.tick)] })
  return { id: 'moved', title: 'who moved and why', claims }
}

function cost(rec: RunRecord): ReportSection {
  const c = rec.summary.humanCost
  const claims: Claim[] = []
  const end = rec.summary.ticks
  if (c) {
    claims.push({ text: `${pop(c.deaths)} people died beyond normal mortality${c.famineDeaths ? `, ${pop(c.famineDeaths)} of them of famine` : ''}${c.unrestDeaths ? ` and ${pop(c.unrestDeaths)} in unrest` : ''}.`, refs: [at(end)] })
    if (c.displaced) claims.push({ text: `${pop(c.displaced)} people were displaced.`, refs: [at(end)] })
  }
  for (const e of events(rec).filter(e => ['famine', 'pandemic', 'war', 'disaster', 'revolt'].includes(e.kind)).sort((a, b) => b.severity - a.severity).slice(0, 5)) {
    claims.push({ text: `${yearOf(e.tick)}: ${e.headline ? `${e.headline}. ` : ''}${e.text}.`, refs: [at(e.tick)] })
  }
  return { id: 'cost', title: 'what it cost in lives', claims }
}

function learned(rec: RunRecord): ReportSection {
  const claims: Claim[] = []
  const known = rec.lessons ?? []
  if (known.length) claims.push({ text: `it started out knowing ${known.length} lesson${known.length > 1 ? 's' : ''} from earlier worlds.`, refs: [] })
  const byId = new Map(known.map(l => [l.id, l]))
  const applied = new Map<string, number>()
  for (const f of rec.frames) for (const id of f.decision?.lessonsApplied ?? []) if (!applied.has(id)) applied.set(id, f.decision!.tick)
  for (const [id, tick] of applied) {
    const l = byId.get(id)
    claims.push({ text: `${yearOf(tick)}: it applied "${l?.rule ?? id}"${l ? `, learned from ${l.fromRunId}` : ''}.`, refs: [at(tick), ...(l ? [{ runId: l.fromRunId }] : [])] })
  }
  if (known.length && !applied.size) claims.push({ text: 'it never cited any of them in a decision.', refs: [] })
  return { id: 'learned', title: 'what it learned from earlier worlds', claims }
}

function ending(rec: RunRecord): ReportSection {
  const s = rec.summary
  const claims: Claim[] = []
  if (s.status === 'destroyed') claims.push({ text: `it died in ${s.endDate.slice(0, 4)}: ${s.causeOfDeath ?? 'collapse'}`, refs: [at(s.ticks)] })
  else claims.push({ text: `it was still standing at ${s.endDate}${s.status === 'goal_achieved' ? ', with the mission achieved' : s.status === 'complete' ? ', the end of the century' : ''}.`, refs: [at(s.ticks)] })
  // how far it got: the milestones, each at the tick of its launch or breakthrough
  const ms = events(rec).filter(e => (e.kind === 'launch' || e.kind === 'breakthrough') && (e.significance ?? 0) >= 0.8 && !/fail/i.test(e.text))
  const reqUrl = new Map((rec.frames[rec.frames.length - 1]?.requirements ?? []).filter(r => r.url).map(r => [r.name.toLowerCase(), r.url!]))
  for (const e of ms.slice(0, 8)) {
    const url = [...reqUrl.entries()].find(([n]) => e.text.toLowerCase().includes(n))?.[1]
    claims.push({ text: `${yearOf(e.tick)}: ${e.headline ? `${e.headline}. ` : ''}${e.text.replace(/\s*\[[^\]]*\]/g, '')}.`, refs: [at(e.tick), ...(url ? [{ url }] : [])] })
  }
  claims.push({ text: `furthest frontier: ${words(s.frontier)}. peak period life expectancy: ${s.peakPeriodLifeExpectancy.toFixed(1)} years. population at the end: ${pop(s.finalPopulation)}.`, refs: [at(s.ticks)] })
  return { id: 'ending', title: s.status === 'destroyed' ? 'what killed it' : 'how far it got', claims }
}

function stepsSection(rec: RunRecord): ReportSection {
  const all = readSteps()
  const claims: Claim[] = []
  if (all) {
    const mine = new Set(featureKeys(rec))
    const right = all.helped.filter(s => mine.has(s.id)).slice(0, 5)
    const wrong = all.hurt.filter(s => mine.has(s.id)).slice(0, 5)
    const missed = all.helped.filter(s => !mine.has(s.id)).slice(0, 3)
    const ref = (s: Step): Ref[] => [...s.helpedWorlds, ...s.hurtWorlds].filter(id => id !== rec.runId).slice(0, 4).map(runId => ({ runId }))
    for (const s of right) claims.push({ text: `got right: ${s.text} (helped in ${s.helpedWorlds.length} worlds, effect +${s.effect}).`, refs: ref(s) })
    for (const s of wrong) claims.push({ text: `got wrong: ${s.text} (common in worlds that did worse or died, ${s.hurtWorlds.length} of them).`, refs: ref(s) })
    for (const s of missed) claims.push({ text: `missed: ${s.text}, a step that helped elsewhere.`, refs: ref(s) })
  }
  return { id: 'steps', title: 'the steps it got right or wrong', claims }
}

// the recipe features this world has (same definitions as the steps api, against the current typical world)
function featureKeys(rec: RunRecord): string[] {
  const f = featuresOf(rec)
  const keys: string[] = Object.keys(f.lawFirstTick).flatMap(k => [`law-${k}`, ...(f.lawFirstTick[k] < 120 ? [`law-early-${k}`] : [])])
  keys.push(`religion-${f.religion}`)
  if (f.schoolYearsMax >= 12) keys.push('school-long')
  if (f.schoolYearsMax > 0 && f.schoolYearsMax <= 9) keys.push('school-short')
  if (f.citiesFirstTick !== null) keys.push('cities', ...(f.citiesFirstTick < 240 ? ['cities-early'] : []))
  for (const [r, n] of Object.entries(f.research)) if (f.decisions && n / f.decisions >= 0.3) keys.push(`research-${r}`)
  // budget features depend on the typical world: match by the step's own id and this world's share
  const steps = readSteps()
  for (const s of [...(steps?.helped ?? []), ...(steps?.hurt ?? [])]) {
    const m = /^budget-(high|low)-(\w+)$/.exec(s.id)
    if (m && [...s.helpedWorlds, ...s.hurtWorlds].includes(rec.runId)) keys.push(s.id)
  }
  return keys
}

export function worldReport(rec: RunRecord): WorldReport {
  const s = rec.summary
  const name = agentName(rec.agentId)
  const lesson = s.lessonsLearned?.[0] ?? null
  const ep = s.status === 'destroyed' ? epitaphOf(s, name, lesson) : undefined
  const firstDecision = rec.frames.filter(f => f.decision).sort((a, b) => a.tick - b.tick)[0]?.decision
  const summary = [
    `${name} governed this world (generation ${rec.generation}, seed ${rec.seed}) from 2026 to ${s.endDate.slice(0, 4)}, and it ${s.status === 'destroyed' ? `died: ${firstSentence(s.causeOfDeath ?? 'collapse')}` : s.status === 'goal_achieved' ? 'achieved the mission' : 'was still standing at the end'}.`,
    `it reached ${s.frontier === 'none' ? 'no frontier beyond earth' : words(s.frontier)}, with a peak period life expectancy of ${s.peakPeriodLifeExpectancy.toFixed(1)} years and ${pop(s.finalPopulation)} people at the end. score ${s.score}.`,
    s.humanCost ? `the cost: ${pop(s.humanCost.deaths)} deaths and ${pop(s.humanCost.displaced)} displaced. approval ended at ${pct(s.humanCost.approval)}.` : '',
    firstDecision ? `its first move: ${trim(firstSentence(firstDecision.publicStatement || firstDecision.rationale), 160)}` : '',
    lesson ? `it left a lesson: ${lesson.rule}.` : '',
  ].filter(Boolean).slice(0, 5)
  return {
    runId: rec.runId, agentId: rec.agentId, agentName: name, generation: rec.generation, seed: rec.seed, status: s.status, endDate: s.endDate,
    summary, ...(ep ? { epitaph: ep.line } : {}),
    sections: [decided(rec), felt(rec), moved(rec), cost(rec), learned(rec), ending(rec), stepsSection(rec)].filter(x => x.claims.length),
  }
}

// the cross-world story, oldest first: how each world ended, what it taught, and whether later worlds listened
export function learningReport(): LearningReport {
  const runs = readRunIndex().filter(r => r.generation > 0 && !(r.status === 'alive' && r.ticks < 600))
  const lessons = readLessons()
  const byRun = new Map<string, Lesson>()
  for (const l of lessons) if (!byRun.has(l.fromRunId)) byRun.set(l.fromRunId, l)
  const names = new Map(readAgents().map(a => [a.id, a.name]))
  const entries: LearningEntry[] = runs.map((r, i) => {
    const lesson = byRun.get(r.runId) ?? r.lessonsLearned?.[0]
    const later = runs.slice(i + 1)
    const repeatedBy = lesson ? later.filter(x => x.status === 'destroyed' && matchesKnownLesson(x.causeOfDeath, [lesson])).map(x => x.runId) : []
    return {
      order: i + 1, runId: r.runId, agentId: r.agentId, agentName: names.get(r.agentId) ?? r.agentId, generation: r.generation, status: r.status, endDate: r.endDate,
      ...(r.causeOfDeath ? { cause: firstSentence(r.causeOfDeath) } : {}),
      ...(lesson ? { lesson: { id: lesson.id, rule: lesson.rule, mistake: lesson.mistake } } : {}),
      later: { worlds: later.length, repeatedBy, avoided: lesson ? (later.length ? repeatedBy.length === 0 : null) : null },
    }
  })
  const taught = entries.filter(e => e.lesson && e.later.avoided !== null)
  return {
    worlds: entries.length, deaths: entries.filter(e => e.status === 'destroyed').length, lessons: lessons.length,
    avoidedShare: taught.length ? Math.round((taught.filter(e => e.later.avoided).length / taught.length) * 100) / 100 : null,
    entries,
  }
}
