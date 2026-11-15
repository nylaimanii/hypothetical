import { connection } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import type { Divergence, RunRecord } from '@/lib/types'
import { readAgents } from '@/lib/evolve/agents'
import { findDivergences } from '@/lib/evolve/core'
import { pendingFile } from '@/lib/evolve/live'
import { dirs, isReadOnly, listShowcase, loadRecord, readRunIndex, readShowcase, SAFE_ID, type IndexedRun } from '@/lib/evolve/store'
import { spawnRunner } from '@/lib/evolve/spawn'

// GET /api/compare?agents=a,b,c,d
// for each agent, its best world on the seed most of them share. agents missing a world on that seed get one
// started in the background (local only), listed in `pending`. divergences come from the sim, for every pair.
export async function GET(req: Request) {
  await connection()
  const ids = [...new Set((new URL(req.url).searchParams.get('agents') ?? '').split(',').map(s => s.trim()).filter(s => SAFE_ID.test(s)))].slice(0, 4)
  if (ids.length < 2) return Response.json({ error: 'pass 2 to 4 agent ids: ?agents=a,b' }, { status: 400 })
  const ro = isReadOnly()

  const pool: IndexedRun[] = ro ? [] : readRunIndex().filter(r => r.status !== 'alive')
  for (const s of listShowcase()) if (s.seed !== undefined && !pool.some(r => r.runId === s.runId)) pool.push({ ...s, seed: s.seed })
  const mine = pool.filter(r => ids.includes(r.agentId))

  // the seed shared by the most requested agents (ties: the lowest seed, so answers are stable)
  const agentsOnSeed = new Map<number, Set<string>>()
  for (const r of mine) agentsOnSeed.set(r.seed, (agentsOnSeed.get(r.seed) ?? new Set()).add(r.agentId))
  const seed = [...agentsOnSeed.entries()].sort((a, b) => b[1].size - a[1].size || a[0] - b[0])[0]?.[0]
    ?? [...pool].sort((a, b) => b.generation - a.generation)[0]?.seed ?? 1002

  const runs: RunRecord[] = []
  const pending: string[] = []
  const agents = readAgents()
  for (const id of ids) {
    const best = mine.filter(r => r.agentId === id && r.seed === seed).sort((a, b) => b.score - a.score)[0]
    const rec = best ? (ro ? readShowcase(best.runId) : loadRecord(best.runId)) : null
    if (rec) { runs.push(rec); continue }
    const agent = agents.find(a => a.id === id)
    if (ro || !agent) continue
    // missing: run this agent on the shared seed in the background, once
    const runId = `cmp-${id}-s${seed}`.slice(0, 80)
    const started = fs.existsSync(pendingFile(runId)) || fs.existsSync(path.join(dirs.runs, `${runId}.json`))
    if (!started) {
      fs.mkdirSync(dirs.live, { recursive: true })
      fs.writeFileSync(pendingFile(runId), new Date().toISOString())
      if (!spawnRunner(runId, agent.constitution, ['--seed', String(seed), '--agentId', id, '--batch'])) { fs.rmSync(pendingFile(runId), { force: true }); continue }
    }
    pending.push(id)
  }

  const divergences: Divergence[] = []
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    try { divergences.push(...findDivergences(runs[i], runs[j])) } catch { /* one bad pair should not sink the rest */ }
  }
  const note = pending.length
    ? `running ${pending.length} missing world${pending.length > 1 ? 's' : ''} on seed ${seed} in the background (${pending.join(', ')}). ask again in a few minutes`
    : runs.length < ids.length ? `${ids.length - runs.length} agent${ids.length - runs.length > 1 ? 's have' : ' has'} no world on seed ${seed}${ro ? ' in the showcase' : ''}` : undefined
  return Response.json({ seed, runs, divergences, pending, ...(note ? { note } : {}) })
}
