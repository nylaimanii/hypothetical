// THE DAILY: a front page per calendar year, built only from the record: that year's events (by their own tick),
// laws, crowd turns, precedents and human cost, never past the playhead. every sentence states something the
// record holds; nothing is invented on the page (no made-up quotes, jokes or reactions).
import type { Emotion, Frame, Law, Precedent, RunRecord, WorldEvent } from '@/lib/types'
import { EMOTIONS } from '@/lib/mock/mood'
import { rosterAt } from '../state/store'
import { dateOfTick, eventsBetween, FIRST_YEAR, yearIndexOfTick, yearSpan } from './truth'

export type Story = {
  headline: string
  body: string
  kind: WorldEvent['kind'] | 'decision' | 'crowd'
  // where clicking the story should take you
  // tick: the frame holding it (its details), at: when it happened (where the scrubber jumps)
  ref?: { tick: number; index?: number; regionId?: string; at?: number }
}
export type Issue = {
  year: number // calendar year
  yearIndex: number // years since 2026
  date: string
  number: number
  lead: Story
  stories: Story[]
  mood: { line: string; top: { emotion: Emotion; value: number }[]; approval: number }
  coreSays?: { quote: string; date: string }
  cost?: { deaths: number; displaced: number }
}

const people = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} billion` : n >= 1e6 ? `${Math.round(n / 1e6)} million` : n >= 1e3 ? `${Math.round(n / 1e3)} thousand` : `${Math.round(n)}`)
const brief = (t: string) => t.split(/[.;]/)[0].trim()

// frames inside a calendar year, never past the playhead (upTo)
export const yearFrames = (rec: RunRecord, yearIndex: number, upTo = Infinity) => {
  const { start, end } = yearSpan(yearIndex)
  return rec.frames.filter((f) => f.tick >= start && f.tick <= end && f.tick <= upTo)
}
// the calendar years with data up to lastTick (index 0 = 2026)
export const yearsOf = (rec: RunRecord, lastTick?: number) => {
  const last = lastTick ?? rec.frames.at(-1)?.tick ?? 0
  return Array.from({ length: yearIndexOfTick(Math.max(0, last)) + 1 }, (_, i) => i)
}

function eventStory(e: WorldEvent, f: Frame, index: number): Story {
  const where = f.regions.find((x) => x.id === e.regionId)?.name
  return { kind: e.kind, ref: { tick: f.tick, index, regionId: e.regionId, at: e.tick }, headline: e.headline ?? brief(e.text), body: `${dateOfTick(e.tick)}${where ? `, ${where}` : ''}.${(e.headline ?? brief(e.text)) === e.text.replace(/\.$/, '') ? '' : ` ${e.text}`}` }
}

function lawStory(l: Law, f: Frame, precedents: Precedent[]): Story {
  const prec = l.precedentIds.map((id) => precedents.find((p) => p.id === id)).find(Boolean)
  const parts = [`${brief(l.text)}.`]
  if (prec) parts.push(`precedent: ${prec.country}, ${prec.year}; the result was ${prec.reaction}.`)
  if (l.lovedBy.length) parts.push(`supported by ${l.lovedBy.slice(0, 2).join(' and ')}.`)
  if (l.hatedBy.length) parts.push(`opposed by ${l.hatedBy.slice(0, 2).join(' and ')}.`)
  return { kind: 'law', ref: { tick: f.tick }, headline: `new law: ${l.title}`, body: parts.join(' ') }
}

function crowdStories(f: Frame, prev: Frame | undefined): Story[] {
  const out: Story[] = []
  for (const r of f.regions) for (const c of r.crowds ?? []) {
    const was = prev?.regions.find((x) => x.id === r.id)?.crowds?.find((x) => x.topic === c.topic)
    const ref = { tick: f.tick, regionId: r.id }
    const at = `intensity ${Math.round(c.intensity * 100)} percent, approval in ${r.name} ${Math.round(r.approval * 100)} percent.`
    if (c.phase === 'outraged' && was?.phase !== 'outraged') out.push({ kind: 'crowd', ref, headline: `${r.name} is furious about ${c.topic}`, body: at })
    if (c.phase === 'bored' && was && was.phase !== 'bored') out.push({ kind: 'crowd', ref, headline: `${r.name} loses interest in ${c.topic}`, body: at })
    if (c.phase === 'realizing_cost' && was?.phase === 'outraged') out.push({ kind: 'crowd', ref, headline: `${r.name} weighs what ${c.topic} costs`, body: at })
  }
  return out
}

const frameAtOrBefore = (rec: RunRecord, tick: number) => rec.frames.filter((f) => f.tick <= tick).at(-1)

export function buildIssue(rec: RunRecord, yearIndex: number, upTo = Infinity): Issue | null {
  const { start, end } = yearSpan(yearIndex)
  const lastTick = rec.frames.at(-1)?.tick ?? 0
  const until = Math.min(end, upTo, lastTick)
  if (until < start) return null
  const frames = yearFrames(rec, yearIndex, upTo)
  const last = frameAtOrBefore(rec, until) ?? rec.frames[0]
  const before = start > 0 ? frameAtOrBefore(rec, start - 1) : undefined
  // every event this year by its own tick, most significant first
  const events = eventsBetween(rec, start, until).filter(({ e }) => e.kind !== 'law' && e.kind !== 'override')
    .sort((a, b) => (b.e.significance ?? b.e.severity) - (a.e.significance ?? a.e.severity))
  const decision = frames.find((f) => f.decision)
  const stories: Story[] = [
    ...events.map(({ e, f, index }) => eventStory(e, f, index)),
    ...(decision ? decision.decision!.laws.map((l) => lawStory(l, decision, rec.precedents ?? [])) : []),
    ...frames.flatMap((f, i) => crowdStories(f, i ? frames[i - 1] : before)),
  ]
  const year = FIRST_YEAR + yearIndex
  // a quiet year only once the whole year is in (its last month reached, and data up to it); before that, say so
  const yearDone = upTo >= end && lastTick >= end
  const fallback: Story = !yearDone
    ? { kind: 'decision', ref: { tick: last.tick }, headline: 'no news yet this year', body: `${year} is still going. nothing has made the front page so far.` }
    : { kind: 'decision', ref: { tick: last.tick }, headline: `no major events in ${year}`, body: `the record shows no disasters, revolts, wars, launches or breakthroughs in ${year}.` }
  const [lead, ...rest] = stories.length ? stories : [fallback]
  // the mood of the people the world follows (its recorded roster), at the latest point of the year
  const cits = rosterAt(rec, last.tick)
  const avg = Object.fromEntries(EMOTIONS.map((e) => [e, cits.length ? cits.reduce((a, c) => a + c.mood[e], 0) / cits.length : 0])) as Record<Emotion, number>
  const top = [...EMOTIONS].sort((a, b) => avg[b] - avg[a]).slice(0, 3).map((emotion) => ({ emotion, value: avg[emotion] }))
  const costNow = last.humanCost, costBefore = before?.humanCost
  const deaths = before === last ? 0 : Math.max(0, costNow.deaths - (costBefore?.deaths ?? 0))
  const displaced = before === last ? 0 : Math.max(0, costNow.displaced - (costBefore?.displaced ?? 0))
  return {
    year, yearIndex, date: dateOfTick(until), number: yearIndex + 1,
    lead, stories: rest.slice(0, 5),
    mood: { line: cits.length ? `most felt among the people followed: ${top.map((t) => t.emotion).join(', ')}.` : '', top, approval: costNow.approval },
    coreSays: decision?.decision?.publicStatement ? { quote: decision.decision.publicStatement, date: dateOfTick(decision.tick) } : undefined,
    cost: deaths > 0 || displaced > 0 ? { deaths, displaced } : undefined,
  }
}

export { people as fmtPeople }
