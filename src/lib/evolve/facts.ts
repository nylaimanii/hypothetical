// the one place C's code reads dates, people and counts from a record. every report, digest, telegram and api
// response goes through these, so two surfaces can't disagree. the readers are B's (src/lib/sim/truth.ts, via the
// browser-safe replay-pure.ts), the same ones the ui and the consistency checks use; only wording lives here.
import type { Frame, RunRecord } from '../types'
import { dateOfTick, frameAt as truthFrameAt, populationAt, yearOfTick, lifeExpectancyAt } from '../sim/replay-pure'

export { dateOfTick, yearOfTick, populationAt, lifeExpectancyAt }
export { deathsAt, eventDate, frontierAt } from '../sim/replay-pure'

type Rec = Pick<RunRecord, 'frames'>
// the frame in force at `tick` (the last frame at or before it)
export const frameAt = (rec: Rec, tick: number): Frame | null => truthFrameAt(rec, tick) ?? null
export const lastFrame = (rec: Rec): Frame | null => rec.frames.reduce<Frame | null>((a, f) => (!a || f.tick > a.tick ? f : a), null)

// a frame's date, from its tick (the same rule every surface uses)
export const dateOf = (f: Pick<Frame, 'tick'>) => dateOfTick(f.tick)

// people alive in one frame (a world frame or the no-ai twin's), through truth.ts: the sum of the regions
export const populationOf = (f: { tick: number; regions: { population: number }[] }) => populationAt({ frames: [f as unknown as Frame] }, f.tick)
export const lifeExpectancyOf = (f: Pick<Frame, 'globalPeriodLifeExpectancy'>) => f.globalPeriodLifeExpectancy

// people in plain words: 1.23 billion, 456 million, 78,000
export function people(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return `${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2).replace(/\.?0+$/, '')} billion`
  if (a >= 1e6) return `${Math.round(a / 1e6)} million`
  if (a >= 1e3) return `${Math.round(a / 1e3).toLocaleString('en-US')},000`
  return String(Math.round(a))
}

// a world's score for ranking: a record broken by a sim bug can carry NaN (null once saved), which must rank last,
// never first, and never turn a "best" into NaN (gen 3's "best 100-year world NaN", sim 5.10.7's housing bug)
export const rankScore = (r: { score?: number | null }) => (typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : -Infinity)
export const byScore = (a: { score?: number | null }, b: { score?: number | null }) => rankScore(b) - rankScore(a) || 0
