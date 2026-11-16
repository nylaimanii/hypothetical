// one evolve at a time. data/.evolve.lock holds the pid of the running evolve. a lock whose pid is dead, or now
// belongs to some other program (pids are reused after a restart), is stale and taken over.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const lockFile = () => path.join(process.cwd(), 'data', '.evolve.lock')
const nowFile = () => path.join(process.cwd(), 'data', 'evolve-now.json')

// is pid an evolve process? (its command line runs scripts/evolve.ts)
export function isEvolvePid(pid: number): boolean {
  if (!pid || pid === process.pid) return false
  try { process.kill(pid, 0) } catch { return false }
  try { return /scripts\/evolve\.ts/.test(execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })) } catch { return false }
}

// the evolve already running, from the lock or (older evolves never wrote one) from data/evolve-now.json
export function runningEvolve(): number | null {
  for (const f of [lockFile(), nowFile()]) {
    try { const pid = Number((JSON.parse(fs.readFileSync(f, 'utf8')) as { pid?: number }).pid); if (isEvolvePid(pid)) return pid } catch { /* none */ }
  }
  return null
}

// takes the lock, or returns the pid that holds it
export function acquireEvolveLock(): { ok: true; release: () => void } | { ok: false; pid: number } {
  const other = runningEvolve()
  if (other) return { ok: false, pid: other }
  fs.mkdirSync(path.dirname(lockFile()), { recursive: true })
  fs.writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, since: new Date().toISOString() }))
  return { ok: true, release: () => { try { if ((JSON.parse(fs.readFileSync(lockFile(), 'utf8')) as { pid: number }).pid === process.pid) fs.rmSync(lockFile(), { force: true }) } catch { /* gone */ } } }
}

// when this mac last booted (ms), from sysctl kern.boottime ("{ sec = 1731700000, usec = 0 } ...")
export function bootTime(): number | null {
  try { const m = /sec = (\d+)/.exec(execFileSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8' })); return m ? Number(m[1]) * 1000 : null } catch { return null }
}

// after a restart, the ollama lock, queue tickets and lives gap from before the boot are stale (b's lock also checks
// this since cdb3dee; this stays for the gap and evolve locks), but a pid in them
// may now belong to an unrelated process (pids are reused), which would make the lock look held forever.
// anything written before the boot is removed. returns what was cleared
export function clearPreBootLocks(boot = bootTime()): string[] {
  if (!boot) return []
  const data = path.join(process.cwd(), 'data')
  const cleared: string[] = []
  const old = (f: string) => { try { return fs.statSync(f).mtimeMs < boot } catch { return false } }
  for (const f of ['.ollama.lock', '.ollama.gap', '.evolve.lock']) { const p = path.join(data, f); if (old(p)) { fs.rmSync(p, { force: true }); cleared.push(f) } }
  // queue tickets: b's lock treats tickets older than the boot as stale itself (cdb3dee), by file time
  const q = path.join(data, '.ollama.queue')
  try { for (const t of fs.readdirSync(q)) if (old(path.join(q, t))) { fs.rmSync(path.join(q, t), { force: true }); cleared.push(`.ollama.queue/${t}`) } } catch { /* no queue */ }
  return cleared
}
