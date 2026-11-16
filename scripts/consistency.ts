// npm run consistency: run tests/consistency (every name, age, date and number shown anywhere agrees with the sim
// records) on the latest real worlds and lives, and print what failed in plain words.
//   --hook      before a commit (.git/hooks/pre-commit runs this from the committing worktree): the newest 3 worlds
//               and 3 lives. exit 1 only on a failure in a test for a file the commit changes, on current-sim data
//               (or no data); every other failure is a warning (consistency.ts classify, the user's rule)
//   --nightly   the worlds and lives from the last day; telegram when a check fails on current-sim data, with failures
//               on older data as one warnings line (a warnings-only telegram once per new set) (evolve runs this daily
//               between 2 and 7am, and the 8am launchd job catches up if the mac was asleep)
//   --if-due    with --nightly: only if it has not run in the last 20 hours
// the code checked is HYP_CODE_ROOT (default: this checkout); the data is always the project's data/ (cwd)
import '../src/lib/evolve/env'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import { classify, dataVersions, failureText, latestLives, latestWorlds, runSuite, warningLine } from '../src/lib/evolve/consistency'
import { consistencyDue, markConsistency, markConsistencyWarned, readState } from '../src/lib/evolve/maintenance'
import { codeRoot, readVersion, simVersionOnDisk } from '../src/lib/evolve/version'
import { send } from '../src/lib/notify/telegram'

const has = (f: string) => process.argv.includes(f)

async function main(): Promise<number> {
  const hook = has('--hook'), nightly = has('--nightly')
  if (nightly && has('--if-due') && !consistencyDue()) { console.log('consistency: not due'); return 0 }
  const since = nightly ? Date.now() - 26 * 3600e3 : undefined
  const runs = latestWorlds({ since, max: hook ? 3 : 40 })
  const lives = latestLives({ since, max: hook ? 3 : 30 })
  if (nightly) markConsistency('running')
  const r = runSuite({ codeRoot: codeRoot(), dataRoot: process.cwd(), runs, lives, timeoutMs: hook ? 180_000 : 30 * 60_000 })
  const where = hook ? 'this commit' : nightly ? `last night's ${runs.length} worlds and ${lives.length} lives` : `the latest ${runs.length} worlds and ${lives.length} lives`
  if (!r.ran) { console.log(`consistency: ${r.note}`); if (nightly) markConsistency(r.note); return r.failed.length && hook ? 1 : 0 }
  if (!r.failed.length) { console.log(`consistency: ${r.note} (${where})`); if (nightly) markConsistency(r.note); return 0 }
  // which failures block: the commit's own files, on current-sim data (the nightly has no commit: data only)
  let changed: string[] | null = null
  if (hook) { try { changed = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: codeRoot(), encoding: 'utf8' }).split('\n').filter(Boolean) } catch { changed = null } }
  const current = [...new Set([readVersion()?.current, simVersionOnDisk()].filter((v): v is string => !!v))]
  const v = classify(r.failed, { codeRoot: codeRoot(), changed, current, versions: dataVersions(process.cwd()) })
  for (const w of v.warnings) console.error(`consistency warning (not blocking): ${w.name}${w.why ? `: ${w.why}` : ''} (${w.why2})`)
  if (!v.blocking.length) {
    const note = `${r.passed} of ${r.total} passed; ${v.warnings.length} warning${v.warnings.length === 1 ? '' : 's'} on older data or untouched files`
    console.log(`consistency: ${note} (${where})`)
    if (nightly) {
      markConsistency(note)
      // a warnings-only telegram once per new set, so the same old record does not repeat every night
      const sig = crypto.createHash('sha1').update(v.warnings.map(w => w.name).sort().join('|')).digest('hex').slice(0, 12)
      if (readState().consistencyWarned !== sig && await send(`consistency: every check on current-sim data passed (${where}). ${warningLine(v.warnings)}`)) markConsistencyWarned(sig)
    }
    return 0
  }
  const text = failureText({ ...r, failed: v.blocking }, where) + (v.warnings.length ? `\n${warningLine(v.warnings)}` : '')
  console.error(text)
  if (nightly) {
    markConsistency(r.note)
    const ok = await send(text)
    if (!ok) console.error('consistency: telegram send failed')
  }
  if (hook) console.error('\nfix the page or the shared function so it reads the record, then commit again. the checks live in tests/consistency. only failures in tests for files this commit changes, on current-sim data, stop a commit.')
  return hook ? 1 : 0
}
main().then(code => process.exit(code), e => { console.error(`consistency: the runner itself failed: ${(e as Error).message}`); process.exit(has('--hook') ? 1 : 0) })
