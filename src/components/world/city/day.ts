// v4 living pips: what a citizen is doing at a local hour, where, until when, and why, in plain words.
// pure functions, shared by the city diorama and the pip dossier.
import type { Activity, Citizen, Workplace } from '@/lib/types'

export type PlanStep = { hour: number; activity: Activity }

// a plain day when the sim gave none: home, work, home
const DEFAULT_PLAN: PlanStep[] = [
  { hour: 0, activity: 'sleeping' }, { hour: 7, activity: 'eating' }, { hour: 8, activity: 'commuting' },
  { hour: 9, activity: 'working' }, { hour: 12, activity: 'eating' }, { hour: 13, activity: 'working' },
  { hour: 17, activity: 'commuting' }, { hour: 18, activity: 'resting' }, { hour: 22, activity: 'sleeping' },
]

export function planOf(c: Citizen): PlanStep[] {
  const p = c.dayPlan && c.dayPlan.length ? c.dayPlan : DEFAULT_PLAN
  return [...p].sort((a, b) => a.hour - b.hour)
}

// the step in force at hour h (plans wrap around midnight), and when it ends
export function stepAt(plan: PlanStep[], h: number, jitter = 0): { step: PlanStep; index: number; until: number } {
  const t = (((h - jitter) % 24) + 24) % 24
  let index = plan.length - 1
  for (let i = 0; i < plan.length; i++) if (plan[i].hour <= t) index = i
  const next = plan[(index + 1) % plan.length]
  const until = (next.hour + jitter + 24) % 24
  return { step: plan[index], index, until }
}

// what a commute is heading to: the next step that is not a commute
export function nextNonCommute(plan: PlanStep[], index: number): Activity {
  for (let k = 1; k <= plan.length; k++) {
    const a = plan[(index + k) % plan.length].activity
    if (a !== 'commuting') return a
  }
  return 'resting'
}

const WORK_WORDS: Record<Workplace, string> = {
  farm: 'the fields', factory: 'the factory', office: 'the office', lab: 'the lab', clinic: 'the clinic', school: 'the school',
  shop: 'the market', launch_site: 'the launch site', construction: 'the building site', power_plant: 'the power plant', none: 'home',
}
export const workWords = (w: Workplace | undefined) => WORK_WORDS[w ?? 'none']

export function placeOf(c: Citizen, a: Activity, h: number): string {
  switch (a) {
    case 'sleeping': case 'resting': case 'idle': return 'home'
    case 'eating': return h >= 11 && h < 14 && c.employed !== false && c.workplace && c.workplace !== 'none' ? 'the market' : 'home'
    case 'working': return workWords(c.workplace)
    case 'school': return 'the school'
    case 'shopping': return 'the market'
    case 'socializing': return c.mood.joy + c.mood.hope > 0.8 ? 'the park' : 'home'
    case 'celebrating': case 'protesting': return 'the square'
    case 'striking': return `outside ${c.workplace && c.workplace !== 'none' ? workWords(c.workplace) : 'the factory'}`
    case 'praying': return c.belief === 'religious' ? 'the shrine' : 'home'
    case 'aid_line': return 'the aid line at the clinic'
    case 'moving': return 'the road out of town'
    case 'commuting': return 'on the way'
  }
}

export const fmtH = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`

function whyOf(c: Citizen, a: Activity, place: string, until: string, next: Activity): string {
  const job = workWords(c.workplace)
  switch (a) {
    case 'aid_line': return `in the aid line because they lost their job${c.workplace && c.workplace !== 'none' ? ` at ${job}` : ''}`
    case 'striking': return `on strike with the other workers from ${job}`
    case 'protesting': return 'protesting in the square instead of going to work'
    case 'celebrating': return 'celebrating in the square with half the town'
    case 'moving': return 'leaving town with everything they can carry'
    case 'working': return `at work until ${until}`
    case 'school': return `at school until ${until}`
    case 'sleeping': return `asleep until ${until}`
    case 'commuting': return `on the way to ${placeOf(c, next, 12)}`
    case 'shopping': return c.behavior === 'hoarding' || c.behavior === 'panic_buying' ? 'buying more than they need, in case shelves empty' : 'shopping after work'
    case 'praying': return 'at prayer, as every day at this hour'
    case 'eating': return place === 'home' ? 'eating at home' : 'lunch at the market'
    case 'socializing': return place === 'the park' ? 'out in the park while the evening is good' : 'staying in tonight'
    case 'resting': return `resting at home until ${until}`
    case 'idle': return 'nothing to do today'
  }
}

export function todayOf(c: Citizen, localHour: number): { now: Activity; place: string; until: string; why: string; schedule: { hour: number; activity: Activity }[] } {
  const plan = planOf(c)
  const { step, index, until } = stepAt(plan, localHour)
  const now = step.activity
  const next = nextNonCommute(plan, index)
  const place = placeOf(c, now, localHour)
  const u = fmtH(until)
  return { now, place, until: u, why: whyOf(c, now, place, u, next), schedule: plan }
}
