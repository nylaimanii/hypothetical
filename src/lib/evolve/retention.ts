// disk retention. full records are ~34MB and evolution makes ~130 a day, so:
//   - every finished world keeps a gzipped slim payload forever (data/runs/slim/<runId>.json.gz)
//   - full records stay for protected worlds: the hall of history, each sim version's top 20, showcase worlds,
//     and anything a petition, what-if, life, follow list or branch points at
//   - every other full record is gzipped, and deleted once it is 3 days old (its slim stays)
// only worlds evolve indexed are touched; other agents' test records in data/runs are left alone.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import type { RunRecord, SlimRun } from '../types'
import { dirs, listShowcase, readJson, readRunIndex, readRunRecord, SAFE_ID } from './store'
import { slimRun } from './slim'

const DAY = 864e5
export const DELETE_AFTER_MS = 3 * DAY
// a just-finished world may still be read by its generation's digest: wait before compressing it
const SETTLE_MS = 6 * 3600e3
export const LOW_DISK_BYTES = 50 * 1024 ** 3

const slimDir = () => path.join(dirs.runs, 'slim')
const slimPath = (id: string) => path.join(slimDir(), `${id}.json.gz`)
const full = (id: string) => path.join(dirs.runs, `${id}.json`)
const fullGz = (id: string) => path.join(dirs.runs, `${id}.json.gz`)
const lives = (id: string) => path.join(dirs.runs, `${id}.lives.json`)

export function writeSlim(rec: RunRecord) {
  fs.mkdirSync(slimDir(), { recursive: true })
  fs.writeFileSync(slimPath(rec.runId), zlib.gzipSync(JSON.stringify(slimRun(rec))))
}
export function readSlim(id: string): SlimRun | null {
  if (!SAFE_ID.test(id)) return null
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(slimPath(id))).toString('utf8')) as SlimRun } catch { return null }
}

// run ids mentioned by the json files under these folders (petitions, what-ifs, lives, follows, live branches)
function referencedIds(): Set<string> {
  const out = new Set<string>()
  const re = /"(?:runId|sourceRunId|newRunId|fromRunId|originalRunId|branchOf)"\s*:\s*"([A-Za-z0-9_-]{1,80})"/g
  const walk = (p: string, depth = 0) => {
    let st: fs.Stats
    try { st = fs.statSync(p) } catch { return }
    if (st.isDirectory()) { if (depth < 3) for (const f of fs.readdirSync(p)) walk(path.join(p, f), depth + 1); return }
    if (!/\.json$/.test(p) || st.size > 5e6) return
    try { for (const m of fs.readFileSync(p, 'utf8').matchAll(re)) out.add(m[1]) } catch {}
  }
  for (const d of ['petitions', 'whatif', 'life', 'lives', 'follow.json', 'follows.json']) walk(path.join(process.cwd(), 'data', d))
  // live worlds branched from a run keep their source
  try {
    for (const f of fs.readdirSync(dirs.live).filter(f => f.endsWith('.json'))) {
      const b = readJson<RunRecord>(path.join(dirs.live, f))?.branchedFrom?.runId
      if (b) out.add(b)
    }
  } catch {}
  return out
}

function hallIds(): Set<string> {
  const out = new Set<string>()
  const files = [path.join(process.cwd(), 'data', 'hall.json')]
  try { for (const v of fs.readdirSync(path.join(process.cwd(), 'data', 'versions'))) files.push(path.join(process.cwd(), 'data', 'versions', v, 'hall.json')) } catch {}
  for (const f of files) for (const e of readJson<{ entries: { runId: string }[] }>(f)?.entries ?? []) out.add(e.runId)
  return out
}

// each version's top 20, ranked inside each horizon (50-year screening and 100-year full runs score differently)
function topPerVersion(n = 20): Set<string> {
  const groups = new Map<string, { runId: string; score: number }[]>()
  for (const r of readRunIndex()) {
    const key = `${r.simVersion ?? '?'}|${/-full-s\d+$/.test(r.runId) ? 'full' : 'screen'}`
    groups.set(key, [...(groups.get(key) ?? []), { runId: r.runId, score: r.score }])
  }
  const out = new Set<string>()
  for (const g of groups.values()) for (const r of g.sort((a, b) => b.score - a.score).slice(0, n)) out.add(r.runId)
  return out
}

export function protectedIds(): Set<string> {
  return new Set([...hallIds(), ...topPerVersion(), ...listShowcase().map(s => s.runId), ...referencedIds()])
}

// keeps the original modification time, so a record's age is always measured from when its world finished
const gzipFile = (from: string, to: string) => { const st = fs.statSync(from); fs.writeFileSync(to, zlib.gzipSync(fs.readFileSync(from))); fs.utimesSync(to, st.atime, st.mtime); fs.rmSync(from) }
const gunzipFile = (from: string, to: string) => { fs.writeFileSync(to, zlib.gunzipSync(fs.readFileSync(from))); fs.rmSync(from) }

export type SweepResult = { slimmed: number; gzipped: number; restored: number; deleted: number; freedBytes: number }

// the hourly pass. active: run ids of the generation in progress (never touched)
export function sweep(active: Set<string> = new Set(), now = Date.now()): SweepResult {
  const res: SweepResult = { slimmed: 0, gzipped: 0, restored: 0, deleted: 0, freedBytes: 0 }
  const keep = protectedIds()
  for (const r of readRunIndex()) {
    const id = r.runId
    if (active.has(id)) continue
    const p = full(id), gz = fullGz(id)
    const hasPlain = fs.existsSync(p), hasGz = fs.existsSync(gz)
    if (!hasPlain && !hasGz) continue
    const age = now - fs.statSync(hasPlain ? p : gz).mtimeMs
    try {
      // every world keeps its slim payload forever
      if (!fs.existsSync(slimPath(id))) { const rec = readRunRecord(id); if (rec) { writeSlim(rec); res.slimmed++ } }
      if (keep.has(id)) {
        // protected worlds stay plain json, so the sim can branch from them
        if (!hasPlain && hasGz) { gunzipFile(gz, p); res.restored++ }
        if (fs.existsSync(`${lives(id)}.gz`)) gunzipFile(`${lives(id)}.gz`, lives(id))
        continue
      }
      if (hasPlain && age >= SETTLE_MS) {
        const before = fs.statSync(p).size
        gzipFile(p, gz)
        res.freedBytes += before - fs.statSync(gz).size
        res.gzipped++
        if (fs.existsSync(lives(id))) gzipFile(lives(id), `${lives(id)}.gz`)
      }
      // mediocre and 3+ days old: the full record goes, the slim payload stays
      if (fs.existsSync(gz) && now - fs.statSync(gz).mtimeMs >= DELETE_AFTER_MS) {
        res.freedBytes += fs.statSync(gz).size
        fs.rmSync(gz)
        fs.rmSync(`${lives(id)}.gz`, { force: true })
        res.deleted++
      }
    } catch { /* one bad file should not stop the sweep */ }
  }
  return res
}

// disk use for /status and the heartbeat
export function diskReport(): { dataBytes: number; freeBytes: number; low: boolean } {
  let dataBytes = 0
  const walk = (p: string) => {
    let st: fs.Stats
    try { st = fs.lstatSync(p) } catch { return }
    if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)) } else dataBytes += st.size
  }
  walk(path.join(process.cwd(), 'data'))
  let freeBytes = 0
  try { const s = fs.statfsSync(process.cwd()); freeBytes = s.bavail * s.bsize } catch {}
  return { dataBytes, freeBytes, low: freeBytes > 0 && freeBytes < LOW_DISK_BYTES }
}
export const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)}GB`
export const diskLine = () => { const d = diskReport(); return `disk: data ${gb(d.dataBytes)}, ${gb(d.freeBytes)} free${d.low ? ' (LOW)' : ''}` }
