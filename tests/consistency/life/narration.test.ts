// the narration reads the scene the sim has her in and can't contradict it: where she is (home or not), whether she
// is moving, what she is doing; one voice (third person), her own pronouns, no broken grammar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allLives } from './load'
import { pronouns, snapAt } from '../../../src/lib/life/facts'
import { LifeWorld } from '../../../life/components/lifeworld'
import { narrate } from '../../../life/components/narrate'
import { DAYS_PER_TICK, tickOf } from '../../../life/components/day'

const PLACE_WORDS: Record<string, RegExp> = { home: /\bat home\b|\bhome, resting\b|\bsitting at home\b/, market: /\bthe market\b/, clinic: /\bthe clinic\b/, school: /\bschool\b|\bin class\b/ }

for (const r of allLives()) test(`the narration of ${r.name}'s days never contradicts the scene on screen (${r.lifeId})`, () => {
  const p = pronouns(r)
  const end = (r.deathTick ?? r.snaps.length - 1) * DAYS_PER_TICK
  const lw = new LifeWorld(r, [])
  const bad: string[] = []
  for (const age of [0.2, 3, 9, 16, 30, 50, 75]) {
    const day0 = Math.floor(age * 365.25)
    if (day0 > end) continue
    for (let h = 0; h < 24; h += 0.25) {
      const days = day0 + h / 24
      const w = lw.tick(days, h, 'day', end)
      const snap = snapAt(r, tickOf(days))
      const line = narrate({ once: () => true, record: r, snap, prevYearSnap: null, env: null, prevEnv: null, where: w, hour: h, family: lw.W.family, kin: lw.W.kin, carrierId: lw.L.carrier, exactAge: days / 365.25, presentAt: () => false, rain: false, tempC: 24, canBus: true, busFareShare: 0.1, she: p.she, her: p.her })
      const at = `${r.lifeId} age ${age} ${h.toFixed(2)}h [${w.moving ? 'moving' : w.stop.act}@${w.stop.lot.kind}]: "${line}"`
      // one voice
      if (/\b(i|i'm|my|me|we|our)\b/i.test(line)) bad.push(`first person: ${at}`)
      // her pronouns about herself and her family
      if (p.she === 'he' && /\bher (mom|dad|sister|brother|husband|wife|partner|son|daughter|own)\b/.test(line)) bad.push(`wrong pronoun: ${at}`)
      if (p.she === 'she' && /\bhis (mom|dad|sister|brother|son|daughter|own)\b/.test(line)) bad.push(`wrong pronoun: ${at}`)
      // where she is
      if (!w.leg) for (const [kind, re] of Object.entries(PLACE_WORDS)) if (kind !== w.stop.lot.kind && re.test(line) && !(kind === 'home' && /walking home/.test(line))) bad.push(`says ${kind}: ${at}`)
      if (!w.leg && /\bwalking\b|on the bus|waiting for the bus/.test(line)) bad.push(`says moving while still: ${at}`)
      if (w.moving && w.leg && !/walking|bus|on the way/.test(line) && age >= 2) bad.push(`moving, line says otherwise: ${at}`)
      // grammar: no raw ids, no doubled words, no "chose play"
      if (/\b(\w+) \1\b/i.test(line) || /\bchose [a-z_]+\b(?! to)/.test(line) || /_/.test(line) || /undefined|null|NaN/.test(line)) bad.push(`grammar: ${at}`)
    }
  }
  assert.equal(bad.length, 0, `${bad.length} narration lines contradict the scene:\n${[...new Set(bad)].slice(0, 12).join('\n')}`)
})
