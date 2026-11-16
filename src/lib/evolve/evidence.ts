// the evidence layer: every claim a report, leaderboard or telegram makes about why a world did well or died, built
// only from the records (frames, decisions, cause links), the feature index and the real UN baseline. nothing here
// writes a sentence that is not filled from real state.
//   autopsy(record)            how a dead world died: the cause chain walked back from the end, the core's decision
//                              on it, the regions lost, the human cost
//   realBaseline(record)       the world against UN World Population Prospects 2024 (medium variant) at the same year
//   explainGap(a, b)           the 3 decisive decisions between a world and the one ranked below it, and what it cost
import fs from 'node:fs'
import path from 'node:path'
import type { CauseLink, Frame, Law, Provenance, RunRecord } from '../types'
import { dateOf, dateOfTick, frameAt, lastFrame, lifeExpectancyOf, people, populationOf, yearOfTick } from './facts'
import { featuresOf, readSteps, type RunFeatures } from './steps'

// ---------- names of places, from the record itself ----------
function placeName(rec: RunRecord, id: string): string {
  if (id === 'world') return 'the world'
  const f = lastFrame(rec)
  return f?.regions.find(r => r.id === id)?.name ?? f?.countries?.find(c => c.id === id)?.name ?? id
}
const lower = (s: string) => s.replace(/^./, c => c.toLowerCase())
const stripEnd = (s: string) => s.trim().replace(/[.\s]+$/, '')

// ---------- autopsy ----------
export type Autopsy = {
  runId: string; died: string; kind: string; cause: string | null
  chain: { tick: number; date: string; place: string; what: string; because: string; byWhom: string; again: string[] }[]
  decision: { tick: number; date: string; what: string; said: string | null } | null
  lost: { kind: string; regions: string[]; since: string }[]
  cost: { deaths: number; famineDeaths: number; unrestDeaths: number; displaced: number } | null
}
type Link = CauseLink & { sig?: number }

// b's own autopsy in the record (sim 5.10.2+): the chain from the core's first decision to the death. one source:
// when it is there, it is the autopsy; the walk below is only for older records
type SimAutopsy = { tick: number; date: string; death: string; chain: { tick: number; date: string; place: string; what: string; because: string; value: number; byWhom: string; how: 'cause' | 'timing'; lawId?: string }[] }

export function autopsy(rec: RunRecord): Autopsy | null {
  const last = lastFrame(rec)
  if (!last || (rec.summary.status !== 'destroyed' && last.status !== 'destroyed')) return null
  const sim = (rec as RunRecord & { autopsy?: SimAutopsy }).autopsy
  if (sim?.chain?.length) return fromSim(rec, sim, last)
  const links = new Map<string, Link>()
  for (const f of rec.frames) for (const l of (f.causes ?? []) as Link[]) links.set(l.id, l)
  const all = [...links.values()]
  const sig = (l: Link) => l.sig ?? 0
  // the end: the most significant link of the final ticks
  const endTick = Math.max(...all.map(l => l.tick), -1)
  // the link the death is about: in the last 3 years, the one that names the recorded cause (its kind of death or the
  // places it names) wins over a merely loud one, so a late disaster never stands in for the revolt that ended it
  const cause = (rec.summary.causeOfDeath ?? '').toLowerCase()
  const kindWord = /\b(revolt|war|famine|pandemic|collapse|disaster)/.exec(cause)?.[1]
  const fit = (l: Link) => (kindWord && l.what.toLowerCase().includes(kindWord) ? 2 : 0) + (cause && cause.includes(placeName(rec, l.placeId).toLowerCase()) ? 1 : 0)
  const final = all.filter(l => l.tick >= endTick - 36).sort((a, b) => fit(b) - fit(a) || sig(b) - sig(a) || b.tick - a.tick)[0]
  const chain: Link[] = []
  for (let cur: Link | undefined = final, n = 0; cur && n < 6 && !chain.includes(cur); n++) {
    chain.unshift(cur)
    cur = cur.causeIds.map(id => links.get(id)).filter((x): x is Link => !!x).sort((a, b) => sig(b) - sig(a) || b.tick - a.tick)[0]
  }
  // the core's own decision on the way down: the earliest link the core made, with the law it passed and its words
  const coreLink = chain.find(l => l.byWhom === 'core')
  let decision: Autopsy['decision'] = null
  if (coreLink) {
    const law = coreLink.lawId ? rec.frames.flatMap(f => f.laws).find((l: Law) => l.id === coreLink.lawId) : undefined
    const decided = rec.frames.filter(f => f.decision && f.tick <= coreLink.tick).sort((a, b) => b.tick - a.tick)[0]?.decision
    const said = decided?.reasoning?.expected || decided?.rationale || null
    decision = { tick: law?.enactedTick ?? coreLink.tick, date: dateOfTick(law?.enactedTick ?? coreLink.tick), what: law ? `the core passed "${law.title}"` : lower(stripEnd(coreLink.what)), said: said ? stripEnd(said).slice(0, 160) : null }
  }
  // regions fully lost by the end, by kind, and when the last of them went
  const lost = new Map<string, { regions: string[]; since: number }>()
  for (const r of last.regions) {
    const d = r.visual?.damage
    if (!d || d.kind === 'none' || d.level < 1) continue
    const first = rec.frames.filter(f => f.regions.find(x => x.id === r.id)?.visual?.damage?.kind === d.kind && (f.regions.find(x => x.id === r.id)?.visual?.damage?.level ?? 0) >= 0.5).sort((a, b) => a.tick - b.tick)[0]
    const e = lost.get(d.kind) ?? { regions: [], since: -1 }
    e.regions.push(r.name)
    e.since = Math.max(e.since, first?.tick ?? last.tick)
    lost.set(d.kind, e)
  }
  const c = last.humanCost ?? rec.summary.humanCost
  return {
    runId: rec.runId, died: dateOf(last), kind: [...last.newEvents].sort((x, y) => y.severity - x.severity)[0]?.kind ?? [...lost.keys()][0] ?? 'collapse',
    cause: rec.summary.causeOfDeath ?? null,
    chain: chain.reduce<Autopsy['chain']>((out, l) => {
      const e = { tick: l.tick, date: dateOfTick(l.tick), place: placeName(rec, l.placeId), what: stripEnd(l.what), because: stripEnd(l.because), byWhom: l.byWhom, again: [] as string[] }
      const same = out.find(x => x.place === e.place && x.what === e.what)
      if (same) same.again.push(e.date)
      else out.push(e)
      return out
    }, []),
    decision,
    lost: [...lost].map(([kind, v]) => ({ kind, regions: v.regions, since: dateOfTick(v.since) })),
    cost: c ? { deaths: c.deaths, famineDeaths: c.famineDeaths, unrestDeaths: c.unrestDeaths, displaced: c.displaced } : null,
  }
}

function lostRegions(rec: RunRecord, last: Frame): Autopsy['lost'] {
  const lost = new Map<string, { regions: string[]; since: number }>()
  for (const r of last.regions) {
    const d = r.visual?.damage
    if (!d || d.kind === 'none' || d.level < 1) continue
    const first = rec.frames.filter(f => f.regions.find(x => x.id === r.id)?.visual?.damage?.kind === d.kind && (f.regions.find(x => x.id === r.id)?.visual?.damage?.level ?? 0) >= 0.5).sort((a, b) => a.tick - b.tick)[0]
    const e = lost.get(d.kind) ?? { regions: [], since: -1 }
    e.regions.push(r.name)
    e.since = Math.max(e.since, first?.tick ?? last.tick)
    lost.set(d.kind, e)
  }
  return [...lost].map(([kind, v]) => ({ kind, regions: v.regions, since: dateOfTick(v.since) }))
}

function fromSim(rec: RunRecord, sim: SimAutopsy, last: Frame): Autopsy {
  const chain: Autopsy['chain'] = []
  for (const l of sim.chain) {
    const e = { tick: l.tick, date: l.date || dateOfTick(l.tick), place: l.place, what: stripEnd(l.what), because: stripEnd(l.because) + (l.how === 'timing' ? ', linked by timing, not proven' : ''), byWhom: l.byWhom, again: [] as string[] }
    const same = chain.find(x => x.place === e.place && x.what === e.what)
    if (same) same.again.push(e.date)
    else chain.push(e)
  }
  // the core's call: the decision the chain starts from
  const first = sim.chain.find(l => l.byWhom === 'core')
  const decided = first ? rec.frames.filter(f => f.decision && f.tick <= first.tick).sort((a, b) => b.tick - a.tick)[0]?.decision : undefined
  const said = decided?.reasoning?.expected || decided?.rationale || null
  const c = last.humanCost ?? rec.summary.humanCost
  return {
    runId: rec.runId, died: sim.date || dateOf(last),
    kind: [...last.newEvents].sort((x, y) => y.severity - x.severity)[0]?.kind ?? 'collapse',
    cause: sim.death ?? rec.summary.causeOfDeath ?? null,
    chain,
    decision: first ? { tick: first.tick, date: first.date || dateOfTick(first.tick), what: lower(stripEnd(first.what)) + (first.how === 'timing' ? ' (linked by timing, not proven)' : ''), said: said ? stripEnd(said).slice(0, 160) : null } : null,
    lost: lostRegions(rec, last),
    cost: c ? { deaths: c.deaths, famineDeaths: c.famineDeaths, unrestDeaths: c.unrestDeaths, displaced: c.displaced } : null,
  }
}

const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

// the autopsy in plain lines (telegram, reports). `max` caps the chain lines
export function autopsyLines(a: Autopsy, max = 4): string[] {
  const out = [a.cause ? `autopsy: died ${a.died}. ${stripEnd(a.cause)}.` : `autopsy: died ${a.died}, ${a.kind === 'war' || a.kind === 'revolt' ? `in ${a.kind}` : `of ${a.kind}`}.`]
  const chain = a.chain.slice(-max)
  if (chain.length) out.push(...chain.map(l => `${l.date}, ${l.place}: ${l.what}${l.because && l.because !== l.what ? ` (${l.because})` : ''}${l.again.length ? `, again in ${list(l.again.map(d => d.slice(0, 4)).filter((y, i, xs) => xs.indexOf(y) === i))}` : ''}`))
  if (a.decision) out.push(`the core's call, ${a.decision.date}: ${a.decision.what}.${a.decision.said ? ` its reasoning that year: "${a.decision.said}"` : ''}`)
  if (a.lost.length) out.push(`lost: ${a.lost.map(l => `${list(l.regions)} to ${l.kind} by ${l.since}`).join('; ')}.`)
  if (a.cost) out.push(`cost: ${people(a.cost.deaths)} deaths (${people(a.cost.famineDeaths)} famine, ${people(a.cost.unrestDeaths)} unrest), ${people(a.cost.displaced)} displaced.`)
  return out
}

// ---------- the real baseline: UN World Population Prospects 2024, medium variant ----------
type UnFile = { population: { byYear: Record<string, number>; provenance: Provenance & { url: string } }; lifeExpectancy: { byYear: Record<string, number>; provenance: Provenance & { url: string } } }
let un: UnFile | null | undefined
export function unProjections(): UnFile | null {
  if (un === undefined) { try { un = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'real', 'un-wpp-2024.json'), 'utf8')) as UnFile } catch { un = null } }
  return un
}
export const resetUnCache = () => { un = undefined }

export type RealBaseline = {
  year: number
  lifeExpectancy: { world: number; un: number; diff: number }
  population: { world: number; un: number; diff: number }
  source: string
  text: string
}

// compared at 2076 (50 years in) when the world got there, else at its last year
export function realBaseline(rec: Pick<RunRecord, 'frames'>, atYear?: number): RealBaseline | null {
  const u = unProjections()
  const last = lastFrame(rec)
  if (!u || !last) return null
  const lastYear = yearOfTick(last.tick)
  const year = Math.min(atYear ?? (lastYear >= 2076 ? 2076 : lastYear), lastYear, 2100)
  const unLe = u.lifeExpectancy.byYear[String(year)], unPop = u.population.byYear[String(year)]
  // the frame in force at the end of that year
  const f = frameAt(rec, Math.max(0, (year - 2026) * 12 + 1))
  if (unLe === undefined || unPop === undefined || !f) return null
  const le = lifeExpectancyOf(f), pop = populationOf(f)
  const dLe = Math.round((le - unLe) * 10) / 10, dPop = pop - unPop
  const leText = Math.abs(dLe) < 0.05 ? 'matched UN projections on life expectancy' : `${dLe > 0 ? 'beat' : 'trailed'} UN projections by ${Math.abs(dLe).toFixed(1)} years of life expectancy`
  const popText = Math.abs(dPop) < 5e5 ? 'the same number of people alive' : `${people(dPop)} ${dPop > 0 ? 'more' : 'fewer'} people alive`
  return {
    year, lifeExpectancy: { world: Math.round(le * 10) / 10, un: Math.round(unLe * 10) / 10, diff: dLe }, population: { world: pop, un: unPop, diff: dPop },
    source: u.population.provenance.url,
    text: `${leText}, ${popText} by ${year}`,
  }
}

// ---------- why one world beat the next ----------
export type GapExplanation = { vs: string; decisive: string[]; consequence: string | null; text: string; reasons?: GapReason[] }
// one decisive decision, for a clickable list: tick and run only where the difference has a real moment (a law passed
// in a given month, a replayed decision), never for a budget average over the whole run
export type GapReason = { text: string; tick?: number; share?: number; run?: string }
const pct = (x: number) => `${Math.round(x * 100)}%`
const words = (s: string) => s.replace(/[_-]+/g, ' ').trim()
const an = (s: string) => `${/^[aeiou]/i.test(s) ? 'an' : 'a'} ${s}`

// the first kind of damage a world suffered across whole regions, and by when that many regions had it
function worstLoss(rec: RunRecord): { kind: string; regions: number; by: number } | null {
  const first = new Map<string, { kind: string; tick: number }>()
  for (const f of [...rec.frames].sort((a, b) => a.tick - b.tick)) for (const r of f.regions) {
    const d = r.visual?.damage
    if (d && d.kind !== 'none' && d.level >= 0.5 && !first.has(r.id)) first.set(r.id, { kind: d.kind, tick: f.tick })
  }
  if (!first.size) return null
  const byKind = new Map<string, number[]>()
  for (const v of first.values()) byKind.set(v.kind, [...(byKind.get(v.kind) ?? []), v.tick])
  const [kind, ticks] = [...byKind].sort((a, b) => b[1].length - a[1].length || Math.min(...a[1]) - Math.min(...b[1]))[0]
  return { kind, regions: ticks.length, by: Math.max(...ticks) }
}

export function explainGap(a: { name: string; record: RunRecord; features?: RunFeatures }, b: { name: string; record: RunRecord; features?: RunFeatures }): GapExplanation {
  const fa = a.features ?? featuresOf(a.record), fb = b.features ?? featuresOf(b.record)
  // weigh each difference by how much the cross-world recipe says that kind of decision matters
  const steps = readSteps()
  const effect = new Map([...(steps?.helped ?? []), ...(steps?.hurt ?? [])].map(s => [s.id, Math.abs(s.effect)]))
  const cands: { w: number; text: string; tick?: number; run?: string }[] = []
  for (const k of Object.keys(fa.budget) as (keyof RunFeatures['budget'])[]) {
    const d = fa.budget[k] - fb.budget[k]
    if (Math.abs(d) < 0.03) continue
    const w = Math.abs(d) * (1 + Math.max(effect.get(`budget-high-${k}`) ?? 0, effect.get(`budget-low-${k}`) ?? 0))
    cands.push({ w, text: `${a.name} put ${pct(fa.budget[k])} of the budget into ${k}, ${b.name} ${pct(fb.budget[k])}` })
  }
  const kinds = new Set([...Object.keys(fa.lawFirstTick), ...Object.keys(fb.lawFirstTick)].filter(k => k !== 'other'))
  for (const k of kinds) {
    const ta = fa.lawFirstTick[k], tb = fb.lawFirstTick[k]
    const w = 0.04 + (effect.get(`law-${k}`) ?? 0) + (effect.get(`law-early-${k}`) ?? 0)
    if (ta !== undefined && tb === undefined) cands.push({ w, tick: ta, run: a.record.runId, text: `${a.name} passed ${an(words(k))} law in ${yearOfTick(ta)}, ${b.name} never did` })
    else if (tb !== undefined && ta === undefined) cands.push({ w, tick: tb, run: b.record.runId, text: `${b.name} passed ${an(words(k))} law in ${yearOfTick(tb)}, ${a.name} never did` })
    else if (ta !== undefined && tb !== undefined && Math.abs(ta - tb) >= 60) cands.push({ w: w * 0.6, tick: Math.min(ta, tb), run: ta < tb ? a.record.runId : b.record.runId, text: `${ta < tb ? a.name : b.name} passed ${an(words(k))} law in ${yearOfTick(Math.min(ta, tb))}, ${Math.round(Math.abs(ta - tb) / 12)} years before ${ta < tb ? b.name : a.name}` })
  }
  const top = cands.sort((x, y) => y.w - x.w).slice(0, 3)
  const decisive = top.map(c => c.text)
  const reasons: GapReason[] = top.map(c => c.tick !== undefined ? { text: c.text, tick: c.tick, run: c.run } : { text: c.text })
  const loss = worstLoss(b.record), lossA = worstLoss(a.record)
  const consequence = loss && (!lossA || lossA.regions < loss.regions) ? `${b.name} lost ${loss.regions} region${loss.regions > 1 ? 's' : ''} to ${loss.kind} by ${yearOfTick(loss.by)}` : null
  const body = decisive.length ? list(decisive) : `their decisions were close (no budget line more than 3 points apart, the same laws)`
  return { vs: b.record.runId, decisive, reasons, consequence, text: `${body}${consequence ? `, and ${consequence}` : ''}.` }
}

// ---------- per-world evidence index (data/runs/evidence.json) ----------
// small and shipped with the deploy, so the read-only site shows every score next to its real baseline without the
// big records. written when a world finishes; backfilled for older worlds after each generation
export type WorldEvidence = { realBaseline: RealBaseline | null; autopsy: Autopsy | null }
const evidenceFile = () => path.join(process.cwd(), 'data', 'runs', 'evidence.json')
export function readEvidence(): Record<string, WorldEvidence> {
  try { return JSON.parse(fs.readFileSync(evidenceFile(), 'utf8')) as Record<string, WorldEvidence> } catch { return {} }
}
function writeEvidence(all: Record<string, WorldEvidence>) {
  fs.mkdirSync(path.dirname(evidenceFile()), { recursive: true })
  const tmp = `${evidenceFile()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(all))
  fs.renameSync(tmp, evidenceFile())
}
export const evidenceOf = (rec: RunRecord): WorldEvidence => ({ realBaseline: realBaseline(rec), autopsy: autopsy(rec) })
export function indexEvidence(rec: RunRecord) {
  const all = readEvidence()
  all[rec.runId] = evidenceOf(rec)
  writeEvidence(all)
}
export function backfillEvidence(ids: string[], read: (id: string) => RunRecord | null): number {
  const all = readEvidence()
  let n = 0
  for (const id of ids) {
    if (all[id]) continue
    const rec = read(id)
    if (!rec) continue
    all[id] = evidenceOf(rec)
    n++
  }
  if (n) writeEvidence(all)
  return n
}
