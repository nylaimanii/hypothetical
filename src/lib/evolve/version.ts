// sim versions. every world records the version of the sim that ran it, and the leaderboard, steps, hall and
// learning curve are kept per version: when the version changes, the current files move to data/versions/<old>/
// and the new version starts clean. lessons carry forward (the governor still sees them) but are marked
// unverified until a world on the new version confirms them.
//
// the version is B's SIM_VERSION constant when one exists in src/lib/sim, otherwise a hash of the sim and agent
// source. in the runner both come from git: the runner's commit, and origin/main for what B has pushed, so
// uncommitted sim code never decides a version.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Lesson } from '../types'
import { readJson, writeJson } from './store'

const root = () => process.cwd()
// where the running code lives. scripts/run-evolve.sh runs evolve from a clean worktree of origin/main
// (HYP_CODE_ROOT) while the working directory stays the shared project, so data is shared but code is committed
export const codeRoot = () => process.env.HYP_CODE_ROOT || process.cwd()
export const inRunner = () => !!process.env.HYP_CODE_ROOT
const versionFile = () => path.join(root(), 'data', 'version.json')
export const versionDir = (v: string) => path.join(root(), 'data', 'versions', v.replace(/[^A-Za-z0-9._-]/g, '_'))

// the files that hold one version's results (paths relative to data/)
const PER_VERSION = ['leaderboard.json', 'steps.json', 'hall.json', 'learning.json', 'runs/features.json']

export type VersionFile = { current: string; since: string; history: { version: string; since: string; until: string }[] }
export type VersionedLesson = Lesson & { simVersion?: string; verified?: boolean; verifiedIn?: string[] }

function sources(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name)
      return e.isDirectory() ? sources(p) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : []
    }).sort()
  } catch { return [] }
}

// what decides a world's outcome: the sim, the governor, and D's lives when the sim uses them
const SIM_PATHS = ['src/lib/sim', 'src/lib/agent', 'src/lib/life']
// the evolution runner's own code: a pushed change to these restarts evolve at the next generation boundary
const RUNNER_PATHS = ['src/lib/evolve', 'src/lib/notify', 'scripts/evolve.ts', 'scripts/run-evolve.sh']
const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 })

// the sim version of a git ref: its SIM_VERSION constant, or a hash of the sim and agent trees at that ref
export function simVersionOfRef(ref: string, repo = codeRoot()): string {
  try {
    const m = /export\s+const\s+SIM_VERSION\s*=\s*['"`]([^'"`]+)['"`]/.exec(git(['show', `${ref}:src/lib/sim/version.ts`], repo))
    if (m) return m[1]
  } catch { /* no version file at that ref */ }
  const tree = git(['ls-tree', '-r', ref, '--', ...SIM_PATHS], repo)
  return `tree-${crypto.createHash('sha256').update(tree).digest('hex').slice(0, 10)}`
}

// the version pushed to origin/main right now (fetches first)
export function upstreamSimVersion(repo = process.cwd()): string | null {
  try { git(['fetch', '-q', 'origin', 'main'], repo); return simVersionOfRef('origin/main', repo) } catch { return null }
}

// in the runner: has the evolution code changed on origin/main since this process started? (call after a fetch,
// e.g. upstreamSimVersion). the sim version stays the same, so no rollover, only a restart onto the new code
export function runnerCodeChanged(): boolean {
  if (!inRunner()) return false
  try { execFileSync('git', ['diff', '--quiet', 'HEAD', 'origin/main', '--', ...RUNNER_PATHS], { cwd: codeRoot(), stdio: 'ignore', timeout: 60_000 }); return false } catch { return true }
}

// the version of the code this process runs: the runner's commit, or (outside the runner) the files on disk
export function runningSimVersion(): string {
  if (inRunner()) { try { return simVersionOfRef('HEAD', codeRoot()) } catch { /* fall through */ } }
  return simVersionOnDisk()
}

export function simVersionOnDisk(): string {
  const files = SIM_PATHS.flatMap(p => sources(path.join(codeRoot(), ...p.split('/'))))
  for (const f of files) {
    const m = /export\s+const\s+SIM_VERSION\s*=\s*['"`]([^'"`]+)['"`]/.exec(fs.readFileSync(f, 'utf8'))
    if (m) return m[1]
  }
  const h = crypto.createHash('sha256')
  for (const f of files) h.update(path.relative(codeRoot(), f)).update(fs.readFileSync(f))
  return `src-${h.digest('hex').slice(0, 10)}`
}

export function readVersion(): VersionFile | null {
  return readJson<VersionFile>(versionFile())
}
export const currentVersion = () => readVersion()?.current ?? runningSimVersion()

// makes `v` the current version. if another version was current, its results move to data/versions/<old>/
// and lessons carry forward unverified. returns the previous version when a rollover happened
export function enterVersion(v: string): string | null {
  const cur = readVersion()
  const now = new Date().toISOString()
  if (cur?.current === v) return null
  if (!cur) { writeJson(versionFile(), { current: v, since: now, history: [] }); return null }
  const dir = versionDir(cur.current)
  for (const rel of PER_VERSION) {
    const from = path.join(root(), 'data', rel)
    if (!fs.existsSync(from)) continue
    const to = path.join(dir, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.renameSync(from, to)
  }
  const lessonsPath = path.join(root(), 'data', 'lessons.json')
  const lessons = readJson<VersionedLesson[]>(lessonsPath)
  if (lessons) {
    fs.mkdirSync(dir, { recursive: true })
    writeJson(path.join(dir, 'lessons.json'), lessons)
    writeJson(lessonsPath, lessons.map(l => ({ ...l, simVersion: l.simVersion ?? cur.current, verified: (l.verifiedIn ?? []).includes(v) })))
  }
  writeJson(versionFile(), { current: v, since: now, history: [...cur.history, { version: cur.current, since: cur.since, until: now }] })
  return cur.current
}

// a lesson is verified on the current version when a world on it dies of the mistake it names,
// or applies it and survives
export function verifyLessons(ids: string[], v: string) {
  if (!ids.length) return
  const p = path.join(root(), 'data', 'lessons.json')
  const lessons = readJson<VersionedLesson[]>(p)
  if (!lessons) return
  let changed = false
  for (const l of lessons) {
    if (!ids.includes(l.id) || (l.verifiedIn ?? []).includes(v)) continue
    l.verifiedIn = [...(l.verifiedIn ?? []), v]
    l.verified = true
    changed = true
  }
  if (changed) writeJson(p, lessons)
}

// a per-version file: the live one for the current version, the archived one for any older version
export function versionedPath(rel: string, v?: string | null): string {
  if (!v || v === readVersion()?.current) return path.join(root(), 'data', rel)
  return path.join(versionDir(v), rel)
}
