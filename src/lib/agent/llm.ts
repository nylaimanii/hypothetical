// the one llm client every call goes through (governor, lessons, thoughts, askCore).
// provider from env: LLM_PROVIDER=ollama (default) | groq | offline.
//   ollama: native /api/chat at OLLAMA_URL (default http://localhost:11434), model LLM_MODEL (default
//           gpt-oss:20b). json schema output (format) keeps every structured reply valid json. every call:
//           think low (gpt-oss), num_ctx 8192, num_predict <= 1024, keep_alive 30m so the model stays loaded.
//   groq:   GROQ_API_KEY from .env.local, model LLM_MODEL (default openai/gpt-oss-120b), 429 backoff.
//   offline: no llm at all; the deterministic offline governor and templates. only for tests and
//           determinism checks, never chosen silently.
import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

export type Provider = 'ollama' | 'groq' | 'offline'
export type Usage = { llmCalls: number; tokens: number }

export const provider = (): Provider => {
  const p = (process.env.LLM_PROVIDER ?? 'ollama').toLowerCase()
  return p === 'groq' || p === 'offline' ? p : 'ollama'
}
export const llmEnabled = () => provider() !== 'offline'
// default qwen2.5:7b: fastest local model that passed zod 20/20 in the governor benchmark (gpt-oss:20b ~57s/call
// and truncated at the output cap, qwen2.5:14b ~34s/call)
export const modelName = () => process.env.LLM_MODEL ?? (provider() === 'groq' ? 'openai/gpt-oss-120b' : 'qwen2.5:7b')
const ollamaBase = () => (process.env.OLLAMA_URL ?? 'http://localhost:11434/v1').replace(/\/$/, '')

// ---------- per-world usage ----------
const usageStore = new AsyncLocalStorage<Usage>()
export function withUsage<T>(u: Usage, fn: () => Promise<T>): Promise<T> {
  return usageStore.run(u, fn)
}

export class LlmUnavailable extends Error { name = 'LlmUnavailable' }

// fail fast before a real run: never fall back to the offline governor without saying so
export async function assertLlmReady(): Promise<void> {
  const p = provider()
  if (p === 'offline') return
  if (p === 'groq') {
    if (!process.env.GROQ_API_KEY) throw new LlmUnavailable('groq selected but GROQ_API_KEY is not set in .env.local')
    return
  }
  const root = ollamaBase().replace(/\/v1$/, '')
  let tags: { models?: { name: string }[] }
  try {
    const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(3000) })
    tags = await res.json() as typeof tags
  } catch {
    throw new LlmUnavailable('ollama not running: ollama serve')
  }
  const m = modelName()
  const names = (tags.models ?? []).map(x => x.name)
  if (!names.some(n => n === m || n === `${m}:latest`)) throw new LlmUnavailable(`ollama model ${m} is not pulled: ollama pull ${m} (have: ${names.join(', ') || 'none'})`)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// llama.cpp grammars choke on long length bounds and meta keys, so the schema sent to the model keeps only
// structure (types, enums, required). zod still enforces every bound on the reply afterwards.
const DROP = new Set(['$schema', 'default', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'pattern', 'format'])
export function grammarSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(grammarSchema)
  if (!s || typeof s !== 'object') return s
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) if (!DROP.has(k)) out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, grammarSchema(pv)])) : grammarSchema(v)
  // ask for every property so the model fills them all in
  if (out.type === 'object' && out.properties) out.required = Object.keys(out.properties as object)
  return out
}

export type ChatOpts = { system: string; user: string; schema?: Record<string, unknown>; schemaName?: string; json?: boolean; temperature?: number; maxTokens?: number; timeoutMs?: number }

export async function chat(opts: ChatOpts): Promise<string> {
  const p = provider()
  if (p === 'offline') throw new LlmUnavailable('LLM_PROVIDER=offline')
  const url = p === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : `${ollamaBase()}/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (p === 'groq') headers.Authorization = `Bearer ${process.env.GROQ_API_KEY ?? ''}`
  const body: Record<string, unknown> = {
    model: modelName(),
    messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.user }],
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 4096,
  }
  // gpt-oss thinks before answering; low effort keeps local runs tolerable (LLM_REASONING=medium|high for more)
  if (/gpt-oss/.test(modelName())) body.reasoning_effort = process.env.LLM_REASONING ?? 'low'
  if (opts.schema) body.response_format = { type: 'json_schema', json_schema: { name: opts.schemaName ?? 'reply', schema: grammarSchema(opts.schema), strict: true } }
  else if (opts.json) body.response_format = { type: 'json_object' }
  if (p === 'ollama') {
    // native /api/chat: the only ollama endpoint that takes think, num_ctx, num_predict and keep_alive
    const native: Record<string, unknown> = {
      model: modelName(), messages: body.messages, stream: false,
      keep_alive: process.env.LLM_KEEP_ALIVE ?? '30m',
      options: { temperature: opts.temperature ?? 0.4, num_ctx: Number(process.env.LLM_NUM_CTX ?? 8192), num_predict: Math.min(opts.maxTokens ?? 1024, Number(process.env.LLM_NUM_PREDICT ?? 1024)) },
    }
    if (/gpt-oss/.test(modelName())) native.think = process.env.LLM_REASONING ?? 'low'
    if (opts.schema) native.format = grammarSchema(opts.schema)
    else if (opts.json) native.format = 'json'
    return ollamaPost(`${ollamaBase().replace(/\/v1$/, '')}/api/chat`, native, opts.timeoutMs ?? 1_800_000)
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000) })
    if (res.status === 429 && attempt < 6) {
      const ra = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt)
      continue
    }
    if (!res.ok) throw new Error(`${p} ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json() as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } }
    const u = usageStore.getStore()
    if (u) { u.llmCalls++; u.tokens += data.usage?.total_tokens ?? 0 }
    return data.choices?.[0]?.message?.content ?? ''
  }
}

// stats of the most recent ollama call (for benchmarks)
export let lastCall = { promptTokens: 0, outputTokens: 0, doneReason: '' }

// local generation can take many minutes before the first byte (long reasoning, or queued behind another
// request), longer than fetch's built-in 300s header timeout, so ollama goes through plain node:http
function ollamaPost(url: string, body: Record<string, unknown>, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', c => { data += c })
      res.on('end', () => {
        if ((res.statusCode ?? 500) >= 400) return reject(new Error(`ollama ${res.statusCode}: ${data.slice(0, 300)}`))
        try {
          const j = JSON.parse(data) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number; done_reason?: string }
          const st = usageStore.getStore()
          if (st) { st.llmCalls++; st.tokens += (j.prompt_eval_count ?? 0) + (j.eval_count ?? 0) }
          lastCall = { promptTokens: j.prompt_eval_count ?? 0, outputTokens: j.eval_count ?? 0, doneReason: j.done_reason ?? '' }
          resolve(j.message?.content ?? '')
        } catch (e) { reject(e) }
      })
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`ollama timed out after ${Math.round(timeoutMs / 1000)}s`)))
    req.on('error', e => reject((e as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? new LlmUnavailable('ollama not running: ollama serve') : e))
    req.end(JSON.stringify(body))
  })
}

// ---------- one ollama-heavy job at a time ----------
// data/.ollama.lock holds the pid of the process running llm worlds. other processes wait for it. the lock is
// reentrant inside one process (evolve can run several worlds in parallel) and a lock whose pid is dead is stale.
// HYP_OLLAMA_LOCK points runs started from another worktree at the shared lock. waiters take a ticket in
// .ollama.queue/ next to the lock, named <priority>-<ms>-<pid>: lower priority class first (0 = worlds and
// mutations, 9 = background lives), then arrival order. a ticket gains one class for every 10 minutes it waits, so
// a low class cannot starve. after a reboot pids get reused, so any lock or ticket file older than the boot time is
// stale whatever its pid says.
const LOCK = () => process.env.HYP_OLLAMA_LOCK ?? path.join(process.cwd(), 'data', '.ollama.lock')
const QUEUE = () => path.join(path.dirname(LOCK()), '.ollama.queue')
let held = 0
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const BOOT_MS = Date.now() - os.uptime() * 1000
const fromBeforeBoot = (file: string) => { try { return fs.statSync(file).mtimeMs < BOOT_MS - 5000 } catch { return false } }
// ticket names: new <prio>-<ms>-<pid>, old <ms>-<pid> (read as priority 5)
const parseTicket = (t: string) => { const p = t.split('-'); return p.length >= 3 ? { prio: Number(p[0]), ms: Number(p[1]), pid: Number(p[2]) } : { prio: 5, ms: Number(p[0]), pid: Number(p[1]) } }
const WAIT_BONUS_MS = 10 * 60 * 1000
const rank = (t: string, now: number) => { const k = parseTicket(t); return { eff: Math.max(0, k.prio - Math.floor((now - k.ms) / WAIT_BONUS_MS)), ms: k.ms } }

export async function acquireOllamaLock(label: string, opts: { priority?: number } = {}): Promise<() => void> {
  if (provider() !== 'ollama') return () => {}
  if (held > 0) { held++; return releaser() }
  let warned = false
  fs.mkdirSync(QUEUE(), { recursive: true })
  const prio = Math.max(0, Math.min(9, Math.round(opts.priority ?? 5)))
  const ticket = path.join(QUEUE(), `${prio}-${String(Date.now()).padStart(15, '0')}-${process.pid}`)
  fs.writeFileSync(ticket, label)
  try {
    for (;;) {
      // only the first live ticket (by effective priority, then age) may take the lock; dead tickets and tickets
      // from before the last boot are cleared
      const now = Date.now()
      const live = fs.readdirSync(QUEUE()).filter(t => {
        const f = path.join(QUEUE(), t), { pid } = parseTicket(t)
        if (pid && alive(pid) && !fromBeforeBoot(f)) return true
        try { fs.unlinkSync(f) } catch { /* raced */ }
        return false
      }).sort((a, b) => { const ra = rank(a, now), rb = rank(b, now); return ra.eff - rb.eff || ra.ms - rb.ms || (a < b ? -1 : 1) })
      const mine = path.basename(ticket)
      if (live[0] === mine || !live.includes(mine)) {
        try {
          fs.writeFileSync(LOCK(), JSON.stringify({ pid: process.pid, label, since: new Date().toISOString() }), { flag: 'wx' })
          held = 1
          break
        } catch {
          let pid = 0
          try { pid = (JSON.parse(fs.readFileSync(LOCK(), 'utf8')) as { pid: number }).pid } catch { /* half written */ }
          if (pid === process.pid) { held = 1; break }
          if ((pid && !alive(pid)) || fromBeforeBoot(LOCK())) { try { fs.unlinkSync(LOCK()) } catch { /* raced */ } continue }
        }
      }
      if (!warned) { console.error(`[ollama lock] waiting for ollama (queue position ${Math.max(1, live.indexOf(mine) + 1)})...`); warned = true }
      await sleep(3000)
    }
  } finally {
    try { fs.unlinkSync(ticket) } catch { /* gone */ }
  }
  return releaser()
}

function releaser(): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    held--
    if (held <= 0) { held = 0; try { fs.unlinkSync(LOCK()) } catch { /* gone */ } }
  }
}
