// consistency (C): the leaderboard's "why it won" points at real moments. every decisive decision that carries a tick
// (the ui makes it a link that jumps there) names a world whose record has a decision at that tick, and the year in
// its words is that tick's year. checked on the current board and every archived version's board
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { readJson, readRunRecord, type LeaderboardEntry } from '../../../src/lib/evolve/store'
import { gapFor, readGaps } from '../../../src/lib/evolve/gaps'
import { yearOfTick } from '../../../src/lib/sim/replay-pure'

const data = path.join(process.cwd(), 'data')
const boards: [string, string][] = [['current', path.join(data, 'leaderboard.json')]]
try { for (const v of fs.readdirSync(path.join(data, 'versions'))) boards.push([v, path.join(data, 'versions', v, 'leaderboard.json')]) } catch { /* no archive */ }

for (const [label, file] of boards) {
  const lb = readJson<LeaderboardEntry[]>(file)
  if (!lb?.length) continue
  test(`leaderboard (${label}): every clickable decisive decision is a real moment in a real world`, () => {
    const gaps = readGaps()
    lb.forEach((e, i) => {
      const g = gapFor(lb, i, gaps) as { reasons?: { text: string; tick?: number; run?: string }[] } | null
      for (const r of g?.reasons ?? []) {
        if (r.tick === undefined) continue
        assert.ok(r.run, `${e.name}: "${r.text}" has a tick but no world to jump to`)
        const rec = readRunRecord(r.run!)
        if (!rec) continue
        assert.ok(rec.frames.some(f => f.decision?.tick === r.tick), `${e.name}: "${r.text}" jumps to tick ${r.tick} of ${r.run}, which has no decision there`)
        const y = String(yearOfTick(r.tick!))
        if (/\b(19|20|21)\d\d\b/.test(r.text)) assert.ok(r.text.includes(y), `${e.name}: "${r.text}" jumps to tick ${r.tick}, which is ${y}, not the year it says`)
      }
    })
  })
}

// an entry's best world is one with a real score: a world a sim bug left without one (5.10.7's housing NaN) would show
// "destroyed" beside first place while its other numbers came from a different world
for (const [label, file] of boards) {
  const lb = readJson<LeaderboardEntry[]>(file)
  if (!lb?.length) continue
  test(`leaderboard (${label}): every entry's best world has a real score`, () => {
    for (const e of lb) assert.ok(Number.isFinite((e.best as { score?: number }).score), `${e.name}'s best world ${(e.best as { runId?: string }).runId} has no score`)
  })
}
