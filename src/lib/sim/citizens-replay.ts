// citizen keyframes + deltas. frames carry the full roster only on keyframes (every 5 years, plus the first and
// the last frame); every other frame carries `citizenDelta` with just what changed. citizensAt() rebuilds the
// full roster for any tick so the ui and the api never do this math themselves.
import type { Activity, Citizen, LifeEvent, RunRecord } from '../types'

export const KEYFRAME_EVERY = 60
export const FRAME_LIFE_EVENTS = 4

export type CitizenDelta = {
  // fields that changed since the previous frame (id always present)
  changed: (Partial<Citizen> & { id: string })[]
  // pips that appeared (born, moved into view, arrived): full objects
  born: Citizen[]
  // pips that left (died, left the roster)
  gone: string[]
  // life events added since the previous frame, by pip id
  newLifeEvents: Record<string, LifeEvent[]>
}
export type FrameCitizens = { citizens: Citizen[]; citizenKeyframe?: boolean; citizenDelta?: CitizenDelta }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// build the delta between the roster at the previous frame and now (lifeEvents handled separately)
export function makeDelta(prev: Map<string, Citizen>, now: Citizen[], sinceTick: number): CitizenDelta {
  const changed: CitizenDelta['changed'] = []
  const born: Citizen[] = []
  const newLifeEvents: Record<string, LifeEvent[]> = {}
  const seen = new Set<string>()
  for (const c of now) {
    seen.add(c.id)
    const p = prev.get(c.id)
    if (!p) { born.push(c); continue }
    const diff: Partial<Citizen> & { id: string } = { id: c.id }
    let any = false
    for (const k of Object.keys(c) as (keyof Citizen)[]) {
      if (k === 'lifeEvents' || k === 'id') continue
      if (same(c[k], p[k])) continue
      // moods travel as just the emotions that changed
      if (k === 'mood') { const m: Record<string, number> = {}; for (const e of Object.keys(c.mood) as (keyof Citizen['mood'])[]) if (c.mood[e] !== p.mood[e]) m[e] = c.mood[e]; (diff as Record<string, unknown>).mood = m }
      else (diff as Record<string, unknown>)[k] = c[k]
      any = true
    }
    if (any) changed.push(diff)
    const fresh = c.lifeEvents.filter(e => e.tick >= sinceTick && !p.lifeEvents.some(x => x.tick === e.tick && x.text === e.text))
    if (fresh.length) newLifeEvents[c.id] = fresh
  }
  const gone = [...prev.keys()].filter(id => !seen.has(id))
  return { changed, born, gone, newLifeEvents }
}

// the full roster at `tick`: nearest keyframe at or before it, then every delta up to and including it
export function citizensAt(record: Pick<RunRecord, 'frames'>, tick: number): Citizen[] {
  const frames = record.frames.filter(f => f.tick <= tick).sort((a, b) => a.tick - b.tick) as (RunRecord['frames'][number] & FrameCitizens)[]
  let k = -1
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i].citizenKeyframe || !frames[i].citizenDelta) { k = i; break }
  if (k < 0) return []
  const roster = new Map<string, Citizen>(frames[k].citizens.map(c => [c.id, structuredClone(c)]))
  for (const f of frames.slice(k + 1)) {
    const d = f.citizenDelta
    if (!d) { roster.clear(); for (const c of f.citizens) roster.set(c.id, structuredClone(c)); continue }
    for (const id of d.gone) roster.delete(id)
    for (const c of d.born) roster.set(c.id, structuredClone(c))
    for (const ch of d.changed) {
      const c = roster.get(ch.id)
      if (!c) continue
      const { mood, ...rest } = structuredClone(ch)
      Object.assign(c, rest)
      if (mood) Object.assign(c.mood, mood)
    }
    for (const [id, evs] of Object.entries(d.newLifeEvents)) {
      const c = roster.get(id)
      if (c) c.lifeEvents = [...c.lifeEvents, ...evs].slice(-FRAME_LIFE_EVENTS)
    }
  }
  return [...roster.values()]
}

// requirements carry their static fields on keyframes only; this fills them back in for any frame
export function requirementsAt(record: Pick<RunRecord, 'frames'>, tick: number): RunRecord['frames'][number]['requirements'] {
  const frames = record.frames.filter(f => f.tick <= tick).sort((a, b) => a.tick - b.tick) as (RunRecord['frames'][number] & FrameCitizens)[]
  let k = -1
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i].citizenKeyframe || !frames[i].citizenDelta) { k = i; break }
  if (k < 0) return []
  // start from the keyframe's full list, then apply each later frame's changed nodes
  const cur = new Map(frames[k].requirements.map(r => [r.id, { ...r }]))
  const text = new Map(frames[k].requirements.map(r => [r.id, r.realWorld2026]))
  for (const f of frames.slice(k + 1)) for (const r of f.requirements) {
    const c = cur.get(r.id)
    if (!c) continue
    c.progress = r.progress
    if (r.unlockedTick !== undefined) c.unlockedTick = r.unlockedTick
    c.realWorld2026 = r.realWorld2026 ? r.realWorld2026 : text.get(r.id) ?? c.realWorld2026
  }
  return frames[k].requirements.map(r => cur.get(r.id)!)
}

// a pip's typical day this year, derived only from its own fields (so frames do not store it):
// age, workplace, employment, behavior, belief, personality. change points only; same function the sim uses.
export function dayPlanOf(c: Citizen, tick: number, nightlife = 0.3): { hour: number; activity: Activity }[] {
  const u = (salt: string) => { let h = 2166136261; const s = salt; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); let a = (c.personalitySeed ^ h) >>> 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const plan: { hour: number; activity: Activity }[] = []
  const at = (hour: number, activity: Activity) => { if (!plan.length || plan[plan.length - 1].activity !== activity) plan.push({ hour, activity }) }
  const wp = c.workplace ?? 'none', employed = !!c.employed
  const crisis: Activity = c.behavior === 'striking' ? 'striking' : c.behavior === 'protesting' || c.behavior === 'rioting' ? 'protesting' : c.behavior === 'migrating' || c.behavior === 'moving_to_new_city' ? 'moving' : 'working'
  const night = (wp === 'clinic' || wp === 'power_plant' || wp === 'factory') && u('night') < 0.3
  const prays = c.belief === 'religious' && (c.behavior === 'praying' || u('devout') < 0.4)
  if (c.age < 6) { at(0, 'sleeping'); at(7, 'eating'); at(8, 'socializing'); at(12, 'eating'); at(13, 'sleeping'); at(15, 'socializing'); at(18, 'eating'); at(19, 'sleeping'); return plan }
  if (c.age < 18) { at(0, 'sleeping'); at(6, 'eating'); at(7, 'commuting'); at(8, 'school'); at(15, 'commuting'); at(16, c.behavior === 'protesting' ? 'protesting' : 'socializing'); at(19, 'eating'); at(21, 'resting'); at(22, 'sleeping'); return plan }
  if (!employed) {
    // ESTIMATE: under ~$300 a month of income, the morning goes to an aid line
    const poor = (c.income ?? 0) < 300 && c.age < 67
    at(0, 'sleeping'); at(7, 'eating'); at(9, poor ? 'aid_line' : 'resting'); at(11, c.behavior === 'hoarding' || c.behavior === 'panic_buying' ? 'shopping' : 'idle')
    at(13, crisis === 'protesting' ? 'protesting' : prays ? 'praying' : c.age >= 67 ? 'socializing' : 'idle')
    at(18, 'eating'); at(19, 'resting'); at(22, 'sleeping'); return plan
  }
  if (wp === 'farm') { at(0, 'sleeping'); at(4, 'eating'); at(5, crisis); at(11, 'eating'); at(12, 'resting'); at(15, crisis); at(19, 'eating'); at(20, prays ? 'praying' : 'resting'); at(21, 'sleeping'); return plan }
  if (night) { at(0, crisis); at(7, 'commuting'); at(8, 'sleeping'); at(15, 'eating'); at(16, c.behavior === 'hoarding' ? 'shopping' : 'resting'); at(21, 'commuting'); at(22, crisis); return plan }
  at(0, 'sleeping'); at(6, 'eating'); at(7, 'commuting'); at(8, crisis); at(12, 'eating'); at(13, crisis); at(17, 'commuting')
  at(18, c.behavior === 'hoarding' || c.behavior === 'panic_buying' ? 'shopping' : 'eating')
  at(19, prays ? 'praying' : c.behavior === 'celebrating' ? 'celebrating' : 'resting')
  if (c.age < 35 && u(`out${Math.floor(tick / 12)}`) < nightlife) { at(21, 'socializing'); at(1, 'sleeping') } else at(22, 'sleeping')
  return plan.sort((a, b) => a.hour - b.hour)
}
