// daily and weekly upkeep, scheduled by the evolve watchdog (state in data/maintenance.json):
//   backup   daily: the small files that hold what the ai learned go to the origin "data-backup" branch, built with
//            a throwaway git index so the shared working tree and its index are never touched
//   stable   daily: if origin/main typechecks, builds and passes tests in a clean copy, fast-forward origin "stable"
//            to it (vercel deploys from stable, so a mid-change main never reaches the public site)
//   morning  8am: one telegram digest of the night
//   quality  weekly: replay the champion's best world with a bigger model and say whether the result holds up
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RunSummary } from '../types'
import { readAgents } from './agents'
import { readLessons } from './lessons'
import { readJson, readRunIndex, readRunRecord, writeJson } from './store'
import { worldStory } from '../notify/story'
import { codeRoot, currentVersion } from './version'
import { diskLine } from './retention'
import { ollamaUp } from './ollama'
import { paceStats } from './usage'

type State = { lastBackup?: string; backupSha?: string; lastStable?: string; stableSha?: string; stableNote?: string; lastMorning?: string; morningLessons?: number; lastQuality?: string }
const stateFile = () => path.join(process.cwd(), 'data', 'maintenance.json')
export const readState = (): State => readJson<State>(stateFile()) ?? {}
const saveState = (patch: Partial<State>) => writeJson(stateFile(), { ...readState(), ...patch })
const today = (d = new Date()) => d.toLocaleDateString('sv-SE') // local yyyy-mm-dd
const git = (args: string[], env?: Record<string, string>) => execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }).trim()

// ---------- backup ----------
// what the ai learned: agents, lessons (and D's life lessons), steps, hall, leaderboards, learning curves, versions
export function backupFiles(): string[] {
  const top = ['agents.json', 'lessons.json', 'life-lessons.json', 'steps.json', 'hall.json', 'leaderboard.json', 'learning.json', 'version.json', 'uncertainty.json', 'reality-check.json']
  const out = top.map(f => path.join('data', f)).filter(f => fs.existsSync(path.join(process.cwd(), f)))
  for (const sub of ['life', 'versions']) {
    const walk = (dir: string) => {
      let entries: fs.Dirent[] = []
      try { entries = fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const rel = path.join(dir, e.name)
        if (e.isDirectory()) walk(rel)
        else if (/(lessons|steps|hall|leaderboard|learning|agents|version)[^/]*\.json$/.test(e.name) && fs.statSync(path.join(process.cwd(), rel)).size < 20e6) out.push(rel)
      }
    }
    walk(path.join('data', sub))
  }
  return out
}

export function backupToGit(): { committed: boolean; files: number; sha?: string; note: string } {
  const files = backupFiles()
  if (!files.length) return { committed: false, files: 0, note: 'nothing to back up yet' }
  const index = path.join(os.tmpdir(), `hyp-backup-index-${process.pid}`)
  const env = { GIT_INDEX_FILE: index }
  try {
    let parent: string | null = null
    try { git(['fetch', '-q', 'origin', 'data-backup']); parent = git(['rev-parse', 'origin/data-backup']) } catch { /* first backup */ }
    fs.rmSync(index, { force: true })
    if (parent) git(['read-tree', parent], env)
    for (const f of files) {
      const blob = git(['hash-object', '-w', '--', f])
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${f.split(path.sep).join('/')}`], env)
    }
    const tree = git(['write-tree'], env)
    if (parent && git(['rev-parse', `${parent}^{tree}`]) === tree) return { committed: false, files: files.length, note: 'no changes since the last backup' }
    const msg = `data backup ${today()}: ${files.length} files (agents ${readAgents().length}, lessons ${readLessons().length})`
    const sha = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', msg])
    git(['push', '-q', 'origin', `${sha}:refs/heads/data-backup`])
    saveState({ lastBackup: new Date().toISOString(), backupSha: sha })
    return { committed: true, files: files.length, sha, note: msg }
  } finally {
    fs.rmSync(index, { force: true })
  }
}

// ---------- stable ----------
// clean copy of origin/main: typecheck, build, tests. pass -> origin stable fast-forwards to that commit
export function promoteStable(log: (l: string) => void = console.log): { promoted: boolean; sha: string; note: string } {
  git(['fetch', '-q', 'origin', 'main'])
  const sha = git(['rev-parse', 'origin/main'])
  const st = readState()
  if (st.stableSha === sha) return { promoted: false, sha, note: 'stable is already at origin/main' }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyp-stable-'))
  const run = (cmd: string, args: string[], cwd = dir) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 20 * 60_000, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', LLM_PROVIDER: 'offline' } })
  try {
    const arch = run('sh', ['-c', `git -C "${process.cwd()}" archive ${sha} | tar -x -C "${dir}"`], process.cwd())
    if (arch.status !== 0) return { promoted: false, sha, note: `could not export origin/main: ${arch.stderr.slice(0, 200)}` }
    // apfs clones make this copy nearly free
    const cp = run('cp', ['-cR', path.join(codeRoot(), 'node_modules'), path.join(dir, 'node_modules')], process.cwd())
    if (cp.status !== 0) return { promoted: false, sha, note: 'could not copy node_modules' }
    const steps: [string, string, string[]][] = [
      ['typecheck', 'npx', ['tsc', '--noEmit', '-p', '.']],
      ['build', 'npm', ['run', 'build']],
      ['tests', 'npx', ['tsx', '--test', 'src/lib/evolve/queue.test.ts']],
    ]
    for (const [name, cmd, args] of steps) {
      log(`stable: ${name} on ${sha.slice(0, 7)}`)
      const r = run(cmd, args)
      if (r.status !== 0) {
        const note = `${name} failed on ${sha.slice(0, 7)}: ${(r.stdout + r.stderr).split('\n').filter(l => /error|fail/i.test(l)).slice(0, 3).join(' | ').slice(0, 300)}`
        saveState({ lastStable: new Date().toISOString(), stableNote: note })
        return { promoted: false, sha, note }
      }
    }
    // a normal push only fast-forwards; if stable ever diverged this fails loudly instead of overwriting it
    git(['push', '-q', 'origin', `${sha}:refs/heads/stable`])
    saveState({ lastStable: new Date().toISOString(), stableSha: sha, stableNote: 'promoted' })
    return { promoted: true, sha, note: `stable moved to ${sha.slice(0, 7)}` }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// ---------- morning digest ----------
export async function morningDigest(): Promise<string> {
  const since = Date.now() - 12 * 3600e3
  const day = (offset: number) => { const d = new Date(Date.now() - offset * 864e5); return d.toISOString().slice(0, 10) }
  const usage = [day(0), day(1)].flatMap(d => readJson<{ worlds: { runId: string; outcome: string; at: string; wallMs: number }[] }>(path.join(process.cwd(), 'data', 'reports', `usage-${d}.json`))?.worlds ?? [])
  const index = new Map(readRunIndex().map(r => [r.runId, r]))
  // worlds still in the run index (discarded or archived worlds do not count)
  const night = [...new Map(usage.filter(w => w.outcome === 'finished' && Date.parse(w.at) >= since && index.has(w.runId)).map(w => [w.runId, w])).values()]
  const runs = night.map(w => index.get(w.runId)).filter((r): r is RunSummary & { seed: number } => !!r)
  const best = [...runs].sort((a, b) => b.score - a.score)[0]
  const deaths = runs.filter(r => r.status === 'destroyed')
  const lessons = readLessons()
  const st = readState()
  const newLessons = st.morningLessons !== undefined ? lessons.slice(st.morningLessons) : []
  const names = new Map(readAgents().map(a => [a.id, a.name]))
  const up = await ollamaUp()
  const pace = paceStats(1)
  // lead with the most interesting true thing that happened overnight (the narrator picks it)
  const stories = [...deaths, ...[...runs].sort((a, b) => (b.humanCost?.famineDeaths ?? 0) - (a.humanCost?.famineDeaths ?? 0)).slice(0, 3), ...(best ? [best] : [])]
    .map(r => { const rec = readRunRecord(r.runId); return rec ? worldStory(rec, names.get(r.agentId) ?? r.agentId) : null })
    .filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.score - a.score)
  const lead = stories[0]?.lines.slice(0, 2) ?? [night.length ? `${night.length} worlds overnight and nothing worth waking you for.` : 'no worlds finished overnight.']
  const tally = night.length ? `${night.length} worlds overnight${deaths.length ? `, ${deaths.length} died` : ', nobody died'}${newLessons.length ? `, ${newLessons.length} new lesson${newLessons.length > 1 ? 's' : ''}` : ''}${best && stories[0] ? `. best was ${names.get(best.agentId) ?? best.agentId}` : ''}.` : ''
  const lifeLine = lifeStories(since)[0]
  const health = `${up ? 'ollama up' : 'ollama is DOWN'}${pace ? `, ${Math.round(pace.avgMinutesPerWorld)} min a world` : ''}, ${diskLine().replace(/^disk: /, '')}.`
  const lines = [...lead, tally, ...(lifeLine ? [lifeLine] : []), health].filter(Boolean).slice(0, 4)
  saveState({ lastMorning: new Date().toISOString(), morningLessons: lessons.length })
  return lines.filter(Boolean).join('\n')
}

// D's life stories, when D writes them (data/life/stories.json or data/life-stories.json: entries with text and a time)
function lifeStories(since: number): string[] {
  for (const f of [path.join('data', 'life', 'stories.json'), path.join('data', 'life-stories.json')]) {
    const raw = readJson<unknown>(path.join(process.cwd(), f))
    const list = Array.isArray(raw) ? raw : (raw as { stories?: unknown[] } | null)?.stories
    if (!Array.isArray(list)) continue
    return list.map(x => x as { text?: string; line?: string; at?: string })
      .filter(x => (x.text || x.line) && (!x.at || Date.parse(x.at) >= since)).map(x => (x.text ?? x.line)!)
  }
  return []
}

// ---------- schedule ----------
const hoursSince = (iso?: string) => (iso ? (Date.now() - Date.parse(iso)) / 3600e3 : Infinity)
export const backupDue = () => hoursSince(readState().lastBackup) >= 24
export const stableDue = () => { const h = new Date().getHours(); return hoursSince(readState().lastStable) >= 20 && h >= 3 && h < 6 }
export const morningDue = () => new Date().getHours() >= 8 && (readState().lastMorning ? today(new Date(readState().lastMorning!)) !== today() : true)
export const qualityDue = () => hoursSince(readState().lastQuality) >= 7 * 24
export const markQuality = () => saveState({ lastQuality: new Date().toISOString() })
