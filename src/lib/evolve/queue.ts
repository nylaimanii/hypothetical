// work queue for worlds. transient failures (rate limits, timeouts, network) are not deaths:
// the world is marked interrupted, goes back in the queue, and retries after backoff.
// three interruptions in a row pause the whole queue, then it resumes on its own.

export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> }
export const realClock: Clock = { now: () => Date.now(), sleep: ms => new Promise(r => setTimeout(r, ms)) }

const MIN = 60_000
// 30s, 2m, 10m, then park until the next top of the hour
export function backoffUntil(attempt: number, now: number): number {
  const steps = [30_000, 2 * MIN, 10 * MIN]
  if (attempt <= steps.length) return now + steps[attempt - 1]
  return Math.ceil((now + 1) / (60 * MIN)) * 60 * MIN
}

export function isTransient(e: unknown): boolean {
  const err = e as { status?: number; statusCode?: number; code?: string; name?: string; message?: string; cause?: unknown } | null
  if (!err) return false
  const status = err.status ?? err.statusCode
  if (status === 429 || status === 408 || (status !== undefined && status >= 500 && status < 600)) return true
  if (err.name === 'AbortError' || err.name === 'TimeoutError' || err.name === 'APIConnectionError' || err.name === 'APIConnectionTimeoutError') return true
  if (err.code && /^(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_\w+)$/.test(err.code)) return true
  if (/\b429\b|rate.?limit|too many requests|timed? ?out|fetch failed|network|socket hang up|connection (error|reset)/i.test(err.message ?? '')) return true
  return err.cause ? isTransient(err.cause) : false
}

export type QueueHooks<T> = {
  concurrency: number
  run: (task: T) => Promise<void>
  clock?: Clock
  shouldStop?: () => boolean
  // user pause (telegram /pause), checked before each task starts
  isPaused?: () => boolean
  onInterrupted?: (task: T, err: unknown, attempt: number, retryAt: number) => void | Promise<void>
  onLimitPause?: (resumeAt: number) => void | Promise<void>
  limitStreak?: number
}

export async function runQueue<T>(tasks: T[], h: QueueHooks<T>): Promise<void> {
  const clock = h.clock ?? realClock
  const streakMax = h.limitStreak ?? 3
  const queue = tasks.map(task => ({ task, attempt: 0, notBefore: 0 }))
  let streak = 0
  let pausedUntil = 0
  let inFlight = 0

  const next = () => {
    const now = clock.now()
    const i = queue.findIndex(q => q.notBefore <= now)
    return i >= 0 ? queue.splice(i, 1)[0] : null
  }

  const worker = async () => {
    while (!h.shouldStop?.()) {
      if (!queue.length) {
        // another worker may still requeue an interrupted task
        if (!inFlight) return
        await clock.sleep(250)
        continue
      }
      const now = clock.now()
      if (now < pausedUntil) { await clock.sleep(Math.min(pausedUntil - now, 60_000)); continue }
      if (h.isPaused?.()) { await clock.sleep(1000); continue }
      const item = next()
      if (!item) {
        const wake = Math.min(...queue.map(q => q.notBefore))
        await clock.sleep(Math.max(250, Math.min(wake - clock.now(), 60_000)))
        continue
      }
      inFlight++
      try {
        await h.run(item.task)
        streak = 0
      } catch (e) {
        if (!isTransient(e)) throw e
        item.attempt++
        item.notBefore = backoffUntil(item.attempt, clock.now())
        queue.push(item)
        streak++
        await h.onInterrupted?.(item.task, e, item.attempt, item.notBefore)
        if (streak >= streakMax && clock.now() >= pausedUntil) {
          pausedUntil = Math.max(clock.now() + 10 * MIN, Math.min(...queue.map(q => q.notBefore)))
          streak = 0
          await h.onLimitPause?.(pausedUntil)
        }
      } finally {
        inFlight--
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(h.concurrency, tasks.length)) }, worker))
}
