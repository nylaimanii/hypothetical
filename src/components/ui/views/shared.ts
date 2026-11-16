'use client'
import type { Agent, Emotion, Frame, Frontier, Mood, RunRecord } from '@/lib/types'
import { eventsBetween, populationOf, yearIndexOfTick, yearSpan } from '../truth'
import { EMOTIONS } from '@/lib/mock/mood'

export type ViewWorld = { record: RunRecord; agent?: Agent; color: string; active: boolean; label: string }

export const FRONTIERS: Frontier[] = ['none', 'moon_landing', 'moon_base', 'mars_crewed', 'mars_settlement', 'mars_self_sustaining', 'asteroid_mining', 'outer_system']
export const frontierLabel = (f: Frontier) => (f === 'none' ? 'earth only' : f.replace(/_/g, ' '))

// validated with the dataviz palette script against the bone surface (#efe8da); low-contrast slots get labels + tooltips + table
export const ENERGY = [
  { key: 'solar', label: 'solar', color: '#eda100' },
  { key: 'wind', label: 'wind', color: '#1baf7a' },
  { key: 'hydro', label: 'hydro', color: '#2a78d6' },
  { key: 'nuclear', label: 'nuclear', color: '#e87ba4' },
  { key: 'fossil', label: 'fossil', color: '#6250d6' },
] as const
export const EMO_SLOTS = ['#2a78d6', '#1baf7a', '#6250d6', '#eda100', '#e87ba4', '#008300']
export const OTHER = '#9a948a'

export { yearOfTick } from '../truth'

// frames sorted by tick, about one per year for long histories (the last frame of each year)
export function yearly(rec: RunRecord): Frame[] {
  const fs = [...rec.frames].sort((a, b) => a.tick - b.tick)
  if (fs.length <= 30) return fs
  const out: Frame[] = []
  for (const f of fs) {
    const y = yearIndexOfTick(f.tick)
    if (out.length && yearIndexOfTick(out[out.length - 1].tick) === y) out[out.length - 1] = f
    else out.push(f)
  }
  if (out[0] !== fs[0]) out.unshift(fs[0])
  return out
}

const weighted = (f: Frame, pick: (r: Frame['regions'][number]) => number) => {
  const pop = f.regions.reduce((a, r) => a + r.population, 0) || 1
  return f.regions.reduce((a, r) => a + pick(r) * r.population, 0) / pop
}

export const metric = {
  population: (f: Frame) => populationOf(f),
  ple: (f: Frame) => f.globalPeriodLifeExpectancy,
  approval: (f: Frame) => (f.humanCost?.approval || weighted(f, (r) => r.approval)),
  fertility: (f: Frame) => weighted(f, (r) => r.fertility),
  frontier: (f: Frame) => Math.max(0, FRONTIERS.indexOf(f.frontier)),
}

// humanCost counts are cumulative; per-year deaths are the difference between yearly points
export function deathsPerYear(fs: Frame[], key: 'deaths' | 'famineDeaths' | 'unrestDeaths') {
  return fs.slice(1).map((f, i) => {
    const prev = fs[i]
    const years = Math.max(1 / 12, (f.tick - prev.tick) / 12)
    return { tick: f.tick, v: Math.max(0, ((f.humanCost?.[key] ?? 0) - (prev.humanCost?.[key] ?? 0)) / years) }
  })
}

export function energyMix(f: Frame) {
  const rs = f.regions.filter((r) => r.visual?.energyMix)
  if (!rs.length) return null
  const pop = rs.reduce((a, r) => a + r.population, 0) || 1
  const out: Record<string, number> = { solar: 0, wind: 0, hydro: 0, nuclear: 0, fossil: 0 }
  for (const r of rs) {
    const mix = r.visual!.energyMix as Record<string, number>
    for (const k of Object.keys(out)) out[k] += (mix[k] ?? 0) * r.population / pop
  }
  return out
}

export function moodOf(f: Frame): Mood {
  const m = Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as Mood
  const rs = f.regions.filter((r) => r.emotionMix)
  if (rs.length) {
    const pop = rs.reduce((a, r) => a + r.population, 0) || 1
    for (const r of rs) for (const e of EMOTIONS) m[e] += r.emotionMix![e] * r.population / pop
  } else if (f.citizens.length) {
    for (const c of f.citizens) for (const e of EMOTIONS) m[e] += c.mood[e] / f.citizens.length
  }
  return m
}

// the 6 strongest emotions over the run get a color; the rest fold into "other"
export function emotionSlots(fs: Frame[]): { key: Emotion | 'other'; label: string; color: string }[] {
  const tot = Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as Mood
  for (const f of fs) { const m = moodOf(f); for (const e of EMOTIONS) tot[e] += m[e] }
  const top = [...EMOTIONS].sort((a, b) => tot[b] - tot[a]).slice(0, 6)
  return [...top.map((e, i) => ({ key: e, label: e, color: EMO_SLOTS[i] })), { key: 'other' as const, label: 'the other four', color: OTHER }]
}

// the year's biggest event so far: the calendar year of the playhead, events by their own tick, never past it
export function biggestEvent(rec: RunRecord, tick: number) {
  let best: { text: string; severity: number } | null = null
  for (const { e } of eventsBetween(rec, yearSpan(yearIndexOfTick(tick)).start, tick)) if (!best || e.severity > best.severity) best = { text: e.text, severity: e.severity }
  return best
}

export const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }
