// telegram notifications. missing env logs once and every call becomes a no-op. never throws.
import type { RunRecord, RunSummary } from '../types'

let warned = false
export function telegramEnv(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID
  if (token && chatId) return { token, chatId }
  if (!warned) { console.log('[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing, skipping telegram'); warned = true }
  return null
}

export async function tg<T = unknown>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T | null> {
  const env = telegramEnv()
  if (!env) return null
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
    })
    const j = (await res.json()) as { ok: boolean; result?: T; description?: string }
    if (!j.ok) { console.log(`[telegram] ${method} failed: ${j.description}`); return null }
    return j.result ?? null
  } catch (e) {
    if ((e as Error).name !== 'AbortError') console.log(`[telegram] ${method} error: ${(e as Error).message}`)
    return null
  }
}

export async function send(text: string): Promise<boolean> {
  const env = telegramEnv()
  if (!env) return false
  return !!(await tg('sendMessage', { chat_id: env.chatId, text: text.slice(0, 4000), disable_web_page_preview: true }))
}

const fmtPop = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : String(Math.round(n))

export function deathMessage(s: RunSummary, record: RunRecord | null, gen: number): string {
  const last = record?.frames[record.frames.length - 1]
  const laws = (last?.laws ?? []).filter(l => !l.vetoed)
  const weakest = laws.length ? laws.reduce((a, b) => (b.compliance < a.compliance ? b : a)) : null
  const lines = [
    `world ${s.runId} (gen ${gen}) died ${s.endDate}`,
    s.causeOfDeath ? `cause: ${s.causeOfDeath}` : '',
    s.topEvents.length ? 'biggest events:' : '',
    ...s.topEvents.slice(0, 3).map(e => `- ${e.kind}: ${e.text}`),
    weakest ? `least obeyed law: ${weakest.title} (${Math.round(weakest.compliance * 100)}% compliance)` : '',
    last ? `religion: ${last.religionPolicy.replace('_', ' ')}. school: ${last.schoolPolicy.purpose} (${last.schoolPolicy.yearsRequired} yrs)` : '',
    `score ${s.score}, peak pop ${fmtPop(s.peakPopulation)}`,
    `no-ai twin: ${s.baselineStatus} ${s.baselineEndDate}`,
  ]
  return lines.filter(Boolean).join('\n')
}

export async function notifyWorldDied(s: RunSummary, record: RunRecord | null, gen: number) {
  await send(deathMessage(s, record, gen))
}

export async function notifyMoon(s: RunSummary, gen: number) {
  const firstLines = s.constitution.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 2).join('\n')
  await send(`MOON. world ${s.runId} (gen ${gen}) landed a crew on ${s.endDate}.\nscore ${s.score}, no-ai twin: ${s.baselineStatus}\n\n${firstLines}`)
}

export async function notifyGeneration(line: string) {
  await send(line)
}
