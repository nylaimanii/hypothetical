// the life clock and where the chosen person is on it. pure functions over a LifeRecord, no react.
// time is "days since birth" (birth = 2026-11-01). one tick = one month = 30.4375 days.
import type { Kin, LifeActivity, LifeRecord, MonthSnap, Workplace } from '@/lib/life/types'
import type { Layout, Lot, V2 } from '@/components/world/city/layout'
import { pathBetween } from '@/components/world/city/layout'

export const DAYS_PER_TICK = 30.4375
export const SPEEDS = { day: 1, year: 365.25, decade: 3652.5 } as const
export type Speed = keyof typeof SPEEDS

export const tickOf = (days: number) => Math.floor(days / DAYS_PER_TICK)
export const yearOf = (tick: number) => 2026 + Math.floor((tick + 10) / 12)
export const ageAt = (days: number) => days / 365.25

export function snapAt(r: LifeRecord, tick: number): MonthSnap {
  const i = Math.max(0, Math.min(r.snaps.length - 1, tick - (r.snaps[0]?.tick ?? 0)))
  return r.snaps[i]
}
export const lastDay = (r: LifeRecord) => ((r.deathTick ?? r.snaps.length - 1) + 1) * DAYS_PER_TICK - 0.01

// mood blended between this month and the next, so feelings drift instead of jumping on the first of the month
export function moodAt(r: LifeRecord, days: number): Record<string, number> {
  const t = tickOf(days)
  const a = snapAt(r, t).mood, b = snapAt(r, t + 1).mood
  const k = days / DAYS_PER_TICK - t
  const out: Record<string, number> = {}
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) out[key] = (a[key as keyof typeof a] ?? 0) * (1 - k) + (b[key as keyof typeof b] ?? 0) * k
  return out
}

// ---------- the day ----------
export type PlaceKind = 'home' | 'work' | 'school' | 'market' | 'park' | 'clinic' | 'square'
type Stop = { hour: number; at: PlaceKind; act: 'sleep' | 'eat' | 'work' | 'learn' | 'play' | 'rest' | 'shop' | 'care' | 'sit' }

// a plain day for each kind of month. ESTIMATE schedules (cf. the main site's day plans in src/components/world/city/day.ts)
function stopsFor(a: LifeActivity, hasKids: boolean): Stop[] {
  switch (a) {
    case 'working': return [{ hour: 0, at: 'home', act: 'sleep' }, { hour: 6.5, at: 'home', act: 'eat' }, { hour: 8, at: 'work', act: 'work' }, { hour: 17.5, at: 'market', act: 'shop' }, { hour: 18.5, at: 'home', act: 'eat' }, { hour: 19.5, at: hasKids ? 'park' : 'home', act: 'play' }, { hour: 21, at: 'home', act: 'rest' }, { hour: 22.5, at: 'home', act: 'sleep' }]
    case 'school': case 'studying': return [{ hour: 0, at: 'home', act: 'sleep' }, { hour: 7, at: 'home', act: 'eat' }, { hour: 8, at: 'school', act: 'learn' }, { hour: 15, at: 'park', act: 'play' }, { hour: 18, at: 'home', act: 'eat' }, { hour: 21.5, at: 'home', act: 'sleep' }]
    // babies and toddlers stay with the family at home (until B's social network lets a parent carry them out)
    case 'infant': return [{ hour: 0, at: 'home', act: 'sleep' }, { hour: 8, at: 'home', act: 'play' }, { hour: 12.5, at: 'home', act: 'sleep' }, { hour: 14.5, at: 'home', act: 'play' }, { hour: 17, at: 'home', act: 'eat' }, { hour: 19.5, at: 'home', act: 'sleep' }]
    case 'retired': return [{ hour: 0, at: 'home', act: 'sleep' }, { hour: 7, at: 'home', act: 'eat' }, { hour: 9, at: 'park', act: 'sit' }, { hour: 11, at: 'market', act: 'shop' }, { hour: 12.5, at: 'home', act: 'rest' }, { hour: 16, at: 'square', act: 'sit' }, { hour: 18, at: 'home', act: 'eat' }, { hour: 21.5, at: 'home', act: 'sleep' }]
    case 'unemployed': return [{ hour: 0, at: 'home', act: 'sleep' }, { hour: 8, at: 'market', act: 'shop' }, { hour: 12, at: 'square', act: 'sit' }, { hour: 15, at: 'home', act: 'rest' }, { hour: 23, at: 'home', act: 'sleep' }]
    case 'caregiving': return [{ hour: 0, at: 'home', act: 'sleep' }, { hour: 6.5, at: 'home', act: 'care' }, { hour: 10, at: 'clinic', act: 'care' }, { hour: 12, at: 'market', act: 'shop' }, { hour: 13, at: 'home', act: 'care' }, { hour: 22, at: 'home', act: 'sleep' }]
    case 'sick': return [{ hour: 0, at: 'home', act: 'sleep' }, { hour: 10, at: 'clinic', act: 'sit' }, { hour: 12, at: 'home', act: 'rest' }, { hour: 20, at: 'home', act: 'sleep' }]
    case 'grieving': return [{ hour: 0, at: 'home', act: 'sleep' }, { hour: 9, at: 'home', act: 'sit' }, { hour: 16, at: 'park', act: 'sit' }, { hour: 18, at: 'home', act: 'sit' }, { hour: 23, at: 'home', act: 'sleep' }]
    case 'protesting': return [{ hour: 0, at: 'home', act: 'sleep' }, { hour: 9, at: 'square', act: 'play' }, { hour: 18, at: 'home', act: 'eat' }, { hour: 22, at: 'home', act: 'sleep' }]
    default: return [{ hour: 0, at: 'home', act: 'sleep' }, { hour: 9, at: 'market', act: 'shop' }, { hour: 13, at: 'home', act: 'rest' }, { hour: 22, at: 'home', act: 'sleep' }]
  }
}

// when time runs faster than a day per second the clock would strobe day and night, so it holds one telling hour
const STORY_HOUR: Partial<Record<LifeActivity, number>> = { working: 11, school: 10, studying: 10, infant: 15.5, retired: 9.5, unemployed: 9, caregiving: 14, sick: 14, grieving: 17, protesting: 11 }
export const storyHour = (a: LifeActivity) => STORY_HOUR[a] ?? 12

const WORK_LOT: Partial<Record<Workplace, string>> = { shop: 'market', none: 'market' }
export function lotFor(layout: Layout, at: PlaceKind, workplace: Workplace, home: Lot): Lot {
  if (at === 'home') return home
  if (at === 'work') return layout.byKind.get((WORK_LOT[workplace] ?? workplace) as never) ?? layout.byKind.get('market')!
  return layout.byKind.get(at as never) ?? home
}

const TRAVEL_H = 0.6 // ESTIMATE: a short walk in this small city
export type Where = { pos: V2; heading: number; walking: boolean; indoors: boolean; act: Stop['act']; lot: Lot; at: PlaceKind; arrivedAgoH: number }

// where the person is at this hour: in a lot (indoors for buildings), or walking the street path between two lots
// instant: at fast speeds the clock holds one hour, so never show them stuck mid-walk
export function whereAt(layout: Layout, home: Lot, snap: MonthSnap, hasKids: boolean, hour: number, instant = false): Where {
  const stops = stopsFor(snap.activity, hasKids)
  let i = 0
  for (let k = 0; k < stops.length; k++) if (stops[k].hour <= hour) i = k
  const cur = stops[i]
  const prev = stops[(i - 1 + stops.length) % stops.length]
  const lot = lotFor(layout, cur.at, snap.workplace, home)
  const from = lotFor(layout, prev.at, snap.workplace, home)
  const since = hour - cur.hour
  const inside = (l: Lot): V2 => ({ x: l.x + (l.kind === 'home' ? 0 : ((l.id * 7) % 5 - 2) * 0.25), z: l.z + (l.kind === 'home' ? 0.1 : ((l.id * 3) % 5 - 2) * 0.25) })
  const openAir = (l: Lot) => l.kind === 'park' || l.kind === 'square' || l.kind === 'market' || l.kind === 'farm'
  if (!instant && from.id !== lot.id && since < TRAVEL_H) {
    const path = pathBetween(inside(from), from.door, inside(lot), lot.door)
    const lens = path.slice(1).map((p, k) => Math.hypot(p.x - path[k].x, p.z - path[k].z))
    const total = lens.reduce((a, b) => a + b, 0) || 1
    let d = (since / TRAVEL_H) * total, k = 0
    while (k < lens.length - 1 && d > lens[k]) { d -= lens[k]; k++ }
    const a = path[k], b = path[k + 1] ?? a
    const f = lens[k] ? d / lens[k] : 0
    const pos = { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f }
    return { pos, heading: Math.atan2(b.x - a.x, b.z - a.z), walking: true, indoors: false, act: cur.act, lot, at: cur.at, arrivedAgoH: -1 }
  }
  const pos = inside(lot)
  return { pos, heading: Math.atan2(lot.door.x - pos.x, lot.door.z - pos.z) + Math.PI, walking: false, indoors: !openAir(lot), act: cur.act, lot, at: cur.at, arrivedAgoH: since - TRAVEL_H }
}

// ---------- their people at this moment ----------
export type Present = Kin & { age: number }
export function householdAt(r: LifeRecord, tick: number): Present[] {
  const age = tick / 12
  return r.kin.filter(k => {
    if (k.bornTick > tick || (k.diedTick !== undefined && k.diedTick <= tick)) return false
    if (k.relation === 'partner') return (k.sinceTick ?? 0) <= tick && (k.untilTick === undefined || k.untilTick > tick)
    if (k.relation === 'child') return true
    if (k.relation === 'mother' || k.relation === 'father' || k.relation === 'sibling') return age < 20
    return false
  }).map(k => ({ ...k, age: (tick - k.bornTick) / 12 }))
}

// everyone in her family alive at this tick, wherever they live (parents, siblings, partner, kids, grandkids)
export function kinAliveAt(r: LifeRecord, tick: number): Present[] {
  return r.kin.filter(k => k.bornTick <= tick && (k.diedTick === undefined || k.diedTick > tick) && (k.relation !== 'partner' || ((k.sinceTick ?? 0) <= tick && (k.untilTick === undefined || k.untilTick > tick)))).map(k => ({ ...k, age: (tick - k.bornTick) / 12 }))
}

// growth: rough share of adult height by age (who growth standards medians, https://www.who.int/tools/child-growth-standards ;
// after 5, cdc 2000 charts). ESTIMATE as a smooth curve
export function heightShare(age: number): number {
  const pts: [number, number][] = [[0, 0.3], [1, 0.45], [2, 0.52], [5, 0.65], [9, 0.78], [13, 0.9], [16, 0.97], [18, 1]]
  if (age >= 18) return age > 70 ? 1 - Math.min(0.04, (age - 70) * 0.002) : 1 // older adults lose a few cm
  for (let i = 1; i < pts.length; i++) if (age < pts[i][0]) { const [a0, h0] = pts[i - 1], [a1, h1] = pts[i]; return h0 + (h1 - h0) * (age - a0) / (a1 - a0) }
  return 1
}

// gray hair: about half of people have some gray by 50 (panhard et al. 2012, https://doi.org/10.1111/j.1365-2133.2011.10789.x).
// ESTIMATE ramp from 40 to 75
export const grayShare = (age: number) => Math.max(0, Math.min(1, (age - 40) / 35))

// the moments that pause the clock: their own milestones, births and deaths in the family, their death
export type Moment = { tick: number; caption: string; kind: 'milestone' | 'family' | 'world' | 'death' | 'birth'; emotion?: string; lesson?: string; move?: boolean }
export function momentsOf(r: LifeRecord): Moment[] {
  const out: Moment[] = []
  for (const m of r.milestones) out.push({ tick: m.tick, caption: m.caption, kind: 'milestone', lesson: m.lessonApplied ?? undefined, move: m.kind === 'move' })
  for (const e of r.events) {
    const year = yearOf(e.tick)
    if (e.kind === 'family' && e.severity >= 0.5) out.push({ tick: e.tick, caption: `${year} · ${e.text}`, kind: 'family', emotion: e.emotion })
    else if (e.kind === 'personal' && /moved from/.test(e.text)) out.push({ tick: e.tick, caption: `${year} · ${e.text}`, kind: 'world', move: true, emotion: 'hope' })
    else if (e.kind === 'world' && e.severity >= 0.45) out.push({ tick: e.tick, caption: `${year} · ${e.text}`, kind: 'world', emotion: e.emotion })
  }
  out.sort((a, b) => a.tick - b.tick)
  // one pause per month at most, the milestone wins
  return out.filter((m, i) => i === 0 || m.tick !== out[i - 1].tick || m.kind === 'milestone')
}
