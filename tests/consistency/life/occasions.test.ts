// every life event plays out on a real day, at a real place in the city she lives in that month, with the actual
// people from her record: she meets her partner with the partner there, a child is born with the baby and the other
// parent there, a funeral has the family still alive and never the one who died. checked on every recorded life and
// on rule-only lives from a real world (they have partners, children and deaths without waiting on the llm)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { allLives } from './load'
import { occasionsOf, DAYS_PER_TICK } from '../../../src/lib/life/occasions'
import { kinAt, snapAt, endTick } from '../../../src/lib/life/facts'
import { twinRecord } from '../../../src/lib/life/run'
import { allWorlds } from '../../../src/lib/life/worlds'
import { WorldEnv } from '../../../src/lib/life/env'
import type { LifeRecord } from '../../../src/lib/life/types'

function check(r: LifeRecord) {
  const occ = occasionsOf(r)
  const end = endTick(r)
  const inLife = (t: number) => t >= 0 && t <= end
  // every partner met, child born and death in the family has its day
  const want = [
    ...r.kin.filter(k => k.relation === 'partner' && k.sinceTick !== undefined && inLife(k.sinceTick)).map(k => ['met', k.id]),
    ...r.kin.filter(k => k.relation === 'child' && inLife(k.bornTick)).map(k => ['birth', k.id]),
    ...r.kin.filter(k => k.relation !== 'grandchild' && k.diedTick !== undefined && k.diedTick >= 0 && k.diedTick < end).map(k => ['funeral', k.id]),
  ]
  for (const [kind, id] of want) assert.ok(occ.some(o => o.kind === kind && o.about === id), `${r.lifeId}: no ${kind} day for ${id}`)
  const days = occ.map(o => o.day)
  assert.equal(new Set(days).size, days.length, `${r.lifeId}: two occasions on one day`)
  for (const o of occ) {
    const k = r.kin.find(x => x.id === o.about)!
    // the day is inside the month the record says, and in the city she lived in then
    assert.equal(Math.floor((o.day + 0.5) / DAYS_PER_TICK), o.tick, `${r.lifeId}: ${o.kind} day ${o.day} not in month ${o.tick}`)
    assert.equal(o.cityId, snapAt(r, o.tick).cityId, `${r.lifeId}: ${o.kind} in the wrong city`)
    assert.ok(o.start >= 6 && o.end <= 22 && o.end > o.start, `${r.lifeId}: ${o.kind} at ${o.start}-${o.end}`)
    // everyone there is alive and in her life at that moment; the one who died is not
    const alive = new Set(kinAt(r, o.tick).filter(x => x.alive).map(x => x.id))
    for (const id of o.who) assert.ok(alive.has(id) || (o.kind === 'met' && id === o.about) || (o.kind === 'birth' && id === o.about), `${r.lifeId}: ${id} at the ${o.kind} but not alive then`)
    if (o.kind === 'funeral') assert.ok(!o.who.includes(o.about), `${r.lifeId}: ${k.name} at their own funeral`)
    else assert.ok(o.who.includes(o.about), `${r.lifeId}: ${o.kind} without ${k.name}`)
    // the line names the real person
    assert.ok(o.text.includes(k.name), `${r.lifeId}: "${o.text}" does not name ${k.name}`)
    if (o.kind === 'birth') { const p = r.kin.find(x => x.relation === 'partner' && (x.sinceTick ?? 0) <= o.tick && (x.untilTick === undefined || x.untilTick > o.tick) && (x.diedTick === undefined || x.diedTick > o.tick)); if (p) assert.ok(o.who.includes(p.id), `${r.lifeId}: ${p.name} missing at ${k.name}'s birth`) }
  }
  return occ.length
}

for (const r of allLives()) test(`${r.name}'s life events each happen on a real day, in a real place, with the real people (${r.lifeId})`, () => { check(r) })

test('rule-only lives stage every partner, birth and funeral with the people involved', async () => {
  const w = allWorlds().find(x => x.current) ?? allWorlds()[0]
  if (!w) return
  const W = new WorldEnv(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'runs', `${w.runId}.json`), 'utf8')))
  let n = 0, kinds = new Set<string>()
  for (let i = 0; i < 6; i++) {
    const r = await twinRecord(W, 4242 + i * 7919, (['africa', 'asia', 'europe', 'north_america', 'south_america', 'oceania'] as const)[i % 6])
    n += check(r)
    for (const o of occasionsOf(r)) kinds.add(o.kind)
  }
  assert.ok(n > 0, 'no occasions in six lives')
  console.log(`  ${n} occasions over 6 rule-only lives: ${[...kinds].join(', ')}`)
})
