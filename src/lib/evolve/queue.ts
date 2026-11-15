// work queue for worlds. transient failures (llm unreachable, timeouts, network) are not deaths:
// the world is marked interrupted, goes back in the queue, and retries after backoff.
// beforeEach runs before every world starts; evolve uses it to hold the queue while ollama is down.

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
  if (err.name === 'AbortError' || err.name === 'TimeoutError' || err.name === 'APIConnectionError' || err.name === 'APIConnectionTimeoutError' || err.name === 'LlmDownError' || err.name === 'LlmUnavailable') return true
  if (err.code && /^(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_\w+)$/.test(err.code)) return true
  if (/\b429\b|rate.?limit|too many requests|timed? ?out|fetch failed|network|socket hang up|connection (error|reset)|ollama (is )?(down|not running|unreachable)/i.test(err.message ?? '')) return true
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
  // awaited before each world starts; may block (e.g. until the llm server is back)
  beforeEach?: () => Promise<void>
}

export async function runQueue<T>(tasks: T[], h: QueueHooks<T>): Promise<void> {
  const clock = h.clock ?? realClock
  const queue = tasks.map(task => ({ task, attempt: 0, notBefore: 0 }))
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
      if (h.isPaused?.()) { await clock.sleep(1000); continue }
      const item = next()
      if (!item) {
        const wake = Math.min(...queue.map(q => q.notBefore))
        await clock.sleep(Math.max(250, Math.min(wake - clock.now(), 60_000)))
        continue
      }
      inFlight++
      try {
        await h.beforeEach?.()
        await h.run(item.task)
      } catch (e) {
        if (!isTransient(e)) throw e
        item.attempt++
        item.notBefore = backoffUntil(item.attempt, clock.now())
        queue.push(item)
        await h.onInterrupted?.(item.task, e, item.attempt, item.notBefore)
      } finally {
        inFlight--
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(h.concurrency, tasks.length)) }, worker))
}
