// starts scripts/live.ts as a detached background process. returns false when the runner is not available
// (deployed copies have no scripts or tsx), so routes can answer 404/503 instead of crashing.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { dirs } from './store'

export function runnerAvailable(): boolean {
  const root = process.cwd()
  return fs.existsSync(path.join(root, 'scripts', 'live.ts')) && fs.existsSync(path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'))
}

export function spawnRunner(runId: string, constitution: string, args: string[]): boolean {
  if (!runnerAvailable()) return false
  const root = process.cwd()
  fs.mkdirSync(dirs.live, { recursive: true })
  const cfile = path.join(dirs.live, `${runId}.constitution.txt`)
  fs.writeFileSync(cfile, constitution)
  const log = fs.openSync(path.join(dirs.live, `${runId}.log`), 'a')
  const child = spawn(process.execPath, [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(root, 'scripts', 'live.ts'), '--runId', runId, '--constitution-file', cfile, ...args], {
    cwd: root, detached: true, stdio: ['ignore', log, log], env: process.env,
  })
  child.unref()
  return true
}

export const newRunId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`
