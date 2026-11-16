// the consistency suite runner (C owns the runner; A, B and D write the checks in tests/consistency).
// one source of truth: every name, age, date and number a page, report or telegram shows must agree with the sim
// records. the suite runs
//   - before every commit, from any agent (.git/hooks/pre-commit calls scripts/consistency.ts --hook), on the
//     latest few real worlds and lives, so it stays quick
//   - nightly, on the worlds and lives from the last day (telegram only when a check fails, in plain words)
//   - before stable is promoted, on the exact data the deployed site will serve
// the checks find their data through process.cwd() (the project's data/), and get the ids to check in
// HYP_CONSISTENCY_RUNS and HYP_CONSISTENCY_LIVES (comma lists; empty means "pick your own").
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { listWorlds, livesFile, readIndex } from '../life/store'
import { dirs, readRunIndex } from './store'

export type Failure = { name: string; why: string }
export type SuiteResult = { ran: boolean; total: number; passed: number; failed: Failure[]; note: string }

// every *.test.ts under tests/consistency of the code being checked
export function suiteFiles(codeRoot: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.test.ts')) out.push(p)
    }
  }
  walk(path.join(codeRoot, 'tests', 'consistency'))
  return out.sort()
}

const mtime = (f: string) => { try { return fs.statSync(f).mtimeMs } catch { return 0 } }

// the newest finished real worlds (by when their record was written): `since` ms, or else the newest `max`
export function latestWorlds(opts: { since?: number; max: number }): string[] {
  const rows = readRunIndex().map(r => {
    const at = Math.max(mtime(path.join(dirs.runs, `${r.runId}.json`)), mtime(path.join(dirs.runs, `${r.runId}.json.gz`)))
    return { id: r.runId, at }
  }).filter(r => r.at > 0).sort((a, b) => b.at - a.at)
  const recent = opts.since ? rows.filter(r => r.at >= opts.since!) : []
  return (recent.length ? recent : rows).slice(0, opts.max).map(r => r.id)
}

// the newest lives, living or ended (D's data/lives), the same way
export function latestLives(opts: { since?: number; max: number }): string[] {
  const rows: { id: string; at: number }[] = []
  try {
    for (const w of listWorlds()) for (const s of readIndex(w)) rows.push({ id: s.lifeId, at: mtime(livesFile(w, `${s.lifeId}.json`)) })
  } catch { /* no lives yet */ }
  rows.sort((a, b) => b.at - a.at)
  const recent = opts.since ? rows.filter(r => r.at >= opts.since! && r.at > 0) : []
  return (recent.length ? recent : rows.filter(r => r.at > 0)).slice(0, opts.max).map(r => r.id)
}

// node's tap output -> the checks that failed, each with its own message (suites that only failed because a check
// inside them did are left out, so every line is one real check)
export function parseTap(tap: string): { total: number; passed: number; failed: Failure[] } {
  const lines = tap.split('\n')
  const failed: Failure[] = []
  let total = 0, passed = 0
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(not ok|ok) \d+ - (.*?)(\s+#.*)?$/.exec(lines[i])
    if (!m) continue
    // a yaml block follows; a suite says "subtestsFailed" or has nested results before it
    let why = '', suite = false
    for (let j = i + 1; j < lines.length && j < i + 60; j++) {
      const l = lines[j]
      if (/^\s*\.\.\.\s*$/.test(l)) break
      if (/^\s*(not ok|ok) \d+ - /.test(l)) break
      if (/failureType: '?subtestsFailed/.test(l) || /^\s*type: 'suite'/.test(l)) suite = true
      const e = /^\s*error: (.*)$/.exec(l)
      if (e && !why) {
        let v = e[1].trim()
        if (/^[|>]-?$/.test(v)) v = (lines[j + 1] ?? '').trim()
        why = v.replace(/^['"]|['"]$/g, '').replace(/\\n/g, ' ').trim()
      }
    }
    if (suite) continue
    total++
    if (m[2] === 'ok') passed++
    else failed.push({ name: m[3].replace(/\\#/g, '#').trim(), why: why.slice(0, 240) })
  }
  return { total, passed, failed }
}

// runs the checks of `codeRoot` against the data in `dataRoot`
export function runSuite(opts: { codeRoot: string; dataRoot: string; runs?: string[]; lives?: string[]; timeoutMs?: number; env?: Record<string, string> }): SuiteResult {
  const files = suiteFiles(opts.codeRoot)
  if (!files.length) return { ran: false, total: 0, passed: 0, failed: [], note: 'no consistency checks yet (tests/consistency is empty)' }
  // tsx from the code being checked, or the project's own (worktrees often have no node_modules)
  const tsx = [opts.codeRoot, opts.dataRoot].map(r => path.join(r, 'node_modules', 'tsx', 'dist', 'cli.mjs')).find(f => fs.existsSync(f))
  if (!tsx) return { ran: false, total: 0, passed: 0, failed: [{ name: 'the suite could start', why: 'tsx is not installed' }], note: 'tsx missing' }
  const r = spawnSync(process.execPath, [tsx, '--tsconfig', path.join(opts.codeRoot, 'tsconfig.json'), '--test', '--test-reporter=tap', ...files], {
    cwd: opts.dataRoot, encoding: 'utf8', timeout: opts.timeoutMs ?? 10 * 60_000, maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env, ...opts.env, HYP_CODE_ROOT: opts.codeRoot, LLM_PROVIDER: 'offline', NEXT_TELEMETRY_DISABLED: '1',
      NODE_PATH: path.join(opts.dataRoot, 'node_modules'),
      HYP_CONSISTENCY_RUNS: (opts.runs ?? []).join(','), HYP_CONSISTENCY_LIVES: (opts.lives ?? []).join(','),
    },
  })
  const t = parseTap(r.stdout ?? '')
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return { ran: true, ...t, failed: [...t.failed, { name: 'the suite finished in time', why: `it was still running after ${Math.round((opts.timeoutMs ?? 600_000) / 1000)}s` }], note: 'timed out' }
  }
  // it crashed before reporting anything (a syntax error, a missing import): that is a failure too
  if (r.status !== 0 && !t.failed.length) {
    const why = `${r.stderr ?? ''}\n${r.stdout ?? ''}`.split('\n').map(l => l.trim()).find(l => /error/i.test(l)) ?? `exit code ${r.status}`
    return { ran: true, ...t, failed: [{ name: 'the suite could run', why: why.slice(0, 240) }], note: 'crashed' }
  }
  return { ran: true, ...t, note: t.failed.length ? `${t.failed.length} of ${t.total} checks failed` : `all ${t.total} checks passed` }
}

// plain words for a person: what failed, not stack traces
export function failureText(r: SuiteResult, where: string, max = 5): string {
  const lines = r.failed.slice(0, max).map(f => `- ${f.name}${f.why ? `: ${f.why}` : ''}`)
  const more = r.failed.length > max ? [`and ${r.failed.length - max} more.`] : []
  const head = r.total ? `consistency check failed on ${where}: ${r.failed.length} of ${r.total} checks disagree with the records.` : `consistency check failed on ${where}.`
  return [head, ...lines, ...more].join('\n')
}
