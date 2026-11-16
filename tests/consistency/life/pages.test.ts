// consistency across pages: the home card, the /live header, the family and health panels, the journal, the ending
// card, the life switcher, the telegram line and the report all say the same names, ages, dates and counts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allLives, allSummaries } from './load'
import { ageYears, childrenCount, endTick, kinAt, yearOf, lifespanLabel, firstName } from '../../../src/lib/life/facts'
import { cardView, endView, familyView, headerView, healthView, journalView, switchView } from '../../../src/lib/life/views'
import { endOfLifeLine } from '../../../src/lib/life/telegram'

const lives = allLives()
const sums = allSummaries()

for (const r of lives) {
  test(`the home page's card for ${r.name} matches the life record (${r.lifeId})`, () => {
    const s = sums.find(x => x.lifeId === r.lifeId && x.worldId === r.worldId)
    if (!s) return // (a life still being lived has no summary yet)
    assert.equal(s.name, r.name)
    assert.equal(s.deathTick, r.deathTick)
    assert.equal(s.deathAge, r.deathAge)
    assert.equal(s.birthplace.city, r.birthplace.city)
    assert.equal(s.kids, childrenCount(r), 'index kids vs record children')
    assert.equal(s.epitaph, r.epitaph)
    if (r.score) assert.equal(s.score, r.score.total)
  })

  test(`every page says the same names, ages, dates and counts for ${r.name} (${r.lifeId})`, () => {
    const end = endTick(r)
    const s = sums.find(x => x.lifeId === r.lifeId && x.worldId === r.worldId)
    // home card and switcher: name, years, age at death
    if (s) {
      const card = cardView(s)
      assert.equal(card.name, r.name)
      if (r.deathTick !== null) {
        assert.equal(card.deathAge, ageYears(r, r.deathTick), 'card age at death')
        assert.ok(card.years.startsWith(`${yearOf(0)}–${yearOf(r.deathTick)}`), `card years ${card.years}`)
        assert.equal(switchView(s).text, card.status, 'switcher vs card')
      }
    }
    // the ending card: its epitaph years, death age and children are the record's
    const ev = endView(r)
    assert.ok(ev.epitaph.includes(lifespanLabel(r)), 'end card years')
    if (r.deathTick !== null) assert.ok(ev.death!.includes(`${r.deathAge! < 1 ? '' : ageYears(r, r.deathTick)}`), `end card death "${ev.death}"`)
    if (r.epitaph) assert.equal(ev.epitaph, r.epitaph, 'end card epitaph vs stored epitaph')
    // the telegram message: same first name, same death age, same number of kids
    if (r.score && r.deathTick !== null) {
      const t = endOfLifeLine(r)
      assert.ok(t.startsWith(firstName(r)), 'telegram name')
      if (r.deathAge! >= 1) assert.ok(t.includes(`${ageYears(r, r.deathTick)}`), `telegram age in "${t.split('\n')[0]}"`)
      const kids = childrenCount(r)
      if (kids && r.deathAge! >= 16) assert.ok(t.includes(`${kids} ${kids === 1 ? 'kid' : 'kids'}`), 'telegram kids')
    }
    // at several moments of the life: the header, the family panel and the health panel agree with each other
    for (const tick of [0, 60, Math.floor(end / 2), end].filter(t => t <= end)) {
      const h = headerView(r, tick)
      assert.equal(h.age, ageYears(r, tick), `header age at ${tick}`)
      const fam = familyView(r, tick)
      const shown = fam.sections.flatMap(x => x.items)
      const ids = shown.map(i => i.id)
      assert.equal(new Set(ids).size, ids.length, `someone listed twice in the family at ${tick}`)
      const names = shown.filter(i => i.label === 'sister' || i.label === 'brother').map(i => i.name)
      assert.equal(new Set(names).size, names.length, `duplicate sibling names at ${tick}`)
      for (const i of shown) {
        const k = kinAt(r, tick).find(x => x.id === i.id)!
        assert.equal(i.age, k.age, `${i.name}'s age at ${tick}`)
        assert.ok(i.text.includes(String(i.alive ? k.age : k.ageAtDeath)), `${i.name}'s text "${i.text}"`)
        if (!i.alive) assert.ok(i.text.includes(String(k.diedYear)), `${i.name}'s death year`)
      }
      assert.equal(shown.filter(i => i.label === 'son' || i.label === 'daughter').length, kinAt(r, tick).filter(k => k.relation === 'child').length, `children count at ${tick}`)
      const hv = healthView(r, tick)
      for (const c of hv.conditions) assert.ok(c.since <= h.age, `condition ${c.what} since ${c.since}, older than ${h.age}`)
      // the journal never runs ahead of the moment, and its years are in her life
      for (const j of journalView(r, tick)) { assert.ok(j.from <= yearOf(tick)); assert.ok(j.seekTick <= Math.max(end, 6) + 12) }
    }
  })
}

// /compare: the count in the takeaway sentence is the number of marked rows
import { compareView } from '../../../src/lib/life/views'
test('the compare page counts exactly the decisions it marks as different', () => {
  for (const a of lives) for (const b of lives) {
    if (a === b) continue
    const v = compareView(a, b)
    assert.equal(v.differ, v.rows.filter(r => r.differ).length)
    assert.ok(v.rows.every(r => !r.differ || (r.a && r.b)), 'a row marked different with one side missing')
    assert.equal(new Set(v.rows.map(r => r.id)).size, v.rows.length, 'a decision listed twice')
  }
})
