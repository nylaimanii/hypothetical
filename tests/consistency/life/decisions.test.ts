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
import { DECIDE_VERSION } from '../../../src/lib/life/decide'
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

// (only lives decided with the same inputs are compared: a life from before the inputs changed says nothing about
// whether the current ones make lives react to their worlds. older records carry no decideVersion)
test('lives in different worlds do not make the same choice at most decisions', () => {
  const lives = allLives().filter(l => l.decideVersion === DECIDE_VERSION)
  const pairs: string[] = []
  for (const a of lives) for (const b of lives) {
    if (a.lifeId >= b.lifeId || a.worldId === b.worldId) continue
    const v = compareView(a, b)
    if (v.both >= 8) { pairs.push(`${a.lifeId}/${b.lifeId} ${v.both - v.differ} same of ${v.both}`); assert.ok((v.both - v.differ) / v.both <= 0.65, `${a.lifeId} and ${b.lifeId} made the same choice at ${v.both - v.differ} of ${v.both}`) }
  }
  if (!pairs.length) console.log(`# (no finished lives decided with inputs ${DECIDE_VERSION} in two different worlds yet)`)
})

// the two causes of the d2 failure (gabriel in rio and daniela in lima, 10 of 14 alike): one old life's money lesson
// steered every life's move, love, children and career decisions, and every life was told money was short
import { relevantLessons, readLessons } from '../../../src/lib/life/lessons'
import { roomLine, roomWords } from '../../../src/lib/life/decide'
import type { LifeLesson } from '../../../src/lib/life/types'
test('a decision only hears lessons about that kind of decision', () => {
  const mk = (id: string, kind: string, gain: number): LifeLesson => ({ id, fromLifeId: id, worldId: 'w', lifeNo: 1, createdAt: '', kind: kind as LifeLesson['kind'], choice: 'c', ledTo: 'l', rule: 'r', tags: ['young_adult', 'poverty', 'money', 'risk'], regionId: 'ssa', lifeScore: 0.7, simVersion: 'x', verified: true, timesGiven: 9, timesApplied: 9, meanGain: gain })
  const all = [mk('save', 'money', 0.064), mk('wed', 'partner', 0), ...readLessons()]
  for (const kind of ['move', 'partner', 'children', 'career', 'protest', 'help_others'] as const) {
    const got = relevantLessons(all, kind, ['young_adult', 'poverty', 'money', 'risk'], 'ssa')
    for (const l of got) assert.equal(l.kind, kind, `${kind} decision got the ${l.kind} lesson ${l.id}`)
  }
  assert.ok(relevantLessons(all, 'partner', ['young_adult', 'poverty'], 'ssa').some(l => l.id === 'wed'))
})
test('the room line follows her own month: short, tight, or with room', () => {
  // gabriel at 37: $653 in, about $600 out, $5822 owed. daniela at 37: $372 in, about $330 out, $5385 saved. a new
  // earner with $122 left and a month of savings
  const gabriel = roomWords(653, 600, -5822), daniela = roomWords(372, 330, 5385), starting = roomWords(408, 286, 221)
  assert.match(gabriel, /short/)
  assert.match(daniela, /room/)
  assert.match(starting, /tight/)
  assert.equal(new Set([gabriel, daniela, starting]).size, 3, 'every life hears the same thing about its money')
  assert.equal(typeof roomLine, 'function')
})
