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

// ---------- every usable world, for the continent roster ----------
// the current sim version first (best first), then everything else on disk as a labeled fallback: older versions and
// untagged recordings. skipped: test recordings, pre-v2 scores, files that are not world records. each world says
// which agent governed it, so the same city can be compared across agents
export type WorldInfo = { runId: string; seed: number; version: string; current: boolean; agentId: string | null; agent: string; score: number; ticks: number; status: string; label: string }

const AGENT_NAMES = (): Map<string, string> => {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'agents.json'), 'utf8')) as { id: string; name: string }[]
    return new Map(a.map(x => [x.id, x.name.toLowerCase()]))
  } catch { return new Map() }
}
const summaryCache = new Map<string, { mtime: number; s: { agentId: string | null; score: number; ticks: number; status: string; seed: number } | null }>()
function summaryOf(runId: string): { agentId: string | null; score: number; ticks: number; status: string; seed: number } | null {
  const f = path.join(process.cwd(), 'data', 'runs', `${runId}.json`)
  let mtime = 0
  try { mtime = fs.statSync(f).mtimeMs } catch { return null }
  const hit = summaryCache.get(runId)
  if (hit && hit.mtime === mtime) return hit.s
  let s: { agentId: string | null; score: number; ticks: number; status: string; seed: number } | null = null
  try {
    const rec = JSON.parse(fs.readFileSync(f, 'utf8')) as RunRecord & { agentId?: string }
    if (rec.summary && rec.frames?.length && typeof rec.summary.score === 'number' && rec.summary.score <= 10) {
      const id = rec.agentId && rec.agentId !== 'unassigned' ? rec.agentId : null
      s = { agentId: id, score: rec.summary.score, ticks: rec.summary.ticks, status: rec.summary.status, seed: rec.seed }
    }
  } catch { s = null }
  summaryCache.set(runId, { mtime, s })
  return s
}

export function allWorlds(): WorldInfo[] {
  const current = currentVersion()
  const names = AGENT_NAMES()
  const index = new Map(readRunIndex().map(r => [r.runId, r]))
  const dir = path.join(process.cwd(), 'data', 'runs')
  const ids = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter(f => /^[A-Za-z0-9_-]+\.json$/.test(f) && f !== 'index.json' && f !== 'features.json' && !/test/i.test(f))
    .map(f => f.replace(/\.json$/, ''))
  const out: WorldInfo[] = []
  for (const runId of ids) {
    const ix = index.get(runId) as (ReturnType<typeof readRunIndex>[number] & { agentId?: string; simVersion?: string }) | undefined
    const s = summaryOf(runId)
    if (!s) continue
    const agentId = (ix?.agentId && ix.agentId !== 'unassigned' ? ix.agentId : null) ?? s.agentId
    const version = ix?.simVersion ?? 'untagged'
    const agent = agentId ? names.get(agentId) ?? agentId.replace(/-/g, ' ') : 'no agent'
    out.push({ runId, seed: s.seed, version, current: version === current, agentId, agent, score: s.score, ticks: s.ticks, status: s.status,
      label: `${runId} (${agent}, sim ${version}${version === current ? ', current' : ''}, ${s.ticks} months, ${s.status})` })
  }
  return out.sort((a, b) => Number(b.current) - Number(a.current) || Number(!!b.agentId) - Number(!!a.agentId) || rank(b) - rank(a))
}

// the agent that governed a world, for labels ("lagos · halcyon")
export function agentOfWorld(runId: string): string {
  return allWorlds().find(w => w.runId === runId)?.agent ?? 'no agent'
}
