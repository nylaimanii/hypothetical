// a life told plainly, the way a friend would sum it up: what was hard, what she did, how it ended.
// every clause comes from the record (milestones, events, kin, childhood marks). nothing is invented, and if a part
// of the life has nothing notable, it is left out rather than padded.
import type { LifeRecord } from './types'

const yr = (tick: number) => 2026 + Math.floor((tick + 10) / 12)
const age = (tick: number) => Math.floor(tick / 12)
const num = (n: number) => (['no', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? String(n))

export type Pron = { she: string; her: string; her2: string } // her2: object pronoun
export const pron = (r: LifeRecord): Pron => (r.sex === 'female' ? { she: 'she', her: 'her', her2: 'her' } : { she: 'he', her: 'his', her2: 'him' })

export function lifeStory(r: LifeRecord): string[] {
  const p = pron(r)
  const out: string[] = []
  const ev = (re: RegExp, before = Infinity) => r.events.filter(e => re.test(e.text) && e.tick < before)
  const choice = (id: string) => r.milestones.find(m => m.id.startsWith(`${id}-`))

  // ---- childhood ----
  const hard: string[] = []
  const homesLost = ev(/home was lost/, 16 * 12).length
  if (homesLost) hard.push(`lost ${num(homesLost)} ${homesLost === 1 ? 'home' : 'homes'}`)
  const parent = r.kin.find(k => (k.relation === 'mother' || k.relation === 'father') && k.diedTick !== undefined && k.diedTick < 16 * 12)
  if (parent) hard.push(`${p.her} ${parent.relation === 'mother' ? 'mom' : 'dad'}`)
  const lastLoss = Math.max(...ev(/home was lost/, 16 * 12).map(e => e.tick), parent?.diedTick ?? -1)
  const hungry = (r.childhood?.hungerMonths ?? 0) > 6
  const school = choice('stay_school')
  const leftSchool = school && school.choice === 'leave_work' ? age(school.tick) : null
  if (hard.length || leftSchool !== null || hungry) {
    const parts = [hard.length ? `${hard.join(' and ')} before ${p.she} was ${Math.max(age(lastLoss) + 1, 5)}` : '', hungry ? 'went hungry a lot' : '', leftSchool !== null ? `out of school at ${leftSchool}` : ''].filter(Boolean)
    out.push(`rough start: ${parts.join(', ')}.`)
  } else if (r.family.quintile >= 4) out.push(`grew up comfortable in ${r.birthplace.city.toLowerCase()}.`)

  // ---- what they did ----
  const did: string[] = []
  const jobs = [...new Set(r.snaps.map(s => s.job).filter(Boolean) as string[])]
  const helping = jobs.find(j => /nurse|doctor|teacher|care|health/.test(j))
  const path = choice('path')
  if (path && path.choice === 'trade' && r.family.quintile >= 4) did.push('picked a trade over university')
  if (helping) did.push(`${leftSchool !== null || hard.length ? 'still ' : ''}became a ${helping.replace(/^rural clinic /, '').replace('community health aide', 'health aide')}`)
  else if (jobs[0]) did.push(`worked as a ${jobs[0]}`)
  const moved = ev(/^moved from .* to /)
  if (moved.length) did.push(`moved to ${moved[moved.length - 1].text.replace(/^moved from .* to ([^,]+).*$/, '$1').toLowerCase()}`)
  else if (r.milestones.some(m => m.outcome.some(o => /visa was refused/.test(o)))) did.push('tried to emigrate but the visa got refused')
  const laidOff = ev(/^laid off/)[0]
  if (laidOff) did.push(`got laid off at ${age(laidOff.tick)} and retrained`)
  const home = ev(/bought a first home/)[0]
  if (home) did.push(`bought ${p.her} own place at ${age(home.tick)}`)
  const caregiver = choice('parents')
  if (caregiver?.choice === 'take_in') did.push(`took ${p.her} ${r.kin.find(k => k.relation === 'mother') ? 'mom' : 'parents'} in at the end`)
  const kids = r.kin.filter(k => k.relation === 'child').length
  const partner = r.kin.find(k => k.relation === 'partner')
  if (kids) did.push(`raised ${num(kids)} ${kids === 1 ? 'kid' : 'kids'}${partner ? ` with ${partner.name}` : ''}`)
  if (did.length) out.push(`${did.slice(0, 3).join(', ')}.`)

  // ---- how it ended ----
  if (r.deathAge !== null) out.push(r.deathAge < 16 ? `died at ${r.deathAge < 1 ? `${Math.max(1, Math.round(r.deathAge * 12))} months` : Math.floor(r.deathAge)} of ${r.deathCause}.` : `died at ${Math.floor(r.deathAge)} of ${r.deathCause}.`)
  return out.map(s => s.charAt(0).toLowerCase() + s.slice(1))
}

// the score in words, always against the same person making the usual choices
export function scoreWords(r: LifeRecord): string | null {
  if (!r.score) return null
  const s = r.score.total, t = r.twin?.score.total
  if (t === undefined) return `${s.toFixed(2)} out of 1.`
  const gap = s - t
  const how = gap > 0.12 ? 'way above' : gap > 0.04 ? 'above' : gap > -0.04 ? 'about the same as' : gap > -0.12 ? 'below' : 'way below'
  const years = r.twin && r.deathAge !== null ? Math.round(r.deathAge - r.twin.deathAge) : 0
  return `${s.toFixed(2)} out of 1, ${how} the ${t.toFixed(2)} ${pron(r).she} gets making the usual choices${years >= 3 ? `, and ${years} more years` : years <= -3 ? `, but ${-years} fewer years` : ''}.`
}

export const lifeYears = (r: LifeRecord) => `${yr(0)}–${r.deathTick !== null ? yr(r.deathTick) : 'now'}`
