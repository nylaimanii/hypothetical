// THE DAILY: a front page per year, built only from that year's events, laws, crowds, precedents and human cost.
// templates, no llm. the voice is dry and deadpan; satire aims at behaviors and institutions, never at who people are.
import type { Emotion, Frame, Law, Precedent, RunRecord, WorldEvent } from '@/lib/types'
import { EMOTIONS } from '@/lib/mock/mood'

export type Story = {
  headline: string
  body: string
  kind: WorldEvent['kind'] | 'decision' | 'crowd'
  // where clicking the story should take you
  ref?: { tick: number; index?: number; regionId?: string }
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

// stable choice so the same year always prints the same paper
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }
const pick = <T,>(seed: string, xs: T[]) => xs[hash(seed) % xs.length]
// the paper keeps the product's lowercase voice
const cap = (s: string) => s
const people = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} billion` : n >= 1e6 ? `${Math.round(n / 1e6)} million` : n >= 1e3 ? `${Math.round(n / 1e3)} thousand` : `${Math.round(n)}`)
const brief = (t: string) => t.split(/[.;]/)[0].trim()

export const yearFrames = (rec: RunRecord, yearIndex: number) => rec.frames.filter((f) => f.tick >= yearIndex * 12 && f.tick < yearIndex * 12 + 12)
export const yearsOf = (rec: RunRecord, lastTick?: number) => {
  const last = lastTick ?? rec.frames.at(-1)?.tick ?? 0
  return Array.from({ length: Math.floor(last / 12) + 1 }, (_, i) => i)
}

function eventStory(e: WorldEvent, f: Frame, index: number, seed: string): Story {
  const r = f.regions.find((x) => x.id === e.regionId)
  const where = r?.name ?? 'the world'
  const what = brief(e.text)
  const ref = { tick: f.tick, index, regionId: e.regionId }
  const fail = /fail|scrub/i.test(e.text)
  switch (e.kind) {
    case 'famine':
      return { kind: e.kind, ref, headline: `${where}: food runs short, officials confirm hunger "remains a priority"`, body: `${cap(what)}. ${pick(seed, [
        'a task force on hunger met for six hours and ordered lunch.',
        'the ministry has scheduled a summit on the shortage, catered.',
        'a regional office released a report on food. it was twelve pages and contained no food.',
      ])} ${pick(seed + 'h', [
        'enterprising locals are already selling "i survived the shortage" tote bags, priced at about a week of grain.',
        'a hustler near the market is selling commemorative empty bowls.',
      ])}` }
    case 'revolt':
      return { kind: e.kind, ref, headline: `${where} takes to the streets`, body: `${cap(what)}. ${pick(seed, [
        'organizers vow to stay until their demands are met or it rains, whichever comes first.',
        'protesters say they will not go home. several have since gone home for a jacket.',
      ])} ${pick(seed + 'v', [
        'a vendor reports record sales of blank protest signs, "so customers can decide later what they are angry about."',
        'merch tables outnumbered speakers by early afternoon.',
      ])}` }
    case 'war':
      return { kind: e.kind, ref, headline: `${where}: regional governors stop answering their phones`, body: `${cap(what)}. the central office has responded by forming a committee on communication, which has not yet met because no one answered the invitation.` }
    case 'disaster':
      return { kind: e.kind, ref, headline: `${cap(what)}`, body: `${pick(seed, [
        `rescue crews worked through the night in ${where}. meanwhile, insurers formed a committee to decide whether the disaster counted as a disaster. the committee has formed a subcommittee.`,
        `neighbors in ${where} pulled each other out of the water before any form could be filed. the forms arrived the following week, in triplicate.`,
      ])}` }
    case 'pandemic':
      return { kind: e.kind, ref, headline: `${where}: fever spreads, hand washing briefly fashionable`, body: `${cap(what)}. clinics are full. a wellness influencer has released a sixteen step morning routine that does not mention the fever at all.` }
    case 'breakthrough':
      return { kind: e.kind, ref, headline: `scientists announce: ${what}`, body: `the result was published, peer reviewed and immediately misquoted. asked for comment, the public wanted to know if it comes in a flavor.` }
    case 'launch':
      return fail
        ? { kind: e.kind, ref, headline: `rocket goes up, comes back down sooner than planned`, body: `${cap(what)}. engineers describe the outcome as "very informative." souvenir debris is already for sale online, most of it from a hardware store.` }
        : { kind: e.kind, ref, headline: `${cap(what)}`, body: `crowds cheered for eleven minutes, then returned to arguing about parking. commemorative mugs sold out before the rocket cleared the clouds.` }
    case 'migration':
      return { kind: e.kind, ref, headline: `the great move: ${what}`, body: `the housing office has announced a waiting list for the waiting list. new arrivals report that the paperwork asks for a previous address, a future address, and a reason, in that order.` }
    default:
      return { kind: e.kind, ref, headline: cap(what), body: 'officials say more information will follow. it usually does.' }
  }
}

function lawStory(l: Law, f: Frame, precedents: Precedent[], seed: string): Story {
  const prec = l.precedentIds.map((id) => precedents.find((p) => p.id === id)).find(Boolean)
  const precLine = prec
    ? ` the last time anyone tried this (${prec.country}, ${prec.year}) the result was ${prec.reaction}. officials say this time is different because it is a different year.`
    : ' no one can find a precedent, which officials describe as "innovation."'
  const fans = l.lovedBy.length ? ` supporters include ${l.lovedBy.slice(0, 2).join(' and ')}.` : ''
  const foes = l.hatedBy.length ? ` ${cap(l.hatedBy.slice(0, 2).join(' and '))} have already printed the stickers.` : ''
  return {
    kind: 'law', ref: { tick: f.tick },
    headline: `new law: ${l.title}`,
    body: `${cap(brief(l.text))}.${precLine}${fans}${foes}${pick(seed, ['', ' a committee has been formed to review the committee that drafted it.'])}`,
  }
}

function crowdStories(f: Frame, prev: Frame | undefined): Story[] {
  const out: Story[] = []
  for (const r of f.regions) for (const c of r.crowds ?? []) {
    const was = prev?.regions.find((x) => x.id === r.id)?.crowds?.find((x) => x.topic === c.topic)
    if (c.phase === 'outraged' && was?.phase !== 'outraged') out.push({ kind: 'crowd', ref: { tick: f.tick, regionId: r.id }, headline: `${r.name} is furious about ${c.topic}`, body: `outrage is at ${Math.round(c.intensity * 100)} percent, according to a poll of people who were already shouting. analysts expect the issue to dominate conversation until roughly spring.` })
    if (c.phase === 'bored' && was && was.phase !== 'bored') out.push({ kind: 'crowd', ref: { tick: f.tick, regionId: r.id }, headline: `${r.name} quietly forgets ${c.topic}`, body: `an informal survey found most former protesters could no longer say what the signs were about. the signs themselves are being resold, lightly used, for the next outrage.` })
    if (c.phase === 'realizing_cost' && was?.phase === 'outraged') out.push({ kind: 'crowd', ref: { tick: f.tick, regionId: r.id }, headline: `${r.name} discovers ${c.topic} costs money`, body: `the movement has entered the "wait, who pays for this" phase. attendance is down, spreadsheets are up.` })
  }
  return out
}

export function buildIssue(rec: RunRecord, yearIndex: number): Issue | null {
  const frames = yearFrames(rec, yearIndex)
  if (!frames.length) return null
  const last = frames.at(-1)!
  const before = rec.frames.filter((f) => f.tick < yearIndex * 12).at(-1)
  const seed = `${rec.runId}:${yearIndex}`
  // every event this year, most significant first
  const events = frames.flatMap((f) => f.newEvents.map((e, index) => ({ e, f, index }))).filter(({ e }) => e.kind !== 'law' && e.kind !== 'override')
    .sort((a, b) => (b.e.significance ?? b.e.severity) - (a.e.significance ?? a.e.severity))
  const decision = frames.find((f) => f.decision)
  const stories: Story[] = [
    ...events.map(({ e, f, index }) => eventStory(e, f, index, `${seed}:${index}:${e.kind}`)),
    ...(decision ? decision.decision!.laws.map((l) => lawStory(l, decision, rec.precedents ?? [], `${seed}:${l.id}`)) : []),
    ...frames.flatMap((f, i) => crowdStories(f, i ? frames[i - 1] : before)),
  ]
  const fallback: Story = {
    kind: 'decision', ref: { tick: frames[0].tick },
    headline: pick(seed, ['nothing happens, experts baffled', 'slow year: citizens report doing their jobs', 'quiet year reported; pundits furious']),
    body: 'no disasters, no revolts, no launches. talk shows filled the time by asking whether the quiet was suspicious. it was not.',
  }
  const [lead, ...rest] = stories.length ? stories : [fallback]
  // the public mood: average feelings across everyone this year
  const cits = last.citizens
  const avg = Object.fromEntries(EMOTIONS.map((e) => [e, cits.length ? cits.reduce((a, c) => a + c.mood[e], 0) / cits.length : 0])) as Record<Emotion, number>
  const top = [...EMOTIONS].sort((a, b) => avg[b] - avg[a]).slice(0, 3).map((emotion) => ({ emotion, value: avg[emotion] }))
  const MOOD: Partial<Record<Emotion, string>> = {
    anger: 'the public is angry, mostly in the comments.', fear: 'people are nervous and buying batteries.', joy: 'people seem fine, which some find suspicious.',
    hope: 'cautious optimism detected. experts urge calm.', grief: 'a heavy year. neighbors are checking on neighbors.', boredom: 'a nation shrugs.',
    distrust: 'nobody believes anybody, including this newspaper.', envy: 'everyone is sure the next region over has it easier.', pride: 'people are proud of themselves, loudly.', awe: 'people keep looking up.',
  }
  const costNow = last.humanCost, costBefore = before?.humanCost
  const deaths = Math.max(0, costNow.deaths - (costBefore?.deaths ?? 0))
  const displaced = Math.max(0, costNow.displaced - (costBefore?.displaced ?? 0))
  return {
    year: Number(frames[0].date.slice(0, 4)),
    yearIndex, date: last.date, number: yearIndex + 1,
    lead, stories: rest.slice(0, 5),
    mood: { line: MOOD[top[0]?.emotion] ?? 'the public is having a year.', top, approval: costNow.approval },
    coreSays: decision?.decision?.publicStatement ? { quote: decision.decision.publicStatement, date: decision.date } : undefined,
    cost: deaths > 0 || displaced > 0 ? { deaths, displaced } : undefined,
  }
}

export { people as fmtPeople }
