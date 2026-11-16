// consistency (C): what reports, autopsies, the real-baseline line and the death telegram say about a world must be
// what its record says, read through b's shared readers (truth.ts). every check is named as a plain sentence and
// fails with the two values that disagree.
// worlds: HYP_CONSISTENCY_RUNS (comma list), else the newest 3 real worlds with a record
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { RunRecord } from '../../../src/lib/types'
import { readRunIndex, readRunRecord } from '../../../src/lib/evolve/store'
import { worldReport } from '../../../src/lib/evolve/report'
import { autopsy, realBaseline } from '../../../src/lib/evolve/evidence'
import { deathStory } from '../../../src/lib/notify/story'
import { dateOfTick, populationAt, yearOfTick } from '../../../src/lib/sim/replay-pure'

function worlds(): RunRecord[] {
  const env = (process.env.HYP_CONSISTENCY_RUNS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const ids = env.length ? env : readRunIndex().map(r => r.runId).reverse()
  const out: RunRecord[] = []
  for (const id of ids) { const r = readRunRecord(id); if (r?.frames?.length) out.push(r); if (!env.length && out.length >= 3) break }
  return out
}
const last = (r: RunRecord) => r.frames.reduce((a, f) => (f.tick > a.tick ? f : a))
// records before sim 5.8.0 carry a known population bug (headline vs sum of regions), fixed from 5.8.0
const versionAtLeast = (v: string | undefined, min: string) => { if (!v) return false; const a = v.split('.').map(Number), b = min.split('.').map(Number); if (a.some(isNaN)) return false; for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); return true }
const versionOf = (r: RunRecord) => (r as RunRecord & { simVersion?: string }).simVersion ?? readRunIndex().find(x => x.runId === r.runId)?.simVersion
const un = () => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'real', 'un-wpp-2024.json'), 'utf8')) as { population: { byYear: Record<string, number> }; lifeExpectancy: { byYear: Record<string, number> } }

const recs = worlds()

test('there are real worlds to check the reports against', { skip: recs.length ? false : 'no world records on this machine yet' }, () => {
  assert.ok(recs.length > 0)
})

for (const rec of recs) {
  test(`every date in the report on ${rec.runId} is the date of the tick it cites`, () => {
    const rep = worldReport(rec)
    for (const s of rep.sections) for (const c of s.claims) for (const r of c.refs) {
      if (r.tick === undefined || !r.date) continue
      assert.equal(r.date, dateOfTick(r.tick), `the report on ${rec.runId} says "${c.text.slice(0, 80)}" is from ${r.date}, but tick ${r.tick} is ${dateOfTick(r.tick)}`)
    }
  })

  test(`the report on ${rec.runId} ends in the year the record ends`, () => {
    const rep = worldReport(rec)
    const year = String(yearOfTick(last(rec).tick))
    assert.match(rep.summary[0], new RegExp(`to ${year}\\b`), `the report on ${rec.runId} says "${rep.summary[0].slice(0, 120)}", but its last frame is in ${year}`)
  })

  test(`the real-baseline line on ${rec.runId} uses the record's people and the un's numbers for the same year`, () => {
    const b = realBaseline(rec)
    if (!b) return
    const tick = Math.max(0, (b.year - 2026) * 12 + 1)
    assert.equal(b.population.world, populationAt(rec, tick), `the baseline line on ${rec.runId} says ${b.population.world} people in ${b.year}, but the record has ${populationAt(rec, tick)}`)
    const u = un()
    assert.equal(b.population.un, u.population.byYear[String(b.year)], `the baseline line on ${rec.runId} says the un projects ${b.population.un} people in ${b.year}, but the un file says ${u.population.byYear[String(b.year)]}`)
    assert.ok(b.year <= yearOfTick(last(rec).tick), `the baseline line on ${rec.runId} compares ${b.year}, after the world ended in ${yearOfTick(last(rec).tick)}`)
  })

  // a record from before 5.10.9 can end with no population at all (b's housing tenure bug: NaN, null in the json).
  // the report cannot agree with a number that is not there; from 5.10.9 b's records check fails such a record itself
  const broken = !Number.isFinite(last(rec).globalPopulation as number)
  const popSkip = !versionAtLeast(versionOf(rec), '5.8.0') ? `${rec.runId} is from sim ${versionOf(rec) ?? 'unknown'}, before the population fix in 5.8.0`
    : broken && !versionAtLeast(versionOf(rec), '5.10.9') ? `${rec.runId} is from sim ${versionOf(rec)} and its record has no final population (the housing bug fixed in 5.10.9)` : false
  test(`the report on ${rec.runId} says the same final population as the record`, { skip: popSkip }, () => {
    const rep = worldReport(rec)
    const n = populationAt(rec, last(rec).tick)
    const fmt = n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`
    assert.ok(rep.summary[1].includes(`${fmt} people at the end`), `the report on ${rec.runId} says "${rep.summary[1].slice(0, 140)}", but the record ends with ${fmt} people`)
  })

  test(`the report on ${rec.runId} never shows a population its record does not have`, { skip: broken ? false : `${rec.runId} has a final population` }, () => {
    const line = worldReport(rec).summary[1]
    assert.ok(/no final population on its record/.test(line), `the record of ${rec.runId} has no final population, but its report says "${line.slice(0, 140)}"`)
  })

  const dead = autopsy(rec)
  test(`the autopsy of ${rec.runId} only names links that are in its record, at their own dates`, { skip: dead ? false : `${rec.runId} did not die` }, () => {
    // the sim's own autopsy (5.10.2+) is the source when the record has one; older records are checked against their cause links
    const sim = (rec as RunRecord & { autopsy?: { chain: { tick: number; what: string }[] } }).autopsy
    const source = sim?.chain?.length ? sim.chain : rec.frames.flatMap(f => f.causes ?? [])
    const byWhat = new Set(source.map(l => `${l.tick}|${l.what.replace(/[.\s]+$/, '')}`))
    for (const c of dead!.chain) {
      assert.equal(c.date, dateOfTick(c.tick), `the autopsy of ${rec.runId} dates "${c.what}" ${c.date}, but its tick is ${dateOfTick(c.tick)}`)
      assert.ok(byWhat.has(`${c.tick}|${c.what}`), `the autopsy of ${rec.runId} says "${c.what}" happened in ${c.date}, but neither the record's autopsy nor its cause links say that`)
    }
    assert.equal(dead!.died, dateOfTick(last(rec).tick), `the autopsy of ${rec.runId} says it died ${dead!.died}, but its last frame is ${dateOfTick(last(rec).tick)}`)
  })

  test(`the death telegram for ${rec.runId} gives the same death date as its autopsy`, { skip: dead ? false : `${rec.runId} did not die` }, () => {
    const text = deathStory(rec, rec.summary, { generation: rec.generation, worldNo: 1, agentName: rec.agentId, added: [], repeat: null })
    assert.ok(text.includes(`died ${dead!.died}`), `the death telegram for ${rec.runId} does not say "died ${dead!.died}": ${text.split('\n')[1] ?? text}`)
  })
}
