// every life opens from its own situation: its own birth hour, its own home, its own family, its own city. no two
// lives open on the same scene, and the opening scene is the plan the sim gives her at that hour (a newborn is with
// whoever is holding her, never at a shared breakfast table)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allLives } from './load'
import { birthHour } from '../../../src/lib/life/facts'
import { LifeWorld } from '../../../life/components/lifeworld'

test('every life opens on its own birth hour, home and family, never a shared scene', () => {
  const lives = allLives()
  const seen = new Map<string, string>()
  for (const r of lives) {
    const h = birthHour(r)
    assert.ok(h >= 0 && h < 24)
    const lw = new LifeWorld(r, [])
    const w = lw.tick(h / 24, h, 'day', Infinity)
    const fam = lw.W.family.map(f => f.id).sort().join(',')
    const key = `${h.toFixed(2)}|${r.birthplace.cityId}|${lw.W.home}|${fam}`
    assert.ok(!seen.has(key), `${r.lifeId} opens exactly like ${seen.get(key)}`)
    seen.set(key, r.lifeId)
    // a newborn's first scene: at home, with family there, not eating at a table
    assert.equal(w.stop.lot.kind, 'home', `${r.lifeId} opens at ${w.stop.lot.kind}`)
    assert.notEqual(w.stop.act, 'eat', `${r.lifeId} opens at the table`)
  }
  assert.ok(new Set(lives.map(birthHour)).size > Math.min(2, lives.length - 1), 'lives share an opening hour')
})
