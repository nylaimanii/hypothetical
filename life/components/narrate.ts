// the quiet line at the bottom: what she is doing right now, plain and specific, tied to real sim state.
// "7:40am. walking to the clinic. the bus costs too much on $140 a month, so she walks."
// every clause comes from the record (snapshot, env, events, kin) or the day plan. nothing is invented.
import type { EnvYear, LifeRecord, MonthSnap } from '@/lib/life/types'
import type { Where } from './plan'
import type { Present } from './day'
import type { Occasion } from '@/lib/life/occasions'
import { ageYears, endTick, firstName, eventsInYear, tickOfYear } from '@/lib/life/facts'

const PLACE: Record<string, string> = { home: 'home', clinic: 'the clinic', school: 'school', market: 'the market', park: 'the park', square: 'the square', shrine: 'the prayer hall', office: 'the office', lab: 'the lab', factory: 'the factory', farm: 'the fields', construction: 'the building site', power_plant: 'the power plant', launch_site: 'the launch site' }
export const fmtClock = (h: number) => { const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60 / 10) * 10; return `${hh % 12 || 12}:${String(mm).padStart(2, '0')}${hh < 12 ? 'am' : 'pm'}` }
const money = (n: number) => `$${Math.round(n)}`

export type NarrateCtx = {
  record: LifeRecord; snap: MonthSnap; prevYearSnap: MonthSnap | null; env: EnvYear | null; prevEnv: EnvYear | null
  once: (key: string, scope: string) => boolean // a clause is said in one scene a day (scope: the walk or stop it belongs to)
  where: Where; hour: number; family: Present[]; kin: Present[]; carrierId?: string | null; neighbor?: string; exactAge?: number; presentAt?: (kinId: string, lotId: number) => boolean; rain: boolean; tempC: number; canBus: boolean; busFareShare: number
  she: string; her: string // pronouns from the record's sex
  occasion?: Occasion | null // today's first meeting, birth or funeral (src/lib/life/occasions.ts)
}

export function narrate(c: NarrateCtx): string {
  const { snap: s, where: w, she, her } = c
  const t = fmtClock(c.hour)
  // a baby's day is told through whoever is holding them
  const exact = c.exactAge ?? s.age
  if (exact < 2) {
    const days = Math.floor(exact * 365.25)
    const old = days < 1 ? 'born today' : days < 14 ? `${days} ${days === 1 ? 'day' : 'days'} old` : days < 90 ? `${Math.round(days / 7)} weeks old` : `${Math.round(exact * 12)} months old`
    const first = firstName(c.record)
    const carrier = c.kin.find(k => k.id === c.carrierId)
    const who = carrier ? `${c.her} ${carrier.relation === 'mother' ? 'mom' : carrier.relation === 'father' ? 'dad' : carrier.relation === 'sibling' ? (carrier.sex === 'female' ? 'sister' : 'brother') : carrier.relation} ${carrier.name}` : 'the family'
    const cs = carrier?.sex === 'male' ? 'he' : 'she'
    const a = c.where.stop.act
    const doing = a === 'sleep' ? `asleep next to ${who}`
      : (a as string) === 'chat' ? `${who} is holding ${c.she === 'she' ? 'her' : 'him'} outside while ${cs} talks to ${c.neighbor ? `the neighbor, ${c.neighbor}` : 'a neighbor'}`
      : a === 'eat' ? `${who} is feeding ${c.she === 'she' ? 'her' : 'him'}`
      : `${who} has ${c.she === 'she' ? 'her' : 'him'} in ${carrier?.sex === 'male' ? 'his' : 'her'} arms at home`
    return `${t}. ${first}'s ${old}. ${doing}.`
  }
  const age = s.age
  const name = firstName(c.record)
  const job = s.job ?? ''
  const place = PLACE[w.stop.lot.kind] ?? w.stop.lot.kind
  const kids = c.family.filter(f => f.relation === 'child')
  const small = kids.filter(k => k.age < 10)
  const partner = c.family.find(f => f.relation === 'partner')
  const priceUp = c.env && c.prevEnv && c.prevEnv.prices > 0 ? c.env.prices / c.prevEnv.prices : 1
  const why: string[] = []

  // ---- what she is doing ----
  let doing: string
  // an occasion, while she is at it: who it is about and who is there, by name, from the record
  const o = c.occasion
  const atOcc = o && !w.moving && w.stop.hour === o.start && c.hour >= o.start && c.hour < o.end
  const named = (id: string) => c.kin.find(k => k.id === id)?.name
  const others = o ? o.who.filter(id => id !== o.about && (c.presentAt?.(id, w.stop.lot.id) ?? true)).map(named).filter(Boolean) as string[] : []
  const with_ = others.length ? `, with ${others.slice(0, 3).join(others.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1')}` : ''
  const visiting = w.stop.at === 'visit'
  const mom = c.kin.find(k => k.relation === 'mother')
  const sibs = c.kin.filter(k => k.relation === 'sibling')
  // only the family who are actually in that house right now are named
  const there = c.kin.filter(k => k.relation === 'sibling' && c.presentAt?.(k.id, w.stop.lot.id))
  if (atOcc && o!.kind === 'met') doing = `at ${place}, talking with ${named(o!.about) ?? 'someone new'}`
  else if (atOcc && o!.kind === 'birth') doing = `at the clinic. ${named(o!.about) ?? 'the baby'} is born today${with_}`
  else if (atOcc && o!.kind === 'funeral') doing = `at the funeral for ${o!.text.split('the funeral for ')[1] ?? 'the family'}${with_}`
  else if (visiting && !w.moving) doing = `at ${mom ? `${her} mom` : sibs[0]?.name ?? 'the family'}'s for the afternoon${there.length ? `, ${there.map(s => s.name).slice(0, 2).join(' and ')} ${there.length > 1 ? 'are' : 'is'} there too` : ''}`
  else if (w.leg?.kind === 'wait') doing = `waiting for the bus to ${PLACE[w.next?.lot.kind ?? ''] ?? 'work'}`
  else if (w.onBus) doing = `on the bus to ${PLACE[w.next?.lot.kind ?? ''] ?? 'work'}`
  else if (w.leg && w.moving && w.next) {
    const dest = w.next.at === 'work' ? (job ? `work (${job})` : 'work') : w.next.at === 'visit' ? (mom ? `${her} mom's` : "the family's") : PLACE[w.next.lot.kind] ?? 'home'
    doing = dest === 'home' ? 'walking home' : `walking to ${dest}`
    if (!c.canBus && w.leg.total > 24 && s.income > 0 && c.once('bus', `${w.leg.start}`)) why.push(`the bus would eat ${Math.round(c.busFareShare * 100)}% of ${her} ${money(s.income)} a month, so ${she} walks`)
    if (c.rain) why.push('in the rain')
  } else {
    const a = w.stop.act
    if (a === 'sleep') doing = age < 1 ? 'asleep' : 'asleep'
    else if (a === 'cook') doing = 'cooking'
    else if (a === 'eat') doing = w.stop.lot.kind === 'home' ? (c.family.length ? `eating with ${c.family.length === 1 ? (c.family[0].relation === 'mother' ? `${her} mom` : c.family[0].name) : 'the family'}` : 'eating alone') : 'lunch at the market'
    else if (a === 'work') doing = job ? `at work, ${job} at ${place}` : `working at ${place}`
    else if (a === 'learn') doing = age < 17 ? 'in class' : 'in lectures'
    else if (a === 'shop') doing = 'buying food at the market'
    else if (a === 'play') doing = age < 13 ? `playing at ${place}` : kids.length ? `at ${place} with the kids` : `out at ${place}`
    else if (a === 'care') doing = w.stop.lot.kind === 'clinic' ? 'at the clinic with a relative' : 'looking after family'
    else if (a === 'pray') doing = 'at prayers'
    else if (a === 'sit') doing = w.stop.lot.kind === 'home' ? 'sitting at home' : `sitting in ${place}`
    else doing = w.stop.lot.kind === 'home' ? 'home, resting' : `at ${place}`
  }

  // ---- why, from the world and her life ----
  if ((w.stop.act === 'shop' || (w.stop.act === 'eat' && w.stop.lot.kind === 'market')) && priceUp > 1.15) why.push(`food costs ${priceUp > 1.8 ? 'about twice' : `${Math.round((priceUp - 1) * 100)}% more than`} what it did last year${c.env?.damage === 'famine' ? ' (the famine)' : c.env?.damage === 'disaster' ? ' (the disaster)' : ''}`)
  if (s.hunger && (w.stop.act === 'eat' || w.stop.act === 'shop')) why.push('not enough to go around this month')
  if (w.stop.act === 'work' && w.next?.at !== 'work' && c.hour > 18 && small.length) {
    const sitter = c.family.find(f => f.relation === 'sibling' || f.relation === 'mother')
    why.push(`${small[0].name} is ${c.hour > 21 ? 'asleep' : 'home'}${sitter ? ` with ${sitter.relation === 'mother' ? 'grandma' : sitter.name}` : ''}`)
  }
  if (w.stop.act === 'sleep' && c.hour > 1 && c.hour < 5 && s.mood.grief && (s.mood.grief ?? 0) > 0.5) why.push(`${she} hasn't been sleeping well`)
  if (age < 16 && w.stop.act === 'learn' && mom === undefined && c.family.some(f => f.relation === 'father')) why.push(`${her} dad drops ${she === 'she' ? 'her' : 'him'} off now`)
  if (s.savings < 0 && (w.stop.act === 'work' || w.stop.act === 'shop') && !why.length && c.once('debt', `${w.stop.hour}`)) why.push(`still ${money(-s.savings)} in debt`)
  if (partner && w.stop.act === 'eat' && w.stop.lot.kind === 'home' && !why.length) why.push(`${partner.name} cooked`)
  if (c.tempC >= 30 && !w.stop.lot.kind.includes('home') && !why.length && c.once('heat', `${w.stop.hour}`)) why.push(`${Math.round(c.tempC)}°c out`)
  if (c.tempC <= 12 && !why.length && w.moving && c.once('cold', `${w.leg?.start ?? w.stop.hour}`)) why.push(`a cold morning, ${Math.round(c.tempC)}°c`)
  void name
  const line = `${t}. ${doing}${why.length ? `. ${why[0]}` : ''}.`
  return line.replace(/\.\./g, '.')
}

// at fast speeds: one line for the year, from the journal and the year's biggest event
export function yearLine(r: LifeRecord, year: number): string {
  const j = r.journal.find(x => x.year === year)
  const big = eventsInYear(r, year).filter(e => e.severity >= 0.5 && e.kind !== 'milestone').map(e => e.text)[0]
  const parts = [`${year}, age ${ageYears(r, Math.min(endTick(r), Math.max(0, tickOfYear(year) + 6)))}`]
  if (big && !/^born/.test(big)) parts.push(big)
  else if (j && !j.text.startsWith('(')) parts.push(`"${j.text}"`)
  return parts.join('. ')
}
