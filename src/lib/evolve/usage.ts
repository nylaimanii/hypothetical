// llm usage + cost tracking. this module wraps fetch at import time (scripts import it before the sim) and
// attributes each llm chat call (ollama or groq) to the world running in the current async context. totals per day live in data/reports/usage-<date>.json.
import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'
import { dirs, readJson, writeJson } from './store'

type Ctx = { calls: number; tokens: number }
const als = new AsyncLocalStorage<Ctx>()

export type WorldUsage = {
  runId: string
  generation: number
  outcome: 'finished' | 'interrupted' | 'crashed'
  wallMs: number
  llmCalls: number
  tokens: number
  // where the token count came from: runWorld result, counted from groq responses, or none
  tokenSource: 'runWorld' | 'groq-responses' | 'none'
  // local ollama costs nothing per call; kept so a paid provider can fill it in later
  costUsd: number
  at: string
}
// calls = successful llm calls. rejected = groq said no (429 rate limits, quota), not counted as calls
export type DayUsage = { date: string; calls: number; tokens: number; rejected?: number; worldsFinished: number; worldsInterrupted: number; worlds: WorldUsage[] }

const today = () => new Date().toISOString().slice(0, 10)
const dayFile = (date: string) => path.join(dirs.reports, `usage-${date}.json`)

export function readDay(date = today()): DayUsage {
  return readJson<DayUsage>(dayFile(date)) ?? { date, calls: 0, tokens: 0, worldsFinished: 0, worldsInterrupted: 0, worlds: [] }
}
function bumpDay(fn: (d: DayUsage) => void) {
  try {
    const d = readDay()
    fn(d)
    writeJson(dayFile(d.date), d)
  } catch {}
}

// llm chat calls: ollama's openai-compatible endpoint or groq
const isGroq = (input: unknown) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request | undefined)?.url
  return !!url && (url.includes('api.groq.com') || url.endsWith('/chat/completions'))
}

let installed = false
export function installFetchCounter() {
  if (installed || typeof globalThis.fetch !== 'function') return
  installed = true
  const orig = globalThis.fetch
  globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const res = await orig(input, init)
    if (!isGroq(input)) return res
    if (!res.ok) {
      bumpDay(d => { d.rejected = (d.rejected ?? 0) + 1 })
      return res
    }
    const ctx = als.getStore()
    let tokens = 0
    try {
      tokens = ((await res.clone().json()) as { usage?: { total_tokens?: number } }).usage?.total_tokens ?? 0
    } catch {}
    if (ctx) { ctx.calls++; ctx.tokens += tokens }
    // calls outside a world (mutations) still count toward the day
    bumpDay(d => { d.calls++; d.tokens += tokens })
    return res
  }
}
installFetchCounter()

// runs fn inside a usage context and records the world's numbers when it settles
export async function trackWorld<T>(runId: string, generation: number, fn: () => Promise<T>, classify: (r: { ok: true; value: T } | { ok: false; err: unknown }) => WorldUsage['outcome']): Promise<T> {
  const ctx: Ctx = { calls: 0, tokens: 0 }
  const start = Date.now()
  const finish = (outcome: WorldUsage['outcome'], reported?: { llmCalls?: number; tokens?: number }) => {
    const reportedTokens = reported?.tokens
    const w: WorldUsage = {
      runId, generation, outcome, wallMs: Date.now() - start,
      llmCalls: reported?.llmCalls ?? ctx.calls,
      tokens: reportedTokens ?? ctx.tokens,
      tokenSource: reportedTokens !== undefined ? 'runWorld' : ctx.tokens ? 'groq-responses' : 'none',
      costUsd: 0,
      at: new Date().toISOString(),
    }
    bumpDay(d => {
      d.worlds.push(w)
      if (outcome === 'interrupted') d.worldsInterrupted++
      else d.worldsFinished++
    })
    return w
  }
  try {
    const value = await als.run(ctx, fn)
    // if B ever adds usage to the summary, prefer it over our own count
    const u = (value as { usage?: { llmCalls?: number; tokens?: number } } | null)?.usage
    finish(classify({ ok: true, value }), u)
    return value
  } catch (err) {
    finish(classify({ ok: false, err }))
    throw err
  }
}

// average minutes per finished world (today, else yesterday) and how many more fit before 7am
export function paceStats(concurrency = 1, now = new Date()): { avgMinutesPerWorld: number; estWorldsByMorning: number } | null {
  const yesterday = new Date(now.getTime() - 864e5).toISOString().slice(0, 10)
  const today = readDay().worlds
  const done = (today.length ? today : readDay(yesterday).worlds).filter(w => w.outcome === 'finished')
  if (!done.length) return null
  const avgMs = done.reduce((a, w) => a + w.wallMs, 0) / done.length
  const morning = new Date(now)
  morning.setHours(7, 0, 0, 0)
  if (morning <= now) morning.setDate(morning.getDate() + 1)
  return {
    avgMinutesPerWorld: Math.round((avgMs / 60000) * 10) / 10,
    estWorldsByMorning: Math.floor(((morning.getTime() - now.getTime()) / avgMs) * Math.max(1, concurrency)),
  }
}

export function paceLine(concurrency = 1, now = new Date()): string {
  const p = paceStats(concurrency, now)
  if (!p) return 'pace: no finished worlds yet'
  return `pace: ${p.avgMinutesPerWorld} min per world, about ${p.estWorldsByMorning} more by 7am, cost $0 (ollama)`
}
