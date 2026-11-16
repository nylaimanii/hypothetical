import type { Frame, Region, RunRecord, WorldEvent } from '@/lib/types'
import { dateOfTick, eventDate, eventsBetween } from './truth'

export type FeedKind = WorldEvent['kind'] | 'decision' | 'crowd'
// tick: when it happened. frameTick: the frame that carries it (where its details live)
export type FeedItem = { key: string; tick: number; frameTick?: number; date: string; kind: FeedKind; regionId?: string; severity: number; text: string; danger: boolean; index?: number }

const KILLERS: FeedKind[] = ['war', 'pandemic']

// ember is only for deaths, revolts and failed launches
export function isDanger(kind: FeedKind, severity: number, text: string) {
  if (kind === 'revolt') return true
  if (kind === 'launch') return /fail/i.test(text)
  if (KILLERS.includes(kind)) return true
  if ((kind === 'famine' || kind === 'disaster') && severity >= 0.6) return true
  return false
}

// decisions and crowd turns up to the frame at the playhead; events by their own tick up to the playhead itself
export function feedFor(rec: RunRecord, idx: number, tick = rec.frames[idx]?.tick ?? 0): FeedItem[] {
  const out: FeedItem[] = []
  for (const f of rec.frames.slice(0, idx + 1)) {
    if (f.decision) out.push({ key: `${f.tick}-d`, tick: f.tick, date: dateOfTick(f.tick), kind: 'decision', severity: 0.4, text: f.decision.rationale, danger: false })
    for (const r of f.regions) for (const c of r.crowds ?? []) {
      if (c.sinceTick !== f.tick || (c.phase !== 'outraged' && c.phase !== 'bored')) continue
      out.push({ key: `${f.tick}-c-${r.id}-${c.topic}`, tick: f.tick, date: dateOfTick(f.tick), kind: 'crowd', regionId: r.id, severity: c.intensity, text: c.phase === 'outraged' ? `outraged over ${c.topic}` : `lost interest in ${c.topic}`, danger: false })
    }
  }
  for (const { e, f, index } of eventsBetween(rec, 0, tick)) {
    if (e.kind === 'law') continue
    out.push({ key: `${f.tick}-${index}`, tick: e.tick, frameTick: f.tick, date: eventDate(e), kind: e.kind, regionId: e.regionId, severity: e.severity, text: e.text, danger: isDanger(e.kind, e.severity, e.text), index })
  }
  return out.sort((a, b) => b.tick - a.tick)
}

// how much the director wants to look at something
const WEIGHT: Partial<Record<FeedKind, number>> = {
  launch: 1.25, crowd: 1.15, revolt: 1.1, war: 1.1, famine: 1, disaster: 0.95, pandemic: 0.9, migration: 0.75, injected: 1.3, breakthrough: 0.5, decision: 0.6,
}
export const shotScore = (kind: FeedKind, severity: number) => (WEIGHT[kind] ?? 0) * (0.5 + severity)

const pct = (v: number) => `${Math.round(v * 100)}%`

// "2031-04 · south asia · famine. 40% food shortfall", numbers flagged for the mono font
export function captionFor(kind: FeedKind, text: string, severity: number, regionId: string | undefined, frame: Frame, tick = frame.tick): { parts: { t: string; mono?: boolean }[]; danger: boolean } {
  const r: Region | undefined = frame.regions.find((x) => x.id === regionId)
  let detail = text
  if (kind === 'famine' && r) {
    const short = Math.max(0, 1 - r.foodKcalPerCapita / 2500)
    detail = short >= 0.05 ? `${pct(short)} food shortfall` : text
  } else if ((kind === 'revolt' || kind === 'war') && r) {
    detail = `${pct(r.unrest)} unrest. ${text}`
  } else if (kind === 'launch') {
    detail = `${text}. moon program ${pct(frame.moonProgress)}`
  } else if (kind === 'crowd' && r) {
    const c = r.crowds.find((x) => text.includes(x.topic))
    detail = c ? `${c.phase === 'outraged' ? 'outrage' : c.phase} over ${c.topic} at ${pct(c.intensity)}. approval ${pct(r.approval)}` : text
  } else if (kind === 'decision') {
    const d = frame.decision
    const laws = d?.laws.length ?? 0
    detail = `${laws} new law${laws === 1 ? '' : 's'}, space budget ${pct(frame.budget.space)}`
  }
  const when = dateOfTick(tick)
  const head = kind === 'decision' ? `${when} · the core decides` : [when, r?.name ?? 'world', kind === 'crowd' ? 'the crowd' : kind].join(' · ')
  const line = `${head}. ${detail}`
  const parts: { t: string; mono?: boolean }[] = []
  for (const tok of line.split(/(\d[\d.,:-]*[%mbkt]?)/)) if (tok) parts.push({ t: tok, mono: /^\d/.test(tok) })
  return { parts, danger: isDanger(kind, severity, text) }
}
