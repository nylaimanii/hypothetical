// one life, birth to death, inside a finished world. runLife() runs the person and their no-lessons twin (same
// birth, same world, same monthly luck, the usual choices, no llm) and writes data/lives/<worldId>/<lifeId>.json.
import fs from 'node:fs'
import path from 'node:path'
import { normal, pickWeighted, stream } from '../sim/rng'
import { provider, withUsage } from '../agent/llm'
import { WorldEnv } from './env'
import { worldBrief } from './brief'
import { nameFor as sharedName, newNameRegistry } from '../sim/names'
import { yearOf } from './facts'
import { pickBirthplace, nameFor, type Continent } from './births'
import { RESEARCH as R, PROVENANCE } from './research'
import { SCHEDULE, TRIGGERS, lateChildCheck, type MilestoneDef, type Option } from './milestones'
import { addEvent, ageOf, kidsOf, livingKids, luck, medianIncome, parentsAlive, partnerOf, stepMonth, type Person } from './person'
import { decideLlm, ruleChoice, politeLlm, type Decision } from './decide'
import { creditLessons, readLessons, relevantLessons, writeLessons, writeLifeLessons } from './lessons'
import { scoreLife } from './score'
import { writeLife, writeNow } from './store'
import { sendEndOfLife, sendWild, lifeLink } from './telegram'
import type { EnvYear, JournalLine, LifeLesson, LifeRecord, Look, Milestone, MonthSnap, Sex, Temperament } from './types'

export const LIFE_SIM_VERSION = 'life-1.0'
const MAX_TICKS = 125 * 12 // nobody lives past 125 here (the oldest verified human reached 122)
const MAX_TRIGGERED = 16

type Demo = { regions: Record<string, { skinTone: { weights: number[] }; hairType: { weights: Record<string, number> }; hairColor: { weights: Record<string, number> }; heightCm: { female: number; male: number; sd?: { female: number; male: number } }; vitalRates?: { tfr: number } }> }
let demoCache: Demo | null = null
const demo = (): Demo => (demoCache ??= JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'demographics.json'), 'utf8')) as Demo)

// ---------- birth ----------
// mean age of mothers at birth by region, ESTIMATE rounded from un wpp 2024 (https://population.un.org/wpp/)
const MOTHER_AGE: Record<string, number> = { ssa: 28, sasia: 26, nafrica: 29, mideast: 29, seasia: 28, easia: 31, latam: 27, carib_pac: 27, rus_ca: 28, na: 30, europe: 31, oceania: 31 }
// births skew poorer: poorer families have more children (ESTIMATE weights for the five income fifths at birth)
const QUINTILE_AT_BIRTH = [0.26, 0.22, 0.2, 0.17, 0.15]

export function createPerson(world: WorldEnv, seed: number, continent?: Continent): Person {
  const r = stream(seed, 'birth')
  const { country, city } = pickBirthplace(r, continent)
  const regionId = country.regionId
  // sex ratio at birth ~105 boys per 100 girls (un wpp). SOURCED
  const sex: Sex = r() < 105 / 205 ? 'male' : 'female'
  const d = demo().regions[regionId] ?? demo().regions.europe
  const hairKeys = Object.keys(d.hairType.weights)
  const hcKeys = Object.keys(d.hairColor.weights)
  const sd = d.heightCm.sd?.[sex] ?? 7
  const look: Look = {
    skinTone: pickWeighted<number>(r, d.skinTone.weights) + 1,
    hair: pickWeighted<string>(r, hairKeys.map(k => d.hairType.weights[k]), hairKeys) as Look['hair'],
    hairColor: pickWeighted<string>(r, hcKeys.map(k => d.hairColor.weights[k]), hcKeys) as Look['hairColor'],
    adultHeightCm: Math.round((d.heightCm[sex] + sd * normal(r)) * 10) / 10,
    build: (['slim', 'average', 'broad'] as const)[pickWeighted<number>(r, [0.3, 0.5, 0.2])],
  }
  const t = (): number => Math.max(0.03, Math.min(0.97, 0.5 + 0.17 * normal(r)))
  const temperament: Temperament = { openness: t(), conscientiousness: t(), extraversion: t(), agreeableness: t(), neuroticism: t() }
  const quintile = pickWeighted<number>(r, QUINTILE_AT_BIRTH) + 1
  // names: B's shared generator. parents first, then her and her siblings in the family's pattern
  const names = newNameRegistry()
  const takenGiven = new Set<string>() // (across the whole family, whatever their family names)
  const nm = (o: Omit<Parameters<typeof sharedName>[2], 'countryId' | 'regionId'>) => { let x = sharedName(names, Math.floor(r() * 2 ** 32) >>> 0, { countryId: country.id, regionId, ...o }); for (let k = 0; k < 20 && takenGiven.has(x.given.toLowerCase()); k++) x = sharedName(names, Math.floor(r() * 2 ** 32) >>> 0, { countryId: country.id, regionId, ...o }); takenGiven.add(x.given.toLowerCase()); return { given: x.given.toLowerCase(), family: x.family.toLowerCase(), group: x.group, full: x.full.toLowerCase(), ...(x.family2 ? { family2: x.family2.toLowerCase() } : {}) } }
  const mother = nm({ sex: 'female' }), father = nm({ sex: 'male' })
  const informal = (R.informalUrbanShare[regionId] ?? 0.2) * (quintile <= 2 ? 1.7 : quintile === 3 ? 0.6 : 0.05)
  const mAge = MOTHER_AGE[regionId] ?? 28
  const motherAge = Math.max(16, Math.min(44, mAge + 5.5 * normal(r)))
  const fatherPresent = r() < 0.88 // ESTIMATE: most children are born with a father in the household (un women 2019)
  const tfr = d.vitalRates?.tfr ?? 2.3
  const olderSibs = Math.max(0, Math.min(8, Math.round((tfr - 1) * (motherAge - 18) / Math.max(8, mAge - 18) * 0.6 + normal(r) * 0.8)))
  const n = nm({ sex, father: fatherPresent ? father : undefined, mother })
  const p: Person = {
    seed, name: n.full, nameParts: n, names, sex, look, quintile, temperament,
    kid: { hungerMonths: 0, displaced: false, lostParent: false, famineMonths: 0, unstableMonths: 0 }, marks: null, aces: 0,
    place: { cityId: city.id, city: city.name, countryId: country.id, country: country.name, regionId, lat: city.lat, lon: city.lon },
    places: [], tick: 0, alive: true, deathCause: null,
    health: Math.min(1, 0.82 + 0.1 * r() + 0.02 * quintile), chronic: [], injuredUntil: 0,
    mood: { joy: 0.4, fear: 0.2, anger: 0.1, hope: 0.5, grief: 0, pride: 0.1, envy: 0.05, boredom: 0.1, awe: 0.3, distrust: 0.1 },
    schoolYears: 0, inSchool: false, path: null, wantsKids: false, kidsWanted: 2,
    job: null, unemployedSince: null, retired: false, earn: Math.exp(0.25 * normal(r)),
    savings: 0, home: r() < informal ? 'informal_settlement' : 'family_home', saveRate: 0.03,
    habits: new Set(), quitSmokingAge: null, friends: 0.2, community: 0.2,
    kin: [
      { id: 'mother', name: mother.given, family: mother.family, relation: 'mother', sex: 'female', bornTick: -Math.round(motherAge * 12), bond: 0.8 },
      ...(fatherPresent ? [{ id: 'father', name: father.given, family: father.family, relation: 'father' as const, sex: 'male' as const, bornTick: -Math.round((motherAge + 3 + 3 * normal(r)) * 12), bond: 0.65 }] : []),
      ...(() => {
        // siblings never share a name with each other or the chosen person
        // (the registry keeps given names unique within the family)
        return Array.from({ length: olderSibs }, (_, i) => {
          const s: Sex = r() < 0.5 ? 'female' : 'male'
          const sn = nm({ sex: s, father: fatherPresent ? father : undefined, mother })
          return { id: `sib${i + 1}`, name: sn.given, family: sn.family, relation: 'sibling' as const, sex: s, bornTick: -Math.round((2 + i * 2.5 + r()) * 12), bond: 0.6 }
        })
      })(),
    ],
    migrant: false, pendingBirthTick: null, widowedAt: null, griefUntil: 0,
    help: 0, harm: 0, meaningSum: 0, adultMonths: 0, healthyMonths: 0, valenceSum: 0, relSum: 0, months: 0, lastIncome: 0,
    events: [], flinch: null,
  }
  p.places.push({ ...p.place, fromTick: 0 })
  void world
  return p
}

const familyStory = (p: Person) => {
  const q = ['the poorest fifth', 'a poor family', 'a middle-income family', 'a comfortable family', 'the richest fifth'][p.quintile - 1]
  const dad = p.kin.some(k => k.relation === 'father')
  const sibs = p.kin.filter(k => k.relation === 'sibling').length
  return `${q} in ${p.place.city}${p.home === 'informal_settlement' ? ', in an informal settlement' : ''}, ${dad ? 'mother and father' : 'raised by their mother'}${sibs ? `, ${sibs} older ${sibs === 1 ? 'sibling' : 'siblings'}` : ', first child'}`
}

// ---------- the life loop ----------
// twinDeath: when and how the usual-choices twin died, so a life outliving it on a lesson can be told (once)
type Mode = { kind: 'self' | 'twin'; continent?: Continent; lessons: LifeLesson[]; telegram: boolean; lifeId: string; twinDeath?: { tick: number; cause: string }; onYear?: (p: Person, snap: MonthSnap) => void }
type SimOut = { p: Person; snaps: MonthSnap[]; milestones: Milestone[]; journal: JournalLine[]; env: EnvYear[]; lessonsGiven: Set<string>; ruleFallbacks: number }

async function simulate(world: WorldEnv, seed: number, mode: Mode): Promise<SimOut> {
  const W = world // (the milestone helper below shadows `world` with the month's news line)
  const p = createPerson(world, seed, mode.continent)
  const snaps: MonthSnap[] = [], milestones: Milestone[] = [], journal: JournalLine[] = [], env: EnvYear[] = []
  const lessonsGiven = new Set<string>()
  const done = new Set<string>()
  const lastTrig = new Map<string, number>()
  let triggered = 0, ruleFallbacks = 0, llmFailStreak = 0
  let ownsHome = false, lowHealth = false, wildSent = false
  const burden0 = world.regionAt(12, p.place.regionId).diseaseBurden || 0.1
  const yearOf = (tick: number) => 2026 + Math.floor((tick + 10) / 12)
  const first = p.nameParts.given

  if (mode.kind === 'self') {
    addEvent(p, { kind: 'birth', text: `born in ${p.place.city}, ${p.place.country}: ${familyStory(p).replace(` in ${p.place.city}`, '')}`, severity: 0.6, emotion: 'joy' })
  }

  for (let t = 0; t <= MAX_TICKS && p.alive; t++) {
    p.tick = t
    const age = ageOf(p)
    const e = world.month(t, p.place.regionId)
    const median = medianIncome(e)

    // ---- school and work by rule ----
    if (p.inSchool && age >= 5) p.schoolYears += (1 / 12) * (1 - 0.3 * Math.min(1, p.kid.hungerMonths / 24)) // stunting slows learning (ESTIMATE; cf. victora et al. 2008 lancet https://doi.org/10.1016/S0140-6736(07)61692-4)
    if (p.inSchool && !p.path && age >= 18) p.inSchool = false
    if (p.path === 'medicine' && age >= 27 && p.inSchool) { p.inSchool = false; p.job = { title: 'doctor', workplace: 'clinic', helping: true, sinceTick: t }; addEvent(p, { kind: 'personal', text: 'became a doctor', severity: 0.6, emotion: 'pride' }) }
    if (age >= 18 && !p.inSchool && !p.job && !p.retired) {
      const out = p.unemployedSince === null ? 0 : t - p.unemployedSince
      if (p.unemployedSince === null) p.unemployedSince = t
      if (out >= 6 || age < 19) {
        const farm = e.economy < 0.35 && luck(p, 'firstwork')() < 0.5
        p.job = { title: farm ? 'farm worker' : e.economy < 0.6 ? 'market trader' : 'shop assistant', workplace: farm ? 'farm' : 'shop', helping: false, sinceTick: t }
        p.unemployedSince = null
        addEvent(p, { kind: 'personal', text: `found work: ${p.job.title}`, severity: 0.3, emotion: 'hope' })
      }
    }
    if (p.job && age >= 75 && !p.retired) { p.retired = true; p.job = null; addEvent(p, { kind: 'personal', text: 'retired', severity: 0.3, emotion: 'joy' }) }
    if (age >= 20 && p.home === 'family_home' && luck(p, 'leavehome')() < 0.02) p.home = p.quintile >= 3 ? 'apartment' : 'rented_room'
    if (!ownsHome && age >= 22 && p.savings > median * 30 && p.home !== 'care_home') { ownsHome = true; p.home = 'house'; p.savings -= median * 24; addEvent(p, { kind: 'personal', text: 'bought a first home', severity: 0.5, emotion: 'pride' }) }
    if (p.home === 'shelter' && luck(p, 'rehoused')() < 0.08) p.home = p.quintile <= 2 ? 'informal_settlement' : 'rented_room'
    if (age > 85 && p.health < 0.4 && livingKids(p).length === 0 && p.home !== 'care_home') p.home = 'care_home'
    lateChildCheck(p)

    const snap = stepMonth(p, { env: e, burden0, regionPop: e.region.population })
    snaps.push(snap)

    // ---- childhood leaves its marks at 16 ----
    if (t === 192 && p.alive) {
      const k = p.kid
      const aces = (k.hungerMonths > 6 ? 1 : 0) + (k.displaced ? 1 : 0) + (k.lostParent ? 1 : 0) + (k.famineMonths > 6 ? 1 : 0) + (k.unstableMonths > 96 ? 1 : 0)
      p.aces = aces
      const stable = Math.max(0, 1 - k.unstableMonths / 192 - (k.displaced ? 0.3 : 0) - (k.lostParent ? 0.3 : 0))
      p.marks = { hungerMonths: k.hungerMonths, displaced: k.displaced, lostParent: k.lostParent, famineYears: Math.round(k.famineMonths / 12), stableHome: Math.round(stable * 100) / 100, schoolYearsBy16: Math.round(p.schoolYears * 10) / 10, trust: Math.round(Math.max(0.1, Math.min(1, 0.65 - 0.1 * aces + 0.2 * stable)) * 100) / 100 }
      if (k.hungerMonths > 12) p.health = Math.max(0.3, p.health - 0.04)
      if (aces >= 3) addEvent(p, { kind: 'personal', text: 'a hard childhood, carried forward', severity: 0.3 })
    }

    // ---- milestones ----
    if (p.alive) {
      for (const s of SCHEDULE) {
        if (done.has(s.def.id) || t !== Math.round(s.age * 12) || !applies(s.def, p)) continue
        done.add(s.def.id)
        const m = await milestone(p, e, s.def, undefined)
        if (m) milestones.push(m)
      }
      if (triggered < MAX_TRIGGERED) for (const trig of TRIGGERS) {
        const last = lastTrig.get(trig.def.id)
        if (last !== undefined && t - last < trig.cooldownMonths) continue
        const why = trig.when(p, e)
        if (!why) continue
        lastTrig.set(trig.def.id, t)
        triggered++
        const m = await milestone(p, e, trig.def, why)
        if (m) milestones.push(m)
      }
    }

    // ---- recovery, for the record ----
    if (mode.kind === 'self') {
      if (p.health < 0.45) lowHealth = true
      else if (lowHealth && p.health > 0.65) { lowHealth = false; addEvent(p, { kind: 'health', text: 'recovered', severity: 0.3, emotion: 'joy' }) }
    }

    // ---- the one wild mid-life message: a lesson visibly saving them ----
    if (mode.telegram && !wildSent && mode.twinDeath && p.alive && p.tick === mode.twinDeath.tick + 1 && mode.twinDeath.tick < 80 * 12) {
      const saver = milestones.filter(m => m.lessonApplied).map(m => mode.lessons.find(l => l.id === m.lessonApplied)).find(Boolean)
      if (saver) {
        wildSent = true
        void sendWild(p.nameParts.given, `${first} · ${yearOf(p.tick)} · ${p.place.city.toLowerCase()}: the same ${first} with the usual choices died right here, at ${Math.floor(mode.twinDeath.tick / 12)}, of ${mode.twinDeath.cause}. this one is still going, on a lesson an earlier life left: ${saver.rule}\n${lifeLink(mode.lifeId, p.tick)}`)
      }
    }

    // ---- the year ----
    if (t % 12 === 0) {
      env.push(world.envYear(t, p.place.regionId))
      if (t > 0) {
        const yearSnaps = snaps.slice(-12)
        const line = journalLine(p, yearSnaps, milestones, t)
        journal.push(line)
        mode.onYear?.(p, snap)
      }
    }
  }
  if (p.alive) { p.alive = false; p.deathCause = 'old age, in their sleep' }
  return { p, snaps, milestones, journal, env, lessonsGiven, ruleFallbacks }

  async function milestone(p: Person, e: ReturnType<WorldEnv['month']>, def: MilestoneDef, world: string | undefined): Promise<Milestone | null> {
    const opts = def.options(p, e)
    if (opts.length < 2) return null
    const age = ageOf(p)
    const decider = age < 16 ? 'parents' : 'self'
    const tags = [...new Set(opts.flatMap(o => o.tags))]
    const lessons = mode.kind === 'self' && decider === 'self' ? relevantLessons(mode.lessons, def.kind, [...tags, ...situationTags(p, e)], p.place.regionId) : []
    lessons.forEach(l => lessonsGiven.add(l.id))
    const question = def.question(p, e)
    const usual = ruleChoice(opts, p.temperament)
    let d: Decision
    if (mode.kind === 'twin' || decider === 'parents' || provider() === 'offline') {
      d = { choice: usual.id, reasoning: decider === 'parents' ? parentReason(p, usual) : 'did what most people do', thought: '', lessonApplied: null, decidedBy: decider === 'parents' ? 'parents' : 'rule' }
    } else {
      try { d = await decideLlm(p, e, question, opts, lessons, world, worldBrief(W, p.tick, p.place.regionId, def.kind)); llmFailStreak = 0 } catch (err) {
        console.error(`[life] milestone ${def.id} llm failed (${(err as Error).message}), using the rule choice`)
        ruleFallbacks++
        // fail loudly: a run of failures means the llm is broken, not unlucky. never finish a whole life on rules
        if (++llmFailStreak >= 3) throw new Error(`3 llm failures in a row, stopping this life: ${(err as Error).message}`)
        d = { choice: usual.id, reasoning: 'did what most people do', thought: '', lessonApplied: null, decidedBy: 'rule' }
      }
    }
    const chosen = opts.find(o => o.id === d.choice) ?? usual
    const outcome = chosen.apply(p, e)
    const year = yearOf(p.tick)
    const lesson = d.lessonApplied ? lessons.find(l => l.id === d.lessonApplied) : undefined
    const over = usual.id !== chosen.id ? ` over ${short(usual.label)}` : ''
    const because = lesson ? `, because an earlier life learned: ${lesson.rule}` : decider === 'parents' ? `. the parents decided: ${d.reasoning}` : d.reasoning ? `, ${d.reasoning.replace(/\.$/, '')}` : ''
    const caption = `${year} · ${def.short}. ${decider === 'parents' ? 'the family chose' : 'chose'} ${short(chosen.label)}${over}${because}`.slice(0, 220)
    const m: Milestone = {
      id: `${def.id}-${p.tick}`, tick: p.tick, age: Math.round(age * 10) / 10, kind: def.kind, question,
      options: opts.map(o => ({ id: o.id, label: o.label, tags: o.tags })), choice: chosen.id,
      reasoning: d.reasoning, thought: d.thought, lessonIds: lessons.map(l => l.id), lessonApplied: d.lessonApplied,
      decidedBy: d.decidedBy, decider, outcome, caption, ...(world ? { world } : {}),
    }
    if (mode.kind === 'self') {
      addEvent(p, { kind: 'milestone', text: caption, severity: 0.5 })
    }
    return m
  }
}

function applies(def: MilestoneDef, p: Person): boolean {
  switch (def.id) {
    case 'stay_school': return p.inSchool
    case 'more_kids': return livingKids(p).length > 0 && !!partnerOf(p)
    case 'children': return !!partnerOf(p) || ageOf(p) < 30
    case 'parents': return parentsAlive(p).length > 0
    case 'kids_help': return livingKids(p).length > 0
    case 'retire': return !!p.job && !p.retired
    case 'first_job': return !p.job || !!p.path
    default: return true
  }
}

// the situations a lesson can be tagged with, so general rules find the people they fit
export function situationTags(p: Person, e: ReturnType<WorldEnv['month']>): string[] {
  const age = ageOf(p)
  const t: string[] = [age < 18 ? 'teen' : age < 30 ? 'young_adult' : age < 60 ? 'midlife' : 'elder']
  if (e.food < 0.85 || e.damage === 'famine') t.push('famine')
  if (e.unrest > 0.45) t.push('unrest')
  if (p.quintile <= 2) t.push('poverty')
  if (p.quintile >= 4) t.push('wealth')
  if (p.migrant) t.push('migration')
  if (livingKids(p).length) t.push('parent')
  if (p.chronic.length) t.push('illness')
  if (p.tick < p.griefUntil) t.push('grief')
  if (e.events.some(x => x.kind === 'pandemic')) t.push('pandemic')
  if (e.events.some(x => x.kind === 'disaster')) t.push('disaster')
  return t
}

function parentReason(p: Person, o: Option): string {
  if (p.quintile <= 2 && o.tags.includes('money')) return 'the family needed every hand'
  if (o.tags.includes('education')) return 'they wanted more for their child than they had'
  if (o.tags.includes('faith')) return 'it is how they were raised'
  return 'it is what families like theirs do'
}

const short = (label: string) => label.replace(/^(have |take |keep |join |go |start |stay |become |work |move |retire )/, m => m).split(/[,(:]/)[0].trim().toLowerCase()

// ---------- words ----------
// the journal: one line a year in their voice. plain and specific, like a real diary ("long shift. feet hurt."),
// built from what actually happened that year. years with a milestone use the llm's diary line instead
function journalLine(p: Person, ys: MonthSnap[], ms: Milestone[], t: number): JournalLine {
  const year = yearOf(t - 2)
  const age = Math.floor(t / 12)
  const m = ms.filter(x => x.tick > t - 12 && x.tick <= t && x.thought).pop()
  if (m) return { year, age, text: m.thought, byLlm: true }
  // no llm line this year: the year in her words, but only what the record says happened (no invented detail).
  // one clause per fact: a death, a birth, a move, a lost home, a job, hunger, then what her days were.
  const evs = p.events.filter(e => e.tick > t - 12 && e.tick <= t && e.kind !== 'milestone' && e.kind !== 'death' && e.kind !== 'birth')
  const s = ys[ys.length - 1]
  const hungry = ys.filter(x => x.hunger).length
  const inc = Math.round(ys.reduce((a, x) => a + x.income, 0) / Math.max(1, ys.length))
  const facts: string[] = []
  for (const e of evs) {
    if (/ died/.test(e.text)) facts.push(e.text)
    else if (/was born$/.test(e.text) || /^moved from/.test(e.text) || /home was lost/.test(e.text) || /^(first job|new job|found work):/.test(e.text) || /^laid off|^diagnosed with/.test(e.text)) facts.push(e.text)
  }
  if (hungry >= 3) facts.push(`hungry ${hungry} months of the year`)
  let text: string
  if (age < 6) text = '(too young to write.)'
  else if (facts.length) text = `${facts.slice(0, 2).join('. ')}.`
  else if (s?.job) text = `${s.job}. $${inc} a month. ${s.savings < 0 ? `$${Math.round(-s.savings)} in debt.` : `$${Math.round(s.savings)} saved.`}`
  else if (p.retired) { const gk = p.kin.filter(k => k.relation === 'grandchild' && k.diedTick === undefined).length; text = `retired.${gk ? ` ${gk} ${gk === 1 ? 'grandchild' : 'grandchildren'}.` : ''}` }
  else if (s && (s.activity === 'studying' || s.activity === 'school')) text = `${s.activity === 'school' ? 'school' : p.path ? `${p.path} training` : 'studying'}, year ${Math.max(1, Math.round(p.schoolYears))}.`
  else text = '(a year with nothing written down.)'
  return { year, age, text: text.replace(/\s+/g, ' ').trim().toLowerCase(), byLlm: false }
}

// ---------- the whole thing ----------
export type RunLifeOpts = { world: WorldEnv; worldVersion: string; lifeNo: number; telegram?: boolean; log?: (l: string) => void; continent?: Continent }

export async function runLife(o: RunLifeOpts): Promise<LifeRecord> {
  const { world, lifeNo } = o
  const seed = (stream(world.seed, `life:${world.id}:${lifeNo}`)() * 2 ** 32) >>> 0
  const lifeId = `${world.id}-life-${lifeNo}`
  const log = o.log ?? (() => {})
  const lessons = readLessons().map(l => (l.simVersion === o.worldVersion ? l : { ...l, verified: l.verified && l.simVersion === o.worldVersion }))

  // the twin first: no llm, no lessons, the usual choices. same birth and same monthly luck
  const twin = await simulate(world, seed, { kind: 'twin', continent: o.continent, lessons: [], telegram: false, lifeId })
  const twinScore = scoreLife(twin.p)
  log(`twin: ${twin.p.name}, died at ${Math.floor(ageOf(twin.p))} (${twin.p.deathCause}), score ${twinScore.total.toFixed(3)}`)

  const usage = { llmCalls: 0, tokens: 0 }
  const self = await withUsage(usage, () => simulate(world, seed, {
    kind: 'self', continent: o.continent, lessons, telegram: !!o.telegram, lifeId, twinDeath: { tick: twin.p.tick, cause: twin.p.deathCause ?? 'an illness' },
    onYear: (p, snap) => writeNow({ lifeId, name: p.name, age: snap.age, city: p.place.city, tick: p.tick, pid: process.pid, updatedAt: new Date().toISOString(), job: snap.job, partner: snap.partner, kids: snap.kids, savings: snap.savings, income: snap.income, health: snap.health, mood: Object.keys(snap.mood).slice(0, 2).join(', ') }, lifeId),
  }))
  const p = self.p
  const score = scoreLife(p)
  const deathAge = Math.round(ageOf(p) * 10) / 10
  const cities = [...new Set(p.places.map(x => x.city.toLowerCase()))]
  const kids = kidsOf(p).length
  const lastJob = [...self.snaps].reverse().find(s => s.job)?.job
  const role = [lastJob, kids ? `${p.sex === 'female' ? 'mother' : 'father'} of ${kids}` : ''].filter(Boolean).join(', ')
  const epitaph = `${p.name} · 2026–${2026 + Math.floor((p.tick + 10) / 12)} · ${cities.join(' → ')}${role ? ` · ${role}` : ''}`

  const record: LifeRecord = {
    lifeId, worldId: world.id, worldSeed: world.seed, worldScore: world.record.summary.score, worldStatus: world.record.summary.status, worldVersion: o.worldVersion,
    lifeNo, seed, simVersion: LIFE_SIM_VERSION,
    name: p.name, given: p.nameParts.given, sex: p.sex, look: p.look, temperament: p.temperament, childhood: p.marks,
    birthTick: 0, deathTick: p.tick, deathAge, deathCause: p.deathCause,
    birthplace: p.places[0], places: p.places, family: { quintile: p.quintile, story: familyStory(createPerson(world, seed, o.continent)) },
    kin: p.kin, snaps: self.snaps, milestones: self.milestones, events: p.events, journal: self.journal, env: self.env,
    laws: world.allLaws().filter(l => l.enactedTick <= p.tick).map(l => ({ tick: l.enactedTick, title: l.title, text: l.text })),
    score, twin: { score: twinScore, deathAge: Math.round(ageOf(twin.p) * 10) / 10, deathCause: twin.p.deathCause ?? '' },
    lessonsGiven: [...self.lessonsGiven], lessonsLeft: [], epitaph,
    usage: { ...usage, ruleFallbacks: self.ruleFallbacks },
    provenance: { ...PROVENANCE }, createdAt: new Date().toISOString(), status: 'done',
  }

  // the lessons they leave: one llm call, polite with the lock. babies and young kids made no choices of their own,
  // so their death teaches nothing about choices; it is recorded as luck, not turned into a rule
  const ownChoices = self.milestones.filter(m => m.decider === 'self').length
  let left: LifeLesson[] = []
  if (ownChoices >= 2) {
    const out = await withUsage(usage, () => politeLlm(() => writeLifeLessons(record)))
    left = out.lessons
  }
  record.lessonsLeft = left
  record.usage = { ...usage, ruleFallbacks: self.ruleFallbacks }
  const ledger = creditLessons(readLessons(), record).map(l => (record.milestones.some(m => m.lessonApplied === l.id) && record.score!.total > record.twin!.score.total && !l.verified && o.worldVersion === l.simVersion ? { ...l, verified: true } : l))
  writeLessons([...ledger, ...left])
  writeLife(record)
  writeNow(null, lifeId)

  if (o.telegram) await sendEndOfLife(record)
  return record
}

// calibration helper: the rule-only twin for a seed (no files, no llm)
export async function twinOnly(world: WorldEnv, seed: number) {
  const out = await simulate(world, seed, { kind: 'twin', lessons: [], telegram: false, lifeId: 'calibration' })
  return { p: out.p, score: scoreLife(out.p), milestones: out.milestones }
}

// the rule-only twin as a full life record (no files, no llm): the same shape the pages read. used by the
// consistency checks to test many lives (partners, children, funerals) without waiting on the llm
export async function twinRecord(world: WorldEnv, seed: number, continent?: Continent): Promise<LifeRecord> {
  const lifeId = `twin-${world.id}-${seed}`
  const t = await simulate(world, seed, { kind: 'twin', continent, lessons: [], telegram: false, lifeId })
  const p = t.p
  return {
    lifeId, worldId: world.id, worldSeed: world.seed, worldScore: world.record.summary.score, worldStatus: world.record.summary.status, worldVersion: 'twin',
    lifeNo: 0, seed, simVersion: LIFE_SIM_VERSION,
    name: p.name, given: p.nameParts.given, sex: p.sex, look: p.look, temperament: p.temperament, childhood: p.marks,
    birthTick: 0, deathTick: p.tick, deathAge: Math.round(ageOf(p) * 10) / 10, deathCause: p.deathCause,
    birthplace: p.places[0], places: p.places, family: { quintile: p.quintile, story: '' },
    kin: p.kin, snaps: t.snaps, milestones: t.milestones, events: p.events, journal: t.journal, env: t.env,
    laws: [], score: scoreLife(p), twin: { score: scoreLife(p), deathAge: Math.round(ageOf(p) * 10) / 10, deathCause: p.deathCause ?? '' }, lessonsGiven: [], lessonsLeft: [], epitaph: '',
    usage: { llmCalls: 0, tokens: 0, ruleFallbacks: t.ruleFallbacks }, provenance: { ...PROVENANCE }, createdAt: new Date(0).toISOString(), status: 'done',
  }
}
