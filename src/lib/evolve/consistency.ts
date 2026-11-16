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

export type Failure = { name: string; why: string; file?: string }
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
    let why = '', suite = false, file: string | undefined
    for (let j = i + 1; j < lines.length && j < i + 60; j++) {
      const l = lines[j]
      if (/^\s*\.\.\.\s*$/.test(l)) break
      if (/^\s*(not ok|ok) \d+ - /.test(l)) break
      if (/failureType: '?subtestsFailed/.test(l) || /^\s*type: 'suite'/.test(l)) suite = true
      const loc = /^\s*location: '?(.*?):\d+:\d+'?\s*$/.exec(l)
      if (loc && !file) file = loc[1]
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
    else failed.push({ name: m[3].replace(/\\#/g, '#').trim(), why: why.slice(0, 240), ...(file ? { file } : {}) })
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

// ---------- what blocks a commit (the user's rule, 2026-11-16) ----------
// a commit is stopped only by a failing check that is (a) in a test for a file the commit changes (the test file
// itself, or anything it imports, directly or not) and (b) on a world or life of the current sim version (or on no
// world at all: a check of pure logic). every other failure is a warning: printed, and a line in the nightly
// telegram, never a block. so a sim bug found in an old record cannot stop another agent's unrelated commit

// the files a test reads, by following its relative and @/ imports inside codeRoot
export function testDeps(codeRoot: string, testFile: string): Set<string> {
  const seen = new Set<string>()
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith('@/') ? path.join(codeRoot, 'src', spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null
    if (!base) return null
    for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
    return null
  }
  const walk = (f: string) => {
    if (seen.has(f)) return
    seen.add(f)
    let src = ''
    try { src = fs.readFileSync(f, 'utf8') } catch { return }
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^import\s+['"]([^'"]+)['"]/gm)) {
      const r = resolve(f, m[1] ?? m[2] ?? m[3])
      if (r) walk(r)
    }
  }
  walk(path.resolve(testFile))
  return new Set([...seen].map(f => path.relative(codeRoot, f).split(path.sep).join('/')))
}

// every world and life id the data knows, with the sim version it was made by (a life: its world's)
export function dataVersions(dataRoot: string): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const r of readRunIndex()) out.set(r.runId, r.simVersion ?? null)
  try {
    for (const f of fs.readdirSync(dirs.live)) {
      if (!/^[A-Za-z0-9_-]+\.json$/.test(f)) continue
      const id = f.replace(/\.json$/, '')
      if (out.has(id)) continue
      try { const fd = fs.openSync(path.join(dirs.live, f), 'r'); const b = Buffer.alloc(4096); fs.readSync(fd, b, 0, 4096, 0); fs.closeSync(fd); const m = /"simVersion":"([^"]+)"/.exec(b.toString('utf8')); out.set(id, m ? m[1] : null) } catch { out.set(id, null) }
    }
  } catch { /* no live worlds */ }
  try { for (const w of listWorlds()) for (const s of readIndex(w)) out.set(s.lifeId, out.get(s.worldId ?? w) ?? null) } catch { /* no lives */ }
  void dataRoot
  return out
}

export type Verdict = { blocking: (Failure & { why2: string })[]; warnings: (Failure & { why2: string })[] }
export function classify(failed: Failure[], opts: { codeRoot: string; changed: string[] | null; current: string[]; versions: Map<string, string | null> }): Verdict {
  const ids = [...opts.versions.keys()].sort((a, b) => b.length - a.length)
  const deps = new Map<string, Set<string>>()
  const out: Verdict = { blocking: [], warnings: [] }
  for (const f of failed) {
    const text = `${f.name} ${f.why}`
    // (b) the data: the ids it names; none named means a check of logic, which counts as current
    const named: string[] = []
    let rest = text
    for (const id of ids) if (rest.includes(id)) { named.push(id); rest = rest.split(id).join(' ') }
    const old = named.length > 0 && named.every(id => !opts.current.includes(opts.versions.get(id) ?? ''))
    // (a) the files: a check the suite itself could not run blocks; otherwise its test must read a changed file
    let related = true
    if (opts.changed && f.file) {
      const rel = path.relative(opts.codeRoot, f.file).split(path.sep).join('/')
      if (!deps.has(rel)) deps.set(rel, testDeps(opts.codeRoot, f.file))
      related = opts.changed.some(c => deps.get(rel)!.has(c))
    }
    if (old) out.warnings.push({ ...f, why2: `on data from sim ${[...new Set(named.map(id => opts.versions.get(id) ?? 'unknown'))].join(', ')}, not the current ${opts.current.join(' or ')}` })
    else if (!related) out.warnings.push({ ...f, why2: 'its test does not read any file this commit changes' })
    else out.blocking.push({ ...f, why2: '' })
  }
  return out
}

export const warningLine = (w: Verdict['warnings'], max = 3) => w.length ? `warnings (on older data, never blocking): ${w.slice(0, max).map(x => `${x.name}${x.why ? `: ${x.why}` : ''}`).join('; ')}${w.length > max ? `; and ${w.length - max} more` : ''}` : ''
