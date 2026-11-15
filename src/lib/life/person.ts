// the chosen person between milestones: deterministic monthly rules + the world's events + their own luck.
// luck is a per-month named stream (stream(seed, name + tick)), so the person and their no-lessons twin face
// exactly the same dice every month even after their choices diverge.
import type { Emotion, Mood } from '../types'
import { normal, stream } from '../sim/rng'
import { RESEARCH as R } from './research'
import { deadInEvent, type MonthEnv } from './env'
import type { ChildhoodMarks, HomeType, Job, Kin, LifeActivity, LifeEvent, Look, MonthSnap, Place, Sex, Temperament } from './types'

export type Habit = 'smokes' | 'drinks_heavily' | 'exercises' | 'volunteers' | 'saves' | 'prays' | 'mentors' | 'remits' | 'caregiver' | 'studies' | 'checkups' | 'community'

export type Person = {
  seed: number; name: string; sex: Sex; look: Look; quintile: number; temperament: Temperament
  kid: { hungerMonths: number; displaced: boolean; lostParent: boolean; famineMonths: number; unstableMonths: number }
  marks: ChildhoodMarks | null // set at 16
  aces: number // adverse childhood experiences counted at 16, 0..5
  place: Place; places: (Place & { fromTick: number })[]
  tick: number; alive: boolean; deathCause: string | null
  health: number; chronic: string[]; injuredUntil: number
  mood: Mood
  schoolYears: number; inSchool: boolean; path: string | null; wantsKids: boolean; kidsWanted: number
  job: Job | null; unemployedSince: number | null; retired: boolean; earn: number // personal earnings factor
  savings: number; home: HomeType; saveRate: number
  habits: Set<Habit>; quitSmokingAge: number | null
  friends: number; community: number
  kin: Kin[]
  migrant: boolean; pendingBirthTick: number | null
  widowedAt: number | null; griefUntil: number
  help: number; harm: number; meaningSum: number; adultMonths: number
  healthyMonths: number; valenceSum: number; relSum: number; months: number
  lastIncome: number
  events: LifeEvent[]
  flinch: Emotion | null
}

export const ageOf = (p: Person) => p.tick / 12
export const luck = (p: Person, name: string) => stream(p.seed, `${name}:${p.tick}`)
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))

export const partnerOf = (p: Person) => p.kin.find(k => k.relation === 'partner' && k.diedTick === undefined && k.untilTick === undefined)
export const kidsOf = (p: Person) => p.kin.filter(k => k.relation === 'child')
export const livingKids = (p: Person) => kidsOf(p).filter(k => k.diedTick === undefined)
export const parentsAlive = (p: Person) => p.kin.filter(k => (k.relation === 'mother' || k.relation === 'father') && k.diedTick === undefined)

export function addEvent(p: Person, e: Omit<LifeEvent, 'tick'>) {
  p.events.push({ tick: p.tick, ...e })
  if (e.emotion) p.flinch = e.emotion
}

// ---------- mortality ----------
// gompertz with a modal age set from the region's period life expectancy this year, so the world drives how long
// people live. ESTIMATE: mode = e0 + MODE_OFFSET. calibrated, not derived: with the personal multipliers, child
// mortality and the world's events all stacked on top, an offset of MODE_OFFSET makes the mean age at death of 400
// rule-only twins land within ~2 years of the region's e0 (scripts/life-calibrate.ts prints the check)
export const MODE_OFFSET = Number(process.env.LIFE_MODE_OFFSET ?? 13)
function gompertzYear(age: number, e0: number) {
  const b = R.gompertzSlope
  const mode = e0 + MODE_OFFSET
  return b * Math.exp(b * (age - mode))
}

// under-5 hazard per year from the un igme rate, scaled by how the region's disease burden changed since 2026
function childYear(age: number, regionId: string, burdenNow: number, burden0: number) {
  if (age >= 5) return 0
  const q5 = (R.under5PerThousand[regionId] ?? 37) / 1000
  const scale = burden0 > 0 ? clamp(burdenNow / burden0, 0.05, 3) : 1
  // ~45% of under-5 deaths happen in the first month and ~75% in the first year (un igme 2023). ESTIMATE split
  const share = age < 1 ? 0.75 : 0.25 / 4
  return -Math.log(1 - q5 * share) * scale
}

export function personalMultiplier(p: Person, env: MonthEnv): { mult: number; parts: Record<string, number> } {
  const age = ageOf(p)
  const parts: Record<string, number> = {}
  if (p.habits.has('smokes')) parts.smoking = R.smokingHazard
  else if (p.quitSmokingAge !== null) parts.smoking = p.quitSmokingAge < 40 ? 1 + (R.smokingHazard - 1) * R.quitBy40Keeps : 1 + (R.smokingHazard - 1) * 0.5
  if (p.habits.has('drinks_heavily')) parts.drinking = R.heavyDrinkHazard
  if (p.habits.has('exercises')) parts.exercise = R.exerciseHazard
  const conn = relationshipIndex(p)
  parts.connection = 1 / (1 + (R.connectionSurvivalOR - 1) * conn)
  if (conn < 0.2 && age > 18) parts.loneliness = R.lonelinessHazard
  if (p.adultMonths > 60 && p.meaningSum / p.adultMonths > 0.55) parts.purpose = R.purposeHazard
  if (p.habits.has('volunteers') && age > 50) parts.volunteering = R.volunteerHazard
  if (p.widowedAt !== null && p.tick - p.widowedAt < R.widowhoodMonths) parts.widowhood = R.widowhoodHazard
  // income gradient (chetty 2016): interpolate between the poorest and richest quintile
  const q = currentQuintile(p, env)
  parts.income = R.poorHazard + (R.richHazard - R.poorHazard) * (q - 1) / 4
  if (p.chronic.length) parts.chronic = 1.3 ** p.chronic.length // ESTIMATE per chronic condition
  if (p.habits.has('checkups') && p.chronic.length) parts.checkups = 0.85 // ESTIMATE: treated early
  // relationships at midlife feed health at 80 (harvard study); applied past 70 as a small extra protection
  if (age > 70) parts.harvard = 1 - R.relationshipsToHealthAt80 * (p.relSum / Math.max(1, p.months))
  // conscientiousness: ~0.85x mortality at the high end (kern & friedman 2008 meta-analysis,
  // https://doi.org/10.1037/0278-6133.27.5.505)
  parts.conscientiousness = 1 - 0.3 * (p.temperament.conscientiousness - 0.5)
  // adverse childhood experiences: people with 6+ died ~20 years earlier (brown et al. 2009,
  // https://doi.org/10.1016/j.amepre.2009.06.021). ESTIMATE: +8% hazard per ace
  if (p.aces) parts.childhood = 1 + 0.08 * p.aces
  let mult = Object.values(parts).reduce((a, b) => a * b, 1)
  // the region's life expectancy already includes an average person's habits and income. ESTIMATE: an average
  // person's product of the factors above is ~1.15, so divide it back out
  mult /= 1.15
  return { mult, parts }
}

// which fifth of their region's income distribution they are in now (adults: by income; kids: by family)
export function currentQuintile(p: Person, env: MonthEnv): number {
  if (ageOf(p) < 18 || !p.job) return p.quintile
  const median = medianIncome(env)
  const ratio = p.lastIncome / Math.max(1, median)
  return ratio < 0.5 ? 1 : ratio < 0.85 ? 2 : ratio < 1.2 ? 3 : ratio < 2 ? 4 : 5
}

// ESTIMATE: a median worker earns ~55% of gdp per head (labor share of income, ilo ~52% globally,
// https://ilostat.ilo.org/topics/labour-income/) , per month
export const medianIncome = (env: MonthEnv) => Math.max(40, env.gdpPerHead * 0.55 / 12)

// ---------- money ----------
const JOB_MULT: Record<string, number> = { farm: 0.55, factory: 0.95, construction: 0.85, shop: 0.8, office: 1.35, clinic: 1.25, school: 1.05, lab: 1.8, launch_site: 2.0, power_plant: 1.35, none: 0.45 }

export function monthlyIncome(p: Person, env: MonthEnv): number {
  if (!p.job || p.retired) return 0
  const r = p.place.regionId === 'ssa' ? R.returnPerSchoolYearSsa : R.returnPerSchoolYear
  const meanYears = 4 + 10 * env.education
  const edu = (1 + r) ** clamp(p.schoolYears - meanYears, -8, 10)
  const disaster = env.damage !== 'none' ? 1 - 0.4 * env.damageLevel : 1
  const sickness = p.tick < p.injuredUntil ? 0.4 : 0.7 + 0.3 * p.health
  return medianIncome(env) * (JOB_MULT[p.job.workplace] ?? 1) * edu * p.earn * disaster * sickness
}

// ---------- relationships ----------
// depth index 0..1: partner, kids, friends, wider family. the harvard study's point is quality over quantity, so
// each part is a bond (closeness), not a count
export function relationshipIndex(p: Person): number {
  const age = ageOf(p)
  const partner = partnerOf(p)
  const kids = livingKids(p)
  const fam = p.kin.filter(k => (k.relation === 'mother' || k.relation === 'father' || k.relation === 'sibling') && k.diedTick === undefined)
  if (age < 16) {
    const famBond = fam.length ? fam.reduce((a, k) => a + k.bond, 0) / fam.length : 0.2
    return clamp(0.65 * famBond + 0.35 * p.friends)
  }
  const parts: [number, number][] = [[p.friends, 0.3], [fam.length ? Math.max(...fam.map(k => k.bond)) : 0, 0.15], [p.community, 0.1]]
  if (partner) parts.push([partner.bond, 0.3])
  if (kids.length) parts.push([kids.reduce((a, k) => a + k.bond, 0) / kids.length, 0.25])
  // missing parts count as absent, but a life without a partner or kids can still be full: the weights that are
  // present are scaled up partway (ESTIMATE: 60% of the gap), not all the way
  const w = parts.reduce((a, [, x]) => a + x, 0)
  const v = parts.reduce((a, [b, x]) => a + b * x, 0) / w
  const full = 1.1
  return clamp(v * (w + (full - w) * 0.6) / full)
}

// ---------- the month ----------
export type StepCtx = { env: MonthEnv; burden0: number; regionPop: number }

export function stepMonth(p: Person, ctx: StepCtx): MonthSnap {
  const { env } = ctx
  const age = ageOf(p)
  const L = (n: string) => luck(p, n)
  p.flinch = null
  let hunger = false

  // ---- the world reaches in ----
  const poverty = clamp(1 - (currentQuintile(p, env) - 1) / 4 - Math.min(0.3, p.savings / Math.max(1, medianIncome(env) * 24)))
  if (env.food < 0.85 || env.damage === 'famine') {
    const pHunger = clamp((env.prices - 1) * 0.5 * (0.2 + poverty) + (env.damage === 'famine' ? 0.3 * env.damageLevel : 0))
    if (L('hunger')() < pHunger) {
      hunger = true
      if (age < 16) p.kid.hungerMonths++
      p.health = clamp(p.health - 0.01 - (age < 5 ? 0.01 : 0))
      if (!p.events.slice(-12).some(e => e.text.startsWith('the market'))) addEvent(p, { kind: 'world', worldKind: 'famine', text: env.food < 0.7 ? 'the market stalls were empty. we ate once a day' : 'food prices kept climbing. we ate less', severity: 0.5, emotion: 'fear' })
    }
  }
  for (const e of env.events) {
    if (e.kind === 'disaster' || e.kind === 'war') {
      const dead = deadInEvent(e.text)
      const exposure = 0.6 + 1.4 * poverty // poorer homes are hit harder (ESTIMATE; cf. world bank "unbreakable" 2017, https://openknowledge.worldbank.org/handle/10986/25335)
      const pDie = clamp(dead / Math.max(1, ctx.regionPop) * exposure / 1.3) // the world's own death toll, spread over the region, tilted toward poorer homes (exposure averages ~1.3)
      const pHit = clamp(e.severity * 0.12 * exposure)
      const u = L(`disaster${e.text.length}`)()
      if (u < pDie && age > 0) return die(p, ctx, `killed in a ${e.kind === 'war' ? 'war' : 'disaster'}: ${e.headline ?? e.text}`)
      if (u < pHit) {
        p.health = clamp(p.health - 0.05 * e.severity)
        p.savings *= 0.6
        if (p.home !== 'care_home' && L('homeloss')() < e.severity) { p.home = 'shelter'; if (age < 16) p.kid.displaced = true; addEvent(p, { kind: 'world', worldKind: e.kind, text: `${e.headline ?? e.text}. our home was lost`, severity: e.severity, emotion: 'grief' }) }
        else addEvent(p, { kind: 'world', worldKind: e.kind, text: `${e.headline ?? e.text}. it reached our street`, severity: e.severity, emotion: 'fear' })
      } else if (e.severity > 0.35 && L('heard')() < 0.3) addEvent(p, { kind: 'world', worldKind: e.kind, text: e.headline ?? e.text, severity: e.severity * 0.5, emotion: 'fear' })
    } else if (e.kind === 'revolt' && L('protestpast')() < 0.35) {
      addEvent(p, { kind: 'world', worldKind: 'revolt', text: 'a protest walked past the window', severity: 0.3, emotion: 'distrust' })
    } else if (e.kind === 'pandemic') {
      addEvent(p, { kind: 'world', worldKind: 'pandemic', text: e.headline ?? e.text, severity: e.severity, emotion: 'fear' })
      const pInf = 0.15 * e.severity * (1 - 0.6 * env.health)
      if (L('infection')() < pInf) {
        p.health = clamp(p.health - 0.08)
        const pDie = 0.002 * e.severity * Math.exp(0.08 * Math.max(0, age - 40)) * (1.5 - env.health) // ESTIMATE: infection fatality rises ~8%/year of age (covid ifr, levin et al. 2020 https://doi.org/10.1007/s10654-020-00698-1)
        if (L('ifr')() < pDie) return die(p, ctx, `the pandemic: ${e.headline ?? 'a new disease'}`)
        addEvent(p, { kind: 'health', text: 'caught the new illness. weeks in bed', severity: 0.4, emotion: 'fear' })
      }
    } else if ((e.kind === 'launch' || e.kind === 'breakthrough') && e.significance > 0.6 && L('awe')() < 0.5) {
      addEvent(p, { kind: 'world', worldKind: e.kind, text: e.headline ?? e.text, severity: 0.2, emotion: 'awe' })
    }
  }
  for (const law of env.newLaws) addEvent(p, { kind: 'world', worldKind: 'law', text: `on the news screen: ${law.title.toLowerCase()}`, severity: 0.15, emotion: law.support > 0.5 ? 'hope' : 'distrust' })
  if (env.status === 'destroyed' && L('collapse')() < 0.02) addEvent(p, { kind: 'world', worldKind: 'revolt', text: 'the world government has fallen. nobody is in charge', severity: 0.8, emotion: 'fear' })

  // ---- childhood marks ----
  if (age < 16) {
    if (env.damage === 'famine') p.kid.famineMonths++
    if (p.home === 'shelter' || p.home === 'informal_settlement') p.kid.unstableMonths++
  }

  // ---- body ----
  // ESTIMATE: physical health declines slowly from ~30, faster from ~65; habits bend the curve
  let decline = age < 30 ? 0 : age < 65 ? 0.0006 : 0.0018 + (age - 65) * 0.00005
  if (p.habits.has('smokes')) decline += 0.0005
  if (p.habits.has('drinks_heavily')) decline += 0.0004
  if (p.habits.has('exercises')) decline *= 0.7
  p.health = clamp(p.health - decline + (age < 18 ? 0.002 : 0) + (p.tick < p.injuredUntil ? -0.002 : 0) + (1 - p.health) * 0.01 * env.health)
  if (age > 35) {
    // chronic onset, ESTIMATE per-year rates rising with age, behaviors and poverty
    const onset = 0.004 * Math.exp(0.05 * (age - 35)) * (p.habits.has('smokes') ? 1.8 : 1) * (p.habits.has('exercises') ? 0.7 : 1) * (1 + 0.5 * poverty) / 12
    if (L('chronic')() < onset && p.chronic.length < 3) {
      const which = ['heart disease', 'diabetes', 'lung disease', 'arthritis', 'high blood pressure'].filter(x => !p.chronic.includes(x))
      const c = which[Math.floor(L('chronicKind')() * which.length)]
      p.chronic.push(c)
      p.health = clamp(p.health - 0.06)
      addEvent(p, { kind: 'health', text: `diagnosed with ${c}`, severity: 0.4, emotion: 'fear' })
    }
  }

  // ---- money ----
  const income = monthlyIncome(p, env)
  p.lastIncome = income
  const median = medianIncome(env)
  const costs = Math.max(median * 0.45, income * 0.7) * (0.6 + 0.4 * env.prices) * (1 + 0.15 * livingKids(p).filter(k => p.tick - k.bornTick < 216).length)
  const remit = p.habits.has('remits') ? income * R.remittanceShare : 0
  if (age >= 16) {
    // savings below zero is debt, capped at two years of median income (ESTIMATE: informal lenders stop there)
    // the family covers students and young people still living at home. otherwise a shortfall is mostly eaten
    // (people cut back; that is the hunger above), and only a slice becomes debt (ESTIMATE 15%)
    const covered = p.inSchool || (age < 22 && p.home === 'family_home')
    const shortfall = covered ? 0 : Math.max(0, costs - income) * 0.15
    p.savings = Math.max(-median * 24, p.savings + income * (p.habits.has('saves') ? Math.max(p.saveRate, 0.1) : p.saveRate) - shortfall - remit)
    if (p.retired) p.savings = Math.max(-median * 24, p.savings - median * 0.25 * (p.savings > 0 ? 1 : 0.3)) // living on savings and family (ESTIMATE)
    if (remit) p.help += 0.3
  }

  // ---- people ----
  stepKin(p, ctx)

  // ---- feelings ----
  const rel = relationshipIndex(p)
  const unemployed = age >= 18 && !p.retired && !p.inSchool && !p.job
  const grief = p.tick < p.griefUntil ? clamp((p.griefUntil - p.tick) / 24) : 0
  const relIncome = Math.log2(Math.max(0.1, (income || (p.retired ? median * 0.6 : age < 18 ? median * (0.4 + 0.3 * p.quintile) : median * 0.2)) / median))
  const smallKids = livingKids(p).filter(k => p.tick - k.bornTick < 60).length
  const meaningNow = meaningRate(p)
  let valence = 0.52 + R.wellbeingPerLog2Income * clamp(relIncome, -3, 3) + 0.22 * (rel - 0.5) + 0.15 * (p.health - 0.7)
    - (unemployed ? R.unemploymentValenceHit : 0) - (hunger ? 0.15 : 0) - 0.25 * grief - (smallKids ? R.kidsSmallValenceDip : 0)
    + 0.08 * (meaningNow - 0.4) - 0.08 * env.unrest - (p.home === 'shelter' ? 0.08 : p.home === 'informal_settlement' ? 0.03 : 0)
  // personality: a stable set point (lykken & tellegen 1996, https://doi.org/10.1111/j.1467-9280.1996.tb00355.x)
  valence += 0.04 * normalSeed(p.seed)
  // neuroticism lowers and extraversion raises the wellbeing set point (steel et al. 2008 meta-analysis,
  // https://doi.org/10.1037/0033-2909.134.1.138). ESTIMATE sizes
  valence += -0.1 * (p.temperament.neuroticism - 0.5) + 0.05 * (p.temperament.extraversion - 0.5) - 0.01 * p.aces
  valence = clamp(valence + 0.02 * normal(L('mood')))
  easeMood(p, {
    joy: valence, fear: clamp((hunger ? 0.5 : 0) + env.unrest * 0.3 + (p.chronic.length ? 0.15 : 0) + (unemployed ? 0.2 : 0)),
    anger: clamp(0.15 * (p.temperament.neuroticism - 0.3) + env.unrest * 0.4 + (unemployed ? 0.15 : 0) + (hunger ? 0.15 : 0)), hope: clamp(0.6 - age / 250 + (income > p.lastIncome ? 0.05 : 0) + 0.2 * meaningNow),
    grief, pride: clamp(0.15 + meaningNow * 0.4 + (p.job?.helping ? 0.1 : 0)), envy: clamp(0.15 + (relIncome < -1 ? 0.2 : 0)),
    boredom: clamp(unemployed ? 0.45 : p.retired ? 0.3 : 0.15), awe: 0.08, distrust: clamp(0.15 + env.unrest * 0.4 + (p.marks ? (1 - p.marks.trust) * 0.3 : 0)),
  })

  // ---- bookkeeping for the score ----
  p.months++
  p.healthyMonths += p.health
  p.valenceSum += valence
  p.relSum += rel
  if (age >= 18) { p.adultMonths++; p.meaningSum += meaningNow }
  p.help += helpRate(p)

  // ---- death ----
  const { mult } = personalMultiplier(p, env)
  const famine = hunger ? R.famineDeathPerMonth * 12 * (env.damage === 'famine' ? env.damageLevel : 0.3) * (age < 5 || age > 70 ? 2 : 1) : 0
  const violence = env.unrest > 0.5 ? (env.unrest - 0.5) * 0.004 : 0 // ESTIMATE yearly
  const collapse = env.status === 'destroyed' ? 0.03 : 0 // ESTIMATE yearly, once the world government falls
  const base = gompertzYear(age, env.lifeExpectancy) * mult
  const child = childYear(age, p.place.regionId, 1 - env.health, ctx.burden0) * (0.6 + 0.8 * poverty)
  const yearly = base + child + famine + violence + collapse
  if (L('death')() < 1 - Math.exp(-yearly / 12)) {
    const parts: [string, number][] = [['base', base], ['child', child], ['famine', famine], ['violence', violence], ['collapse', collapse]]
    const total = parts.reduce((a, [, x]) => a + x, 0)
    let u = L('cause')() * total, which = 'base'
    for (const [k, x] of parts) { u -= x; if (u <= 0) { which = k; break } }
    return die(p, ctx, causeOf(p, which, env))
  }

  return snapshot(p, env, rel, valence, income, hunger)
}

const normalSeed = (seed: number) => { const r = stream(seed, 'setpoint'); return normal(r) }

export function meaningRate(p: Person): number {
  let m = 0.2
  if (p.job?.helping) m += 0.25
  else if (p.job) m += 0.1
  if (p.habits.has('prays')) m += 0.12
  if (p.habits.has('volunteers')) m += 0.15
  if (p.habits.has('mentors')) m += 0.12
  if (p.habits.has('caregiver')) m += 0.15
  if (p.habits.has('community')) m += 0.08
  if (livingKids(p).length) m += 0.12
  if (!p.job && !p.retired && ageOf(p) >= 18 && !p.inSchool) m -= 0.15
  return clamp(m)
}

function helpRate(p: Person): number {
  let h = 0
  if (p.job?.helping) h += 1
  if (p.habits.has('volunteers')) h += 0.6
  if (p.habits.has('mentors')) h += 0.4
  if (p.habits.has('caregiver')) h += 0.8
  h += 0.35 * livingKids(p).filter(k => p.tick - k.bornTick < 216).length
  return h
}

function easeMood(p: Person, target: Mood) {
  for (const k of Object.keys(target) as Emotion[]) p.mood[k] = clamp(p.mood[k] + (target[k] - p.mood[k]) * 0.25)
  if (p.flinch) p.mood[p.flinch] = clamp(p.mood[p.flinch] + 0.25)
}

function stepKin(p: Person, ctx: StepCtx) {
  const { env } = ctx
  for (const k of p.kin) {
    if (k.diedTick !== undefined) continue
    const kAge = (p.tick - k.bornTick) / 12
    if (kAge < 0) continue
    const h = gompertzYear(kAge, env.lifeExpectancy) + childYear(kAge, p.place.regionId, 1 - env.health, ctx.burden0)
    if (luck(p, `kin:${k.id}`)() < 1 - Math.exp(-h / 12)) {
      k.diedTick = p.tick
      k.diedOf = kAge < 5 ? 'a childhood illness' : kAge > 70 ? 'old age' : 'an illness'
      const close = k.relation === 'partner' || k.relation === 'child' || ((k.relation === 'mother' || k.relation === 'father') && ageOf(p) < 30)
      p.griefUntil = Math.max(p.griefUntil, p.tick + (k.relation === 'child' ? 60 : close ? 30 : 12))
      if (k.relation === 'partner') p.widowedAt = p.tick
      if ((k.relation === 'mother' || k.relation === 'father') && ageOf(p) < 16) p.kid.lostParent = true
      // bereavement hits health too: mortality rises for months after losing a close person (stroebe et al. 2007
      // lancet, https://doi.org/10.1016/S0140-6736(07)61816-9). ESTIMATE size
      if (close) p.health = clamp(p.health - (k.relation === 'child' ? 0.05 : 0.03))
      addEvent(p, { kind: 'family', text: `${k.name} died${k.relation === 'child' ? ', my child' : k.relation === 'partner' ? ', my partner' : k.relation === 'mother' ? ', my mother' : k.relation === 'father' ? ', my father' : ''}`, severity: close ? 0.9 : 0.5, emotion: 'grief' })
      continue
    }
    // bonds drift: toward warm when there is time together, cooler with distance (migration) or neglect
    const far = p.migrant && (k.relation === 'mother' || k.relation === 'father' || k.relation === 'sibling')
    // agreeableness predicts relationship satisfaction (malouff et al. 2010, https://doi.org/10.1016/j.jrp.2009.09.004)
    const target = k.relation === 'partner' ? 0.55 + 0.25 * relationshipCare(p) + 0.1 * (p.temperament.agreeableness - 0.5) : k.relation === 'child' ? 0.6 + 0.25 * relationshipCare(p) : far ? 0.3 : 0.5 + 0.15 * relationshipCare(p)
    k.bond = clamp(k.bond + (target - k.bond) * 0.01)
    if (k.relation === 'partner' && k.bond < 0.3 && luck(p, 'split')() < 0.01) {
      k.untilTick = p.tick
      p.griefUntil = Math.max(p.griefUntil, p.tick + 12)
      addEvent(p, { kind: 'family', text: `${k.name} and i separated`, severity: 0.6, emotion: 'grief' })
    }
  }
  // the friends circle: young people make friends easily, adults keep them only with effort (ESTIMATE; cf. hall 2019
  // ~200 hours to make a close friend, https://doi.org/10.1177/0265407518761225)
  const age = ageOf(p)
  // extraverts keep bigger, closer circles (asendorpf & wilpers 1998, https://doi.org/10.1037/0022-3514.74.6.1531)
  const fTarget = clamp((age < 25 ? 0.6 : (p.habits.has('community') || p.habits.has('volunteers') || p.habits.has('prays') ? 0.6 : 0.35) * (p.migrant ? 0.8 : 1)) + 0.15 * (p.temperament.extraversion - 0.5))
  p.friends = clamp(p.friends + (fTarget - p.friends) * 0.01)
  // births: a pending pregnancy becomes a child
  if (p.pendingBirthTick !== null && p.tick >= p.pendingBirthTick) {
    p.pendingBirthTick = null
    const r = luck(p, 'baby')
    const sex: Sex = r() < 0.5 ? 'female' : 'male'
    const n = kidsOf(p).length
    const kid: Kin = { id: `kid${n + 1}`, name: babyName(p, r, sex), relation: 'child', sex, bornTick: p.tick, bond: 0.7 }
    p.kin.push(kid)
    addEvent(p, { kind: 'family', text: `${kid.name} was born`, severity: 0.7, emotion: 'joy' })
    // maternal risk for the person who gives birth (who et al. 2023)
    if (p.sex === 'female' && r() < (R.maternalPer100k[p.place.regionId] ?? 100) / 1e5 * (1.6 - env.health)) die(p, ctx, 'complications in childbirth')
  }
  // grandchildren: each adult child may have kids of their own (ESTIMATE: ~region fertility spread over ages 24-38)
  for (const k of livingKids(p)) {
    const kAge = (p.tick - k.bornTick) / 12
    if (kAge < 24 || kAge > 38) continue
    const already = p.kin.filter(g => g.parentId === k.id).length
    if (already < Math.round(env.region.fertility || 2) && luck(p, `gk:${k.id}`)() < (env.region.fertility || 2) / 14 / 12) {
      const r = luck(p, `gkid:${k.id}`)
      const sex: Sex = r() < 0.5 ? 'female' : 'male'
      p.kin.push({ id: `${k.id}-g${already + 1}`, name: babyName(p, r, sex), relation: 'grandchild', sex, bornTick: p.tick, parentId: k.id, bond: 0.5 })
      addEvent(p, { kind: 'family', text: `a grandchild: ${k.name}'s baby`, severity: 0.5, emotion: 'joy' })
    }
  }
}

// how much effort they put into the people around them (habits that make time for others)
function relationshipCare(p: Person) {
  let c = 0.4
  if (p.habits.has('community')) c += 0.15
  if (p.habits.has('caregiver')) c += 0.15
  if (p.habits.has('drinks_heavily')) c -= 0.25
  if (p.job && p.job.workplace === 'office' && p.earn > 1.4) c -= 0.1 // long hours (ESTIMATE)
  return clamp(c)
}

import { nameFor } from './births'
import type { Rng } from '../sim/rng'
// a name nobody in the family already has (up to a few redraws)
export function freshName(p: Person, r: Rng, sex: Sex): string {
  const taken = new Set([p.name.split(' ')[0], ...p.kin.map(k => k.name)])
  let n = nameFor(r, p.place.regionId, sex).given
  for (let i = 0; i < 6 && taken.has(n); i++) n = nameFor(r, p.place.regionId, sex).given
  return n
}
const babyName = (p: Person, r: Rng, sex: Sex) => freshName(p, r, sex)

function causeOf(p: Person, which: string, env: MonthEnv): string {
  const age = ageOf(p)
  const r = luck(p, 'causeKind')()
  if (which === 'child') return age < 0.1 ? 'complications at birth' : env.region.id === 'ssa' && r < 0.3 ? 'malaria' : r < 0.6 ? 'pneumonia' : 'diarrhea from unsafe water'
  if (which === 'famine') return 'hunger, in the famine'
  if (which === 'violence') return 'violence during the unrest'
  if (which === 'collapse') return 'the collapse, when the hospitals closed'
  if (age < 40) return r < 0.4 ? 'a road accident' : r < 0.7 ? 'an infection' : 'a sudden illness'
  if (p.habits.has('smokes') && r < 0.45) return r < 0.25 ? 'lung cancer' : 'a heart attack'
  if (p.chronic.length && r < 0.5) return p.chronic[0] === 'diabetes' ? 'complications of diabetes' : p.chronic[0] === 'lung disease' ? 'lung disease' : 'heart disease'
  if (age > 88) return 'old age, in their sleep'
  return r < 0.35 ? 'heart disease' : r < 0.6 ? 'cancer' : r < 0.8 ? 'a stroke' : 'pneumonia'
}

function die(p: Person, ctx: StepCtx, cause: string): MonthSnap {
  p.alive = false
  p.deathCause = cause
  addEvent(p, { kind: 'death', text: `died: ${cause}`, severity: 1, emotion: 'grief' })
  return snapshot(p, ctx.env, relationshipIndex(p), 0, 0, false)
}

export function activityOf(p: Person): LifeActivity {
  const age = ageOf(p)
  if (!p.alive) return 'sick'
  if (age < 4) return 'infant'
  if (p.tick < p.griefUntil && p.griefUntil - p.tick > 18) return 'grieving'
  if (p.tick < p.injuredUntil) return 'sick'
  if (p.inSchool) return age >= 17 ? 'studying' : 'school'
  if (p.retired) return p.habits.has('caregiver') ? 'caregiving' : 'retired'
  if (p.job) return 'working'
  if (p.habits.has('caregiver')) return 'caregiving'
  return 'unemployed'
}

function snapshot(p: Person, env: MonthEnv, rel: number, valence: number, income: number, hunger: boolean): MonthSnap {
  const top = (Object.entries(p.mood) as [Emotion, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const r2 = (x: number) => Math.round(x * 100) / 100
  return {
    tick: p.tick, age: Math.round(ageOf(p) * 10) / 10, cityId: p.place.cityId, home: p.home,
    job: p.job?.title ?? null, workplace: p.job?.workplace ?? 'none', activity: activityOf(p),
    income: Math.round(income), savings: Math.round(p.savings), health: r2(p.health),
    mood: Object.fromEntries(top.map(([k, v]) => [k, r2(v)])), valence: r2(valence), relationships: r2(rel),
    kids: livingKids(p).length, partner: !!partnerOf(p), behavior: [...p.habits],
    ...(hunger ? { hunger: true } : {}),
  }
}
