// npm run consistency: run tests/consistency (every name, age, date and number shown anywhere agrees with the sim
// records) on the latest real worlds and lives, and print what failed in plain words.
//   --hook      before a commit (.git/hooks/pre-commit runs this from the committing worktree): the newest 3 worlds
//               and 3 lives, exit 1 on any failure so the commit stops
//   --nightly   the worlds and lives from the last day; telegram only when a check fails (evolve runs this daily
//               between 2 and 7am, and the 8am launchd job catches up if the mac was asleep)
//   --if-due    with --nightly: only if it has not run in the last 20 hours
// the code checked is HYP_CODE_ROOT (default: this checkout); the data is always the project's data/ (cwd)
import '../src/lib/evolve/env'
import { failureText, latestLives, latestWorlds, runSuite } from '../src/lib/evolve/consistency'
import { consistencyDue, markConsistency } from '../src/lib/evolve/maintenance'
import { codeRoot } from '../src/lib/evolve/version'
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
  const text = failureText(r, where)
  console.error(text)
  if (nightly) {
    markConsistency(r.note)
    const ok = await send(text)
    if (!ok) console.error('consistency: telegram send failed')
  }
  if (hook) console.error('\nfix the page or the shared function so it reads the record, then commit again. the checks live in tests/consistency.')
  return hook ? 1 : 0
}
main().then(code => process.exit(code), e => { console.error(`consistency: the runner itself failed: ${(e as Error).message}`); process.exit(has('--hook') ? 1 : 0) })
