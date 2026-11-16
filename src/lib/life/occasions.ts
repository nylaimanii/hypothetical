// the days her life turns on, staged: meeting a partner, a child's birth, a funeral. each one happens on a real day,
// at a real place in the city she lives in that month, with the actual people from her record. the scene
// (life/components/lifeworld.ts and population.ts) plays these, the moment caption fires when it starts, and
// tests/consistency/life/occasions.test.ts checks every one against the record. nothing here is invented: the
// day, the hour and the place are drawn from her seed, the people and the month from the record.
import type { Kin, LifeRecord } from './types'
import { firstName, kinById, pronouns, snapAt, yearOf } from './facts'

export const DAYS_PER_TICK = 30.4375
export type OccasionKind = 'met' | 'birth' | 'funeral'
export type OccasionPlace = 'square' | 'park' | 'market' | 'clinic' | 'home' | 'visit' | 'shrine'
export type Occasion = {
  kind: OccasionKind
  tick: number // the month it happens in (the record's tick)
  day: number // days since her birth (whole day), inside that month
  start: number; end: number // hours of the day
  at: OccasionPlace // a lot kind in her city's layout ('visit' = her parents' house)
  act: 'chat' | 'sit' | 'pray'
  cityId: string // the city she lives in that month
  about: string // the kin id it is about (the partner, the newborn, the one who died)
  who: string[] // the kin ids there with her, all alive at that tick (the newborn included)
  text: string // one line, from the record's names
}

const h01 = (n: number) => (((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1) + 1) % 1
const idHash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) }
// the first whole day of a month, and a day `off` days into it (always still inside that month)
const dayIn = (tick: number, off: number) => Math.min(Math.ceil(tick * DAYS_PER_TICK) + off, Math.ceil((tick + 1) * DAYS_PER_TICK) - 1)

function aliveAt(k: Kin, tick: number) {
  if (k.bornTick > tick || (k.diedTick !== undefined && k.diedTick <= tick)) return false
  if (k.relation === 'partner') return (k.sinceTick ?? 0) <= tick && (k.untilTick === undefined || k.untilTick > tick)
  return true
}
const partnerAt = (r: LifeRecord, tick: number) => r.kin.find(k => k.relation === 'partner' && aliveAt(k, tick))
const word = (k: Kin, her: string) => k.relation === 'sibling' ? (k.sex === 'female' ? `${her} sister` : `${her} brother`) : k.relation === 'child' ? (k.sex === 'female' ? `${her} daughter` : `${her} son`) : k.relation === 'grandchild' ? `${her} grandchild` : k.relation === 'partner' ? `${her} partner` : `${her} ${k.relation}`

export function occasionsOf(r: LifeRecord): Occasion[] {
  const end = r.deathTick ?? r.snaps[r.snaps.length - 1]?.tick ?? 0
  const { her } = pronouns(r)
  const she = firstName(r)
  const religious = r.snaps.some(s => s.behavior.includes('prays'))
  const out: Occasion[] = []
  const city = (tick: number) => snapAt(r, tick).cityId
  for (const k of r.kin) {
    // she meets her partner: an evening out where people meet, in her city that month
    if (k.relation === 'partner' && k.sinceTick !== undefined && k.sinceTick >= 0 && k.sinceTick <= end) {
      const t = k.sinceTick, u = h01(r.seed + idHash(k.id))
      const at = (['square', 'park', 'market'] as const)[Math.floor(u * 3)]
      out.push({ kind: 'met', tick: t, day: dayIn(t, Math.floor(h01(u * 91) * 24)), start: 17.5, end: 19.5, at, act: 'chat', cityId: city(t), about: k.id, who: [k.id], text: `${yearOf(t)} · ${she} meets ${k.name} at the ${at}` })
    }
    // her child is born: at the clinic, with the other parent if there is one (or her mother), and the baby
    if (k.relation === 'child' && k.bornTick >= 0 && k.bornTick <= end) {
      const t = k.bornTick
      const p = partnerAt(r, t) ?? r.kin.find(x => x.relation === 'mother' && aliveAt(x, t))
      out.push({ kind: 'birth', tick: t, day: dayIn(t, Math.floor(h01(r.seed + idHash(k.id)) * 24)), start: 9, end: 13, at: 'clinic', act: 'sit', cityId: city(t), about: k.id, who: [k.id, ...(p ? [p.id] : [])], text: `${yearOf(t)} · ${k.name} is born at the clinic${p ? `, ${p.name} is there` : ''}` })
    }
    // someone in her family dies: the funeral a few days later, at the prayer hall if she prays, otherwise at the
    // house of the one who died (her parents' house, or her own), with the family still alive
    if (k.diedTick !== undefined && k.diedTick >= 0 && k.diedTick < end && k.relation !== 'grandchild') {
      const t = k.diedTick
      const parentsHouse = (k.relation === 'mother' || k.relation === 'father') && t >= 240
      const at: OccasionPlace = religious ? 'shrine' : parentsHouse ? 'visit' : 'home'
      const who = r.kin.filter(x => x.id !== k.id && aliveAt(x, t) && x.relation !== 'grandchild').sort((a, b) => order(a) - order(b)).slice(0, 5).map(x => x.id)
      out.push({ kind: 'funeral', tick: t, day: dayIn(t, 3), start: 10, end: 13, at, act: religious ? 'pray' : 'sit', cityId: city(t), about: k.id, who, text: `${yearOf(t)} · the funeral for ${k.name}, ${word(k, her)}` })
    }
  }
  out.sort((a, b) => a.day - b.day || a.start - b.start)
  // one occasion a day (the first one wins; the other moves to the next free day of the same month if there is one)
  const used = new Set<number>()
  const kept: Occasion[] = []
  for (const o of out) {
    let d = o.day
    while (used.has(d) && d + 1 < Math.ceil((o.tick + 1) * DAYS_PER_TICK)) d++
    if (used.has(d)) continue
    used.add(d)
    kept.push({ ...o, day: d })
  }
  return kept
}
const ORDER: Record<string, number> = { partner: 0, child: 1, mother: 2, father: 3, sibling: 4 }
const order = (k: Kin) => ORDER[k.relation] ?? 9

// the occasion on this day (days since birth), if any
export function occasionOn(list: Occasion[], day: number): Occasion | null {
  const d = Math.floor(day)
  return list.find(o => o.day === d) ?? null
}
export { kinById }
