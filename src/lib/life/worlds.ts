// which world a series of lives runs in: the best world of the CURRENT sim version (C's version.ts decides what
// current means). a person may live 100+ years, so worlds that reach the horizon rank above short screens.
// when no world of the current version exists yet, the best untagged recording is used and every life in it is
// marked worldVersion 'untagged', so the series restarts cleanly once a current-version world lands.
import fs from 'node:fs'
import path from 'node:path'
import { currentVersion } from '../evolve/version'
import { loadRecord, readRunIndex } from '../evolve/store'
import type { RunRecord } from '../types'

export type WorldPick = { record: RunRecord; version: string; current: string; why: string }

const rank = (s: { score: number; ticks: number; status: string }) => (s.status === 'destroyed' ? 0 : 1) * 10 + Math.min(1, s.ticks / 1200) * 5 + s.score

// the top k worlds of the current version (or the single best untagged one when none exist yet)
export function bestWorlds(k: number): WorldPick[] {
  const current = currentVersion()
  const ours = readRunIndex().filter(r => r.simVersion === current).sort((a, b) => rank(b) - rank(a))
  const out: WorldPick[] = []
  for (const r of ours) {
    if (out.length >= k) break
    const rec = loadRecord(r.runId)
    if (rec) out.push({ record: rec, version: current, current, why: `#${out.length + 1} world of sim ${current} (score ${r.score})` })
  }
  if (out.length) return out
  const one = bestWorld()
  return one ? [one] : []
}

export function bestWorld(explicit?: string): WorldPick | null {
  const current = currentVersion()
  if (explicit) {
    const rec = loadRecord(explicit)
    if (!rec) return null
    const tagged = readRunIndex().find(r => r.runId === explicit)?.simVersion
    return { record: rec, version: tagged ?? 'untagged', current, why: 'chosen with --world' }
  }
  const ours = readRunIndex().filter(r => r.simVersion === current).sort((a, b) => rank(b) - rank(a))
  for (const r of ours) {
    const rec = loadRecord(r.runId)
    if (rec) return { record: rec, version: current, current, why: `best world of sim ${current} (score ${r.score}, ${r.ticks} months)` }
  }
  // fallback: untagged recordings on disk. parse summaries only once per call
  const dir = path.join(process.cwd(), 'data', 'runs')
  let best: { id: string; s: RunRecord['summary'] } | null = null
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!/^[A-Za-z0-9_-]+\.json$/.test(f) || f === 'index.json' || f === 'features.json') continue
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RunRecord
      if (!rec.summary || !rec.frames?.length || typeof rec.summary.score !== 'number' || rec.summary.score > 10) continue // skip pre-v2 records (score was a different scale)
      if (!best || rank(rec.summary) > rank(best.s)) best = { id: f.replace(/\.json$/, ''), s: rec.summary }
    } catch { /* not a record */ }
  }
  if (!best) return null
  const rec = loadRecord(best.id)
  return rec ? { record: rec, version: 'untagged', current, why: `no world of sim ${current} yet; best untagged recording (score ${best.s.score}, ${best.s.ticks} months, ${best.s.status})` } : null
}
