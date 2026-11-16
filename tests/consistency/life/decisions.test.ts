// lives must react to their worlds. two checks:
// 1. the same decision, for someone in the same region at the same moment, is briefed differently in two agents'
//    worlds whenever those worlds actually differ (budget, laws, the region's numbers)
// 2. once lives in different worlds exist, they do not make the same choice at most of the decisions they share
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { allWorlds } from '../../../src/lib/life/worlds'
import { WorldEnv } from '../../../src/lib/life/env'
import { worldBrief } from '../../../src/lib/life/brief'
import { compareView } from '../../../src/lib/life/views'
import { allLives } from './load'
import type { RunRecord } from '../../../src/lib/types'

const load = (id: string) => new WorldEnv(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'runs', `${id}.json`), 'utf8')) as RunRecord)

test('the same decision is described differently in two agents\' worlds', () => {
  const ws = allWorlds().filter(w => w.current && w.agentId)
  const byAgent = [...new Map(ws.map(w => [w.agentId, w])).values()].slice(0, 3)
  if (byAgent.length < 2) return
  const envs = byAgent.map(w => load(w.runId))
  const region = envs[0].frameAt(0).regions[0].id
  for (const [tick, kind] of [[17 * 12, 'path'], [30 * 12, 'children'], [45 * 12, 'health'], [60 * 12, 'retirement']] as const) {
    const t = Math.min(tick, ...envs.map(e => e.lastTick))
    const briefs = envs.map(e => worldBrief(e, t, region, kind))
    assert.ok(new Set(briefs).size === briefs.length, `identical briefs for ${kind} at ${t}:\n${briefs[0]}`)
  }
})

test('lives in different worlds do not make the same choice at most decisions', () => {
  const lives = allLives()
  const pairs: string[] = []
  for (const a of lives) for (const b of lives) {
    if (a.lifeId >= b.lifeId || a.worldId === b.worldId) continue
    const v = compareView(a, b)
    if (v.both >= 8) { pairs.push(`${a.lifeId}/${b.lifeId} ${v.both - v.differ} same of ${v.both}`); assert.ok((v.both - v.differ) / v.both <= 0.65, `${a.lifeId} and ${b.lifeId} made the same choice at ${v.both - v.differ} of ${v.both}`) }
  }
  if (!pairs.length) console.log('# (no finished lives in two different worlds yet)')
})
