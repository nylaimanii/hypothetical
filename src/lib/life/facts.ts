// the one source of truth for everything the life site, its narration, its reports and its messages say about a life.
// every name, age, date, count and event shown anywhere comes from the record through these functions; nothing is
// recomputed with its own formula on a page, and nothing is invented. (tick 0 = 2026-11; one tick is one month.)
// tests: tests/consistency/life
import type { Kin, LifeRecord, MonthSnap } from './types'

// ---------- time ----------
// (the world's calendar; when B exports date-from-tick for the main site, these delegate to it)
const START_YEAR = 2026, START_MONTH = 10 // november, 0-based
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
export const yearOf = (tick: number) => START_YEAR + Math.floor((START_MONTH + tick) / 12)
export const monthOf = (tick: number) => (((START_MONTH + tick) % 12) + 12) % 12
export const dateLabel = (tick: number) => `${yearOf(tick)} ${MONTHS[monthOf(tick)]}`
// the first tick of a calendar year (january), clamped to the start of the world
export const tickOfYear = (year: number) => Math.max(0, (year - START_YEAR) * 12 - START_MONTH)

// ---------- her ----------
export const firstName = (r: LifeRecord) => r.name.split(' ')[0]
export const pronouns = (r: LifeRecord) => (r.sex === 'female' ? { she: 'she', her: 'her', him: 'her' } : { she: 'he', her: 'his', him: 'him' })
/** her age in years (fractional) at a tick */
export const ageAt = (r: LifeRecord, tick: number) => (tick - r.birthTick) / 12
/** her age in whole years at a tick, the way people say it */
export const ageYears = (r: LifeRecord, tick: number) => Math.floor(ageAt(r, tick))
export const endTick = (r: LifeRecord) => r.deathTick ?? r.snaps[r.snaps.length - 1].tick
export const isDead = (r: LifeRecord) => r.deathTick !== null
export const deathYear = (r: LifeRecord) => (r.deathTick === null ? null : yearOf(r.deathTick))
/** "2026–2117", or "2026–" while alive */
export const lifespanLabel = (r: LifeRecord) => `${yearOf(r.birthTick)}–${r.deathTick === null ? '' : yearOf(r.deathTick)}`
/** "died at 90, in 2117, of complications of diabetes" */
export function deathLine(r: LifeRecord): string | null {
  if (r.deathTick === null) return null
  const a = ageAt(r, r.deathTick)
  const at = a < 1 ? `${Math.max(1, Math.round(a * 12))} months old` : `${Math.floor(a)}`
  return `died at ${at}, in ${yearOf(r.deathTick)}${r.deathCause ? `, of ${r.deathCause}` : ''}`
}

// ---------- the month she is in ----------
export function snapAt(r: LifeRecord, tick: number): MonthSnap {
  let s = r.snaps[0]
  for (const x of r.snaps) { if (x.tick <= tick) s = x; else break }
  return s
}
export const cityAt = (r: LifeRecord, tick: number) => {
  let p = r.places[0] ?? r.birthplace
  for (const x of r.places) if (x.fromTick <= tick) p = x
  return p
}
export const jobAt = (r: LifeRecord, tick: number) => snapAt(r, tick).job

// ---------- family ----------
export type KinNow = { id: string; name: string; firstName: string; relation: Kin['relation']; sex: Kin['sex']; age: number; alive: boolean; bornTick: number; diedTick?: number; diedOf?: string; diedYear: number | null; ageAtDeath: number | null }
/** everyone in her family at a tick who has been born by then: their age then (or at death), alive or not */
export function kinAt(r: LifeRecord, tick: number): KinNow[] {
  return r.kin.filter(k => k.bornTick <= tick).map(k => {
    const gone = k.diedTick !== undefined && k.diedTick <= tick
    const until = gone ? k.diedTick! : tick
    return { id: k.id, name: k.name, firstName: k.name.split(' ')[0], relation: k.relation, sex: k.sex, age: Math.floor((until - k.bornTick) / 12), alive: !gone, bornTick: k.bornTick, diedTick: k.diedTick, diedOf: k.diedOf, diedYear: k.diedTick === undefined ? null : yearOf(k.diedTick), ageAtDeath: k.diedTick === undefined ? null : Math.floor((k.diedTick - k.bornTick) / 12) }
  })
}
export const kinById = (r: LifeRecord, id: string) => r.kin.find(k => k.id === id) ?? null
/** what she calls them: "her mom halima", "his sister grace" */
export function kinCall(r: LifeRecord, k: Pick<Kin, 'relation' | 'sex' | 'name'>, withName = true): string {
  const p = pronouns(r)
  const word = k.relation === 'mother' ? 'mom' : k.relation === 'father' ? 'dad' : k.relation === 'sibling' ? (k.sex === 'female' ? 'sister' : 'brother') : k.relation === 'child' ? (k.sex === 'female' ? 'daughter' : 'son') : k.relation
  return `${p.her} ${word}${withName ? ` ${k.name.split(' ')[0]}` : ''}`
}
export const childrenAt = (r: LifeRecord, tick: number) => kinAt(r, tick).filter(k => k.relation === 'child')
export const childrenCount = (r: LifeRecord) => r.kin.filter(k => k.relation === 'child').length

// ---------- what happened ----------
export const eventsInYear = (r: LifeRecord, year: number) => r.events.filter(e => yearOf(e.tick) === year)
export function conditionsAt(r: LifeRecord, tick: number) {
  return r.events.filter(e => e.tick <= tick && /^diagnosed with/.test(e.text)).map(e => ({ what: e.text.replace('diagnosed with ', ''), tick: e.tick, year: yearOf(e.tick), age: ageYears(r, e.tick) }))
}
/** the epitaph, built from the facts (the stored one is checked against this in tests/consistency/life) */
export function epitaph(r: LifeRecord): string {
  const cities = [...new Set(r.places.map(p => p.city.toLowerCase()))]
  const lastJob = [...r.snaps].reverse().find(s => s.job)?.job
  const kids = childrenCount(r)
  const role = [lastJob, kids ? `${r.sex === 'female' ? 'mother' : 'father'} of ${kids}` : ''].filter(Boolean).join(', ')
  return `${r.name} · ${lifespanLabel(r)} · ${cities.join(' → ')}${role ? ` · ${role}` : ''}`
}

// ---------- the opening: the hour she was born (fixed by the record's seed, so every page and every replay agrees) ----------
// births spread over the whole day, a little more in the early morning (ESTIMATE: spontaneous labor peaks roughly
// 1am-7am in hospital data, e.g. https://doi.org/10.1136/bmjopen-2016-015227). no life opens at a shared hour.
export function birthHour(r: LifeRecord): number {
  let x = (r.seed ^ 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0; x = (x ^ (x >>> 16)) >>> 0
  const u = x / 2 ** 32, v = ((Math.imul(x, 2654435761) >>> 0) / 2 ** 32)
  const h = u < 0.3 ? 1 + v * 6 : v * 24 // 30% in 1am-7am, the rest anywhere
  return Math.round(h * 6) / 6 // to the 10 minutes
}
