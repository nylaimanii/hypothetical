// what each life page shows, as plain data, built only from the record through ./facts. the pages render these and
// nothing else; tests/consistency/life checks every view against every other view and against the record, so no two
// pages can say different things about the same life.
import type { LifeRecord, LifeSummary } from './types'
import { labelOf, ageAt, ageYears, cityAt, childrenCount, conditionsAt, dateLabel, deathLine, endTick, epitaph, isDead, kinAt, lifespanLabel, snapAt, yearOf } from './facts'

// ---------- a card on the home page (from the summary index, which tests check against the record) ----------
export type CardView = { lifeId: string; name: string; place: string; years: string; status: string; deathAge: number | null; score: number | null; lifeNo: number }
export function cardView(l: LifeSummary): CardView {
  const dead = l.deathTick !== null
  const deathAge = dead ? Math.floor(l.deathTick! / 12) : null
  return {
    lifeId: l.lifeId, name: l.name, place: l.birthplace.city.toLowerCase(),
    years: dead ? `${yearOf(0)}–${yearOf(l.deathTick!)}` : `${yearOf(0)}–`,
    status: dead ? `died at ${deathAge}` : 'living',
    deathAge, score: l.score ?? null, lifeNo: l.lifeNo,
  }
}

// ---------- the top of /live: who, when, how old, where ----------
export type HeaderView = { name: string; date: string; age: number; city: string }
export function headerView(r: LifeRecord, tick: number): HeaderView {
  return { name: r.name, date: dateLabel(tick), age: ageYears(r, Math.min(tick, endTick(r))), city: cityAt(r, tick).city.toLowerCase() }
}

// ---------- the family panel ----------
export type FamilyItem = { id: string; name: string; label: string; age: number; alive: boolean; text: string }
export type FamilyView = { sections: { title: string; items: FamilyItem[] }[]; note: string | null }
export function familyView(r: LifeRecord, tick: number): FamilyView {
  const now = kinAt(r, tick)
  const item = (k: (typeof now)[number], label: string): FamilyItem => ({
    id: k.id, name: k.name, label, age: k.age, alive: k.alive,
    // (only what the record knows: when they died and how old they were; never a guessed place)
    text: k.alive ? `${label}, ${k.age}` : `${label}, died ${k.diedYear} at ${k.ageAtDeath}`,
  })
  const word = (rel: string, sex: string) => (rel === 'sibling' ? (sex === 'female' ? 'sister' : 'brother') : rel === 'child' ? (sex === 'female' ? 'daughter' : 'son') : rel)
  const of = (rel: string) => now.filter(k => k.relation === rel)
  const partners = of('partner').filter(k => (r.kin.find(x => x.id === k.id)?.sinceTick ?? 0) <= tick)
  const sections = [
    { title: 'parents', items: [...of('mother'), ...of('father')].map(k => item(k, k.relation)) },
    { title: 'siblings', items: of('sibling').map(k => item(k, word('sibling', k.sex))) },
    { title: 'partner', items: partners.map(k => { const kk = r.kin.find(x => x.id === k.id)!; return item(k, kk.untilTick !== undefined && kk.untilTick <= tick ? 'separated' : 'partner') }) },
    { title: 'children', items: of('child').map(k => item(k, word('child', k.sex))) },
    { title: 'grandchildren', items: of('grandchild').map(k => item(k, `${r.kin.find(c => c.id === r.kin.find(x => x.id === k.id)?.parentId)?.name.split(' ')[0] ?? 'a child'}'s`)) },
  ].filter(s => s.items.length)
  const note = !partners.length && !of('child').length && ageAt(r, tick) > 30 ? 'no partner or children so far.' : null
  return { sections, note }
}

// ---------- the health panel ----------
export type HealthView = { now: string; score: number; conditions: { what: string; since: number; year: number }[]; habits: string[]; hungry: boolean }
const HABIT: Record<string, string> = { smokes: 'smokes', drinks_heavily: 'drinks heavily', exercises: 'exercises', volunteers: 'volunteers', saves: 'saves money', prays: 'prays', mentors: 'mentors', remits: 'sends money home', caregiver: 'cares for family' }
export function healthView(r: LifeRecord, tick: number): HealthView {
  const s = snapAt(r, tick)
  const h = s.health
  return {
    now: h > 0.85 ? 'strong' : h > 0.7 ? 'good' : h > 0.5 ? 'worn down' : h > 0.3 ? 'poor' : 'very frail', score: Math.round(h * 100),
    conditions: conditionsAt(r, tick).map(c => ({ what: c.what, since: c.age, year: c.year })),
    habits: s.behavior.map(b => HABIT[b] ?? b.replace(/_/g, ' ')), hungry: !!s.hunger,
  }
}

// ---------- the journal: one line a year, identical years merged; year and age from the facts ----------
export type JournalRow = { from: number; to: number; span: string; text: string; seekTick: number; quiet: boolean }
export function journalView(r: LifeRecord, tick: number): JournalRow[] {
  const rows: JournalRow[] = []
  const nowYear = yearOf(tick)
  for (const j of r.journal) {
    if (j.year > nowYear) break
    const last = rows[rows.length - 1]
    if (last && last.text === j.text) { last.to = j.year; last.span = `${last.from}–${j.year}` }
    else rows.push({ from: j.year, to: j.year, span: `${j.year}`, text: j.text, seekTick: Math.max(0, (j.year - yearOf(0)) * 12 - 10 + 6), quiet: j.text.startsWith('(') })
  }
  return rows
}

// ---------- the ending card ----------
export type EndView = { epitaph: string; death: string | null; years: string; children: number }
export function endView(r: LifeRecord): EndView {
  return { epitaph: epitaph(r), death: deathLine(r), years: lifespanLabel(r), children: childrenCount(r) }
}

// ---------- the life switcher on /live ----------
export type SwitchItem = { lifeId: string; name: string; first: string; city: string; text: string }
export function switchView(l: LifeSummary & { lastCity?: string; ageNow?: number }): SwitchItem {
  const c = cardView(l)
  return { lifeId: l.lifeId, name: l.name, first: (l as LifeSummary & { given?: string }).given ?? l.name.split(' ')[0], city: (l.lastCity ?? l.birthplace.city).toLowerCase(), text: c.deathAge !== null ? c.status : l.ageNow !== undefined ? `living, ${Math.floor(l.ageNow)}` : 'living' }
}
export { isDead }

// ---------- /compare: the decisions side by side. the "differ" count is computed from these same rows ----------
export type CompareRow = { id: string; what: string; a: { label: string; age: number; lesson: boolean } | null; b: { label: string; age: number; lesson: boolean } | null; differ: boolean }
export type CompareView = { rows: CompareRow[]; differ: number; both: number; total: number }
export function compareView(a: LifeRecord, b: LifeRecord): CompareView {
  const key = (id: string) => id.replace(/-\d+$/, '')
  const own = (r: LifeRecord) => r.milestones.filter(m => m.decider === 'self')
  const ids = [...new Set([...own(a), ...own(b)].sort((x, y) => x.age - y.age).map(m => key(m.id)))]
  const cell = (r: LifeRecord, id: string) => {
    const m = own(r).find(x => key(x.id) === id)
    return m ? { label: labelOf(m.options.find(o => o.id === m.choice)?.label ?? m.choice), age: ageYears(r, m.tick), lesson: !!m.lessonApplied, choice: m.choice, m } : null
  }
  const rows: CompareRow[] = ids.map(id => {
    const ca = cell(a, id), cb = cell(b, id)
    const m = (ca ?? cb)!.m
    return { id, what: (m.caption.split(' · ')[1] ?? m.kind).split('.')[0], a: ca && { label: ca.label, age: ca.age, lesson: ca.lesson }, b: cb && { label: cb.label, age: cb.age, lesson: cb.lesson }, differ: !!ca && !!cb && ca.choice !== cb.choice }
  })
  return { rows, differ: rows.filter(r => r.differ).length, both: rows.filter(r => r.a && r.b).length, total: rows.length }
}
