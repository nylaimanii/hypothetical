// long-polls telegram getUpdates while evolve runs. answers only TELEGRAM_CHAT_ID.
import { control } from '../evolve/evolve'
import { readLeaderboard } from '../evolve/store'
import { send, telegramEnv, tg } from './telegram'

type Update = { update_id: number; message?: { chat: { id: number }; text?: string } }

function reply(cmd: string): string | null {
  switch (cmd) {
    case '/status': {
      const best = readLeaderboard()[0]
      return [
        `gen ${control.generation}: ${control.worldsDone}/${control.worldsTotal} worlds done${control.paused ? ', PAUSED' : ''}`,
        best ? `best all time: ${best.name} (gen ${best.generation}) score ${best.score}` : '',
      ].filter(Boolean).join('\n')
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
    while (!stopped) {
      const updates = await tg<Update[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, ctrl.signal)
      if (!updates) { if (!stopped) await new Promise(r => setTimeout(r, 3000)); continue }
      for (const u of updates) {
        offset = u.update_id + 1
        if (String(u.message?.chat.id) !== env.chatId) continue
        const cmd = (u.message?.text ?? '').trim().split(/[\s@]/)[0].toLowerCase()
        const text = reply(cmd)
        if (text) await send(text)
      }
    }
  })()
  return () => { stopped = true; ctrl.abort() }
}
