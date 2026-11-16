// polls telegram getUpdates while evolve runs. answers only TELEGRAM_CHAT_ID.
import { control } from '../evolve/evolve'
import { loadRecord, readLeaderboard } from '../evolve/store'
import { askCore, CORE_REAL } from '../evolve/core'
import { paceLine, readDay } from '../evolve/usage'
import { topAgents } from '../evolve/agents'
import { diskLine } from '../evolve/retention'
import { send, telegramEnv, tg } from './telegram'
import { readAgents } from '../evolve/agents'
import { readRunIndex } from '../evolve/store'
import { readNowFile } from '../evolve/now'
import { livingByContinent } from '../evolve/lives'
import { lifeReply } from '../life/telegram'

type Update = { update_id: number; message?: { chat: { id: number }; text?: string } }
const POLL_MS = 2000

async function ask(question: string): Promise<string> {
  if (!CORE_REAL) return 'core offline'
  if (!question) return 'usage: /ask <question>'
  const best = readLeaderboard()[0]
  const record = best && loadRecord(best.best.runId)
  if (!record) return 'no best world yet'
  try {
    return (await askCore(record, question)).slice(0, 3500)
  } catch (e) {
    return `ask failed: ${(e as Error).message}`
  }
}

const site = () => (process.env.HYP_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const worldLink = (runId: string, done: boolean) => done ? `${site()}/report/${encodeURIComponent(runId)}` : `${site()}/?tabs=${encodeURIComponent(runId)}&active=${encodeURIComponent(runId)}`

// the current generation's worlds: finished (status, year, score), running now, and still queued
export function worldsList(generation: number, running: string[]): string {
  const names = new Map(readAgents().map(a => [a.id, a.name]))
  const done = readRunIndex().filter(r => r.generation === generation).sort((a, b) => a.runId.localeCompare(b.runId))
  const status = (s: string) => (s === 'destroyed' ? 'DIED' : s === 'alive' ? 'alive' : s.replace(/_/g, ' '))
  const lines = done.map(r => `${names.get(r.agentId) ?? r.agentId} s${r.seed}${/-full-/.test(r.runId) ? ' (100y)' : ''} · ${status(r.status)} ${r.endDate.slice(0, 4)} · ${r.score} · ${worldLink(r.runId, true)}`)
  for (const id of running) if (!done.some(r => r.runId === id)) lines.push(`${id} · running now · ${worldLink(id, false)}`)
  const queued = (readNowFile()?.queue ?? []).filter(q => !running.includes(q.runId))
  if (queued.length) lines.push(`queued: ${queued.map(q => `${names.get(q.agentId) ?? q.agentId} s${q.seed}`).join(', ')}`)
  return lines.length ? `gen ${generation}\n${lines.join('\n')}` : `gen ${generation}: no worlds yet`
}

export function livesList(): string {
  const groups = livingByContinent()
  if (!groups.length) return 'nobody is being lived right now'
  return groups.map(g => `${g.continent}\n${g.people.map(p => `  ${p.name}, ${p.age}, ${p.city}${p.agent ? ` (${p.agent}'s world)` : ''}`).join('\n')}`).join('\n')
}

async function reply(cmd: string, rest: string): Promise<string | null> {
  switch (cmd) {
    case '/worlds':
      { const cur = readNowFile()?.runId; return worldsList(control.generation, cur ? [cur] : []) }
    case '/lives':
      return livesList()
    case '/help':
      return '/status /worlds /lives /best /agents /ask <question> /pause /resume\n/life <name> /mute <name> /unmute <name> /quiet /loud'
    case '/status': {
      const best = readLeaderboard()[0]
      const day = readDay()
      const pace = paceLine(control.concurrency)
      return [
        `gen ${control.generation}: ${control.worldsDone}/${control.worldsTotal} worlds done${control.paused ? ', PAUSED' : ''}`,
        pace,
        diskLine(),
        `today: ${day.calls} llm calls${day.tokens ? `, ${day.tokens} tokens` : ''}${day.rejected ? `, ${day.rejected} rejected by groq` : ''}, ${day.worldsFinished} worlds finished, ${day.worldsInterrupted} interrupted`,
        best ? `best all time: ${best.name} (gen ${best.generation}) score ${best.score}` : '',
      ].filter(Boolean).join('\n')
    }
    case '/ask':
      return ask(rest)
    case '/agents': {
      const top = topAgents(5)
      if (!top.length) return 'no agent has governed a world yet'
      return top.map((a, i) => `${i + 1}. ${a.name}${a.champion ? ' (champion)' : ''}${a.retired ? ' (retired)' : ''}: avg ${a.avgScore}, best ${a.bestScore}, ${a.worlds} worlds, ${a.deaths} died, frontier ${a.bestFrontier.replace(/_/g, ' ')}`).join('\n')
    }
    case '/best': {
      const best = readLeaderboard()[0]
      if (!best) return 'no finished generation yet'
      return `${best.name} (gen ${best.generation}) score ${best.score}\nbest world ${best.best.runId}: ${best.best.status} ${best.best.endDate}\n\n${best.constitution.slice(0, 3000)}`
    }
    case '/pause':
      control.paused = true
      return 'paused. running worlds finish, no new ones start. /resume to continue'
    case '/resume':
      control.paused = false
      return 'resumed'
    default:
      // D's life commands (/life, /mute, /unmute, /quiet, /loud): one poller per bot, so evolve answers them
      return lifeReply(cmd, rest)
  }
}

export function startCommands(): () => void {
  const env = telegramEnv()
  if (!env) return () => {}
  const ctrl = new AbortController()
  let offset = 0
  let stopped = false
  ;(async () => {
    // skip anything sent before this run started
    const old = await tg<Update[]>('getUpdates', { offset: -1, timeout: 0 })
    if (old?.length) offset = old[old.length - 1].update_id + 1
    // short polling on purpose: a pending long poll makes node's fetch queue every other telegram call
    // (sendMessage included) behind it for the full timeout, which stalled evolve 25s per message
    while (!stopped) {
      const updates = await tg<Update[]>('getUpdates', { offset, timeout: 0, allowed_updates: ['message'] }, ctrl.signal)
      for (const u of updates ?? []) {
        offset = u.update_id + 1
        if (String(u.message?.chat.id) !== env.chatId) continue
        const raw = (u.message?.text ?? '').trim()
        const cmd = raw.split(/[\s@]/)[0].toLowerCase()
        const text = await reply(cmd, raw.replace(/^\S+\s*/, ''))
        if (text) await send(text)
      }
      if (!stopped) await new Promise(r => setTimeout(r, POLL_MS))
    }
  })()
  return () => { stopped = true; ctrl.abort() }
}
