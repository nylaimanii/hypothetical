// thin groq wrapper: json chat completion with exponential backoff on 429. key only from env (.env.local).
import { AsyncLocalStorage } from 'node:async_hooks'
import Groq from 'groq-sdk'

// per-world llm usage. runWorld opens a context; every chat() inside it counts calls and tokens.
export type Usage = { llmCalls: number; tokens: number }
const usageStore = new AsyncLocalStorage<Usage>()
export function withUsage<T>(u: Usage, fn: () => Promise<T>): Promise<T> {
  return usageStore.run(u, fn)
}

let client: Groq | null | undefined

export function groqAvailable(): boolean {
  return !!process.env.GROQ_API_KEY
}

function getClient(): Groq | null {
  if (client === undefined) client = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: 90_000 }) : null
  return client
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// models are tried in order; one that groq reports as not found is skipped for the rest of the process.
// the spec'd llama models come first, newer hosted models follow in case the account no longer has them.
const missing = new Set<string>()

export async function chat(opts: { model: string | string[]; system: string; user: string; json?: boolean; temperature?: number; maxTokens?: number }): Promise<string> {
  const models = (Array.isArray(opts.model) ? opts.model : [opts.model]).filter(m => !missing.has(m))
  for (const model of models) {
    try {
      return await chatOne({ ...opts, model })
    } catch (e) {
      const err = e as { status?: number; error?: { error?: { code?: string } }; message?: string }
      if (err.status === 404 || /model_not_found|does not exist/.test(String(err.message))) { missing.add(model); continue }
      throw e
    }
  }
  throw new Error(`no available groq model among ${(Array.isArray(opts.model) ? opts.model : [opts.model]).join(', ')}`)
}

async function chatOne(opts: { model: string; system: string; user: string; json?: boolean; temperature?: number; maxTokens?: number }): Promise<string> {
  const c = getClient()
  if (!c) throw new Error('GROQ_API_KEY not set')
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await c.chat.completions.create({
        model: opts.model,
        messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.user }],
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 2048,
        ...(opts.json ? { response_format: { type: 'json_object' as const } } : {}),
      })
      const u = usageStore.getStore()
      if (u) { u.llmCalls++; u.tokens += res.usage?.total_tokens ?? 0 }
      return res.choices[0]?.message?.content ?? ''
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status === 429 && attempt < 6) {
        const retryAfter = Number((e as { headers?: Record<string, string> }).headers?.['retry-after'])
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt)
        continue
      }
      throw e
    }
  }
}
