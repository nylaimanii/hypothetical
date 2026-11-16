// starts scripts/live.ts as a detached background process. returns false when the runner is not available
// (deployed copies have no scripts or tsx), so routes can answer 404/503 instead of crashing.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { dirs } from './store'

export function runnerAvailable(): boolean {
  const root = process.cwd()
  return fs.existsSync(path.join(root, 'scripts', 'live.ts')) && fs.existsSync(path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'))
}

// the one ollama lock every local world shares: data/.ollama.lock in the main checkout. a dev server running from a
// git worktree (or a scratch copy) would otherwise take its own data/.ollama.lock and run next to evolution instead of
// waiting its turn, slowing both (a rerun from a worktree did that on 2026-11-16). an explicit HYP_OLLAMA_LOCK wins
export function sharedOllamaLock(root = process.cwd()): string {
  if (process.env.HYP_OLLAMA_LOCK) return process.env.HYP_OLLAMA_LOCK
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const main = path.dirname(common)
    if (path.basename(common) === '.git' && fs.existsSync(path.join(main, 'data'))) return path.join(main, 'data', '.ollama.lock')
  } catch { /* not a git checkout */ }
  return path.join(root, 'data', '.ollama.lock')
}

export function spawnRunner(runId: string, constitution: string, args: string[]): boolean {
  if (!runnerAvailable()) return false
  const root = process.cwd()
  fs.mkdirSync(dirs.live, { recursive: true })
  const cfile = path.join(dirs.live, `${runId}.constitution.txt`)
  fs.writeFileSync(cfile, constitution)
  const log = fs.openSync(path.join(dirs.live, `${runId}.log`), 'a')
  const child = spawn(process.execPath, [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(root, 'scripts', 'live.ts'), '--runId', runId, '--constitution-file', cfile, ...args], {
    cwd: root, detached: true, stdio: ['ignore', log, log], env: { ...process.env, HYP_OLLAMA_LOCK: sharedOllamaLock(root) },
  })
  child.unref()
  return true
}

export const newRunId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`
