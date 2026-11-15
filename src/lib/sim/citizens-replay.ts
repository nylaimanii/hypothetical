// citizen keyframes + deltas. frames carry the full roster only on keyframes (every 5 years, plus the first and
// the last frame); every other frame carries `citizenDelta` with just what changed. citizensAt() rebuilds the
// full roster for any tick so the ui and the api never do this math themselves.
import type { Citizen, LifeEvent, RunRecord } from '../types'

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
  const f = frames[frames.length - 1]
  if (!f) return []
  const key = [...frames].reverse().find(x => x.citizenKeyframe || !x.citizenDelta)
  const text = new Map((key?.requirements ?? []).map(r => [r.id, r]))
  return f.requirements.map(r => (r.name ? r : { ...(text.get(r.id) ?? r), progress: r.progress, ...(r.unlockedTick !== undefined ? { unlockedTick: r.unlockedTick } : {}), ...(r.realWorld2026 ? { realWorld2026: r.realWorld2026 } : {}) }))
}
