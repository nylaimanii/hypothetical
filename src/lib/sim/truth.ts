// truth: the shared read functions every page, report and test must use. one source: the run record (and its lazy
// lives file). pure: no sim state, no node modules, safe in the browser (re-exported from replay-pure.ts).
// nothing here invents data: every answer is read from the record or derived from a stored value (age from the
// stored birth tick, a date from a tick, a pyramid from the age bands, a tier from progress).
import type { RunRecord, WorldEvent } from '../types'
import { citizensAt } from './citizens-replay'

type Rec = Pick<RunRecord, 'frames'> & Partial<Pick<RunRecord, 'runId' | 'agentId' | 'summary' | 'seed'>>
type F = RunRecord['frames'][number]

// ---- dates: tick 0 = 2026-11, one tick a month ----
export const yearOfTick = (tick: number) => 2026 + Math.floor((10 + tick) / 12)
export const monthOfTick = (tick: number) => ((10 + tick) % 12 + 12) % 12 + 1
export const dateOfTick = (tick: number) => `${yearOfTick(tick)}-${String(monthOfTick(tick)).padStart(2, '0')}`
// an event is dated by its own tick, never by the frame that carries it
export const eventDate = (e: Pick<WorldEvent, 'tick'>) => dateOfTick(e.tick)

// ---- frames ----
export function frameAt(r: Rec, tick: number): F | undefined {
  let best: F | undefined
  for (const f of r.frames) if (f.tick <= tick && (!best || f.tick > best.tick)) best = f
  return best ?? r.frames[0]
}
// the headline population is the sum of the regions (the two can never differ)
export function populationAt(r: Rec, tick: number, regionId?: string): number {
  const f = frameAt(r, tick)
  if (!f) return 0
  return regionId ? Math.round(f.regions.find(x => x.id === regionId)?.population ?? 0) : Math.round(f.regions.reduce((a, x) => a + x.population, 0))
}
export const frontierAt = (r: Rec, tick: number) => frameAt(r, tick)?.frontier
export const lifeExpectancyAt = (r: Rec, tick: number) => frameAt(r, tick)?.globalPeriodLifeExpectancy

// deaths by cause up to a tick (cumulative since 2026). causes the sim counts: all deaths, famine, pandemic, riots,
// disasters, health and social spending vs 2026 (welfare), air, water, despair, housing
export function deathsAt(r: Rec, tick: number): Record<string, number> {
  const f = frameAt(r, tick) as (F & { vital?: Record<string, number>; causeDeaths?: Record<string, number> }) | undefined
  if (!f) return {}
  return { ...(f.vital ?? {}), ...(f.causeDeaths ?? {}), excess: f.humanCost?.deaths ?? 0 }
}

// the age pyramid: people per 5-year band from the demographic model (never sampled from pips)
export function pyramidAt(r: Rec, tick: number, regionId?: string): { band: string; people: number }[] {
  const f = frameAt(r, tick)
  if (!f) return []
  const regions = f.regions.filter(x => !regionId || x.id === regionId) as (F['regions'][number] & { ageBands?: number[] })[]
  const n = regions[0]?.ageBands?.length ?? 0
  return Array.from({ length: n }, (_, i) => ({ band: i === n - 1 ? `${i * 5}+` : `${i * 5}-${i * 5 + 4}`, people: regions.reduce((a, x) => a + (x.ageBands?.[i] ?? 0), 0) }))
}
// share of children (0-14) from the pyramid
export function childShareAt(r: Rec, tick: number, regionId?: string): number {
  const p = pyramidAt(r, tick, regionId)
  const tot = p.reduce((a, b) => a + b.people, 0)
  return tot ? (p[0].people + p[1].people + p[2].people) / tot : 0
}

// ---- technology ----
// a tier from progress: proven only when deployed at scale (90%+), speculative while a 2026-speculative idea is under 30%
export function tierOf(progress: number, tier2026: 'proven' | 'emerging' | 'speculative'): 'proven' | 'emerging' | 'speculative' {
  if (progress >= 0.9) return 'proven'
  if (tier2026 === 'speculative' && progress < 0.3) return 'speculative'
  return 'emerging'
}
export function requirementStatus(q: { progress: number; unlockedTick?: number }): 'done' | 'in progress' | 'not started' {
  return q.unlockedTick !== undefined || q.progress >= 1 ? 'done' : q.progress > 0 ? 'in progress' : 'not started'
}

// ---- people ----
type Person = { id: string; name: string; givenName?: string; familyName?: string; birthTick?: number; age: number; sex: string; countryId?: string; cityId?: string; regionId: string }
type Lives = { lives: Record<string, { name: string; events: { tick: number; text: string }[]; death?: { tick: number; ageAtDeath: number; cause: string }; birthTick?: number; countryId?: string; cityId?: string }> }
export const ageAt = (birthTick: number, tick: number) => Math.floor((tick - birthTick) / 12)
// who a person is at a tick: the roster at that tick (keyframes + deltas), and the lives file for the dead
export function personAt(r: Rec, id: string, tick: number, lives?: Lives) {
  const c = citizensAt(r as RunRecord, tick).find(x => x.id === id) as unknown as Person | undefined
  const arc = lives?.lives[id]
  const birthTick = c?.birthTick ?? arc?.birthTick
  const death = arc?.death && arc.death.tick <= tick ? arc.death : undefined
  if (!c && !arc) return undefined
  return {
    id, name: c?.name ?? arc!.name, givenName: c?.givenName, familyName: c?.familyName, sex: c?.sex, countryId: c?.countryId ?? arc?.countryId, cityId: c?.cityId ?? arc?.cityId,
    birthTick, birthDate: birthTick !== undefined ? dateOfTick(birthTick) : undefined,
    alive: !death && !!c,
    age: death ? death.ageAtDeath : birthTick !== undefined ? ageAt(birthTick, tick) : c?.age,
    ...(death ? { deathTick: death.tick, deathDate: dateOfTick(death.tick), ageAtDeath: death.ageAtDeath, causeOfDeath: death.cause } : {}),
  }
}
// neighbors: people who live in the same city of the same world at that tick
export function neighborsOf(r: Rec, id: string, tick: number): string[] {
  const roster = citizensAt(r as RunRecord, tick) as unknown as Person[]
  const me = roster.find(x => x.id === id)
  if (!me?.cityId) return []
  return roster.filter(x => x.id !== id && x.cityId === me.cityId).map(x => x.id)
}

// ---- agents ----
// the agent that governs this world, or undefined (only the no-ai twin has none)
export function agentOf(r: Rec): string | undefined {
  const a = r.agentId ?? r.summary?.agentId
  return a && a !== 'unassigned' ? a : undefined
}
