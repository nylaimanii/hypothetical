// the page side of one source of truth: thin wrappers over b's shared truth functions (src/lib/sim/truth.ts via
// replay-pure). every date, year, population and event list a panel shows goes through here; no panel computes
// its own. events are dated by their own tick, never by the frame that carries them.
import type { Frame, RunRecord, WorldEvent } from '@/lib/types'
import { dateOfTick, eventDate, populationAt, yearOfTick } from '@/lib/sim/replay-pure'

export { dateOfTick, eventDate, yearOfTick }
export const FIRST_YEAR = 2026
// calendar years: index 0 is 2026 (only november and december: tick 0 is 2026-11)
export const yearIndexOfTick = (tick: number) => yearOfTick(tick) - FIRST_YEAR
export const yearSpan = (i: number) => ({ start: Math.max(0, 12 * i - 10), end: 12 * i + 1 })
// the headline population of a frame: the sum of its regions (b's populationAt)
export const populationOf = (f: Frame) => populationAt({ frames: [f] }, f.tick)

// life expectancy and fertility are 0 in records older than sim 5.10.4 before the sim computes them (their first
// frame): not a value. undefined means "not computed", so pages say so instead of showing 0
export const recorded = (v: number | undefined) => (v !== undefined && v > 0 ? v : undefined)

export type EventRef = { e: WorldEvent; f: Frame; index: number }
// every event whose own tick is in [from, to]. a frame carries the events since the previous frame, so the frame
// just past `to` can still hold events at or before it (frames are often a year apart)
export function eventsBetween(rec: Pick<RunRecord, 'frames'>, from: number, to: number): EventRef[] {
  const out: EventRef[] = []
  for (const f of rec.frames) {
    if (f.tick >= from) f.newEvents.forEach((e, index) => { if (e.tick >= from && e.tick <= to + 1e-6) out.push({ e, f, index }) })
    if (f.tick > to + 1e-6) break
  }
  return out
}
