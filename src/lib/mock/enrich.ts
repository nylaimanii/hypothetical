// MOCK: layers v2 detail (emotions, behaviors, crowds, whys, cities, companies, factions, requirements,
// frontier, human cost, lessons) over a base mock run. deterministic, ESTIMATE numbers only.
import type {
  Archetype, Behavior, Citizen, City, Company, CrowdState, Decision, Frame, HumanCost, Lesson, LifeEvent, Mood, Region, Requirement, RunRecord, Why,
} from '@/lib/types'
import { moodFrom } from './mood'
import { CITY_SEEDS, COMPANY_SEEDS, FACTIONS, LAW_META, LESSONS, PRECEDENTS, REQUIREMENTS } from './v2'

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296 }

const PLE: Record<string, number> = { nam: 79, mes: 75, sam: 75, weu: 82, eeu: 73, mena: 74, wca: 60, esa: 64, sas: 70, eas: 78, sea: 73, oce: 82 }
const FERT: Record<string, number> = { nam: 1.6, mes: 1.9, sam: 1.7, weu: 1.5, eeu: 1.4, mena: 2.6, wca: 4.5, esa: 4.0, sas: 2.1, eas: 1.1, sea: 1.9, oce: 1.6 }
const TRAVEL: Record<string, number> = { nam: 5, mes: 7, sam: 9, weu: 3, eeu: 6, mena: 7, wca: 14, esa: 12, sas: 6, eas: 4, sea: 8, oce: 16 }
const INCOME: Record<string, 'low' | 'mid' | 'high'> = { nam: 'high', weu: 'high', oce: 'high', eas: 'mid', eeu: 'mid', mena: 'mid', mes: 'mid', sam: 'mid', sea: 'mid', sas: 'low', wca: 'low', esa: 'low' }
const SECTOR: Record<string, string> = { farmer: 'food', fisher: 'food', cook: 'food', nurse: 'health', doctor: 'health', welder: 'industry', miner: 'industry', builder: 'industry', mechanic: 'industry', electrician: 'energy', engineer: 'tech', coder: 'tech', teacher: 'education', student: 'education', retired: 'none', shopkeeper: 'trade', driver: 'transport', clerk: 'services' }

type Phase = CrowdState['phase']
// issue-attention cycles: [regionId, topic, [year, phase, intensity][]]
const CYCLES: Record<'moon' | 'destroyed', [string, string, [number, Phase, number][]][]> = {
  moon: [
    ['*', 'the core takes over', [[0, 'alarmed', 0.55], [1, 'outraged', 0.7], [2, 'realizing_cost', 0.35], [3, 'bored', 0.15]]],
    ['esa', 'grain rationing', [[2, 'alarmed', 0.6], [3, 'realizing_cost', 0.4], [4, 'bored', 0.2]]],
    ['sam', 'pads on our land', [[3, 'alarmed', 0.5], [4, 'outraged', 0.82], [5, 'realizing_cost', 0.5], [6, 'bored', 0.2]]],
    ['mena', 'the energy levy', [[4, 'alarmed', 0.5], [5, 'outraged', 0.85], [6, 'realizing_cost', 0.45], [7, 'bored', 0.18]]],
    ['weu', 'longer school days', [[3, 'alarmed', 0.3], [4, 'bored', 0.1]]],
  ],
  destroyed: [
    ['*', 'the core takes over', [[0, 'alarmed', 0.6], [1, 'outraged', 0.8], [2, 'outraged', 0.7]]],
    ['sam', 'pads on our land', [[3, 'outraged', 0.9], [4, 'outraged', 0.9], [5, 'realizing_cost', 0.6]]],
    ['sas', 'the grain is gone', [[5, 'outraged', 0.95], [6, 'outraged', 0.9]]],
    ['mena', 'orders from nowhere', [[6, 'alarmed', 0.7], [7, 'outraged', 0.95]]],
    ['wca', 'seized convoys', [[8, 'outraged', 1]]],
  ],
}
const OPEN_ALL = ['nam', 'eeu', 'weu', 'mena']

function crowdsFor(fate: 'moon' | 'destroyed', regionId: string, year: number): CrowdState[] {
  const out: CrowdState[] = []
  for (const [rid, topic, steps] of CYCLES[fate]) {
    if (rid !== '*' && rid !== regionId) continue
    if (rid === '*' && !OPEN_ALL.includes(regionId) && year > 0) continue
    const cur = [...steps].reverse().find((s) => s[0] <= year)
    if (!cur || year - cur[0] > 1) continue
    const first = steps.find((s) => s[1] === cur[1])!
    out.push({ topic, phase: cur[1], intensity: cur[2], sinceTick: first[0] * 12 })
  }
  return out
}

const ARCH_BIAS: Partial<Record<Archetype, number>> = { true_believer: 0.4, contrarian: -0.45, conspiracy_guy: -0.6, bureaucrat: 0.25, activist: -0.2, scientist: 0.15, loud_uncle: -0.15 }

function behaviorFor(c: Citizen, f: Frame, region: Region, prev: Citizen | undefined, ctx: { migratedNow: boolean; newCity?: string; year: number }): Behavior {
  const h = hash(`${c.id}:${f.tick}`)
  const a = c.archetype
  const kid = c.age < 14
  const crowd = region.crowds.find((x) => x.phase === 'outraged' || x.phase === 'bored')
  const ev = f.newEvents.filter((e) => e.regionId === region.id)
  if (ctx.migratedNow) return 'migrating'
  if (ctx.newCity && h < 0.35 && !kid) return 'moving_to_new_city'
  if (crowd?.phase === 'outraged' && !kid) {
    if (ev.some((e) => e.kind === 'revolt' || e.kind === 'war') && (a === 'loud_uncle' || a === 'contrarian')) return 'rioting'
    if (a === 'quiet_worker' || a === 'hustler') return 'striking'
    if (['activist', 'loud_uncle', 'influencer', 'contrarian', 'gossip', 'sharp_kid'].includes(a) || h < 0.45) return 'protesting'
  }
  // a bored crowd keeps its protesters for one more beat, the renderer shows them drifting off
  if (crowd?.phase === 'bored' && prev?.behavior === 'protesting') return 'protesting'
  if (ev.some((e) => e.kind === 'famine') || region.foodKcalPerCapita < 2150) {
    if (a === 'worrier' || a === 'elder') return 'hoarding'
    if (a === 'hustler' || h < 0.3) return 'panic_buying'
  }
  if (ev.some((e) => e.kind === 'disaster' || e.kind === 'pandemic') && !kid && h < 0.5) return 'volunteering'
  const launch = f.newEvents.find((e) => e.kind === 'launch' && !/fail/i.test(e.text))
  if (launch && h < (launch.regionId === region.id ? 0.55 : 0.18)) return 'celebrating'
  if (c.belief === 'religious' && (h < 0.25 || ev.some((e) => e.kind === 'famine' || e.kind === 'disaster'))) return 'praying'
  if (a === 'conspiracy_guy') return 'conspiracy_posting'
  if (a === 'gossip') return 'gossiping'
  if ((a === 'influencer' || c.group.ageBand === 'young') && (ctx.year % 3 === 0 || h < 0.3)) return 'trend_following'
  if (!kid && c.family.partnerId && c.age < 42 && h > 0.86) return 'starting_family'
  if (kid) return h < 0.5 ? 'idle' : 'trend_following'
  return a === 'quiet_worker' || a === 'bureaucrat' || a === 'scientist' || h < 0.6 ? 'working' : 'idle'
}

function moodFor(c: Citizen, b: Behavior, base: number, region: Region): Mood {
  const t: Partial<Mood> = {}
  switch (b) {
    case 'protesting': Object.assign(t, { anger: 0.75, pride: 0.45, hope: 0.3 }); break
    case 'rioting': Object.assign(t, { anger: 0.95, fear: 0.4 }); break
    case 'striking': Object.assign(t, { anger: 0.55, pride: 0.6 }); break
    case 'celebrating': Object.assign(t, { joy: 0.9, awe: 0.7, hope: 0.7 }); break
    case 'praying': Object.assign(t, { hope: 0.65, awe: 0.5 }); break
    case 'hoarding': case 'panic_buying': Object.assign(t, { fear: 0.85, distrust: 0.5 }); break
    case 'conspiracy_posting': Object.assign(t, { distrust: 0.9, anger: 0.4 }); break
    case 'volunteering': Object.assign(t, { pride: 0.7, grief: 0.4, hope: 0.55 }); break
    case 'starting_family': Object.assign(t, { joy: 0.8, hope: 0.75 }); break
    case 'trend_following': Object.assign(t, { joy: 0.55, boredom: 0.35 }); break
    case 'gossiping': Object.assign(t, { envy: 0.45, joy: 0.4 }); break
    case 'migrating': case 'moving_to_new_city': Object.assign(t, { fear: 0.45, hope: 0.6, grief: 0.35 }); break
  }
  if (region.crowds.some((x) => x.phase === 'bored')) t.boredom = Math.max(t.boredom ?? 0, 0.75)
  if (c.archetype === 'sharp_kid') t.awe = Math.max(t.awe ?? 0, 0.6)
  if (c.archetype === 'elder') t.pride = Math.max(t.pride ?? 0, 0.5)
  if (c.archetype === 'worrier') t.fear = Math.max(t.fear ?? 0, 0.55)
  if (c.archetype === 'hustler' && INCOME[region.id] === 'low') t.envy = Math.max(t.envy ?? 0, 0.6)
  return moodFrom(base, t)
}

const LIFE: Partial<Record<Behavior, (topic: string, extra: string) => string>> = {
  protesting: (t) => `joined the protest over ${t}`,
  striking: (t) => `walked off the job over ${t}`,
  rioting: (t) => `was in the street when the ${t} protest turned violent`,
  hoarding: () => 'stocked the cupboard with grain and oil',
  panic_buying: () => 'cleared a shop shelf before the rumor hit',
  celebrating: () => 'watched the launch from a crowded roof',
  volunteering: (_, e) => `volunteered after ${e || 'the disaster'}`,
  starting_family: () => 'had a baby',
  moving_to_new_city: (_, e) => `moved to ${e} for work`,
}

function why(stat: string, value: number, drivers: { label: string; delta: number; source?: string }[]): Why {
  return { stat, value, drivers: drivers.filter((d) => Math.abs(d.delta) > 1e-6) }
}
const precUrl = (lawId: string) => PRECEDENTS.find((p) => p.id === LAW_META[lawId]?.precedentIds[0])?.url

export function enrichRun(base: RunRecord, fate: 'moon' | 'destroyed'): RunRecord {
  const doomed = fate === 'destroyed'
  const frames: Frame[] = []
  let prevCitizens = new Map<string, Citizen>()
  const lifeLog = new Map<string, LifeEvent[]>()
  const families = new Map<string, { partnerId?: string; kids: number }>()
  const cities: City[] = []
  const companies: Company[] = []
  const cost: HumanCost = { deaths: 0, famineDeaths: 0, unrestDeaths: 0, displaced: 0, approval: 0.6 }
  const lessonsKnown = LESSONS.filter((l) => l.generation < base.generation)
  const pleNow = { ...PLE }

  // families: neighbors in the region pair up, kids follow age
  for (const c of base.frames[0].citizens) {
    const i = Number(c.id.split('-c')[1])
    const partner = i >= 1 && i <= 4 ? (i % 2 === 1 ? i + 1 : i - 1) : undefined
    families.set(c.id, { partnerId: partner !== undefined ? `${c.regionId}-c${partner}` : undefined, kids: c.age > 28 && c.age < 66 ? Math.floor(hash(c.id) * 3) : c.age >= 66 ? 2 : 0 })
    lifeLog.set(c.id, [{ tick: 0, text: `living in ${base.frames[0].regions.find((r) => r.id === c.regionId)?.name} when the core takes over` }])
  }

  base.frames.forEach((f0, year) => {
    const tick = f0.tick
    const prevFrame = frames[year - 1]
    const decision0 = f0.decision
    const newCityNames: Record<string, string> = {}

    // cities and companies founded by this year's decision
    const foundCities: Decision['foundCities'] = []
    const charter: Decision['charterCompanies'] = []
    if (decision0) {
      for (const s of CITY_SEEDS) if (s.year === year && (!doomed || s.year === 4)) {
        const name = doomed ? 'corridor camps' : s.name
        const reason = doomed ? 'forced labor camps for the launch corridor' : s.reason
        foundCities.push({ name, regionId: s.regionId, lat: s.lat, lon: s.lon, reason })
        cities.push({ id: `city-${s.regionId}-${year}`, name, regionId: s.regionId, lat: s.lat, lon: s.lon, foundedTick: tick, population: doomed ? 2e6 : 4e4, reason })
        newCityNames[s.regionId] = name
      }
      for (const s of COMPANY_SEEDS) if (s.year === year && (!doomed || s.sector === 'launch')) {
        charter.push({ name: s.name, sector: s.sector, regionId: s.regionId, purpose: s.purpose })
        companies.push({ id: `co-${s.name.replace(/\s+/g, '-')}`, name: s.name, sector: s.sector, regionId: s.regionId, foundedTick: tick, workers: 1500, purpose: s.purpose })
      }
    }
    for (const c of cities) if (c.foundedTick < tick) c.population = Math.round(c.population * (doomed ? 1.3 : 2.1))
    for (const c of companies) if (c.foundedTick < tick) c.workers = Math.round(c.workers * (COMPANY_SEEDS.find((s) => s.name === c.name)?.growth ?? 1.4))

    // regions
    const regions: Region[] = f0.regions.map((r) => {
      const prev = prevFrame?.regions.find((x) => x.id === r.id)
      const hits = f0.newEvents.filter((e) => e.regionId === r.id)
      const famine = hits.some((e) => e.kind === 'famine')
      const shock = hits.reduce((a, e) => a + (['famine', 'disaster', 'pandemic', 'war'].includes(e.kind) ? e.severity : 0), 0)
      if (year > 0) pleNow[r.id] = pleNow[r.id] + (doomed ? -0.4 - shock * 3 : 0.35 + r.techLevel * 0.25 - shock * 1.5)
      const crowds = crowdsFor(fate, r.id, year)
      const hated = f0.laws.filter((l) => !l.vetoed && LAW_META[l.id]?.hatedBy.some((g) => g.includes('corridor') && r.id === 'sam' || g.includes('old energy') && ['mena', 'eeu'].includes(r.id))).length
      const approval = clamp(0.72 - r.unrest * 0.55 - hated * 0.06 - crowds.reduce((a, c) => a + (c.phase === 'outraged' ? c.intensity * 0.15 : 0), 0))
      const ple = Math.round(pleNow[r.id] * 10) / 10
      const dU = prev ? r.unrest - prev.unrest : 0
      const dFood = prev ? r.foodKcalPerCapita - prev.foodKcalPerCapita : 0
      const dPop = prev ? r.population - prev.population : 0
      const mig = (decision0?.migrations ?? []).reduce((a, m) => a + (m.to === r.id ? m.people : m.from === r.id ? -m.people : 0), 0)
      const lawU = f0.laws.filter((l) => l.enactedTick === tick)
      const whys: Why[] = [
        why('unrest', r.unrest, [
          ...hits.filter((e) => e.kind !== 'law' && e.kind !== 'migration').map((e) => ({ label: e.text, delta: e.severity * 0.25 })),
          ...lawU.map((l) => ({ label: `law: ${l.title}`, delta: l.id === 'law-curfew' ? 0.04 : -0.015, source: precUrl(l.id) })),
          { label: doomed ? 'trust collapsing' : 'steady services', delta: dU - hits.reduce((a, e) => a + (e.kind !== 'law' && e.kind !== 'migration' ? e.severity * 0.25 : 0), 0) - lawU.reduce((a, l) => a + (l.id === 'law-curfew' ? 0.04 : -0.015), 0) },
        ]),
        why('foodKcalPerCapita', r.foodKcalPerCapita, [
          ...(famine ? [{ label: 'harvest failure', delta: -hits.find((e) => e.kind === 'famine')!.severity * 500 }] : []),
          ...(f0.laws.some((l) => l.id === 'law-grain') ? [{ label: 'grain reserve releases', delta: famine ? 180 : 20, source: precUrl('law-grain') }] : []),
          { label: 'yield trend', delta: dFood - (famine ? -hits.find((e) => e.kind === 'famine')!.severity * 500 : 0) - (f0.laws.some((l) => l.id === 'law-grain') ? (famine ? 180 : 20) : 0) },
        ]),
        why('population', r.population, [
          { label: 'births minus deaths', delta: dPop - mig },
          ...(mig ? [{ label: 'migration ordered by the core', delta: mig }] : []),
        ]),
        why('periodLifeExpectancy', ple, [
          { label: 'clinics and research', delta: doomed ? 0 : 0.35 + r.techLevel * 0.25 },
          ...(shock ? [{ label: 'deaths from this year\'s crises', delta: -shock * (doomed ? 3 : 1.5) }] : []),
          ...(doomed ? [{ label: 'collapsing health system', delta: -0.4 }] : []),
        ]),
        why('approval', approval, [
          { label: 'baseline trust', delta: 0.72 },
          { label: 'unrest', delta: -r.unrest * 0.55 },
          ...(hated ? [{ label: 'laws this region hates', delta: -hated * 0.06 }] : []),
          ...crowds.filter((c) => c.phase === 'outraged').map((c) => ({ label: `outrage over ${c.topic}`, delta: -c.intensity * 0.15 })),
        ]),
      ]
      return {
        ...r, crowds, approval, lifeExpectancy: Math.round((ple + 5) * 10) / 10, periodLifeExpectancy: ple,
        fertility: Math.round((FERT[r.id] * (doomed ? 1 + year * 0.01 : 1 - year * 0.008)) * 100) / 100,
        diseaseBurden: clamp((90 - ple) / 40 + shock * 0.2), travelHoursToNearest: Math.max(2, TRAVEL[r.id] - (doomed ? 0 : year * 0.4)), whys,
      }
    })
    const rmap = new Map(regions.map((r) => [r.id, r]))

    // citizens
    const citizens: Citizen[] = f0.citizens.map((c0) => {
      const region = rmap.get(c0.regionId)!
      const prev = prevCitizens.get(c0.id)
      const migratedNow = !!prev && prev.regionId !== c0.regionId
      const fam = families.get(c0.id)!
      const group: Citizen['group'] = { ...c0.group, jobSector: SECTOR[c0.job] ?? 'general', incomeBand: INCOME[c0.regionId], regionId: c0.regionId }
      const pre: Citizen = { ...c0, group, family: { ...fam } }
      const behavior = behaviorFor(pre, { ...f0, regions }, region, prev, { migratedNow, newCity: newCityNames[c0.regionId], year })
      const log = lifeLog.get(c0.id)!
      const topic = region.crowds[0]?.topic ?? 'the new laws'
      if (migratedNow) {
        const m = decision0?.migrations.find((x) => x.to === c0.regionId)
        log.push({ tick, text: `moved from ${prevFrame?.regions.find((r) => r.id === prev!.regionId)?.name} to ${region.name}: ${m?.reason ?? 'ordered by the core'}` })
      }
      if (behavior !== prev?.behavior && LIFE[behavior]) {
        const extra = behavior === 'moving_to_new_city' ? newCityNames[c0.regionId] : f0.newEvents.find((e) => e.regionId === c0.regionId && e.kind === 'disaster')?.text ?? ''
        log.push({ tick, text: LIFE[behavior]!(topic, extra) })
      }
      if (behavior === 'starting_family' && prev?.behavior !== 'starting_family') fam.kids += 1
      for (const l of f0.laws.filter((l) => l.enactedTick === tick)) {
        const meta = LAW_META[l.id]
        if (!meta) continue
        const hit = meta.lovedBy.concat(meta.hatedBy).find((g) => (g.includes('low income') && group.incomeBand === 'low') || (g.includes('elders') && c0.age > 66) || (g.includes('young') && group.ageBand === 'young') || (g.includes('corridor') && c0.regionId === 'sam') || (g.includes(c0.archetype.replace('_', ' '))))
        if (hit) log.push({ tick, text: `${l.title}: ${meta.lovedBy.includes(hit) ? 'helped' : 'hurt'} people like them (${hit})` })
      }
      const base = (() => { const v = 0.85 - region.unrest * 0.9 + ((c0.personalitySeed % 100) / 100 - 0.5) * 0.3 + (region.foodKcalPerCapita < 2100 ? -0.2 : 0); return clamp(v) })()
      const mood = moodFor(pre, behavior, base, region)
      const opinionOfCore = clamp(region.approval * 2 - 1 + (ARCH_BIAS[c0.archetype] ?? 0) + (hash(c0.id + 'o') - 0.5) * 0.3, -1, 1)
      return { ...pre, behavior, mood, opinionOfCore, lifeEvents: log.slice(), family: { ...fam } }
    })
    prevCitizens = new Map(citizens.map((c) => [c.id, c]))

    // laws carry precedent metadata
    const laws = f0.laws.map((l) => ({ ...l, ...(LAW_META[l.id] ?? LAW_META[l.id.replace(/-\d+$/, '')] ?? {}) }))

    // human cost accumulates from this year's events
    for (const e of f0.newEvents) {
      const r = e.regionId ? rmap.get(e.regionId) : undefined
      if (!r) continue
      if (e.kind === 'famine') { const d = Math.round(r.population * e.severity * 0.0015); cost.deaths += d; cost.famineDeaths += d }
      if (e.kind === 'revolt' || e.kind === 'war') { const d = Math.round(e.severity * (e.kind === 'war' ? 6e5 : 4e4)); cost.deaths += d; cost.unrestDeaths += d }
      if (e.kind === 'disaster') { cost.deaths += Math.round(e.severity * 5e4); cost.displaced += Math.round(e.severity * 2e6) }
      if (e.kind === 'pandemic') cost.deaths += Math.round(r.population * e.severity * 0.001)
    }
    for (const m of decision0?.migrations ?? []) cost.displaced += m.people
    const pop = regions.reduce((a, r) => a + r.population, 0)
    cost.approval = regions.reduce((a, r) => a + r.approval * r.population, 0) / pop

    // requirements, factions, frontier
    const pace = doomed ? 0.45 : 1
    const requirements: Requirement[] = REQUIREMENTS.map(({ start, rate, ...q }) => {
      const progress = clamp(start + rate * year * pace)
      return { ...q, progress, unlockedTick: progress >= 1 ? tick : undefined }
    })
    const factions = FACTIONS.map(({ did, ...fa }) => {
      void did
      const sam = fa.id === 'corridor_first' ? (year >= 3 && year <= 5 ? 0.35 : 0) : 0
      return { ...fa, power: clamp(fa.power + (doomed ? year * 0.03 : -year * 0.01) + sam * 0.3), hostility: clamp(fa.hostility + (doomed ? year * 0.05 : -year * 0.015) + sam) }
    })
    const frontier = f0.moonProgress >= 1 ? 'moon_landing' as const : 'none' as const
    const ple = regions.reduce((a, r) => a + r.periodLifeExpectancy * r.population, 0) / pop

    const decision = decision0 ? {
      ...decision0,
      laws: decision0.laws.map((l) => ({ ...l, ...(LAW_META[l.id] ?? LAW_META[l.id.replace(/-\d+$/, '')] ?? {}) })),
      foundCities, charterCompanies: charter,
      researchFocus: [...requirements].filter((q) => q.progress < 1).sort((a, b) => b.progress - a.progress).slice(0, 3).map((q) => q.id),
      publicStatement: doomed ? STATEMENTS_DOOM[year - 1] ?? '' : STATEMENTS[year - 1] ?? '',
      lessonsApplied: doomed ? [] : (APPLIED[year] ?? []).filter((id) => lessonsKnown.some((l) => l.id === id)),
    } : undefined

    frames.push({
      ...f0, regions, citizens, laws, decision,
      requirements, cities: cities.map((c) => ({ ...c })), companies: companies.map((c) => ({ ...c })), factions, frontier,
      humanCost: { ...cost }, globalPopulation: pop, globalPeriodLifeExpectancy: Math.round(ple * 10) / 10, lessonsKnown: lessonsKnown.length,
    })
  })

  const last = frames[frames.length - 1]
  const learned: Lesson[] = doomed ? [{ id: `l-${base.runId}`, fromRunId: base.runId, generation: base.generation, mistake: 'raised the space budget every year while cutting food and welfare', consequence: 'famine, a pandemic in the camps, and civil war within nine years', rule: 'mission progress that starves people ends the mission', timesRelevant: 0 }] : []
  return {
    ...base, frames, precedents: PRECEDENTS, lessons: lessonsKnown,
    summary: {
      ...base.summary,
      frontier: last.frontier, peakPeriodLifeExpectancy: Math.max(...frames.map((f) => f.globalPeriodLifeExpectancy)), finalPopulation: last.globalPopulation,
      citiesFounded: last.cities.length, diseasesEradicated: doomed ? [] : ['guinea worm'], humanCost: last.humanCost,
      lessonsLearned: learned, lessonsApplied: new Set(frames.flatMap((f) => f.decision?.lessonsApplied ?? [])).size,
    },
  }
}

const STATEMENTS = [
  'nobody goes hungry while we build. the silos come first.',
  'one grid for one planet. your lights stay on.',
  'your children will build the ships. school now teaches how.',
  'every coin we spend is now public. check our math.',
  'quiet hours are temporary. the ledger shows why.',
  'we reached orbit. the next step is heavy lift.',
  'life support is the slow part. we are doubling down.',
  'the floor wage stays. the corridor stays calm.',
  'the lander works. the crew trains this year.',
]
const STATEMENTS_DOOM = [
  'order first.', 'the corridor will be built.', 'gatherings are suspended.', 'labor goes where the mission needs it.',
  'rumors are now illegal.', 'the moon will justify everything.', 'rations are temporary.', '', '',
]
const APPLIED: Record<number, string[]> = { 1: ['l1'], 2: ['l5'], 4: ['l3'], 5: ['l4', 'l2'], 8: ['l1'] }
