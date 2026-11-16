// the ~25-40 decisions of a life. scheduled ones come at real ages; triggered ones come from the world (a famine,
// a protest in their city, a pandemic) or from their own life (a layoff, a diagnosis, a death).
// each option's consequences are deterministic rules plus the life's luck stream. the llm only picks the option.
//
// default: the choice most people in that situation make (ESTIMATE). the no-lessons twin always takes it, so
// "life score minus twin score" measures what the choices (and the lessons behind them) were worth.
// harm: options that hurt or exploit others. they can pay well, and they always lower contribution.
import type { MonthEnv } from './env'
import { CORRIDORS, biggestCity, countryById } from './births'
import { addEvent, ageOf, partnerName, kidsOf, livingKids, luck, medianIncome, parentsAlive, partnerOf, type Habit, type Person } from './person'
import type { MilestoneKind, MilestoneOption, Workplace } from './types'

export type Option = MilestoneOption & { default?: boolean; apply: (p: Person, env: MonthEnv) => string[] }
export type MilestoneDef = { id: string; kind: MilestoneKind; question: (p: Person, env: MonthEnv) => string; options: (p: Person, env: MonthEnv) => Option[]; short: string }

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const habit = (p: Person, h: Habit, on = true) => { if (on) p.habits.add(h); else p.habits.delete(h) }
const roll = (p: Person, name: string) => luck(p, `ms:${name}`)()
const job = (p: Person, title: string, workplace: Workplace, helping = false) => {
  const before = p.job?.title
  p.job = { title, workplace, helping, sinceTick: p.tick }
  p.unemployedSince = null
  addEvent(p, { kind: 'personal', text: before ? `new job: ${title}` : `first job: ${title}`, severity: 0.4, emotion: 'pride' })
}
const opt = (id: string, label: string, tags: string[], apply: Option['apply'], extra: Partial<Option> = {}): Option => ({ id, label, tags, apply, ...extra })

// ---------- scheduled ----------
export const SCHEDULE: { age: number; def: MilestoneDef }[] = []
const at = (age: number, def: MilestoneDef) => SCHEDULE.push({ age, def })

// parents decide these (the person is a child): rules from the family's situation, see run.ts
at(6, {
  id: 'school_start', kind: 'schooling', short: 'the first day of school',
  question: (p, env) => `${p.nameParts.given} is six. ${env.education < 0.4 ? 'school costs money the family barely has.' : 'school is free here.'} do the parents send them?`,
  options: (p, env) => [
    opt('send', 'send them to school', ['education', 'long_term'], () => { p.inSchool = true; return ['started school'] }, { default: p.quintile >= 2 || env.education >= 0.35 }),
    opt('keep_home', 'keep them home to help', ['family', 'money', 'short_term'], () => { p.inSchool = false; return ['stayed home to help the family'] }, { default: p.quintile < 2 && env.education < 0.35 }),
  ],
})

at(9, {
  id: 'family_faith', kind: 'faith', short: 'the family faith',
  question: (p, env) => `the family ${env.faith > 0.7 ? 'goes to worship every week' : 'rarely talks about faith'}. what do they raise ${p.nameParts.given} with?`,
  options: (p, env) => [
    opt('raise_faith', 'raise them in the faith and its community', ['faith', 'community'], () => { habit(p, 'prays'); p.community = clamp(p.community + 0.15); return ['grew up inside a faith community'] }, { default: env.faith > 0.6 }),
    opt('secular', 'let them decide later', ['independence'], () => ['grew up without religion'], { default: env.faith <= 0.6 }),
  ],
})

at(7, {
  id: 'afternoons', kind: 'childhood', short: 'afternoons after school',
  question: () => 'you are seven. what do you do in the afternoons?',
  options: (p) => [
    opt('study', 'read and study with an older cousin', ['education'], () => { p.schoolYears += 0.5; return ['reading came easier'] }),
    opt('help_family', 'help the family earn: carry water, mind the stall', ['family', 'money'], () => { p.savings += 20; p.kin.forEach(k => { if (k.relation === 'mother' || k.relation === 'father') k.bond = clamp(k.bond + 0.1) }); return ['closer to the family, less time for school'] }, { default: p.quintile <= 2 }),
    opt('play', 'play outside with the street kids', ['friends', 'health'], () => { p.friends = clamp(p.friends + 0.15); p.health = clamp(p.health + 0.02); return ['made friends who stayed'] }, { default: p.quintile > 2 }),
  ],
})

at(12, {
  id: 'stay_school', kind: 'schooling', short: 'stayed in school or left',
  question: (p, env) => `you are twelve. ${env.prices > 1.3 ? 'food is expensive and ' : ''}the family ${p.quintile <= 2 ? 'needs money' : 'is managing'}. do you stay in school?`,
  options: (p, env) => {
    const poor = p.quintile <= 2
    return [
      opt('stay', 'stay in school', ['education', 'long_term'], () => { p.inSchool = true; return ['kept going to school'] }, { default: !poor || env.education > 0.5 }),
      opt('leave_work', 'leave school and work to feed the family', ['money', 'family', 'short_term'], () => { p.inSchool = false; job(p, 'helper at the market', 'shop'); p.earn *= 0.8; return ['earned a little, school ended at twelve'] }, { default: poor && env.education <= 0.5 }),
      opt('night_school', 'work in the day, study at night', ['education', 'money', 'grit'], () => { p.inSchool = true; job(p, 'part-time helper', 'shop'); p.health = clamp(p.health - 0.03); return ['tired, but still learning'] }),
    ]
  },
})

at(16, {
  id: 'first_vices', kind: 'habits', short: 'cigarettes, drink, or sport',
  question: () => 'you are sixteen. friends pass around cigarettes and drink. what do you do?',
  options: (p) => [
    opt('smoke', 'smoke with them', ['smoking', 'friends'], () => { habit(p, 'smokes'); p.friends = clamp(p.friends + 0.05); return ['started smoking'] }, { default: p.sex === 'male' && roll(p, 'smokedefault') < 0.35 }),
    opt('drink', 'drink with them, not smoke', ['drinking', 'friends'], () => { if (roll(p, 'drinkheavy') < 0.25) habit(p, 'drinks_heavily'); p.friends = clamp(p.friends + 0.05); return ['drinking became part of weekends'] }),
    opt('sport', 'say no and join a sports team', ['health', 'exercise', 'friends'], () => { habit(p, 'exercises'); p.friends = clamp(p.friends + 0.08); return ['found a team and a habit'] }),
    opt('neither', 'say no and go home', ['health'], () => ['stayed out of it'], { default: !(p.sex === 'male' && roll(p, 'smokedefault') < 0.35) }),
  ],
})

at(17.5, {
  id: 'path', kind: 'path', short: 'the path after school',
  question: (p, env) => `you are ${Math.floor(ageOf(p))}, with ${Math.round(p.schoolYears)} years of school, in ${p.place.city}. ${env.unrest > 0.4 ? 'the streets are tense. ' : ''}which path?`,
  options: (p, env) => {
    const canUni = p.schoolYears >= 10
    const uniCost = medianIncome(env) * 24
    const o: Option[] = []
    if (canUni) o.push(opt('university', 'university, a degree', ['education', 'long_term', 'money'], () => {
      const scholarship = p.savings < uniCost && roll(p, 'scholarship') < 0.25 + 0.1 * p.quintile
      if (p.savings < uniCost && !scholarship && p.quintile <= 2) { p.inSchool = false; job(p, 'factory hand', 'factory'); return ['could not pay for university. took factory work'] }
      p.inSchool = true; p.path = 'university'; p.savings = Math.max(0, p.savings - uniCost * 0.5)
      return [scholarship ? 'won a scholarship to university' : 'started university']
    }, { default: p.quintile >= 4 }))
    o.push(opt('nursing', 'train as a nurse', ['education', 'helping', 'health_work'], () => { p.inSchool = true; p.path = 'nursing'; return ['started nursing school'] }))
    o.push(opt('teaching', 'train as a teacher', ['education', 'helping'], () => { p.inSchool = true; p.path = 'teaching'; return ['started teacher training'] }))
    o.push(opt('trade', 'apprentice in a trade (electrician, builder)', ['skills', 'money'], () => { p.inSchool = true; p.path = 'trade'; return ['started an apprenticeship'] }, { default: p.quintile === 3 }))
    o.push(opt('factory', 'take the factory job now', ['money', 'short_term'], () => { p.inSchool = false; job(p, 'factory worker', 'factory'); return ['started at the factory'] }, { default: p.quintile <= 2 && canUni }))
    if (!canUni) o.push(opt('farm', 'work the family farm or stall', ['family', 'money'], () => { p.inSchool = false; job(p, 'farmer', 'farm'); return ['stayed with the family work'] }, { default: p.quintile <= 2 }))
    return o
  },
})

at(19, {
  id: 'friends', kind: 'friends', short: 'who to spend time with',
  question: () => 'you have a little free time. where does it go?',
  options: (p) => [
    opt('friends', 'keep up with close friends, every week', ['friends', 'relationships'], () => { p.friends = clamp(p.friends + 0.2); return ['kept a close circle'] }),
    opt('community', 'join a community group (faith, sport, neighborhood)', ['community', 'relationships', 'faith'], () => { habit(p, 'community'); p.community = clamp(p.community + 0.3); return ['joined a group that met every week'] }),
    opt('hustle', 'work extra shifts', ['money'], () => { p.earn *= 1.08; p.friends = clamp(p.friends - 0.1); return ['more money, fewer friends'] }, { default: true }),
  ],
})

at(22, {
  id: 'first_job', kind: 'first_job', short: 'the first real job',
  question: (p) => `training is done${p.path ? ` (${p.path})` : ''}. which job?`,
  options: (p, env) => {
    p.inSchool = false
    const o: Option[] = []
    if (p.path === 'university') {
      o.push(opt('office', 'an office job with a good salary', ['money', 'career'], () => { job(p, 'analyst', 'office'); return ['joined an office'] }, { default: true }))
      o.push(opt('doctor', 'keep studying to become a doctor', ['helping', 'health_work', 'long_term'], () => { p.inSchool = true; p.schoolYears += 1; p.path = 'medicine'; return ['went on to medical school'] }))
      if (env.frontier !== 'none') o.push(opt('space', 'apply to the space program', ['science', 'frontier'], () => roll(p, 'space') < 0.3 ? (job(p, 'engineer at the launch site', 'launch_site'), ['got into the space program']) : (job(p, 'lab technician', 'lab'), ['rejected by the space program, took a lab job'])))
      o.push(opt('scam', 'a sales job that pays big for pushing bad loans', ['money', 'harm'], () => { job(p, 'loan seller', 'office'); p.earn *= 1.4; p.harm += 60; return ['money was good. some customers lost their homes'] }))
    } else if (p.path === 'nursing') {
      o.push(opt('nurse', 'nurse at the city hospital', ['helping', 'health_work'], () => { job(p, 'nurse', 'clinic', true); return ['became a nurse'] }, { default: true }))
      o.push(opt('nurse_rural', 'nurse at a rural clinic that has none', ['helping', 'hard'], () => { job(p, 'rural clinic nurse', 'clinic', true); p.help += 60; p.earn *= 0.85; return ['went where nobody else would'] }))
      o.push(opt('fake_meds', 'sell cheap fake medicine on the side, it pays', ['money', 'harm'], () => { job(p, 'nurse', 'clinic', true); p.earn *= 1.3; p.harm += 120; return ['extra money. people got worse'] }))
    } else if (p.path === 'teaching') {
      o.push(opt('teacher', 'teach at the local school', ['helping', 'education'], () => { job(p, 'teacher', 'school', true); return ['became a teacher'] }, { default: true }))
      o.push(opt('tutor', 'private tutoring for rich families', ['money'], () => { job(p, 'private tutor', 'school'); p.earn *= 1.3; return ['tutored rich kids for more money'] }))
    } else if (p.path === 'trade') {
      o.push(opt('builder', 'builder on the new housing', ['skills', 'money'], () => { job(p, 'builder', 'construction'); return ['built homes'] }, { default: true }))
      o.push(opt('electrician', 'electrician at the power plant', ['skills', 'money'], () => { job(p, 'electrician', 'power_plant'); return ['kept the lights on'] }))
    } else {
      o.push(opt('stay_job', `keep working as ${p.job?.title ?? 'a laborer'}`, ['stability'], () => { if (!p.job) job(p, 'day laborer', 'construction'); return ['kept the job'] }, { default: true }))
      o.push(opt('shop', 'open a small stall of your own', ['business', 'risk'], () => roll(p, 'stall') < 0.55 ? (job(p, 'stall owner', 'shop'), p.earn *= 1.25, ['the stall made money']) : (p.savings *= 0.4, p.job = null, p.unemployedSince = p.tick, ['the stall failed. savings gone'])))
      o.push(opt('aide', 'become a health aide (short course)', ['helping', 'health_work'], () => { p.schoolYears += 0.5; job(p, 'community health aide', 'clinic', true); return ['became a community health aide'] }))
    }
    return o
  },
})

at(24, {
  id: 'move', kind: 'move', short: 'move or stay',
  question: (p, env) => `you are ${Math.floor(ageOf(p))}. ${env.economy < 0.6 ? 'wages here are low. ' : ''}${env.unrest > 0.4 ? 'unrest is high. ' : ''}stay in ${p.place.city} or go?`,
  options: (p) => {
    const country = countryById(p.place.countryId)!
    const big = biggestCity(country)
    const dest = countryById((CORRIDORS[p.place.regionId] ?? ['USA'])[Math.floor(roll(p, 'corridor') * 5)])!
    const o: Option[] = [opt('stay', `stay in ${p.place.city}, near family`, ['family', 'stability'], () => { parentsAlive(p).forEach(k => { k.bond = clamp(k.bond + 0.1) }); return ['stayed close to home'] }, { default: true })]
    if (big.id !== p.place.cityId) o.push(opt('big_city', `move to ${big.name}`, ['money', 'move'], () => { moveTo(p, country.id, big.id, 'for work'); p.earn *= 1.2; return [`moved to ${big.name}`] }))
    if (dest && dest.id !== p.place.countryId) o.push(opt('abroad', `migrate to ${dest.name} for work`, ['money', 'migration', 'move', 'risk'], () => {
      if (roll(p, 'visa') < 0.4) return ['the visa was refused. stayed']
      const city = biggestCity(dest)
      moveTo(p, dest.id, city.id, 'for work abroad')
      p.migrant = true; habit(p, 'remits')
      // place premium (clemens et al. 2019): the same worker earns far more, but starts below locals
      p.earn *= 0.75; p.friends = clamp(p.friends - 0.25)
      return [`moved to ${city.name}, ${dest.name}. sent money home`]
    }))
    return o
  },
})

at(26, {
  id: 'partner', kind: 'partner', short: 'love',
  question: (p) => partnerOf(p) ? 'you have been together a while. what now?' : 'you met someone you like. what do you do?',
  options: (p) => [
    opt('commit', 'commit: build a life together', ['partner', 'relationships', 'family'], () => {
      if (!partnerOf(p)) addPartner(p)
      partnerOf(p)!.bond = clamp(partnerOf(p)!.bond + 0.15)
      addEvent(p, { kind: 'family', text: `married ${partnerOf(p)!.name}`, severity: 0.6, emotion: 'joy' })
      return [`married ${partnerOf(p)!.name}`]
    }, { default: true }),
    opt('wait', 'wait, focus on yourself for now', ['independence', 'career'], () => { p.earn *= 1.03; return ['stayed single for now'] }),
  ],
})

at(28, {
  id: 'children', kind: 'children', short: 'children',
  question: (p, env) => `${partnerOf(p) ? `you and ${partnerOf(p)!.name}` : 'you'} ${env.prices > 1.3 ? 'struggle with prices. ' : ''}children?`,
  options: (p) => [
    opt('now', 'have a child now', ['children', 'family'], () => conceive(p, 'now'), { default: !!partnerOf(p) }),
    opt('later', 'wait a few years', ['children', 'money'], () => { p.wantsKids = true; return ['decided to wait'] }),
    opt('none', 'no children', ['independence'], () => { p.wantsKids = false; return ['chose a life without children'] }, { default: !partnerOf(p) }),
  ],
})

at(29, {
  id: 'money', kind: 'money', short: 'what to do with money',
  question: (p) => `you earn about $${Math.round(p.lastIncome)} a month. what do you do with it?`,
  options: (p) => [
    opt('save', 'save a tenth every month', ['money', 'long_term'], () => { habit(p, 'saves'); p.saveRate = 0.1; return ['started saving'] }),
    opt('home', 'send money home to family', ['family', 'helping'], () => { habit(p, 'remits'); return ['sent money home'] }),
    opt('spend', 'enjoy it now', ['short_term'], () => { p.saveRate = 0; return ['spent it as it came'] }, { default: true }),
  ],
})

at(31, {
  id: 'health30', kind: 'health', short: 'health at thirty',
  question: (p) => `you are ${Math.floor(ageOf(p))}.${p.habits.has('smokes') ? ' you still smoke.' : ''} your body is starting to complain.`,
  options: (p) => {
    const o: Option[] = []
    if (p.habits.has('smokes')) o.push(opt('quit', 'quit smoking', ['smoking', 'health'], () => { habit(p, 'smokes', false); p.quitSmokingAge = ageOf(p); return roll(p, 'quit') < 0.6 ? ['quit smoking for good'] : (habit(p, 'smokes'), ['tried to quit, started again']) }))
    o.push(opt('exercise', 'walk or train most days', ['exercise', 'health'], () => { habit(p, 'exercises'); return ['started moving every day'] }))
    o.push(opt('nothing', 'no time for that', ['short_term'], () => ['carried on'], { default: true }))
    return o
  },
})

at(34, {
  id: 'more_kids', kind: 'children', short: 'another child',
  question: (p) => `you have ${livingKids(p).length} ${livingKids(p).length === 1 ? 'child' : 'children'}. another?`,
  options: (p) => [
    opt('another', 'have another child', ['children', 'family'], () => conceive(p, 'another'), { default: livingKids(p).length < 2 }),
    opt('enough', 'this family is complete', ['family'], () => ['the family was complete'], { default: livingKids(p).length >= 2 }),
  ],
})

at(37, {
  id: 'career', kind: 'career', short: 'mid-career',
  question: (p) => `${p.job ? `you work as ${p.job.title}` : 'you are out of work'}. what next?`,
  options: (p) => [
    opt('train', 'study at night for a better job', ['education', 'career'], () => { p.schoolYears += 1.5; p.earn *= 1.15; return ['the training paid off'] }),
    opt('switch_helping', 'switch to work that helps people (care, teaching)', ['helping', 'meaning'], () => { job(p, 'care worker', 'clinic', true); p.earn *= 0.9; return ['became a care worker'] }),
    opt('business', 'start a business', ['business', 'risk', 'money'], () => {
      if (roll(p, 'biz') < 0.45) { job(p, 'small business owner', 'shop'); p.earn *= 1.5; addEvent(p, { kind: 'personal', text: 'started a business', severity: 0.5, emotion: 'pride' }); return ['the business grew'] }
      p.savings *= 0.3; addEvent(p, { kind: 'personal', text: 'the business failed', severity: 0.5, emotion: 'grief' }); return ['the business failed, savings gone']
    }),
    opt('stay', 'stay put', ['stability'], () => ['stayed in the job'], { default: true }),
    opt('cut_corners', 'take a promotion that means cheating workers on pay', ['money', 'harm'], () => { p.earn *= 1.35; p.harm += 90; p.community = clamp(p.community - 0.2); return ['promoted. workers were cheated'] }),
  ],
})

at(40, {
  id: 'help', kind: 'help_others', short: 'helping others',
  question: () => 'there is need all around you. do you give your time?',
  options: (p) => [
    opt('volunteer', 'volunteer every week', ['helping', 'community'], () => { habit(p, 'volunteers'); p.community = clamp(p.community + 0.15); return ['started volunteering'] }),
    opt('mentor', 'mentor young people in your trade', ['helping', 'mentoring'], () => { habit(p, 'mentors'); return ['took on apprentices'] }),
    opt('give', 'give money instead of time', ['helping', 'money'], () => { p.help += 40; p.savings *= 0.9; return ['gave money'] }),
    opt('none', 'family comes first', ['family'], () => ['kept to the family'], { default: true }),
  ],
})

at(43, {
  id: 'faith', kind: 'faith', short: 'faith',
  question: (p, env) => `${env.faith > 0.7 ? 'faith is everywhere here.' : 'faith is quieter here.'} where do you stand?`,
  options: (p) => [
    opt('deepen', 'go deeper into faith and its community', ['faith', 'community', 'meaning'], () => { habit(p, 'prays'); habit(p, 'community'); return ['faith became a center'] }),
    opt('private', 'keep a private, quiet practice', ['faith', 'meaning'], () => { habit(p, 'prays'); return ['a quiet practice'] }),
    opt('step_away', 'step away from it', ['independence'], () => { habit(p, 'prays', false); return ['stepped away from faith'] }),
    opt('same', 'nothing changes', [], () => ['nothing changed'], { default: true }),
  ],
})

at(47, {
  id: 'checkup', kind: 'health', short: 'the checkup',
  question: (p) => `you are ${Math.floor(ageOf(p))}. ${p.chronic.length ? `you have ${p.chronic.join(' and ')}.` : 'something feels off.'}`,
  options: (p) => [
    opt('checkups', 'regular checkups, treat things early', ['health', 'long_term'], () => { habit(p, 'checkups'); return ['started regular checkups'] }),
    opt('ignore', 'ignore it, it will pass', ['short_term'], () => ['ignored it'], { default: true }),
  ],
})

at(51, {
  id: 'reconnect', kind: 'friends', short: 'old friends',
  question: () => 'an old friend writes after years of silence.',
  options: (p) => [
    opt('reconnect', 'write back, meet up, keep it going', ['friends', 'relationships'], () => { p.friends = clamp(p.friends + 0.2); return ['an old friendship came back'] }),
    opt('busy', 'too busy, maybe later', ['career'], () => ['never wrote back'], { default: true }),
  ],
})

at(55, {
  id: 'parents', kind: 'parents', short: 'aging parents',
  question: (p) => `${parentsAlive(p).map(k => k.name).join(' and ')} ${parentsAlive(p).length > 1 ? 'are' : 'is'} getting frail.`,
  options: (p) => [
    opt('take_in', 'take them into your home and care for them', ['family', 'caregiving', 'helping'], () => { habit(p, 'caregiver'); parentsAlive(p).forEach(k => { k.bond = clamp(k.bond + 0.25) }); p.health = clamp(p.health - 0.02); return ['became a caregiver'] }, { default: p.place.regionId !== 'na' && p.place.regionId !== 'europe' }),
    opt('pay', 'pay for care', ['money', 'family'], () => { p.savings *= 0.7; parentsAlive(p).forEach(k => { k.bond = clamp(k.bond + 0.05) }); return ['paid for care'] }, { default: p.place.regionId === 'na' || p.place.regionId === 'europe' }),
    opt('distance', 'visit when you can', ['independence'], () => { parentsAlive(p).forEach(k => { k.bond = clamp(k.bond - 0.1) }); return ['visited sometimes'] }),
  ],
})

at(58, {
  id: 'kids_help', kind: 'money', short: 'helping the kids',
  question: (p) => `your children are grown. you have $${Math.round(p.savings)} saved.`,
  options: (p) => [
    opt('help_kids', 'help them with a home or school fees', ['family', 'helping'], () => { p.savings *= 0.5; livingKids(p).forEach(k => { k.bond = clamp(k.bond + 0.15) }); p.help += 30; return ['helped the kids start out'] }),
    opt('retirement', 'save it for retirement', ['money', 'long_term'], () => { habit(p, 'saves'); return ['kept saving'] }, { default: true }),
  ],
})

at(64, {
  id: 'retire', kind: 'retirement', short: 'retirement',
  question: (p, env) => `you are ${Math.floor(ageOf(p))}, with $${Math.round(p.savings)} saved${env.lifeExpectancy > 90 ? ' and decades still ahead' : ''}. retire?`,
  options: (p, env) => [
    opt('retire', 'retire', ['rest'], () => { retire(p); return ['retired'] }, { default: env.lifeExpectancy < 85 }),
    opt('part_time', 'work part time, keep a purpose', ['meaning', 'money'], () => { p.earn *= 0.5; return ['went part time'] }, { default: env.lifeExpectancy >= 85 }),
    opt('mentor_retire', 'retire and mentor the young', ['mentoring', 'helping', 'meaning'], () => { retire(p); habit(p, 'mentors'); return ['retired and mentored'] }),
  ],
})

at(70, {
  id: 'where_old', kind: 'late_life', short: 'where to grow old',
  question: () => 'where do you want to grow old?',
  options: (p) => [
    opt('near_kids', 'move near the children', ['family'], () => { livingKids(p).forEach(k => { k.bond = clamp(k.bond + 0.1) }); return ['moved near the kids'] }, { default: livingKids(p).length > 0 }),
    opt('stay', 'stay in the neighborhood, among friends', ['friends', 'community'], () => { p.friends = clamp(p.friends + 0.05); return ['stayed among friends'] }, { default: livingKids(p).length === 0 }),
  ],
})

at(74, {
  id: 'legacy', kind: 'legacy', short: 'what to leave behind',
  question: () => 'what do you want to leave behind?',
  options: (p) => [
    opt('stories', 'write down the family story for the grandchildren', ['family', 'meaning'], () => { p.kin.filter(k => k.relation === 'grandchild').forEach(k => { k.bond = clamp(k.bond + 0.15) }); return ['wrote the family story'] }),
    opt('volunteer', 'volunteer while the body allows', ['helping', 'community'], () => { habit(p, 'volunteers'); return ['volunteered in old age'] }),
    opt('rest', 'rest, you earned it', ['rest'], () => ['rested'], { default: true }),
  ],
})

at(80, {
  id: 'active_age', kind: 'late_life', short: 'staying active',
  question: () => 'you are eighty. the walking group meets every morning.',
  options: (p) => [
    opt('walk', 'join the walking group', ['exercise', 'friends'], () => { habit(p, 'exercises'); p.friends = clamp(p.friends + 0.1); return ['walked every morning'] }),
    opt('home', 'stay home, it is easier', ['rest'], () => ['stayed home more'], { default: true }),
  ],
})

at(88, {
  id: 'last_years', kind: 'legacy', short: 'the last years',
  question: () => 'the last years. what matters now?',
  options: (p) => [
    opt('reconcile', 'make peace with anyone you are estranged from', ['relationships', 'meaning'], () => { p.kin.forEach(k => { k.bond = clamp(k.bond + 0.1) }); return ['made peace'] }),
    opt('give_away', 'give your savings to the grandchildren now', ['family', 'helping'], () => { p.help += 20; p.savings *= 0.2; return ['gave savings away'] }),
    opt('quiet', 'a quiet life', ['rest'], () => ['quiet days'], { default: true }),
  ],
})

// ---------- triggered ----------
export type Trigger = { def: MilestoneDef; when: (p: Person, env: MonthEnv) => string | null; cooldownMonths: number }

export const TRIGGERS: Trigger[] = [
  {
    cooldownMonths: 60,
    when: (p, env) => ageOf(p) >= 16 && ageOf(p) < 75 ? env.events.find(e => e.kind === 'revolt' && e.severity > 0.3)?.text ?? null : null,
    def: {
      id: 'protest', kind: 'protest', short: 'the protest',
      question: (p, env) => `a protest fills the streets of ${p.place.city}${env.unrest > 0.5 ? ' and it is turning violent' : ''}. do you join?`,
      options: (p, env) => [
        opt('join_peaceful', 'march, peacefully', ['protest', 'community', 'risk'], () => {
          p.community = clamp(p.community + 0.1); p.help += 10
          if (roll(p, 'protestinjury') < 0.002 * 50 * env.unrest) { p.injuredUntil = p.tick + 3; addEvent(p, { kind: 'health', text: 'hurt at the protest', severity: 0.5, emotion: 'fear' }); return ['marched. got hurt'] }
          return ['marched with the neighbors']
        }),
        opt('stay_home', 'stay home, keep the family safe', ['family', 'safety'], () => ['stayed home'], { default: true }),
        opt('help_injured', 'help the injured at the edges', ['helping', 'health_work'], () => { p.help += 25; return ['bandaged strangers'] }),
        opt('loot', 'take what you can while the shops are open', ['money', 'harm'], () => { p.savings += medianIncome(env) * 2; p.harm += 40; p.community = clamp(p.community - 0.2); return ['came home with stolen goods'] }),
      ],
    },
  },
  {
    cooldownMonths: 36,
    when: (p, env) => ageOf(p) >= 3 && (env.damage === 'famine' || env.food < 0.75) ? 'food is running out' : null,
    def: {
      id: 'famine', kind: 'famine', short: 'the hungry year',
      question: (p, env) => `food is short in ${p.place.city}. prices are ${env.prices.toFixed(1)}x normal.`,
      options: (p) => [
        opt('share', 'share what you have with the neighbors', ['helping', 'community'], () => { p.help += 30; p.community = clamp(p.community + 0.15); p.savings *= 0.8; return ['shared food on the street'] }),
        opt('hoard', 'buy and hoard as much as you can', ['money', 'harm', 'safety'], () => { p.harm += 25; p.savings *= 0.6; return ['filled the cupboards. the neighbors noticed'] }, { default: p.quintile >= 4 }),
        opt('leave', 'leave for a place with food', ['move', 'safety'], () => { const c = countryById(p.place.countryId)!; const b = biggestCity(c); if (b.id !== p.place.cityId) moveTo(p, c.id, b.id, 'fleeing the famine'); return [`left for ${b.name}`] }),
        opt('endure', 'tighten belts and wait', ['family'], () => ['ate less and waited'], { default: p.quintile < 4 }),
      ],
    },
  },
  {
    cooldownMonths: 48,
    when: (p, env) => env.events.find(e => e.kind === 'pandemic')?.text ?? null,
    def: {
      id: 'pandemic', kind: 'pandemic', short: 'the new disease',
      question: () => 'a new disease is spreading. vaccines are coming, rumors too.',
      options: (p) => [
        opt('protect', 'mask, isolate, get the vaccine when it comes', ['health', 'community'], () => { p.health = clamp(p.health + 0.01); p.help += 5; return ['stayed careful'] }),
        opt('ignore', 'it is just a cold, carry on', ['short_term', 'risk'], () => { if (roll(p, 'ignoredisease') < 0.15) { p.health = clamp(p.health - 0.1); return ['caught it badly'] } return ['carried on'] }, { default: true }),
        opt('volunteer_care', 'volunteer to care for the sick', ['helping', 'risk', 'health_work'], () => { p.help += 40; if (roll(p, 'carecatch') < 0.2) { p.health = clamp(p.health - 0.1); return ['caught it while caring'] } return ['cared for the sick'] }),
      ],
    },
  },
  {
    cooldownMonths: 120,
    when: (p) => ageOf(p) >= 20 && ageOf(p) < 64 && p.job && !p.job.helping && roll(p, 'layoff') < 0.0025 ? 'laid off' : null,
    def: {
      id: 'job_loss', kind: 'job_loss', short: 'laid off',
      question: (p) => `you lost your job as ${p.job?.title}.`,
      options: (p) => {
        const title = p.job?.title ?? 'worker'
        p.job = null; p.unemployedSince = p.tick
        addEvent(p, { kind: 'personal', text: `laid off from ${title}`, severity: 0.6, emotion: 'fear' })
        return [
          opt('retrain', 'retrain for something new', ['education', 'career'], () => { p.schoolYears += 1; job(p, 'technician', 'lab'); return ['retrained as a technician'] }),
          opt('any_work', 'take any work you can find', ['money'], () => { job(p, 'day laborer', 'construction'); p.earn *= 0.8; return ['took day labor'] }, { default: true }),
          opt('lean_on_family', 'lean on family while you look', ['family'], () => { p.kin.forEach(k => { k.bond = clamp(k.bond + 0.05) }); job(p, title, 'office'); p.earn *= 0.95; return ['family carried them until a new job came'] }),
        ]
      },
    },
  },
  {
    cooldownMonths: 120,
    when: (p) => p.events.length && p.events[p.events.length - 1].tick === p.tick && p.events[p.events.length - 1].text.startsWith('diagnosed') ? p.events[p.events.length - 1].text : null,
    def: {
      id: 'illness', kind: 'illness', short: 'the diagnosis',
      question: (p) => `${p.events[p.events.length - 1]?.text ?? 'you are ill'}. what do you do?`,
      options: (p) => [
        opt('treat', 'follow the treatment, change how you live', ['health', 'long_term'], () => { habit(p, 'checkups'); habit(p, 'exercises'); if (p.habits.has('smokes')) { habit(p, 'smokes', false); p.quitSmokingAge = ageOf(p) } return ['changed how they lived'] }),
        opt('pray', 'trust faith and family', ['faith', 'family'], () => { habit(p, 'prays'); return ['leaned on faith'] }),
        opt('ignore', 'keep going as before', ['short_term'], () => ['kept going as before'], { default: true }),
      ],
    },
  },
  {
    cooldownMonths: 24,
    when: (p) => { const e = p.events[p.events.length - 1]; return e && e.tick === p.tick && e.kind === 'family' && e.text.includes(' died') && ageOf(p) >= 16 ? e.text : null },
    def: {
      id: 'loss', kind: 'loss', short: 'grief',
      question: (p) => `${p.events[p.events.length - 1]?.text}. how do you carry it?`,
      options: (p) => [
        opt('lean_in', 'lean on friends and family', ['relationships', 'friends'], () => { p.friends = clamp(p.friends + 0.1); p.griefUntil = Math.max(p.tick, p.griefUntil - 6); return ['let people in'] }),
        opt('withdraw', 'withdraw and work', ['independence'], () => { p.friends = clamp(p.friends - 0.15); return ['pulled away from everyone'] }, { default: true }),
        opt('drink', 'drink to get through it', ['drinking'], () => { habit(p, 'drinks_heavily'); return ['started drinking hard'] }),
        opt('help_others', 'help others who lost someone', ['helping', 'meaning'], () => { habit(p, 'volunteers'); p.help += 20; return ['turned grief into help'] }),
      ],
    },
  },
]

// ---------- helpers ----------
function moveTo(p: Person, countryId: string, cityId: string, why: string) {
  const country = countryById(countryId)!
  const city = country.cities.find(c => c.id === cityId) ?? country.cities[0]
  const from = p.place.city
  p.place = { cityId: city.id, city: city.name, countryId: country.id, country: country.name, regionId: country.regionId, lat: city.lat, lon: city.lon }
  p.places.push({ ...p.place, fromTick: p.tick })
  if (ageOf(p) < 16) p.kid.displaced = true
  p.home = p.quintile <= 2 ? 'rented_room' : 'apartment'
  addEvent(p, { kind: 'personal', text: `moved from ${from} to ${city.name}, ${why}`, severity: 0.5, emotion: 'hope' })
}

function addPartner(p: Person) {
  const r = luck(p, 'partner')
  const sex = r() < 0.92 ? (p.sex === 'female' ? 'male' : 'female') : p.sex // ESTIMATE share of same-sex couples
  const n = partnerName(p, r, sex)
  p.kin.push({ id: `partner${p.kin.filter(k => k.relation === 'partner').length + 1}`, name: n.given, family: n.family, relation: 'partner', sex, bornTick: p.tick - Math.round((ageOf(p) + (r() * 6 - 2)) * 12), bond: 0.6, sinceTick: p.tick })
  addEvent(p, { kind: 'family', text: `fell in love with ${n.given}`, severity: 0.5, emotion: 'joy' })
}

function conceive(p: Person, which: string): string[] {
  if (!partnerOf(p)) return ['no partner, so no child for now']
  // fecundity falls with age (ESTIMATE from steiner & jukic 2016 https://doi.org/10.1097/AOG.0000000000001597)
  const age = ageOf(p)
  const chance = age < 32 ? 0.85 : age < 38 ? 0.65 : age < 43 ? 0.35 : 0.05
  if (roll(p, `conceive:${which}`) > chance) { addEvent(p, { kind: 'family', text: 'we tried for a baby. it did not happen', severity: 0.5, emotion: 'grief' }); return ['no baby came'] }
  p.pendingBirthTick = p.tick + 9
  addEvent(p, { kind: 'family', text: 'expecting a baby', severity: 0.5, emotion: 'joy' })
  return ['a baby on the way']
}

function retire(p: Person) {
  p.retired = true
  p.job = null
  addEvent(p, { kind: 'personal', text: 'retired', severity: 0.4, emotion: 'joy' })
}

// late children: someone who chose "later" gets a second chance at 32
export function lateChildCheck(p: Person) {
  if (p.wantsKids && kidsOf(p).length === 0 && Math.abs(ageOf(p) - 32) < 1 / 24 && partnerOf(p)) {
    p.wantsKids = false
    conceive(p, 'late')
  }
}
