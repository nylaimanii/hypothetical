// consistency: the sim records agree with themselves. every number, name, age and date a page shows comes from these
// records through src/lib/sim/truth.ts, so these checks are what every page inherits.
// run: npx tsx --test tests/consistency/sim/*.test.ts (reads data/runs; HYP_CONSISTENCY_RUNS picks the worlds)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadLives, loadWorld, worldIds } from './load'
import fs from 'node:fs'
import path from 'node:path'
import { ageAt, monthOfTick, populationAt, pyramidAt, FRONTIER_LABELS } from '../../../src/lib/sim/truth'
import { citizensAt } from '../../../src/lib/sim/citizens-replay'

type P = { id: string; name: string; givenName?: string; familyName?: string; birthTick?: number; age: number; cityId?: string; countryId?: string; family?: { partnerId?: string } }

// records from before sim 5.8.0 (no simVersion) predate the shared population sum: that check skips them
const atLeast = (v: string | undefined, min: string) => { if (!v) return false; const a = v.split('.').map(Number), b = min.split('.').map(Number); for (let k = 0; k < 3; k++) { if ((a[k] ?? 0) !== (b[k] ?? 0)) return (a[k] ?? 0) > (b[k] ?? 0) } return true }
for (const id of worldIds()) {
  const r = loadWorld(id)
  if (!r) continue
  const version = (r as { simVersion?: string }).simVersion
  const keyTicks = r.frames.filter(f => (f as { citizenKeyframe?: boolean }).citizenKeyframe).map(f => f.tick)

  test(`${id}: the regions add up to the world population in every frame`, { skip: atLeast(version, '5.8.0') ? false : 'made by a sim older than 5.8.0' }, () => {
    for (const f of r.frames) assert.equal(populationAt(r, f.tick), Math.round(f.globalPopulation), `${f.date}: regions sum to ${populationAt(r, f.tick)}, the headline says ${f.globalPopulation}`)
  })

  // a frame is written before its month runs, so it carries events from the previous frame's tick up to its own
  test(`${id}: every event is dated on its own month, inside the frame that carries it`, () => {
    let prev = -Infinity
    const months = new Set<number>()
    let n = 0
    for (const f of [...r.frames].sort((a, b) => a.tick - b.tick)) {
      for (const e of f.newEvents) {
        assert.ok(e.tick <= f.tick && e.tick >= prev, `"${e.text.slice(0, 60)}" at tick ${e.tick} sits in the ${f.date} frame`)
        months.add(monthOfTick(e.tick)); n++
      }
      prev = f.tick
    }
    if (n >= 100) assert.ok(months.size >= 8, `${n} events fall in only ${months.size} months of the year`)
  })

  test(`${id}: everyone in a world has their own full name, and no family repeats a given name`, () => {
    for (const t of keyTicks) {
      const people = citizensAt(r, t) as unknown as P[]
      if (!people.some(p => p.familyName !== undefined)) return // records from before shared names
      const full = new Map<string, string>()
      for (const p of people) { assert.ok(!full.has(p.name), `two people named ${p.name} at tick ${t}`); full.set(p.name, p.id) }
      const fam = new Map<string, Set<string>>()
      for (const p of people) if (p.familyName) { const s = fam.get(p.familyName) ?? new Set(); assert.ok(!s.has(p.givenName!), `two ${p.givenName} ${p.familyName} at tick ${t}`); s.add(p.givenName!); fam.set(p.familyName, s) }
    }
  })

  test(`${id}: partners live in the same city of the same world`, () => {
    for (const t of keyTicks) {
      const people = citizensAt(r, t) as unknown as P[]
      if (!people.some(p => p.birthTick !== undefined)) return
      const byId = new Map(people.map(p => [p.id, p]))
      for (const p of people) { const q = p.family?.partnerId ? byId.get(p.family.partnerId) : undefined; if (q) assert.equal(q.cityId ?? q.countryId, p.cityId ?? p.countryId, `${p.name} and partner ${q.name} live apart at tick ${t}`) }
    }
  })

  test(`${id}: every age follows from the stored birth date`, () => {
    for (const t of keyTicks) for (const p of citizensAt(r, t) as unknown as P[]) if (p.birthTick !== undefined) assert.equal(p.age, ageAt(p.birthTick, t), `${p.name} is ${p.age} at tick ${t} but was born at tick ${p.birthTick}`)
  })

  test(`${id}: each death is stored once, and its age matches its dates`, () => {
    const lives = loadLives(id)
    if (!lives) return
    for (const [pid, l] of Object.entries(lives.lives)) {
      if (!l.death) continue
      const said = l.events.filter(e => /^died at /.test(e.text))
      assert.equal(said.length, 1, `${l.name} (${pid}) dies ${said.length} times`)
      assert.equal(said[0].text, `died at ${l.death.ageAtDeath}`, `${l.name}: the event and the stored age disagree`)
      if (l.birthTick !== undefined) assert.equal(l.death.ageAtDeath, ageAt(l.birthTick, l.death.tick), `${l.name}: age at death vs birth and death dates`)
    }
  })

  test(`${id}: a technology is called proven only when it is deployed at scale`, () => {
    for (const f of r.frames) for (const q of f.requirements as ({ tier?: string; progress: number; tier2026?: string })[]) if (q.tier2026 !== undefined && q.tier === 'proven') assert.ok(q.progress >= 0.9, `${(q as { name?: string }).name ?? ''} is proven at ${Math.round(q.progress * 100)}% in ${f.date}`)
  })

  test(`${id}: no milestone claims a first that humans had already achieved by 2026`, { skip: atLeast(version, '5.8.1') ? false : 'made by a sim older than 5.8.1' }, () => {
    for (const f of r.frames) for (const e of f.newEvents) assert.ok(!/orbital launcher|heavy lift rocket|crew capsule and life support/.test(e.text), `${e.text.slice(0, 80)} (${f.date}): that was done before 2026`)
  })

  test(`${id}: the frontier shown is the record's frontier, in one wording`, () => {
    for (const f of r.frames) assert.ok(FRONTIER_LABELS[f.frontier] !== undefined, `frontier "${f.frontier}" has no shared label`)
  })

  test(`${id}: its no-ai twin shares the seed, the regions and the calendar`, () => {
    const f = path.join(process.cwd(), 'data', 'runs', `${id}.twin.json`)
    if (!fs.existsSync(f)) return
    const t = JSON.parse(fs.readFileSync(f, 'utf8'))
    assert.equal(t.seed, r.seed, 'twin seed')
    assert.equal(t.twinOf, id)
    assert.deepEqual(t.frames[0].regions.map((x: { id: string }) => x.id), r.frames[0].regions.map(x => x.id), 'twin regions')
    for (const fr of t.frames) for (const e of fr.newEvents) assert.ok(e.tick <= fr.tick, `twin event "${e.text.slice(0, 50)}" dated after its frame`)
  })

  test(`${id}: each region's age pyramid adds up to its population`, () => {
    for (const f of r.frames) for (const reg of f.regions as ({ id: string; population: number; ageBands?: number[] })[]) {
      if (!reg.ageBands) continue
      const sum = pyramidAt(r, f.tick, reg.id).reduce((a, b) => a + b.people, 0)
      assert.ok(Math.abs(sum - reg.population) <= Math.max(20, reg.population * 1e-6), `${reg.id} ${f.date}: pyramid ${sum} vs population ${reg.population}`)
    }
  })
}
