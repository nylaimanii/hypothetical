// the behavior engine: people are oddly predictable in groups. every mechanism is a published finding:
// - issue-attention cycle (Downs 1972, "Up and down with ecology", The Public Interest 28): crowd topics move
//   unaware -> alarmed -> outraged -> realizing_cost -> bored. https://www.nationalaffairs.com/public_interest/detail/up-and-down-with-ecologythe-issue-attention-cycle
// - moral panics (Cohen 1972, Folk Devils and Moral Panics): small events blow up out of proportion,
//   faster where gossips and influencers are dense. https://en.wikipedia.org/wiki/Moral_panic
// - conformity (Asch 1951) and bandwagon effects: individuals drift toward their group. https://en.wikipedia.org/wiki/Asch_conformity_experiments
// - preference falsification (Kuran 1995, Private Truths, Public Lies): stated approval runs above private
//   mood until enough people show dissent, then it flips suddenly. https://en.wikipedia.org/wiki/Preference_falsification
// - loss aversion (Kahneman & Tversky 1979): losses weigh ~2x equal gains. https://doi.org/10.2307/1914185
// - hedonic adaptation (Brickman & Campbell 1971; Frederick & Loewenstein 1999): emotions relax back to baseline.
// - social identity (Tajfel & Turner 1979): groups judge laws by who they think wins and loses.
//   https://en.wikipedia.org/wiki/Social_identity_theory
// magnitudes are ESTIMATE calibrations of those findings.
import type { Archetype, Behavior, Citizen, Emotion, GroupKey, Mood } from '../types'
import { HEDONIC_DECAY, LOSS_AVERSION, PROTEST_TIPPING_SHARE, SURVIVAL_KCAL } from './constants'
import { pick, pickWeighted } from './rng'
import { link, ppl } from './causes'
import { BEHAVIORS, EMOTIONS, MOOD_BASELINE, clamp, event, incomeIdx, popWeighted, regionPop, why, type RegionState, type World } from './state'

// ---------- archetypes ----------
// ESTIMATE population mix of archetypes (adults). sharp_kid only for kids, elder mostly 65+.
export const ARCHETYPE_MIX: Record<Archetype, number> = {
  quiet_worker: 0.22, loud_uncle: 0.08, true_believer: 0.07, hustler: 0.07, conspiracy_guy: 0.05, bureaucrat: 0.06, sharp_kid: 0.05,
  influencer: 0.03, elder: 0.07, activist: 0.05, contrarian: 0.04, scientist: 0.04, worrier: 0.09, gossip: 0.08,
}
// reactivity: how hard events move them. decay: how fast they forget (x hedonic rate). ESTIMATE
const ARCH: Record<Archetype, { react: number; decay: number; bias: Partial<Mood>; core: number }> = {
  loud_uncle: { react: 2, decay: 2.2, bias: { anger: 0.1 }, core: -0.1 },
  true_believer: { react: 0.4, decay: 0.4, bias: { pride: 0.1, hope: 0.05 }, core: 0 },
  hustler: { react: 0.7, decay: 1.2, bias: { joy: 0.05, envy: 0.05 }, core: 0.05 },
  conspiracy_guy: { react: 1.2, decay: 0.8, bias: { distrust: 0.35, fear: 0.05 }, core: -0.45 },
  bureaucrat: { react: 0.5, decay: 0.8, bias: { boredom: 0.15 }, core: 0.2 },
  sharp_kid: { react: 1.1, decay: 1.2, bias: { hope: 0.1, awe: 0.05 }, core: 0 },
  influencer: { react: 1.6, decay: 2.5, bias: { pride: 0.1 }, core: 0 },
  quiet_worker: { react: 0.6, decay: 1, bias: {}, core: 0 },
  elder: { react: 0.6, decay: 0.7, bias: { grief: 0.05 }, core: 0.05 },
  activist: { react: 1.5, decay: 0.8, bias: { anger: 0.08, hope: 0.08 }, core: -0.1 },
  contrarian: { react: 1, decay: 1, bias: { distrust: 0.1 }, core: -0.15 },
  scientist: { react: 0.7, decay: 1, bias: { awe: 0.05 }, core: 0.1 },
  worrier: { react: 1.4, decay: 0.7, bias: { fear: 0.15 }, core: 0 },
  gossip: { react: 1.3, decay: 1.8, bias: { envy: 0.05 }, core: 0 },
}
// behavior tendencies by archetype (multipliers on the regional base rate). ESTIMATE
const TENDENCY: Partial<Record<Archetype, Partial<Record<Behavior, number>>>> = {
  activist: { protesting: 5, striking: 3, volunteering: 2 },
  worrier: { panic_buying: 5, hoarding: 4, praying: 1.5 },
  conspiracy_guy: { conspiracy_posting: 12, protesting: 1.5 },
  gossip: { gossiping: 6, trend_following: 2 },
  influencer: { trend_following: 6, celebrating: 2, protesting: 1.5 },
  loud_uncle: { protesting: 2, gossiping: 2, conspiracy_posting: 1.5 },
  hustler: { working: 1.3, hoarding: 2 },
  true_believer: { praying: 3 },
  elder: { praying: 1.8, volunteering: 1.5 },
  scientist: { working: 1.2, volunteering: 1.3 },
  bureaucrat: { working: 1.3 },
  sharp_kid: { trend_following: 2, gossiping: 1.5 },
  contrarian: { protesting: 1.5, trend_following: 0.2 },
}

export const valence = (m: Mood) => clamp(0.5 + ((m.joy + m.hope + m.pride + m.awe) / 4 - (m.fear + m.anger + m.grief + m.envy + m.distrust) / 5))

// ---------- groups ----------
// share of a region belonging to a stake label used in law lovedBy / hatedBy
export function labelShare(w: World, rs: RegionState, label: string): number {
  const r = rs.r
  const pop = Math.max(regionPop(rs), 1)
  const inc = incomeIdx(r.gdpUsd / pop)
  const ages = (a: number, b: number) => rs.bands.slice(a, b).reduce((x, y) => x + y, 0) / pop
  const faction = w.factions.find(f => f.id === label || f.kind === label)
  if (faction) return faction.regionIds.includes(r.id) ? 0.3 * faction.power : 0.05 * faction.power
  switch (label) {
    case 'low income': return clamp(0.8 * (1 - inc))
    case 'high income': return clamp(0.5 * inc * inc)
    case 'religious': return 0.85 * r.faith
    case 'secular': return 0.85 * (1 - r.faith)
    case 'kids': return ages(0, 3)
    case 'young': return ages(3, 6)
    case 'adults': return ages(6, 13)
    case 'elders': return ages(13, 17)
    // ILO: agriculture is ~26% of world employment, far more in poor regions (ESTIMATE curve)
    case 'farm workers': return clamp(0.6 * Math.pow(1 - inc, 1.5))
    case 'industry workers': return 0.22
    case 'service workers': return clamp(0.78 - 0.6 * Math.pow(1 - inc, 1.5))
    case 'bureaucrats': return ARCHETYPE_MIX.bureaucrat
    case 'conspiracy': return ARCHETYPE_MIX.conspiracy_guy
    default: return 0
  }
}

export function groupMatches(g: GroupKey, archetype: Archetype, label: string): boolean {
  switch (label) {
    case 'low income': return g.incomeBand === 'low'
    case 'high income': return g.incomeBand === 'high'
    case 'religious': case 'religious_faction': return g.belief === 'religious'
    case 'secular': return g.belief === 'secular'
    case 'kids': return g.ageBand === 'kid'
    case 'young': return g.ageBand === 'young'
    case 'adults': return g.ageBand === 'adult'
    case 'elders': return g.ageBand === 'elder'
    case 'farm workers': return g.jobSector === 'farming'
    case 'industry workers': case 'labor': return g.jobSector === 'industry'
    case 'service workers': return g.jobSector === 'services'
    case 'bureaucrats': return archetype === 'bureaucrat'
    case 'conspiracy': return archetype === 'conspiracy_guy'
    case 'science': return archetype === 'scientist'
    case 'business': return archetype === 'hustler'
    case 'military': case 'regional_nationalist': case 'old_energy': return false
    default: return false
  }
}

// ---------- crowds ----------
// ESTIMATE invented panic topics: the kind of small thing that becomes a week of national hysteria
const PANIC_TOPICS = [
  'a rumor that the new grid lines hum at night', 'lab grown meat allegedly served in a school lunch', 'the census asking how many houseplants people own',
  'a viral clip of a rocket booster that turned out to be a water tower', 'a claim that the core reads grocery lists', 'a pigeon seen near the launch pad',
  'a new coin design some people say looks smug', 'a weather balloon mistaken for a mars ship', 'a recipe for space potatoes', 'daylight saving time, again',
]

export function addCrowd(rs: RegionState, w: World, c: { topic: string; peak: number; outrageMonths: number; delay?: number; lawId?: string; panic?: boolean; causeId?: string }) {
  if (rs.crowds.some(x => x.topic === c.topic && x.phase !== 'bored')) return
  if (rs.crowds.length >= 4) {
    const drop = rs.crowds.slice().sort((a, b) => (a.phase === 'bored' ? -1 : 0) - (b.phase === 'bored' ? -1 : 0) || a.intensity - b.intensity)[0]
    rs.crowds = rs.crowds.filter(x => x !== drop)
  }
  rs.crowds.push({ topic: c.topic, phase: 'unaware', intensity: 0, sinceTick: w.tick, peak: clamp(c.peak), outrageMonths: Math.max(1, Math.round(c.outrageMonths)), lawId: c.lawId, panic: c.panic, startTick: w.tick + (c.delay ?? 0), causeId: c.causeId })
}

function stepCrowds(w: World, rs: RegionState, spreaders: number) {
  const speed = 1 + 4 * Math.max(0, spreaders - 0.08) // gossips and influencers speed everything up
  for (const c of rs.crowds) {
    const age = w.tick - c.sinceTick
    switch (c.phase) {
      case 'unaware':
        if (w.tick >= c.startTick) { c.phase = 'alarmed'; c.sinceTick = w.tick }
        break
      case 'alarmed':
        c.intensity = Math.min(c.peak * 0.6, c.intensity + c.peak * 0.3 * speed)
        if (age >= Math.max(1, Math.round(2 / speed))) {
          c.phase = 'outraged'; c.sinceTick = w.tick
          // the crowd hits the streets: a protest link chained to whatever set it off
          const cause = c.causeId ? w.causes.find(x => x.id === c.causeId) : undefined
          // ESTIMATE: 0.05% to 1% of a region marches at the peak of a real grievance (the largest protests on record
          // reach low millions per country), a fifth of that for a moral panic
          const marchers = regionPop(rs) * (0.0005 + 0.01 * c.peak) * (c.panic ? 0.2 : 1)
          link(w, { placeId: rs.r.id, what: `${ppl(marchers)} protested in ${rs.r.name} over ${c.topic}`, value: marchers, because: cause ? cause.what : c.panic ? 'a rumor that spread faster than the facts' : c.topic, byWhom: `crowd:${c.topic}`, lawId: c.lawId, causeIds: c.causeId ? [c.causeId] : [] })
        }
        break
      case 'outraged':
        c.intensity = c.peak
        if (age >= c.outrageMonths) { c.phase = 'realizing_cost'; c.sinceTick = w.tick }
        break
      case 'realizing_cost':
        c.intensity *= 0.85
        if (age >= 4) { c.phase = 'bored'; c.sinceTick = w.tick }
        break
      case 'bored':
        c.intensity = Math.min(c.intensity, 0.1 * c.peak)
        break
    }
  }
  rs.crowds = rs.crowds.filter(c => !(c.phase === 'bored' && w.tick - c.sinceTick >= 6))
  // moral panic: small things blow up. ESTIMATE base 0.4%/month per region, x(1 + 10 x spreader density)
  const p = 0.004 * (1 + 10 * spreaders)
  const x = w.rng.behavior(), y = w.rng.behavior(), z = w.rng.behavior()
  if (x < p) {
    const topic = PANIC_TOPICS[Math.floor(y * PANIC_TOPICS.length) % PANIC_TOPICS.length]
    addCrowd(rs, w, { topic, peak: 0.3 + 0.4 * z, outrageMonths: 1 + Math.floor(z * 3), panic: true })
    if (rs.crowds.some(c => c.topic === topic)) event(w, { regionId: rs.r.id, kind: 'revolt', text: `moral panic in ${rs.r.name} over ${topic}`, severity: 0.15 }, { byWhom: `crowd:${topic}`, because: 'a rumor amplified by gossips and influencers (moral panic, Cohen 1972)', causeIds: [] })
  }
}

// ---------- region mood, behavior, approval ----------
export function stepRegionBehavior(w: World, rs: RegionState, lawBacklash: number, religionBacklash: number) {
  const r = rs.r
  const pop = Math.max(regionPop(rs), 1)
  const spreaders = ARCHETYPE_MIX.gossip + ARCHETYPE_MIX.influencer
  stepCrowds(w, rs, spreaders)
  const outrage = Math.min(1, rs.crowds.reduce((a, c) => a + (c.phase === 'outraged' ? c.intensity : c.phase === 'alarmed' ? 0.5 * c.intensity : 0), 0))
  const alarmed = Math.min(1, rs.crowds.reduce((a, c) => a + (c.phase === 'alarmed' ? c.intensity : 0), 0))
  const bored = rs.crowds.filter(c => c.phase === 'bored').length / 4
  const kcal = r.foodKcalPerCapita
  const foodIdx = clamp((kcal - SURVIVAL_KCAL) / 900)
  const foodStress = clamp((2300 - kcal) / 500)
  const pandemic = w.tick < rs.pandemicUntil ? clamp(rs.pandemicMort * 100) : 0
  const relIncome = clamp((r.gdpUsd / pop) / Math.max(popWeighted(w, x => x.r.gdpUsd / Math.max(regionPop(x), 1)), 1))
  // loss aversion on month-over-month wellbeing
  const W = 0.4 * foodIdx + 0.3 * (1 - r.unrest) + 0.3 * clamp(0.5 + rs.growth * 10)
  const dW = rs.lastWellbeing ? W - rs.lastWellbeing : 0
  rs.lastWellbeing = W
  const gain = Math.max(0, dW) * 3
  const loss = Math.max(0, -dW) * 3 * LOSS_AVERSION
  const target: Mood = {
    joy: MOOD_BASELINE.joy + 0.3 * (foodIdx - 0.5) - 0.3 * Math.max(0, r.unrest - 0.3) + gain,
    fear: MOOD_BASELINE.fear + 0.5 * foodStress + 0.5 * pandemic + 0.4 * w.warTension + 0.3 * alarmed + rs.fearShock,
    anger: MOOD_BASELINE.anger + 0.4 * outrage + 2 * lawBacklash + religionBacklash + 0.3 * Math.max(0, r.unrest - 0.3) + loss,
    hope: MOOD_BASELINE.hope + 0.2 * clamp(rs.growth * 10) - 0.3 * foodStress + 0.3 * rs.aweShock + 0.5 * gain,
    grief: MOOD_BASELINE.grief + rs.griefShock + 0.5 * loss + 0.3 * pandemic,
    pride: MOOD_BASELINE.pride + rs.prideShock,
    envy: MOOD_BASELINE.envy + 0.3 * (1 - relIncome),
    boredom: MOOD_BASELINE.boredom + 0.4 * bored - 0.2 * outrage,
    awe: MOOD_BASELINE.awe + rs.aweShock,
    distrust: MOOD_BASELINE.distrust + 0.4 * (1 - r.compliance) + 0.2 * outrage + (rs.flipped ? 0.15 : 0),
  }
  // hedonic adaptation: relax toward the situational target
  for (const e of EMOTIONS) rs.mood[e] = clamp(rs.mood[e] + (clamp(target[e]) - rs.mood[e]) * HEDONIC_DECAY)
  rs.prideShock *= 0.9; rs.aweShock *= 0.9; rs.griefShock *= 0.9; rs.fearShock *= 0.9

  // behavior shares (fractions of the population this month). ESTIMATE base rates
  const m = rs.mood
  const sec = Math.max(rs.spend.security * 12 / pop, 1) / Math.max(rs.pc0.security, 1)
  const suppress = clamp(0.15 * Math.log2(Math.max(sec, 0.5)), -0.1, 0.4)
  const b: Record<Behavior, number> = {} as Record<Behavior, number>
  b.protesting = clamp((0.002 + 0.06 * Math.max(0, m.anger - 0.3) + 0.04 * outrage) * (1 - suppress), 0, 0.2)
  b.striking = clamp(0.001 + 0.03 * Math.max(0, m.anger - 0.35) + rs.strikeBoost, 0, 0.15)
  b.rioting = clamp((0.0003 + 0.02 * Math.max(0, m.anger - 0.55)) * (1 - r.compliance) * (1 - suppress), 0, 0.05)
  b.hoarding = clamp(0.004 + 0.06 * Math.max(0, m.fear - 0.3), 0, 0.2)
  b.panic_buying = clamp(0.001 + 0.08 * Math.max(0, m.fear - 0.45) + 0.03 * alarmed * (rs.crowds.some(c => c.panic && c.phase === 'alarmed') ? 1 : 0), 0, 0.2)
  b.celebrating = clamp(0.005 + 0.15 * Math.max(0, m.joy + m.awe + m.pride - 1), 0, 0.3)
  b.praying = clamp(r.faith * (0.08 + 0.1 * (m.fear + m.grief)), 0, 0.3)
  b.gossiping = clamp(0.04 + 0.06 * alarmed + 0.03 * outrage, 0, 0.2)
  // bandwagon: trend following rises with the loudest crowd
  b.trend_following = clamp(0.02 + 0.08 * Math.max(...rs.crowds.map(c => c.intensity), 0), 0, 0.2)
  b.conspiracy_posting = clamp(0.004 + 0.03 * Math.max(0, m.distrust - 0.25), 0, 0.1)
  b.volunteering = clamp(0.015 + 0.03 * (m.hope + m.grief) / 2, 0, 0.1)
  const newCities = w.cities.filter(c => !c.offWorld && c.regionId === r.id)
  b.moving_to_new_city = clamp(newCities.length ? 0.0005 * newCities.length * (0.5 + m.hope) : 0, 0, 0.01)
  b.starting_family = clamp(0.01 * (r.fertility || rs.tfr) / 2 * (0.7 + 0.6 * m.hope), 0, 0.05)
  b.migrating = clamp(w.transit.filter(t => t.from === r.id).reduce((a, t) => a + t.people, 0) / pop, 0, 0.05)
  b.idle = clamp(0.04 + 0.5 * Math.max(0, -rs.growth), 0, 0.3)
  const used = BEHAVIORS.filter(x => x !== 'working').reduce((a, x) => a + b[x], 0)
  b.working = Math.max(0, 1 - used)
  const wasPanic = rs.behavior.panic_buying > 0.03
  rs.behavior = b
  rs.strikeBoost *= 0.7
  if (b.panic_buying > 0.03 && !wasPanic) event(w, { regionId: r.id, kind: 'disaster', text: `panic buying empties shelves in ${r.name}`, severity: clamp(b.panic_buying * 5) })

  // preference falsification: people say they approve until visible dissent passes the tipping share
  const privateApproval = clamp(0.5 + (valence(m) - 0.5) * 1.3 - 0.25 * (r.unrest - 0.3))
  rs.privateApproval = privateApproval
  if (!rs.flipped && (b.protesting >= PROTEST_TIPPING_SHARE || (privateApproval < 0.3 && outrage > 0.5))) {
    rs.flipped = true
    const lastProtest = w.causes.slice().reverse().find(x => x.placeId === r.id && /protested/.test(x.what) && w.tick - x.tick <= 12)
    event(w, { regionId: r.id, kind: 'revolt', text: `in ${r.name} public approval collapses almost overnight: people now say out loud what they said in private`, severity: 0.5 },
      { byWhom: 'people', because: `${(b.protesting * 100).toFixed(1)}% of people protesting, past the 3.5% tipping point (Chenoweth), private approval ${Math.round(privateApproval * 100)}%`, causeIds: lastProtest ? [lastProtest.id] : [] })
  }
  if (rs.flipped && privateApproval > 0.55 && b.protesting < 0.01) rs.flipped = false
  const gapTarget = rs.flipped ? 0 : 0.25 * r.compliance
  rs.falsificationGap += (gapTarget - rs.falsificationGap) * (rs.flipped ? 0.5 : 0.02)
  const approval = clamp(privateApproval + rs.falsificationGap)
  why(rs, 'approval', 'mood', approval - (r.approval || approval))
  if (outrage > 0.1) why(rs, 'approval', `outrage over ${rs.crowds.find(c => c.phase === 'outraged')?.topic ?? 'the latest thing'}`, -0.15 * outrage)
  if (rs.falsificationGap > 0.05) why(rs, 'approval', 'people saying what is safe to say', rs.falsificationGap, 'https://en.wikipedia.org/wiki/Preference_falsification')
  r.approval = approval
  return { outrage }
}

// economic drag from behavior: strikes, protests and riots cut output (ESTIMATE, as annual growth points)
// ordinary background levels (0.1% striking, 0.2% protesting, 0.03% rioting) are already in normal growth;
// only the excess costs output
export function behaviorDrag(rs: RegionState): number {
  const b = rs.behavior
  return 6 * (Math.max(0, b.striking - 0.001) + 0.3 * Math.max(0, b.protesting - 0.002) + 2 * Math.max(0, b.rioting - 0.0003))
}
// hoarding and panic buying make food scarce for everyone else (ESTIMATE)
export function hoardingFactor(rs: RegionState): number {
  return 1 - 0.3 * (rs.behavior.hoarding + 2 * rs.behavior.panic_buying)
}

// ---------- citizens ----------
export function citizenGroup(w: World, rs: RegionState, c: Pick<Citizen, 'age' | 'job' | 'belief' | 'personalitySeed'>): GroupKey {
  const inc = incomeIdx(rs.r.gdpUsd / Math.max(rs.r.population, 1))
  const u = ((c.personalitySeed % 1000) / 1000)
  const incomeBand = u < 0.8 * (1 - inc) ? 'low' : u > 1 - 0.5 * inc * inc ? 'high' : 'mid'
  const ageBand = c.age < 15 ? 'kid' : c.age < 30 ? 'young' : c.age < 65 ? 'adult' : 'elder'
  const jobSector = /farm|fisher/.test(c.job) ? 'farming' : /builder|mechanic|electrician|tailor|technician/.test(c.job) ? 'industry' : /student|child/.test(c.job) ? 'school' : /retired/.test(c.job) ? 'retired' : 'services'
  return { ageBand, jobSector, belief: c.belief, incomeBand, regionId: rs.r.id }
}

export function pickArchetype(rng: () => number, age: number): Archetype {
  if (age < 15) return pickWeighted<Archetype>(rng, { sharp_kid: 0.5, gossip: 0.15, worrier: 0.1, contrarian: 0.1, quiet_worker: 0.15 })
  if (age >= 65) return pickWeighted<Archetype>(rng, { ...ARCHETYPE_MIX, elder: 0.45, sharp_kid: 0 })
  return pickWeighted<Archetype>(rng, { ...ARCHETYPE_MIX, sharp_kid: 0, elder: 0.01 })
}

export function stepCitizens(w: World) {
  const rng = w.rng.citizens
  for (const c of w.citizens) {
    const rs = w.regions.find(r => r.r.id === c.regionId)!
    const a = ARCH[c.archetype]
    c.group = citizenGroup(w, rs, c)
    // personal stakes: laws loved or hated by my group (social identity), weighted by loss aversion
    let stake = 0
    for (const l of w.laws) {
      if (l.vetoed) continue
      if (l.hatedBy.some(h => groupMatches(c.group, c.archetype, h))) stake -= LOSS_AVERSION * 0.1
      if (l.lovedBy.some(h => groupMatches(c.group, c.archetype, h))) stake += 0.1
    }
    const groupAvg = rs.mood
    for (const e of EMOTIONS) {
      const bias = a.bias[e] ?? 0
      const personal = e === 'anger' ? Math.max(0, -stake) : e === 'joy' ? Math.max(0, stake) : 0
      const targetE = clamp(groupAvg[e] + (groupAvg[e] - MOOD_BASELINE[e]) * (a.react - 1) + bias + personal)
      // hedonic adaptation at the archetype's speed, plus conformity: 10% pull toward the group (Asch)
      let v = c.mood[e] + (targetE - c.mood[e]) * clamp(HEDONIC_DECAY * a.decay)
      v += (groupAvg[e] - v) * 0.1
      c.mood[e] = Math.round(clamp(v) * 1000) / 1000
    }
    // contrarians invert the loudest crowd
    if (c.archetype === 'contrarian' && rs.crowds.some(x => x.phase === 'outraged')) c.mood.anger = clamp(c.mood.anger * 0.6)
    c.opinionOfCore = Math.round(clamp(2 * rs.r.approval - 1 + a.core + stake + (c.archetype === 'scientist' ? 0.2 * (w.budget.research - 0.03) * 10 : 0), -1, 1) * 1000) / 1000
    // behavior: keep the current one 70% of the time, otherwise draw from regional rates x archetype tendency
    const x = rng()
    if (x < 0.3 || c.behavior === undefined) {
      const tend = TENDENCY[c.archetype] ?? {}
      const weights: Record<string, number> = {}
      for (const bh of BEHAVIORS) weights[bh] = rs.behavior[bh] * (tend[bh] ?? 1)
      if (c.age < 15) { weights.working = 0; weights.striking = 0; weights.starting_family = 0; weights.moving_to_new_city = 0; weights.idle += 0.3 }
      if (c.age < 20 || c.age > 50) weights.starting_family = 0
      const prev = c.behavior
      c.behavior = pickWeighted<Behavior>(rng, weights)
      if (prev !== c.behavior) noteBehavior(w, c, rs)
    }
  }
}

function noteBehavior(w: World, c: Citizen, rs: RegionState) {
  const topic = rs.crowds.find(x => x.phase === 'outraged' || x.phase === 'alarmed')?.topic
  const line: Partial<Record<Behavior, string>> = {
    protesting: `joined a protest in ${rs.r.name}${topic ? ` about ${topic}` : ''}`,
    striking: `went on strike in ${rs.r.name}${topic ? ` over ${topic}` : ''}`,
    rioting: 'got caught up in a riot',
    hoarding: 'started stockpiling',
    panic_buying: 'panic bought everything on one shelf',
    moving_to_new_city: `moved to ${w.cities.filter(x => x.regionId === rs.r.id && !x.offWorld).slice(-1)[0]?.name ?? 'a new city'}`,
    starting_family: c.family.kids < 6 ? 'had a baby' : undefined,
    volunteering: 'started volunteering',
    conspiracy_posting: 'started a channel about what the core is hiding',
  }
  const text = line[c.behavior]
  if (!text) return
  if (c.behavior === 'starting_family') c.family.kids++
  addLifeEvent(w, c, text)
}

export function addLifeEvent(w: World, c: Citizen, text: string) {
  if (c.lifeEvents.some(e => e.text === text && w.tick - e.tick < 12)) return
  const arc = (w.lifeArchive[c.id] ??= { name: c.name, regionId: c.regionId, events: [] })
  arc.events.push({ tick: w.tick, text })
  arc.regionId = c.regionId
  c.lifeEvents = [...c.lifeEvents, { tick: w.tick, text }].slice(-4) // the full story lives in w.lifeArchive
  const m = w.citizenMeta[c.id]
  if (m) m.affectedTick = w.tick
}

export function blankMood(): Mood {
  return { ...MOOD_BASELINE }
}

export function dominantEmotion(m: Mood): Emotion {
  let best: Emotion = 'boredom'
  for (const e of EMOTIONS) if (m[e] > m[best]) best = e
  return best
}

// dry, satirical, original voice. targets behaviors and institutions, never identity.
// the thought follows what the person is doing first (a protester thinks about why they march), then their mood:
// cheerful lines only when they are actually doing well, so behavior and words never contradict.
export function satiricalThought(w: World, c: Citizen, rs: RegionState, rng: () => number): string {
  const outraged = rs.crowds.filter(x => x.phase === 'outraged' || x.phase === 'alarmed').sort((a, b) => b.intensity - a.intensity)[0]
  const crowd = outraged ?? rs.crowds.slice().sort((a, b) => b.intensity - a.intensity)[0]
  const topic = crowd?.topic
  const grievanceLaw = outraged?.lawId ? w.laws.find(l => l.id === outraged.lawId) : w.laws.filter(l => !l.vetoed && l.hatedBy.some(h => groupMatches(c.group, c.archetype, h))).slice(-1)[0]
  const why = grievanceLaw ? `law ${grievanceLaw.id}, "${grievanceLaw.title}"` : topic ?? (rs.r.foodKcalPerCapita < 2300 ? 'the price of food' : 'how this place is run')
  const v = valence(c.mood)
  const kcal = Math.round(rs.r.foodKcalPerCapita)
  const price = Math.round((rs.priceIdx - 1) * 100)
  const by = (opts: string[]) => pick(rng, opts)
  switch (c.behavior) {
    case 'protesting': return by([`I am marching because of ${why}. If they wanted us home they should have asked first.`, `Third week in the square over ${why}. My feet hurt less than my rent.`, `They passed ${why} without asking anyone here. So we are asking loudly.`])
    case 'striking': return by([`Off the line until ${why} is fixed. Funny how fast they notice us when nothing ships.`, `On strike over ${why}. The boss says it is not personal. Neither is the strike.`])
    case 'rioting': return by([`Nobody listened to the marches about ${why}. Now they are listening.`, `I did not plan to throw anything. Then the trucks came.`])
    case 'hoarding': return by([`Food prices are ${price >= 0 ? 'up' : 'down'} ${Math.abs(price)}% since 2026. My closet is now a pantry.`, 'Bought forty kilos of rice. The rice is fine. I am not.'])
    case 'panic_buying': return by([`Everyone said the shelves would empty, so I emptied a shelf. Seems I was right.`, `I do not need nine bags of flour. I needed to not be the one without flour.`])
    case 'praying': return v < 0.45 ? by([`I pray for rain, cheaper bread, and a government that answers. In that order.`, `When the core goes quiet, I talk to someone who listens.`]) : by(['Grateful this week. Still praying, just with less in the list.'])
    case 'idle': return by([`No work since ${rs.growth < 0 ? 'the economy shrank' : 'the plant closed'}. I have read every job board twice.`, `Unemployed in ${rs.r.name}. My schedule is open. My fridge is too.`])
    case 'moving_to_new_city': return by(['Packed the apartment into four boxes. The new city has jobs, they say. They always say.', 'Moving to the new city. If it is half as good as the brochure, it is twice as good as here.'])
    case 'migrating': return 'Six months in transit and a form for every border. Still moving.'
    case 'conspiracy_posting': return by([`They say ${why} is about what it says. Notice they never say what else it is about.`, 'Posted the real story tonight. Forty likes. The truth is getting popular.'])
    case 'volunteering': return by([`Handing out food in ${rs.r.name}. ${kcal < 2300 ? 'The line is longer than last month.' : 'The line is shorter than last year. Progress.'}`, 'Volunteering at the clinic. The pay is nothing and the coffee is worse. I keep coming back.'])
    case 'celebrating': return v >= 0.5 ? by(['We are celebrating. Nobody remembers exactly what. Good news of some kind.', w.frontier !== 'none' ? `People live on another world now. We had a party about it. The bus is still late.` : 'Street party tonight. First one in years.']) : 'Everyone is celebrating. I am at the party, mostly for the food.'
    case 'starting_family': return 'A baby on the way. We counted the money twice and decided to stop counting.'
    case 'gossiping': return topic ? `My neighbor's cousin says ${topic} is just the beginning. I have told six people already.` : 'Nothing happened today, which I have now told everyone.'
    case 'trend_following': return topic ? `Everyone is talking about ${topic}, so now I have an opinion too.` : 'Changed my profile picture to match everyone else. Feels like participating.'
  }
  // working: the voice depends on how life is actually going
  if (kcal < 2000) return by(['Dinner was a philosophical concept again.', `Food is ${price}% dearer than in 2026. I eat once a day and call it a diet.`])
  if (v < 0.4) {
    const pool = [`Work, home, worry about ${why}. Repeat.`, `Prices up ${Math.max(price, 0)}%, pay not. My job as a ${c.job} covers less every year.`]
    if (c.archetype === 'loud_uncle' && topic) pool.push(`Nobody asked me about ${topic}. I will be telling everyone at dinner for exactly two weeks.`)
    if (c.archetype === 'bureaucrat' && grievanceLaw) pool.push(`I have been told to enforce "${grievanceLaw.title}". I have formed a committee to decide which committee handles it.`)
    if (c.archetype === 'conspiracy_guy') pool.push('The core has been suspiciously quiet. Which is exactly what a core would do.')
    return by(pool)
  }
  if (crowd?.phase === 'bored' && topic) return `Remember when everyone was furious about ${topic}? Me neither.`
  if (crowd?.phase === 'realizing_cost' && topic) return `Turns out fixing ${topic} costs money. Suddenly everyone has somewhere else to be.`
  const options: string[] = []
  switch (c.archetype) {
    case 'hustler': options.push(grievanceLaw ? `Every new law is a new market. I now sell "${grievanceLaw.title}" compliance stickers.` : 'Change is coming. I have already printed the merchandise.'); break
    case 'sharp_kid': options.push(rs.r.education < rs.base.education ? 'They cut the school budget. In twenty years my class runs the planet. Good luck to everyone.' : 'If the math teacher is right, the mars thing works. If the history teacher is right, it will be late.'); break
    case 'elder': options.push('I have seen worse. I just do not remember it being this loud.', 'Every generation thinks it invented the end of the world.'); break
    case 'scientist': options.push('The data is clear. The data has never once been invited to a protest.', 'Peer review takes eight months. Outrage takes eight minutes.'); break
    case 'influencer': options.push(topic ? `Day three of posting about ${topic}. Engagement up. The topic is down.` : 'Posted a sunset. Two thousand people agreed with it.'); break
    case 'worrier': options.push('Made a plan for every possible disaster. Forgot to make lunch.'); break
    case 'true_believer': options.push('Governments change every decade. My routine has not changed in forty years.'); break
    case 'contrarian': if (topic) options.push(`Everyone is upset about ${topic}, so I have decided it is fine.`); break
    default: options.push(v >= 0.55 ? `Work as a ${c.job} is steady and dinner is on the table. That is the whole review.` : 'Went to work. Came home. The news says history is happening. It looked like a Tuesday.')
  }
  if (w.frontier !== 'none' && rng() < 0.3) options.push('People are living on another world and my bus is still late.')
  if (!options.length) options.push(v >= 0.55 ? `Work as a ${c.job} is steady. That is the whole review.` : `Another month as a ${c.job} in ${rs.r.name}. Nothing exploded. Locally.`)
  return pick(rng, options)
}
