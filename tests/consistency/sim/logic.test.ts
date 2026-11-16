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
