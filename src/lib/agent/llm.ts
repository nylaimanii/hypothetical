// the one llm client every call goes through (governor, lessons, thoughts, askCore).
// provider from env: LLM_PROVIDER=ollama (default) | groq | offline.
//   ollama: openai-compatible endpoint at OLLAMA_URL (default http://localhost:11434/v1), model LLM_MODEL
//           (default gpt-oss:20b). json schema output keeps every structured reply valid json.
//   groq:   GROQ_API_KEY from .env.local, model LLM_MODEL (default openai/gpt-oss-120b), 429 backoff.
//   offline: no llm at all; the deterministic offline governor and templates. only for tests and
//           determinism checks, never chosen silently.
import { AsyncLocalStorage } from 'node:async_hooks'
import http from 'node:http'

export type Provider = 'ollama' | 'groq' | 'offline'
export type Usage = { llmCalls: number; tokens: number }

export const provider = (): Provider => {
  const p = (process.env.LLM_PROVIDER ?? 'ollama').toLowerCase()
  return p === 'groq' || p === 'offline' ? p : 'ollama'
}
export const llmEnabled = () => provider() !== 'offline'
export const modelName = () => process.env.LLM_MODEL ?? (provider() === 'groq' ? 'openai/gpt-oss-120b' : 'gpt-oss:20b')
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
  if (p === 'ollama') return ollamaPost(url, body, opts.timeoutMs ?? 1_800_000)
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
          const j = JSON.parse(data) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } }
          const st = usageStore.getStore()
          if (st) { st.llmCalls++; st.tokens += j.usage?.total_tokens ?? 0 }
          resolve(j.choices?.[0]?.message?.content ?? '')
        } catch (e) { reject(e) }
      })
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`ollama timed out after ${Math.round(timeoutMs / 1000)}s`)))
    req.on('error', e => reject((e as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? new LlmUnavailable('ollama not running: ollama serve') : e))
    req.end(JSON.stringify(body))
  })
}
