// the occasions on screen: on the day of each first meeting, birth and funeral the scene (the same LifeWorld and
// Population code /live draws) has her at that place in her city, the people involved are there with her, and the
// narration names them. rule-only lives from a real world, so every kind of occasion comes up
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { twinRecord } from '../../../src/lib/life/run'
import { allWorlds } from '../../../src/lib/life/worlds'
import { WorldEnv } from '../../../src/lib/life/env'
import { pronouns, snapAt } from '../../../src/lib/life/facts'
import { LifeWorld } from '../../../life/components/lifeworld'
import { Population } from '../../../life/components/population'
import { cityStyle } from '../../../life/components/style'
import { narrate } from '../../../life/components/narrate'
import { K, lotFor } from '../../../life/components/plan'
import { lastDay, tickOf } from '../../../life/components/day'

test('on every occasion day she is at the right place with the people involved, and the narration names them', async () => {
  const w = allWorlds().find(x => x.current) ?? allWorlds()[0]
  if (!w) return
  const W0 = new WorldEnv(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'runs', `${w.runId}.json`), 'utf8')))
  const bad: string[] = []
  let n = 0
  for (let i = 0; i < 4; i++) {
    const r = await twinRecord(W0, 4242 + i * 7919, (['africa', 'asia', 'europe', 'south_america'] as const)[i])
    const lw = new LifeWorld(r, [])
    const end = lastDay(r)
    const p = pronouns(r)
    for (const o of lw.occasions.slice(0, 6)) {
      const hour = (o.start + o.end) / 2
      const days = o.day + hour / 24
      if (days > end) continue
      const where = lw.tick(days, hour, 'day', end)
      const { L, W } = lw
      if (!W.occasion) { bad.push(`${r.lifeId} ${o.kind}: not her city that day`); continue }
      n++
      const layout = lw.layoutOf(W.cityId)
      const lot = lotFor(layout, o.at, 'none', layout.homes[0])
      if (where.stop.lot.id !== lot.id || where.moving) bad.push(`${r.lifeId} ${o.kind} ${o.text}: she is at ${where.stop.lot.kind} (${where.moving ? 'moving' : where.stop.act}), not ${o.at}`)
      // the people involved: on screen in the same place (a baby with the grown-up holding them)
      const pop = new Population(r, layout, cityStyle((r.places.find(x => x.cityId === W.cityId) ?? r.birthplace).countryId), W.cityId)
      pop.cut()
      let bodies = pop.step(W, L, 0, 1 / 30)
      for (let f = 0; f < 40; f++) bodies = pop.step(W, L, f / 30, 1 / 30)
      for (const id of o.who) {
        if (id === o.about && o.kind === 'funeral') continue
        const b = bodies.find(x => (x as { kinId?: string }).kinId === id || x.id === id)
        if (!b) { bad.push(`${r.lifeId} ${o.kind}: ${id} not in the scene`); continue }
        const inLot = Math.abs(b.x - lot.x * K) < lot.w * K * 0.75 && Math.abs(b.z - lot.z * K) < lot.d * K * 0.75
        if (!inLot) bad.push(`${r.lifeId} ${o.text}: ${id} is at (${b.x.toFixed(1)},${b.z.toFixed(1)}), not at the ${o.at} (${(lot.x * K).toFixed(1)},${(lot.z * K).toFixed(1)}) [${(b as { note?: string }).note}]`)
      }
      // the narration says what it is and names who it is about
      const line = narrate({ once: () => true, record: r, snap: snapAt(r, tickOf(days)), prevYearSnap: null, env: null, prevEnv: null, where, hour, family: W.family, kin: W.kin, carrierId: L.carrier, exactAge: days / 365.25, presentAt: () => true, occasion: W.occasion, rain: false, tempC: 24, canBus: true, busFareShare: 0.1, she: p.she, her: p.her })
      const about = r.kin.find(k => k.id === o.about)!
      if (L.age >= 2 && !line.includes(about.name)) bad.push(`${r.lifeId} ${o.kind}: "${line}" does not name ${about.name}`)
    }
  }
  assert.ok(n >= 4, `only ${n} occasions checked`)
  assert.deepEqual(bad, [], bad.join('\n'))
})
