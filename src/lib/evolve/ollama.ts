// the local llm server. evolve holds the queue while it is down, so a dead server never turns worlds into
// offline-fallback runs or deaths.
import type { Clock } from './queue'
import { assertLlmReady } from './core'

// ready = the configured provider answers and (for ollama) the model is pulled. B's assertLlmReady decides
export async function ollamaUp(): Promise<boolean> {
  try {
    await assertLlmReady()
    return true
  } catch (e) {
    lastReason = (e as Error).message
    return false
  }
}
let lastReason = ''
export const llmDownReason = () => lastReason

export class LlmDownError extends Error {
  name = 'LlmDownError'
}

// blocks until the server answers. on the first failed check: one message; after it is back: one message
export function llmGate(opts: { up: () => Promise<boolean>; clock: Clock; notify: (text: string) => Promise<unknown>; log: (l: string) => void; everyMs?: number }) {
  let waiting: Promise<void> | null = null
  return async () => {
    if (await opts.up()) return
    // concurrent workers share one wait and one message
    waiting ??= (async () => {
      opts.log(`paused: ollama not running (${llmDownReason()}), checking every 60s`)
      await opts.notify('paused: ollama not running')
      while (!(await opts.up())) await opts.clock.sleep(opts.everyMs ?? 60_000)
      opts.log('ollama is back, resuming')
      await opts.notify('resumed: ollama is back')
    })().finally(() => { waiting = null })
    await waiting
  }
}
