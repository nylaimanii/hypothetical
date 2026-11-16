// consistency: what the main site's panels show agrees with the records. the panels build their lists with these
// same functions (src/components/ui/truth.ts, dailyIssue.ts, events.ts, views/shared.ts), so a check here is a check
// of the page. playheads are sampled through each world; nothing a panel lists may lie past the playhead.
// run: npx tsx --test tests/consistency/pages/*.test.ts (HYP_CONSISTENCY_RUNS picks the worlds)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadWorld, worldIds } from '../sim/load'
import { dateOfTick, eventsBetween, yearIndexOfTick, yearOfTick, yearSpan } from '../../../src/components/ui/truth'
import { buildIssue, yearsOf } from '../../../src/components/ui/dailyIssue'
import { feedFor } from '../../../src/components/ui/events'
import { biggestEvent } from '../../../src/components/ui/views/shared'
import { normalizeRecord } from '../../../src/components/state/normalize'
import { frameIndexAt } from '../../../src/components/state/store'
import type { RunRecord } from '../../../src/lib/types'

const playheads = (r: RunRecord) => {
  const last = r.frames.at(-1)?.tick ?? 0
  return [...new Set([0, 1, 5, 17, Math.floor(last / 3) + 4, Math.floor(last / 2) + 7, last - 3, last].filter((t) => t >= 0 && t <= last))]
}

for (const id of worldIds()) {
  const raw = loadWorld(id)
  if (!raw) continue
  const r = normalizeRecord(raw)
  const ts = playheads(r)

  test(`${id}: the event lists hold every event up to the playhead and nothing after it`, () => {
    for (const t of ts) {
      const listed = eventsBetween(r, 0, t)
      for (const { e } of listed) assert.ok(e.tick <= t, `at ${dateOfTick(t)} a panel lists "${e.text}" from ${dateOfTick(e.tick)}, which hasn't happened yet`)
      const all = r.frames.flatMap((f) => f.newEvents).filter((e) => e.tick <= t).length
      assert.equal(listed.length, all, `at ${dateOfTick(t)} the record has ${all} events so far, the panels list ${listed.length}`)
    }
  })

  test(`${id}: the event feed shows each event on its own date and never one past the playhead`, () => {
    for (const t of ts) {
      for (const it of feedFor(r, frameIndexAt(r.frames, t), t)) {
        assert.ok(it.tick <= t, `at ${dateOfTick(t)} the feed shows "${it.text}" from ${it.date}, which hasn't happened yet`)
        assert.equal(it.date, dateOfTick(it.tick), `the feed dates "${it.text}" ${it.date}, but it happened in ${dateOfTick(it.tick)}`)
      }
    }
  })

  test(`${id}: the daily only reports the year it is about, up to the playhead`, () => {
    for (const t of ts) {
      for (const y of yearsOf(r, t)) {
        const issue = buildIssue(r, y, t)
        if (!issue) continue
        assert.equal(issue.year, yearOfTick(yearSpan(y).start), `the ${issue.year} issue covers the months of ${yearOfTick(yearSpan(y).start)}`)
        for (const s of [issue.lead, ...issue.stories]) {
          const at = s.ref?.at
          if (at === undefined) continue
          assert.ok(at <= t, `at ${dateOfTick(t)} the daily reports "${s.headline}" from ${dateOfTick(at)}, which hasn't happened yet`)
          assert.equal(yearOfTick(at), issue.year, `the ${issue.year} daily reports "${s.headline}" from ${dateOfTick(at)}`)
          assert.ok(s.body.startsWith(dateOfTick(at)), `the daily dates "${s.headline}" differently from the record (${dateOfTick(at)})`)
        }
      }
    }
  })

  test(`${id}: the daily calls a year quiet only once the whole year is in`, () => {
    for (const t of ts) {
      const y = yearIndexOfTick(t)
      const issue = buildIssue(r, y, t)
      if (!issue) continue
      const done = t >= yearSpan(y).end && (r.frames.at(-1)?.tick ?? 0) >= yearSpan(y).end
      if (!done) assert.ok(!/^no major events/.test(issue.lead.headline), `at ${dateOfTick(t)} the daily calls ${issue.year} quiet before the year is over`)
    }
  })

  test(`${id}: the year's biggest event is from this year and has already happened`, () => {
    for (const t of ts) {
      const best = biggestEvent(r, t)
      if (!best) continue
      const e = eventsBetween(r, yearSpan(yearIndexOfTick(t)).start, t).find((x) => x.e.text === best.text)
      assert.ok(e, `at ${dateOfTick(t)} the biggest event of ${yearOfTick(t)} is "${best.text}", which is not from ${yearOfTick(t)} up to now`)
    }
  })
}
