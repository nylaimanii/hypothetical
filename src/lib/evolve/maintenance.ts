// daily and weekly upkeep, scheduled by the evolve watchdog (state in data/maintenance.json):
//   backup   daily: the small files that hold what the ai learned go to the origin "data-backup" branch, built with
//            a throwaway git index so the shared working tree and its index are never touched
//   stable   daily: origin/main plus the real showcase data (deploy.ts); if that typechecks, builds, passes the tests
//            and the consistency suite in a clean copy, origin "stable" moves to it (vercel deploys from stable)
//   morning  8am: one telegram digest of the night
//   consistency  nightly: tests/consistency on the last day's worlds and lives, telegram only on a failure
//   quality  weekly: replay the champion's best world with a bigger model and say whether the result holds up
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RunRecord } from '../types'
import { readAgents } from './agents'
import { readLessons } from './lessons'
import { readJson, readRunIndex, readRunRecord, writeJson, type IndexedRun } from './store'
import { worldStory } from '../notify/story'
import { codeRoot, readVersion } from './version'
import { diskLine } from './retention'
import { ollamaUp } from './ollama'
import { paceStats } from './usage'
import { livesSection } from './lives'
import { checkDeploy, copyDeploy, deployFiles } from './deploy'
import { writeTradeoffs } from './tradeoffs'
import { readEvidence, realBaseline } from './evidence'
import { failureText, runSuite } from './consistency'
import { freshSteps } from './steps'
import { populationOf, yearOfTick } from './facts'

type State = { lastBackup?: string; backupSha?: string; lastStable?: string; stableSha?: string; stableNote?: string; lastMorning?: string; morningLessons?: number; lastQuality?: string; lastQualityRun?: string; lastConsistency?: string; consistencyNote?: string; consistencyWarned?: string }
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
// vercel deploys origin "stable": origin/main plus one commit with the real data the read-only site serves (see
// deploy.ts). in a clean copy of exactly that tree: typecheck, build (read-only, like vercel), the unit tests, the
// deploy check (worlds that open, agents that exist) and the consistency suite on the deployed data. all pass ->
// stable moves to the new commit, whose parents are the old stable and origin/main, so the push is a fast-forward
export function promoteStable(log: (l: string) => void = console.log, opts: { dry?: boolean; keep?: (dir: string) => void } = {}): { promoted: boolean; sha: string; note: string } {
  git(['fetch', '-q', 'origin', 'main', 'stable'])
  const sha = git(['rev-parse', 'origin/main'])
  let prev: string | null = null
  try { prev = git(['rev-parse', 'origin/stable']) } catch { /* first deploy */ }
  // the recipe is recomputed first so the deploy carries the current one
  try { freshSteps(true) } catch { /* steps are optional */ }
  try { writeTradeoffs() } catch { /* the tradeoff map is optional */ }
  const files = deployFiles()
  // the tree stable would get: main's code and committed data, plus the snapshot
  const index = path.join(os.tmpdir(), `hyp-stable-index-${process.pid}`)
  const env = { GIT_INDEX_FILE: index }
  let tree: string
  try {
    fs.rmSync(index, { force: true })
    git(['read-tree', sha], env)
    for (const f of files) git(['update-index', '--add', '--cacheinfo', `100644,${git(['hash-object', '-w', '--', f])},${f}`], env)
    tree = git(['write-tree'], env)
  } finally { fs.rmSync(index, { force: true }) }
  if (prev && git(['rev-parse', `${prev}^{tree}`]) === tree) return { promoted: false, sha, note: 'stable already has this code and data' }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyp-stable-'))
  const run = (cmd: string, args: string[], cwd = dir, extra: Record<string, string> = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 20 * 60_000, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', LLM_PROVIDER: 'offline', ...extra } })
  const fail = (note: string) => { if (!opts.dry) saveState({ lastStable: new Date().toISOString(), stableNote: note }); return { promoted: false, sha, note } }
  try {
    const arch = run('sh', ['-c', `git -C "${process.cwd()}" archive ${sha} | tar -x -C "${dir}"`], process.cwd())
    if (arch.status !== 0) return fail(`could not export origin/main: ${arch.stderr.slice(0, 200)}`)
    copyDeploy(files, dir)
    const problems = checkDeploy(dir)
    if (problems.length) return fail(`deploy check failed on ${sha.slice(0, 7)}: ${problems.slice(0, 3).join('; ')}`)
    // apfs clones make this copy nearly free
    const cp = run('cp', ['-cR', fs.realpathSync(path.join(codeRoot(), 'node_modules')), path.join(dir, 'node_modules')], process.cwd())
    if (cp.status !== 0) return fail('could not copy node_modules')
    const steps: [string, string, string[], Record<string, string>][] = [
      ['typecheck', 'npx', ['tsc', '--noEmit', '-p', '.'], {}],
      ['build', 'npm', ['run', 'build'], { READ_ONLY: '1' }],
      ['tests', 'npx', ['tsx', '--test', 'src/lib/evolve/queue.test.ts'], {}],
    ]
    for (const [name, cmd, args, extra] of steps) {
      log(`stable: ${name} on ${sha.slice(0, 7)}`)
      const r = run(cmd, args, dir, extra)
      if (r.status !== 0) return fail(`${name} failed on ${sha.slice(0, 7)}: ${(r.stdout + r.stderr).split('\n').filter(l => /^\s*✖|error|not ok/i.test(l) && !/^\s*✔/.test(l)).slice(0, 3).join(' | ').slice(0, 300)}`)
    }
    log(`stable: consistency on ${sha.slice(0, 7)} with the deployed data`)
    const c = runSuite({ codeRoot: dir, dataRoot: dir, env: { READ_ONLY: '1' } })
    if (c.failed.length) return fail(failureText(c, `the deploy of ${sha.slice(0, 7)}`, 3))
    const worlds = files.filter(f => /^data\/showcase\/.*\.json(\.gz)?$/.test(f) && !f.endsWith('index.json')).length
    const lives = files.filter(f => /^data\/lives\/.*-life-\d+\.json$/.test(f)).length
    const commit = git(['commit-tree', tree, ...(prev ? ['-p', prev] : []), '-p', sha, '-m', `deploy ${sha.slice(0, 7)} with ${worlds} showcase worlds and ${lives} lives (${today()})`])
    opts.keep?.(dir)
    if (opts.dry) return { promoted: false, sha, note: `dry run: would move stable to ${commit.slice(0, 7)} (${worlds} worlds, ${lives} lives)` }
    // a normal push only fast-forwards; if stable ever diverged this fails loudly instead of overwriting it
    git(['push', '-q', 'origin', `${commit}:refs/heads/stable`])
    saveState({ lastStable: new Date().toISOString(), stableSha: sha, stableNote: 'promoted' })
    return { promoted: true, sha, note: `stable moved to ${commit.slice(0, 7)} (origin/main ${sha.slice(0, 7)}, ${worlds} worlds, ${lives} lives)` }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// ---------- morning digest ----------
// is the ai beating "do nothing" yet? each world against its no-ai twin (same seed, 2026 policies frozen) at the
// same tick: it beats the twin when it is still standing and has at least as many people alive
export function twinVerdict(recs: RunRecord[], version?: string): string | null {
  const rows = recs.map(rec => {
    const last = [...rec.frames].sort((a, b) => b.tick - a.tick)[0]
    const b = [...(rec.baseline ?? [])].filter(x => !last || x.tick <= last.tick).sort((x, y) => y.tick - x.tick)[0]
    if (!last || !b) return null
    const ai = populationOf(last)
    const tw = populationOf(b)
    const aiMoonF = [...rec.frames].sort((x, y) => x.tick - y.tick).find(f => f.frontier && f.frontier !== 'none')
    const twMoon = [...rec.baseline].sort((x, y) => x.tick - y.tick).find(x => x.moonProgress >= 1)
    const aiAlive = last.status !== 'destroyed', twAlive = b.status !== 'destroyed'
    return { beat: aiAlive && (ai >= tw || !twAlive), gap: ai - tw, moonLead: aiMoonF && twMoon ? yearOfTick(twMoon.tick) - yearOfTick(aiMoonF.tick) : null }
  }).filter((x): x is NonNullable<typeof x> => !!x)
  if (!rows.length) return null
  const won = rows.filter(r => r.beat).length
  const m = (n: number) => `${Math.round(Math.abs(n) / 1e6)} million`
  const gaps = rows.map(r => r.gap).sort((a, b) => a - b)
  const range = (xs: number[]) => xs.length === 1 || m(xs[0]) === m(xs[xs.length - 1]) ? m(xs[0]) : `${m(xs[0]).replace(' million', '')} to ${m(xs[xs.length - 1])}`
  const behind = gaps.filter(g => g < 0), ahead = gaps.filter(g => g >= 0)
  const leads = rows.map(r => r.moonLead).filter((x): x is number => x !== null && x > 0).sort((a, b) => a - b)
  const moon = leads.length ? `, though it reached the moon ${leads[0] === leads[leads.length - 1] ? leads[0] : `${leads[0]} to ${leads[leads.length - 1]}`} years sooner` : ''
  const on = version ? ` on ${version}` : ''
  if (won === rows.length) return `is the ai beating "do nothing" yet? yes: in ${rows.length === 1 ? 'the 1 world' : `all ${rows.length} worlds`}${on} it kept more people alive than the no-ai twin${ahead.length ? `, by ${range(ahead)}` : ''}.`
  if (won === 0) return `is the ai beating "do nothing" yet? no: in 0 of ${rows.length} world${rows.length === 1 ? '' : 's'}${on} did it keep more people alive than the no-ai twin (it trailed by ${range(behind.map(Math.abs).sort((a, b) => a - b))})${moon}.`
  return `is the ai beating "do nothing" yet? sometimes: in ${won} of ${rows.length} world${rows.length === 1 ? '' : 's'}${on} it kept more people alive than the no-ai twin${moon}.`
}

// the digest's first line: the verdict on the current sim version's worlds only. right after a switch, before the
// new version has a finished world, say so (and what the older version showed) instead of dropping the line
export function verdictLine(runs: IndexedRun[], current: string | undefined, read: (id: string) => RunRecord | null = readRunRecord): string | null {
  const recs = (v: string | undefined) => runs.filter(r => r.simVersion === v).map(r => read(r.runId)).filter((x): x is RunRecord => !!x)
  const now = twinVerdict(recs(current), current)
  if (now || !current) return now
  const older = [...new Set(runs.map(r => r.simVersion).filter((v): v is string => !!v && v !== current))].pop()
  const before = older ? twinVerdict(recs(older), older) : null
  return `is the ai beating "do nothing" yet? no ${current} worlds have finished yet, so no answer on the new sim${before ? ` (${before.replace(/^is the ai beating "do nothing" yet\? /, 'before the switch, ').replace(/\.$/, '')}).` : '.'}`
}

// dry: build the text without marking the digest sent (npm run morning -- --dry)
export async function morningDigest(opts: { dry?: boolean } = {}): Promise<string> {
  // everything since the last digest (at most a day back), so evening worlds count in the next morning
  const st0 = readState()
  const since = Math.max(Date.now() - 24 * 3600e3, st0.lastMorning ? Date.parse(st0.lastMorning) : 0)
  const day = (offset: number) => { const d = new Date(Date.now() - offset * 864e5); return d.toISOString().slice(0, 10) }
  const usage = [day(0), day(1)].flatMap(d => readJson<{ worlds: { runId: string; outcome: string; at: string; wallMs: number }[] }>(path.join(process.cwd(), 'data', 'reports', `usage-${d}.json`))?.worlds ?? [])
  const index = new Map(readRunIndex().map(r => [r.runId, r]))
  // worlds still in the run index (discarded or archived worlds do not count)
  const night = [...new Map(usage.filter(w => w.outcome === 'finished' && Date.parse(w.at) >= since && index.has(w.runId)).map(w => [w.runId, w])).values()]
  const runs = night.map(w => index.get(w.runId)).filter((r): r is IndexedRun => !!r)
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
  // every score next to the real baseline: the best world against UN projections at the same year
  const bestBase = best ? (readEvidence()[best.runId]?.realBaseline ?? (() => { const r = readRunRecord(best.runId); return r ? realBaseline(r) : null })()) : null
  const byVersion = [...runs.reduce((m, r) => m.set(r.simVersion ?? '?', (m.get(r.simVersion ?? '?') ?? 0) + 1), new Map<string, number>())]
  const versions = byVersion.length > 1 ? ` (${byVersion.map(([v, n]) => `${n} on ${v}`).join(', ')})` : ''
  const tally = night.length ? `${night.length} worlds overnight${versions}${deaths.length ? `, ${deaths.length} died` : ', nobody died'}${newLessons.length ? `, ${newLessons.length} new lesson${newLessons.length > 1 ? 's' : ''}` : ''}${best && stories[0] ? `. best was ${names.get(best.agentId) ?? best.agentId}${bestBase ? `, which ${bestBase.text}` : ''}` : ''}.` : ''
  // D's chosen lives: the most interesting one that ended, at most 2 lines
  const lives = livesSection(since)
  const health = `${up ? 'ollama up' : 'ollama is DOWN'}${pace ? `, ${Math.round(pace.avgMinutesPerWorld)} min a world` : ''}, ${diskLine().replace(/^disk: /, '')}.`
  // a sim switch overnight resets the leaderboard, worth one line
  const switched = (readVersion()?.history ?? []).filter(h => Date.parse(h.until) >= since).pop()
  const switchLine = switched ? `the sim changed overnight (${switched.version} to ${readVersion()!.current}), so the leaderboard started over.` : ''
  const verdict = verdictLine(runs, readVersion()?.current)
  const lines = [...(verdict ? [verdict] : []), ...lead, tally, ...(switchLine ? [switchLine] : []), ...lives, health].filter(Boolean)
  if (!opts.dry) saveState({ lastMorning: new Date().toISOString(), morningLessons: lessons.length })
  return lines.filter(Boolean).join('\n')
}

// sends the digest once per day, from whichever process gets there first (evolve's watchdog at 8am, or the launchd
// job that macOS runs on wake when the mac slept through 8). a claim file per local date stops a double send; a
// failed send (no network yet after wake) gives the claim back so the next try sends it
const readFileOr = (f: string) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
const claimFile = () => path.join(process.cwd(), 'data', `.morning-${today()}`)
export async function sendMorning(send: (text: string) => Promise<boolean>, log: (l: string) => void = console.log): Promise<boolean> {
  if (!morningDue()) return false
  fs.mkdirSync(path.dirname(claimFile()), { recursive: true })
  const claim = () => { try { fs.writeFileSync(claimFile(), String(process.pid), { flag: 'wx' }); return true } catch { return false } }
  if (!claim()) {
    // a claim left by a process that died before sending is taken over
    const pid = Number(readFileOr(claimFile()))
    let dead = !pid
    try { if (pid) process.kill(pid, 0) } catch { dead = true }
    if (!dead) return false
    fs.rmSync(claimFile(), { force: true })
    if (!claim()) return false
  }
  let ok = false
  try {
    const text = await morningDigest({ dry: true })
    ok = await send(text)
    if (ok) saveState({ lastMorning: new Date().toISOString(), morningLessons: readLessons().length })
    else log('morning digest: telegram send failed, will retry')
  } catch (e) { log(`morning digest failed: ${(e as Error).message}`) }
  if (!ok) fs.rmSync(claimFile(), { force: true })
  else for (const f of fs.readdirSync(path.join(process.cwd(), 'data')).filter(f => f.startsWith('.morning-') && f !== path.basename(claimFile()))) fs.rmSync(path.join(process.cwd(), 'data', f), { force: true })
  return ok
}

// ---------- schedule ----------
const hoursSince = (iso?: string) => (iso ? (Date.now() - Date.parse(iso)) / 3600e3 : Infinity)
export const backupDue = () => hoursSince(readState().lastBackup) >= 24
export const stableDue = () => { const h = new Date().getHours(); return hoursSince(readState().lastStable) >= 20 && h >= 3 && h < 6 }
export const morningDue = () => new Date().getHours() >= 8 && (readState().lastMorning ? today(new Date(readState().lastMorning!)) !== today() : true)
// lastQualityRun: set only when a replay actually ran (older code also wrote lastQuality on a skip, so it is ignored)
export const qualityDue = () => hoursSince(readState().lastQualityRun) >= 7 * 24
export const markQuality = () => saveState({ lastQualityRun: new Date().toISOString() })
// the nightly consistency suite: from 2am, once a day (the 8:05 launchd job catches up after a night asleep)
export const consistencyDue = () => new Date().getHours() >= 2 && hoursSince(readState().lastConsistency) >= 20
export const markConsistency = (note: string) => saveState({ lastConsistency: new Date().toISOString(), consistencyNote: note })
// the set of older-data warnings last sent, so a warnings-only telegram goes out once per new set
export const markConsistencyWarned = (sig: string) => saveState({ consistencyWarned: sig })
