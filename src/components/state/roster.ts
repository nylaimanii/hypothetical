// client copy of B's pure roster replay (src/lib/sim/citizens-replay.ts). B's module now imports the calendar and
// daily systems, which pull in server-only code (node:fs), so the browser can't import it. same math, same names;
// keep in step with B's file until B splits the pure part out
import type { Citizen, LifeEvent, RunRecord } from '@/lib/types'

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

