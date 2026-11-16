// a decision on the site is said in the narrator's voice (third person, her own reason in quotes), and never calls
// someone in her family by the wrong relation, even when the llm's reason did
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allLives } from './load'
import { captionOf, firstName, honestAbout, yearOf } from '../../../src/lib/life/facts'

for (const r of allLives()) test(`${r.name}'s decisions are told in one voice and name the family right (${r.lifeId})`, () => {
  for (const m of r.milestones) {
    const c = captionOf(r, m)
    assert.ok(c.startsWith(`${yearOf(m.tick)} · `), `"${c}" does not start with its year`)
    const outside = c.replace(/"[^"]*"/g, '')
    assert.ok(!/\b(i|my|me|i'm|i'll)\b/.test(outside), `first person outside quotes: "${c}"`)
    if (m.decider === 'self' && !/the family chose/.test(c)) assert.ok(c.includes(`${firstName(r)} chose`) || c.includes('chose') === false, `no subject: "${c}"`)
    assert.doesNotThrow(() => honestAbout(r, c), `wrong relation in "${c}"`)
  }
})

test('a reason that gets the family wrong is left out', () => {
  const r = { name: 'jabari diallo', given: 'jabari', kin: [{ id: 'mother', name: 'halima', relation: 'mother', sex: 'female', bornTick: -300, bond: 1 }] } as never
  assert.throws(() => honestAbout(r, 'halima has been my neighbor for years'))
  assert.doesNotThrow(() => honestAbout(r, 'my mother halima needs me'))
  const m = { tick: 660, caption: '2081 · aging parents. chose take them in, halima has been my neighbor for years', reasoning: 'halima has been my neighbor for years', decider: 'self' } as never
  assert.equal(captionOf(r, m), '2081 · aging parents. jabari chose take them in')
})
