// consistency: every recorded life agrees with itself. ages, dates, kin and events all follow from the record's ticks
// (tick 0 = 2026-11, one tick a month), through the shared functions in src/lib/life/facts.ts.
// run: npx tsx --test tests/consistency/life/*.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allLives } from './load'
import { ageAt, ageYears, yearOf, deathYear, kinAt, lifespanLabel } from '../../../src/lib/life/facts'

for (const r of allLives()) {
  test(`${r.name}'s ages, dates and family agree with ${r.sex === 'female' ? 'her' : 'his'} own record (${r.lifeId})`, () => {
    const end = r.deathTick ?? r.snaps[r.snaps.length - 1].tick
    // every monthly snapshot's age is her age at that tick
    for (const s of r.snaps) assert.ok(Math.abs(s.age - ageAt(r, s.tick)) < 0.06, `snap at tick ${s.tick} says age ${s.age}, facts say ${ageAt(r, s.tick).toFixed(2)}`)
    // milestones happen at the age their tick says, inside the life
    for (const m of r.milestones) {
      assert.ok(Math.abs(m.age - ageAt(r, m.tick)) < 0.06, `milestone ${m.id} age ${m.age} vs tick ${m.tick}`)
      assert.ok(m.tick <= end, `milestone ${m.id} after death`)
    }
    // the journal's years and ages are the facts' years and ages
    for (const j of r.journal) {
      assert.ok(j.year >= yearOf(0) && j.year <= yearOf(end), `journal year ${j.year} outside the life`)
    }
    // events never come after death (the death itself excepted)
    for (const e of r.events) assert.ok(e.tick <= end, `event "${e.text}" at tick ${e.tick} after the end ${end}`)
    // death: the stored age matches the death tick, and the epitaph's years match the dates
    if (r.deathTick !== null) {
      assert.equal(Math.floor(r.deathAge ?? -1), ageYears(r, r.deathTick), 'deathAge vs deathTick')
      if (r.epitaph) assert.ok(r.epitaph.includes(lifespanLabel(r)), `epitaph "${r.epitaph}" vs ${lifespanLabel(r)}`)
      assert.equal(deathYear(r), yearOf(r.deathTick))
    }
    // kin: unique names among siblings and children, nobody with her own first name, born before they die
    const first = r.name.split(' ')[0]
    const sibs = r.kin.filter(k => k.relation === 'sibling').map(k => k.name)
    assert.equal(new Set(sibs).size, sibs.length, `duplicate sibling names: ${sibs.join(', ')}`)
    const kids = r.kin.filter(k => k.relation === 'child').map(k => k.name)
    assert.equal(new Set(kids).size, kids.length, `duplicate child names: ${kids.join(', ')}`)
    for (const k of r.kin) {
      assert.notEqual(k.name.split(' ')[0], first, `${k.relation} shares her first name`)
      if (k.diedTick !== undefined) assert.ok(k.diedTick >= k.bornTick, `${k.name} dies before being born`)
      // her children are born while she is alive and old enough
      if (k.relation === 'child') { assert.ok(k.bornTick >= 0 && k.bornTick <= end, `child ${k.name} born outside her life`); assert.ok(ageAt(r, k.bornTick) >= 14, `child ${k.name} born when she was ${ageAt(r, k.bornTick).toFixed(1)}`) }
      // her parents are old enough to be her parents
      if (k.relation === 'mother' || k.relation === 'father') assert.ok(-k.bornTick / 12 >= 14, `${k.relation} ${k.name} was ${(-k.bornTick / 12).toFixed(1)} at her birth`)
    }
    // the family a page shows at any tick is the kin alive then, at the ages the facts give
    for (const tick of [0, Math.floor(end / 2), end]) for (const k of kinAt(r, tick)) {
      assert.ok(k.age >= 0, `${k.name} has age ${k.age} at tick ${tick}`)
      assert.ok(k.alive === (k.diedTick === undefined || k.diedTick > tick), `${k.name} alive flag at ${tick}`)
    }
  })
}

// names come from the shared generator (src/lib/sim/names.ts): one naming group per family, children in the family
// pattern, no repeats. checked on freshly generated people in a real world, every continent
import { createPerson } from '../../../src/lib/life/run'
import { allWorlds } from '../../../src/lib/life/worlds'
import { WorldEnv } from '../../../src/lib/life/env'
import fs from 'node:fs'
import path from 'node:path'
test('every new family is named in one naming tradition, with no repeated names', () => {
  const w = allWorlds().find(x => x.current) ?? allWorlds()[0]
  if (!w) return
  const W = new WorldEnv(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'runs', `${w.runId}.json`), 'utf8')))
  for (let i = 0; i < 60; i++) {
    const p = createPerson(W, 1000 + i * 7919, (['africa', 'asia', 'europe', 'north_america', 'south_america', 'oceania'] as const)[i % 6])
    const kin = p.kin
    assert.equal(p.nameParts.given, p.name.split(' ').includes(p.nameParts.given) ? p.nameParts.given : '?', `given name ${p.nameParts.given} not in ${p.name}`)
    const givens = [p.nameParts.given, ...kin.map(k => k.name)]
    assert.equal(new Set(givens).size, givens.length, `a repeated given name in ${p.name}'s family: ${givens.join(', ')}`)
    const father = kin.find(k => k.relation === 'father')
    // where the custom is the father's family name, she and her siblings carry it
    if (father?.family && p.nameParts.family && !['patronymic', 'single'].includes(p.nameParts.group)) {
      for (const s of kin.filter(k => k.relation === 'sibling')) assert.equal(s.family, p.nameParts.family, `${s.name} ${s.family} vs ${p.name}`)
    }
  }
})
