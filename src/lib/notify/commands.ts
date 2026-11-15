// polls telegram getUpdates while evolve runs. answers only TELEGRAM_CHAT_ID.
import { control } from '../evolve/evolve'
import { loadRecord, readLeaderboard } from '../evolve/store'
import { askCore, CORE_REAL } from '../evolve/core'
import { readDay } from '../evolve/usage'
import { topAgents } from '../evolve/agents'
import { send, telegramEnv, tg } from './telegram'

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

async function reply(cmd: string, rest: string): Promise<string | null> {
  switch (cmd) {
    case '/status': {
      const best = readLeaderboard()[0]
      const day = readDay()
      const limited = control.limitPausedUntil > Date.now() ? `, limit pause till ${new Date(control.limitPausedUntil).toTimeString().slice(0, 5)}` : ''
      return [
        `gen ${control.generation}: ${control.worldsDone}/${control.worldsTotal} worlds done${control.paused ? ', PAUSED' : ''}${limited}`,
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
      return null
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
