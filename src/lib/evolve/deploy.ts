// what the deployed site serves. vercel builds origin "stable", which has no runner and no data/runs, so before this
// every api route came back empty and the ui fell back to its mock worlds. stable is now origin/main plus one data
// commit: the showcase worlds, the agents, hall, steps, learning curves and lessons, and D's lives, at their usual
// data/ paths, so the read-only routes serve real records with no code of their own. the snapshot is built with a
// throwaway git index (like the backup), so it never lands on main and the shared working tree is never touched.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

// top-level files the read-only routes read (missing ones are skipped)
const TOP = ['agents.json', 'lessons.json', 'life-lessons.json', 'version.json', 'hall.json', 'learning.json', 'leaderboard.json', 'steps.json', 'reality-check.json', 'uncertainty.json', 'runs/features.json', 'runs/evidence.json', 'runs/tradeoffs.json', 'playbook.json', 'gaps.json', 'playbook-ab.json', 'real/un-wpp-2024.json']
// whole folders: the replayable worlds, older versions' hall/steps/learning, D's lives
const DIRS = ['showcase', 'versions', 'lives']
// never shipped, whatever folder they turn up in
const NEVER = /(^|\/)(\.|telegram|maintenance|evolve-now|.*\.tmp$|.*\.lock$)/

// data/ paths (relative to the project, with forward slashes) that go into the deploy
export function deployFiles(root = process.cwd()): string[] {
  const data = path.join(root, 'data')
  const out = TOP.filter(f => fs.existsSync(path.join(data, f))).map(f => `data/${f}`)
  const walk = (rel: string) => {
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(path.join(data, rel), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const r = `${rel}/${e.name}`
      if (NEVER.test(r)) continue
      if (e.isDirectory()) walk(r)
      else if (/\.(json|json\.gz|md)$/.test(e.name)) out.push(`data/${r}`)
    }
  }
  for (const d of DIRS) walk(d)
  return out.sort()
}

// the deployed site must have something real to show: worlds that open, and the agents that ran them.
// returns problems in plain words (empty when the snapshot is good). `dir` holds the snapshot's data/
export function checkDeploy(dir: string): string[] {
  const problems: string[] = []
  const read = <T>(rel: string): T | null => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', rel), 'utf8')) as T } catch { return null } }
  const agents = read<{ id: string }[]>('agents.json') ?? []
  if (!agents.length) problems.push('the deploy has no agents, so /api/agents would be empty')
  const index = read<{ runId: string; agentId: string }[]>('showcase/index.json') ?? []
  if (!index.length) problems.push('the deploy has no showcase worlds, so /api/runs would be empty and the site would show mock worlds')
  for (const s of index) {
    const gz = path.join(dir, 'data', 'showcase', `${s.runId}.json.gz`), raw = path.join(dir, 'data', 'showcase', `${s.runId}.json`)
    let rec: { runId?: string; frames?: unknown[] } | null = null
    try { rec = JSON.parse((fs.existsSync(gz) ? zlib.gunzipSync(fs.readFileSync(gz)) : fs.readFileSync(raw)).toString('utf8')) } catch { /* below */ }
    if (!rec?.frames?.length) problems.push(`showcase world ${s.runId} is listed but its record does not open`)
    else if (rec.runId && rec.runId !== s.runId) problems.push(`showcase world ${s.runId} holds the record of ${rec.runId}`)
    if (agents.length && !agents.some(a => a.id === s.agentId)) problems.push(`showcase world ${s.runId} belongs to agent ${s.agentId}, which is not in agents.json`)
  }
  return problems
}

// copies the snapshot into a clean export of the code at `dir`
export function copyDeploy(files: string[], dir: string, root = process.cwd()) {
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
    fs.copyFileSync(path.join(root, f), path.join(dir, f))
  }
}
