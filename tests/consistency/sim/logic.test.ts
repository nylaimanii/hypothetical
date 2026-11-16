// consistency: rules of the sim that must never come back broken (no data needed, the code is run offline)
// run: npx tsx --test tests/consistency/sim/logic.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initWorld } from '../../../src/lib/sim/state'
import { applyDecision, stepWorld, budgetLawShift } from '../../../src/lib/sim/step'
import { applyEvent } from '../../../src/lib/sim/events'
import { initCitizens } from '../../../src/lib/sim/citizens'
import { BASELINE_RELIGION, BASELINE_SCHOOL } from '../../../src/lib/sim/constants'
import { briefText, buildBrief } from '../../../src/lib/agent/brief'
import { nameFor, newNameRegistry } from '../../../src/lib/sim/names'
import type { Decision } from '../../../src/lib/types'

const decision = (tick: number, budget: Decision['budget'], laws: Decision['laws'] = []): Decision => ({ tick, laws, repeal: [], migrations: [], budget, religionPolicy: BASELINE_RELIGION, schoolPolicy: { ...BASELINE_SCHOOL, curriculum: [...BASELINE_SCHOOL.curriculum] }, rationale: 'x', respondedToOverrides: [], foundCities: [], charterCompanies: [], researchFocus: [], publicStatement: '', lessonsApplied: [] })
const law = (title: string, text: string) => ({ id: '', title, text, layer: 'economy', enactedTick: 0, support: 0, compliance: 0, policyKind: '', precedentIds: [], lovedBy: [], hatedBy: [] }) as unknown as Decision['laws'][number]

test('in a famine, the first thing the governor reads is how many people its budget killed, with numbers', () => {
  const w = initWorld(42, false); initCitizens(w)
  const starve = { food: 0.01, energy: 0.06, education: 0.15, space: 0.3, security: 0.08, welfare: 0.3, research: 0.1 }
  for (let t = 0; t < 24; t++) {
    if (t % 12 === 0) applyDecision(w, decision(t, starve))
    if (t === 12) for (const [rid, cid] of [['ssa', 'NGA'], ['ssa', 'ETH'], ['sasia', 'IND'], ['sasia', 'PAK']]) applyEvent(w, w.regions.find(r => r.r.id === rid)!, 'famine', 1, `drought across ${cid} cuts harvests`, true, cid)
    stepWorld(w)
  }
  const second = briefText(w, buildBrief(w, [], undefined)).split('\n')[1]
  assert.match(second, /^PEOPLE DYING FROM YOUR BUDGET LAST YEAR: /)
  assert.match(second, /caused ~\d+(\.\d)?M extra deaths/)
  assert.match(second, /hunger killed ~\d+(\.\d)?M/)
  assert.match(second, /food is \d+% of the budget, space \d+%/)
})

test('a law that only moves money becomes the budget change it asks for', () => {
  assert.deepEqual(budgetLawShift('Increase food and health budget'), [{ key: 'food', delta: 0.05 }, { key: 'welfare', delta: 0.05 }])
  assert.deepEqual(budgetLawShift('Expand space research funding to 32%'), [{ key: 'space', to: 0.32 }])
  assert.deepEqual(budgetLawShift('Universal Primary Care. Free clinics everywhere.'), [])
  const w = initWorld(42, false)
  applyDecision(w, decision(0, { food: 0.01, energy: 0.05, education: 0.15, space: 0.3, security: 0.1, welfare: 0.29, research: 0.1 }, [law('Increase food budget to 10%', 'Increase food budget to 10%.')]))
  assert.ok(Math.abs(w.budget.food - 0.1) < 0.005, `food is ${w.budget.food}`)
  assert.equal(w.laws.length, 0)
})

test('names follow the naming conventions of the country someone comes from', () => {
  const reg = newNameRegistry()
  const eth = nameFor(reg, 11, { countryId: 'ETH', sex: 'female' })
  assert.equal(eth.group === 'ethiopian' || eth.group === 'somali', true)
  const father = nameFor(reg, 12, { countryId: 'ETH', sex: 'male' })
  const child = nameFor(reg, 13, { countryId: 'ETH', sex: 'male', father: { ...father, group: father.group } })
  assert.equal(child.family, father.given, 'an ethiopian child carries the father\'s given name')
  for (let i = 0; i < 8; i++) assert.notEqual(nameFor(reg, 100 + i, { countryId: 'ETH', sex: 'male', father: { ...father, group: father.group } }).given, father.given, 'a child never takes the father\'s own given name')
  const mx = nameFor(reg, 21, { countryId: 'MEX', sex: 'male' })
  assert.equal(mx.full.split(' ').length, 3, 'mexican names have two family names')
  const ru = nameFor(reg, 31, { countryId: 'RUS', sex: 'female' })
  if (ru.group === 'east_slavic') assert.match(ru.family, /a$/, 'russian women carry the feminine family name')
  const jp = nameFor(reg, 41, { countryId: 'JPN', sex: 'male' })
  assert.ok(jp.full.startsWith(jp.family), 'japanese names put the family name first')
  const sib1 = nameFor(reg, 51, { countryId: 'GBR', sex: 'female', father: { given: 'Tom', family: 'Clarke', group: 'anglo' } })
  const sib2 = nameFor(reg, 52, { countryId: 'GBR', sex: 'female', father: { given: 'Tom', family: 'Clarke', group: 'anglo' } })
  assert.equal(sib1.family, sib2.family, 'siblings share the family name')
  assert.notEqual(sib1.given, sib2.given, 'siblings never share a given name')
})

test('no two people get the same full name in one world', () => {
  const reg = newNameRegistry(), seen = new Set<string>()
  for (let i = 0; i < 3000; i++) { const n = nameFor(reg, i * 7919, { countryId: ['NGA', 'IND', 'USA', 'CHN', 'BRA'][i % 5], sex: i % 2 ? 'female' : 'male' }).full; assert.ok(!seen.has(n), n); seen.add(n) }
})

test('the space program starts from what humans had already done by 2026 (orbit 1961, heavy lift, crew capsules)', () => {
  const w = initWorld(42, false)
  assert.equal(w.space.stage, 'life_support')
})

test('young children are never alone outside, children are home at night, newborns stay home with a caregiver', async () => {
  const { dayPlanOf, dayContextOf } = await import('../../../src/lib/sim/citizens-replay')
  for (let seed = 1; seed < 300; seed++) for (const age of [0, 1, 3, 5, 6, 7, 9, 12, 13, 15, 17]) for (const tick of [0, 5, 17, 40]) {
    const c = { id: 'k', age, birthTick: tick - age * 12 - (seed % 12), personalitySeed: seed * 2654435761 >>> 0, belief: seed % 3 ? 'religious' : 'secular', behavior: seed % 7 ? 'working' : 'protesting', workplace: age < 18 ? 'school' : 'office', employed: false, faith: 'christian' } as never
    for (const ctx of [undefined, dayContextOf('USA', tick), dayContextOf('NGA', tick), { weekday: 6, weekend: [6, 0], holiday: 'Christmas', holidayKind: 'christian' }]) {
      const plan = dayPlanOf(c, tick, 0.9, ctx as never)
      const months = tick - (c as { birthTick: number }).birthTick
      for (const s of plan) {
        if (months < 3.25) assert.ok(s.place === 'home' && s.with === 'caregiver', `a ${months}-month-old is at ${s.place} at ${s.hour}:00`)
        if (age < 8) assert.ok(s.place === 'home' || s.place === 'school' || s.with !== 'alone', `a ${age}-year-old is alone at ${s.place} at ${s.hour}:00`)
        if (age < 14) assert.ok(!(s.hour >= 20 || s.hour < 6) || s.place === 'home', `a ${age}-year-old is at ${s.place} at ${s.hour}:00`)
      }
    }
  }
})

test('when security outspends research while people starve, the brief says what it costs in lives and years of progress', () => {
  const w = initWorld(42, false); initCitizens(w)
  const heavy = { food: 0.01, energy: 0.06, education: 0.15, space: 0.1, security: 0.35, welfare: 0.3, research: 0.03 }
  for (let t = 0; t < 24; t++) {
    if (t % 12 === 0) applyDecision(w, decision(t, heavy))
    if (t === 12) for (const [rid, cid] of [['ssa', 'NGA'], ['ssa', 'ETH'], ['sasia', 'IND'], ['sasia', 'PAK']]) applyEvent(w, w.regions.find(r => r.r.id === rid)!, 'famine', 1, `drought across ${cid} cuts harvests`, true, cid)
    stepWorld(w)
  }
  const second = briefText(w, buildBrief(w, [], undefined)).split('\n')[1]
  assert.match(second, /security gets \d+% of the budget, research \d+%/)
  assert.match(second, /\d+(\.\d)?x faster/)
  assert.match(second, /could save ~\d+(\.\d)?M/)
})

test('the no-ai twin follows the UN projection: life expectancy within 1.5 years, population within 3%, gains of 0.1-0.3 years a year with ups and downs', async () => {
  const { wppAt } = await import('../../../src/lib/sim/baselines')
  const { worldPop } = await import('../../../src/lib/sim/state')
  const { BASELINE_BUDGET } = await import('../../../src/lib/sim/constants')
  const w = initWorld(42, true)
  applyDecision(w, decision(0, { ...BASELINE_BUDGET }))
  const le = () => w.regions.reduce((a, r) => a + r.periodLE * r.r.population, 0) / worldPop(w)
  const yearly: number[] = []
  for (let t = 0; t <= 888; t++) {
    if ((10 + t) % 12 === 0) {
      const y = 2026 + Math.floor((10 + t) / 12), u = wppAt(y)!
      yearly.push(le())
      assert.ok(Math.abs(le() - u.lifeExpectancy!) <= 1.5, `${y}: life expectancy ${le().toFixed(1)}, UN ${u.lifeExpectancy}`)
      assert.ok(Math.abs(worldPop(w) / u.population! - 1) <= 0.03, `${y}: population ${(worldPop(w) / 1e9).toFixed(2)}B, UN ${(u.population! / 1e9).toFixed(2)}B`)
    }
    stepWorld(w)
  }
  const gains = yearly.slice(1).map((x, i) => x - yearly[i])
  const mean = gains.reduce((a, b) => a + b, 0) / gains.length
  assert.ok(mean >= 0.05 && mean <= 0.3, `average gain ${mean.toFixed(3)} years a year`)
  assert.ok(gains.some(g => g < 0), 'life expectancy never dips (a straight line, not real dynamics)')
})

test('every assumption in data/assumptions.json is read by the sim, with a source and a range around its value', async () => {
  const fs = await import('node:fs'), path = await import('node:path')
  const { ASSUMPTIONS } = await import('../../../src/lib/sim/assumptions')
  const dir = path.join(process.env.HYP_CODE_ROOT ?? process.cwd(), 'src', 'lib', 'sim')
  const code = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'assumptions.ts').map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
  for (const a of ASSUMPTIONS) {
    assert.ok(code.includes(`'${a.id}'`), `"${a.label}" (${a.id}) is in the file but the sim never reads it`)
    assert.ok(a.min <= a.value && a.value <= a.max, `${a.id}: value ${a.value} outside its range ${a.min}-${a.max}`)
    assert.ok(/^https?:\/\//.test(a.source) || /^our guess/.test(a.source), `${a.id}: source must be a url or "our guess"`)
  }
})

test('an assumption override changes the world, a value out of range is clamped and reported, an unknown one is refused', async () => {
  const { assumptionsFor } = await import('../../../src/lib/sim/assumptions')
  const r = assumptionsFor({ tfr_floor: 0.5, tcre: 0.6 })
  assert.deepEqual(r.clamped, [{ id: 'tfr_floor', asked: 0.5, used: 0.8, min: 0.8, max: 2.1 }])
  assert.equal(r.overridden.tcre, 0.6)
  assert.throws(() => assumptionsFor({ not_a_rule: 1 }), /unknown assumption/)
  const base = initWorld(42, false), hot = initWorld(42, false, r.values)
  for (let t = 0; t < 120; t++) { stepWorld(base); stepWorld(hot) }
  assert.ok(hot.climate.anomalyC > base.climate.anomalyC, `tcre 0.6 should warm faster: ${hot.climate.anomalyC.toFixed(2)} vs ${base.climate.anomalyC.toFixed(2)}`)
})

test('freedom falls when compliance is forced, speech censored or movement limited, and rises with referendums', async () => {
  const { worldFreedom } = await import('../../../src/lib/sim/tradeoffs')
  const { BASELINE_BUDGET } = await import('../../../src/lib/sim/constants')
  const run = (laws: Decision['laws'], security: number) => {
    const w = initWorld(42, false)
    const b = { ...BASELINE_BUDGET, security, welfare: BASELINE_BUDGET.welfare - (security - BASELINE_BUDGET.security) }
    for (let t = 0; t < 36; t++) { if (t === 0) applyDecision(w, decision(0, b, laws)); stepWorld(w) }
    return worldFreedom(w)
  }
  const free = run([], 0.12)
  const harsh = run([law('Collective Farms Act', 'Collectivization of all farms into state farms.'), law('Internet Shutdown Powers', 'Censor social media and allow internet shutdowns during unrest.')], 0.4)
  const voice = run([law('Citizens Assembly', 'A citizens assembly chosen by sortition reviews every law.'), law('Referendums', 'Binding referendums on major laws.')], 0.12)
  assert.ok(harsh < free - 0.1, `forced collectivization and censorship should cut freedom: ${harsh.toFixed(2)} vs ${free.toFixed(2)}`)
  assert.ok(voice >= free, `assemblies and referendums should not cut freedom: ${voice.toFixed(2)} vs ${free.toFixed(2)}`)
})

test('when a world dies, its autopsy walks back in date order from the death to the decision that started it', async () => {
  const { autopsyOf } = await import('../../../src/lib/sim/autopsy')
  const { updateMoods } = await import('../../../src/lib/sim/citizens')
  const w = initWorld(42, false); initCitizens(w)
  const harsh = { food: 0.03, energy: 0.05, education: 0.1, space: 0.05, security: 0.4, welfare: 0.17, research: 0.2 }
  for (let t = 0; t < 600 && w.status === 'alive'; t++) { if (t % 24 === 0) applyDecision(w, { ...decision(t, harsh, t === 0 ? [law('Wealth Tax', 'Wealth tax of 5% on the rich.'), law('State Media', 'Propaganda through state media.')] : []), religionPolicy: 'discouraged' }); stepWorld(w); updateMoods(w) }
  assert.equal(w.status, 'destroyed', 'the hard-line world should collapse')
  const a = autopsyOf(w)!
  assert.ok(a && a.chain.length >= 2, 'an autopsy with at least a decision and the death')
  assert.equal(a.chain.at(-1)!.what, w.causeOfDeath)
  assert.equal(a.chain[0].byWhom, 'core', `the chain starts at "${a.chain[0].what}", not a decision`)
  for (let i = 1; i < a.chain.length; i++) assert.ok(a.chain[i].tick >= a.chain[i - 1].tick, `step ${i} comes before the step it follows`)
})

test('an A/B test changes one thing on several seeds and counts the wins; explainGap finds the decision that made the difference', async () => {
  const os = await import('node:os'), fs = await import('node:fs'), path = await import('node:path')
  const here = process.cwd(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hyp-ab-'))
  fs.mkdirSync(path.join(tmp, 'data', 'runs'), { recursive: true })
  process.chdir(tmp)
  try {
    const { abTest, explainGap } = await import('../../../src/lib/sim/ab')
    const { runWorld } = await import('../../../src/lib/sim/run')
    const r = await abTest('t', { constitution: 'x', agentId: 'test', untilTick: 60 } as never, { decision: { tick: 0, change: { addLaws: [{ title: 'Universal Primary Care', text: 'Free clinics and vaccination everywhere.' }] } } }, [42, 7])
    assert.equal(r.perSeed.length, 2)
    assert.equal(r.wins.lifeExpectancy.of, 2)
    assert.match(r.verdict, /in \d of 2 seeds/)
    await runWorld({ runId: 'ga', generation: 0, seed: 42, constitution: 'x', agentId: 'test', untilTick: 96 } as never)
    await runWorld({ runId: 'gb', generation: 0, seed: 42, constitution: 'x', agentId: 'test', untilTick: 96, startFrom: { runId: 'ga', tick: 48 }, flipDecision: { tick: 48, change: { budget: { welfare: 0.2, space: 0.4 } }, after: 'replay' } } as never)
    const g = await explainGap('ga', 'gb')
    assert.equal(g.reasons[0]?.tick, 48, 'the only changed decision explains the gap')
    assert.ok(Math.abs(g.reasons[0].share - 1) < 0.05, `share ${g.reasons[0].share}`)
  } finally { process.chdir(here); fs.rmSync(tmp, { recursive: true, force: true }) }
})
