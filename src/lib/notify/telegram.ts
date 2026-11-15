// telegram notifications. missing env logs once and every call becomes a no-op. never throws.
import type { HallEntry, Lesson, RunRecord, RunSummary } from '../types'
import { readAgents } from '../evolve/agents'

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

export const fmtPop = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(Math.round(n))
const frontier = (f: string) => f === 'none' ? 'no frontier yet' : f.replace(/_/g, ' ')

export type DeathContext = { generation: number; worldNo: number; agentName: string; added: Lesson[]; repeat: Lesson | null }

// the no-ai twin is deliberately absent: it only shows in the pdf reports
export function deathMessage(s: RunSummary, ctx: DeathContext): string {
  const c = s.humanCost
  const lesson = ctx.added[0]
  const lines = [
    `world #${ctx.worldNo} (gen ${ctx.generation}, ${ctx.agentName}) died ${s.endDate}`,
    s.causeOfDeath ? `cause: ${s.causeOfDeath}` : '',
    lesson ? `got wrong: ${lesson.mistake}` : ctx.repeat ? `got wrong: ${ctx.repeat.mistake}` : '',
    lesson ? `lesson added: ${lesson.rule}` : '',
    ctx.repeat ? `repeat mistake: a known lesson already said "${ctx.repeat.rule}"` : '',
    `got as far as: ${frontier(s.frontier)}, life expectancy ${s.peakPeriodLifeExpectancy.toFixed(1)}, population ${fmtPop(s.finalPopulation)}`,
    c ? `human cost: ${fmtPop(c.deaths)} deaths (${fmtPop(c.famineDeaths)} famine, ${fmtPop(c.unrestDeaths)} unrest), ${fmtPop(c.displaced)} displaced` : '',
    `score ${s.score}`,
  ]
  return lines.filter(Boolean).join('\n')
}

export async function notifyWorldDied(s: RunSummary, _record: RunRecord | null, ctx: DeathContext) {
  await send(deathMessage(s, ctx))
}

export async function notifyGoal(s: RunSummary, record: RunRecord, ctx: { generation: number; agentName: string }) {
  const firstLines = s.constitution.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 2).join('\n')
  const last = record.frames[record.frames.length - 1]
  const mars = last?.cities.filter(c => c.offWorld === 'mars').reduce((a, c) => a + c.population, 0) ?? 0
  await send([
    '🚀🚀🚀 GOAL ACHIEVED 🚀🚀🚀',
    `${ctx.agentName} did it. world ${s.runId} (gen ${ctx.generation}), ${s.endDate}.`,
    `a self-sustaining civilization on mars${mars ? ` (${fmtPop(mars)} people)` : ''}, period life expectancy ${s.peakPeriodLifeExpectancy.toFixed(1)} years, population ${fmtPop(s.finalPopulation)} and holding.`,
    `human cost on the way: ${fmtPop(s.humanCost.deaths)} deaths.`,
    `score ${s.score}. evolution stops here.`,
    '',
    firstLines,
  ].join('\n'))
}

export async function notifyGeneration(line: string) {
  await send(line)
}

// one message per generation for all its new hall of history entries, e.g. "🏆 first mars city ever: halcyon ii, 2071"
export async function notifyHallBatch(generation: number, entries: HallEntry[]) {
  if (!entries.length) return
  const names = new Map(readAgents().map(a => [a.id, a.name]))
  const lines = entries.map(e => {
    const year = 2026 + Math.floor((e.tick + 10) / 12)
    const icon = e.kind === 'catastrophe' ? '💀' : e.kind === 'milestone' ? '🌍' : '🏆'
    return `${icon} ${e.kind === 'record' ? `new record, ${e.title}` : e.title}: ${names.get(e.agentId) ?? e.agentId}, ${year}`
  })
  await send([`hall of history, gen ${generation}:`, ...lines].join('\n'))
}
