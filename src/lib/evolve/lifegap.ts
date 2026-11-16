// evolution first, chosen lives in the gaps.
// B's runWorld holds the ollama lock for a whole world, and D's lives (src/lib/life/decide.ts politeLlm) yield
// while evolve has worlds queued, so during a generation lives would never get a call. between two worlds, when
// lives are running, evolve steps aside: it writes data/.ollama.gap { until, pid } and waits until the gap ends or
// the lives stop asking. lives that see a fresh gap file take the lock for one call at a time.
// HYP_LIFE_GAP_S sets the gap (default 60s, 0 turns it off). no lives running: no gap, no delay.
import fs from 'node:fs'
import path from 'node:path'
import { provider } from './core'

export const gapFile = () => path.join(process.cwd(), 'data', '.ollama.gap')
const queueDir = () => path.join(process.cwd(), 'data', '.ollama.queue')
const lockFile = () => path.join(process.cwd(), 'data', '.ollama.lock')
const livesNow = () => path.join(process.cwd(), 'data', 'lives', 'now.json')
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' } }

export const gapSeconds = () => { const n = Number(process.env.HYP_LIFE_GAP_S ?? '60'); return Number.isFinite(n) && n > 0 ? n : 0 }

// lives being lived right now (D's data/lives/now.json, live pids only)
export function livesRunning(): number {
  try {
    const list = JSON.parse(fs.readFileSync(livesNow(), 'utf8')) as { pid: number }[]
    return new Set(list.filter(e => e.pid && alive(e.pid)).map(e => e.pid)).size
  } catch { return 0 }
}

// what other jobs want ollama: live tickets in B's fair queue (file content is the label) and the lock holder
export type QueueTicket = { pid: number; label: string; since: string }
export function ollamaQueue(): { holder: { pid: number; label: string; since: string } | null; waiting: QueueTicket[] } {
  let holder: { pid: number; label: string; since: string } | null = null
  try { const h = JSON.parse(fs.readFileSync(lockFile(), 'utf8')) as { pid: number; label: string; since: string }; if (alive(h.pid)) holder = h } catch { /* free */ }
  let waiting: QueueTicket[] = []
  try {
    waiting = fs.readdirSync(queueDir()).sort().map(t => {
      const [ts, pid] = t.split('-')
      let label = ''
      try { label = fs.readFileSync(path.join(queueDir(), t), 'utf8') } catch { /* raced */ }
      return { pid: Number(pid), label, since: new Date(Number(ts)).toISOString() }
    }).filter(t => alive(t.pid))
  } catch { /* no queue */ }
  return { holder, waiting }
}
const lifeAsking = () => { const q = ollamaQueue(); return q.waiting.some(t => t.label.startsWith('life')) || !!q.holder?.label.startsWith('life') }

export function openGap(seconds: number) {
  try { fs.writeFileSync(gapFile(), JSON.stringify({ until: new Date(Date.now() + seconds * 1000).toISOString(), pid: process.pid })) } catch { /* never block evolution */ }
}
export function closeGap() {
  try { const g = JSON.parse(fs.readFileSync(gapFile(), 'utf8')) as { pid: number }; if (g.pid === process.pid) fs.rmSync(gapFile(), { force: true }) } catch { /* gone */ }
}

export type GapDeps = { sleep: (ms: number) => Promise<void>; now: () => number; running: () => number; asking: () => boolean }
const realDeps: GapDeps = { sleep: ms => new Promise(r => setTimeout(r, ms)), now: Date.now, running: livesRunning, asking: lifeAsking }

// between worlds. returns the seconds evolution waited (0 when no lives are running or the gap is off)
export async function lifeGap(deps: GapDeps = realDeps, seconds = gapSeconds()): Promise<number> {
  if (!seconds || provider() !== 'ollama' || deps.running() === 0) return 0
  const start = deps.now()
  openGap(seconds)
  try {
    // lives poll every 15s, so give them a moment to notice; after that, end early once nobody is asking
    let quiet = 0
    while (deps.now() - start < seconds * 1000) {
      await deps.sleep(2000)
      quiet = deps.asking() ? 0 : quiet + 2
      if (deps.now() - start >= 20_000 && quiet >= 6) break
    }
  } finally { closeGap() }
  return Math.round((deps.now() - start) / 1000)
}
