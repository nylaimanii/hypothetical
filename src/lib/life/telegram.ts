// telegram for chosen people, kept quiet on purpose: ONE message per finished life (2-3 lines: who they were, how
// it went, the lesson they left), plus at most one mid-life message when something genuinely wild happens (a lesson
// visibly saving them). everything else lives on the life site. reuses C's exported send/tg read-only.
// commands: /lives, /life <name>, /mute <name>, /unmute <name>, /quiet (end-of-life messages only), /loud
import { send, telegramEnv, tg } from '../notify/telegram'
import { livesFile, readJsonSafe, readNow, writeJsonAtomic, listWorlds, readIndex, findLife } from './store'
import type { LifeRecord } from './types'

export type TgState = { muted: string[]; quiet: boolean }
const stateFile = () => livesFile('telegram.json')
export const readTgState = (): TgState => ({ muted: [], quiet: false, ...(readJsonSafe<TgState>(stateFile()) ?? {}) })
const writeTgState = (s: TgState) => writeJsonAtomic(stateFile(), s, true)

export const lifeLink = (lifeId: string, tick?: number) => {
  const base = (process.env.LIFE_SITE_URL ?? 'http://localhost:3100').replace(/\/$/, '')
  return `${base}/life/${lifeId}${tick !== undefined ? `?t=${tick}` : ''}`
}

const firstName = (name: string) => name.split(' ')[0]
const muted = (name: string) => readTgState().muted.includes(firstName(name).toLowerCase())

// a lesson visibly saving them: the same person making the usual choices died young at this age, and this one is
// still alive with a lesson behind their choices. max one per life (run.ts keeps the count)
export async function sendWild(name: string, text: string) {
  if (!telegramEnv() || muted(name) || readTgState().quiet) return
  await send(text)
}

const pron = (r: LifeRecord) => (r.sex === 'female' ? { their: 'her', them: 'her' } : { their: 'his', them: 'him' })

export function endOfLifeLine(r: LifeRecord): string {
  const first = firstName(r.name)
  const s = r.score!
  const age = Math.floor(r.deathAge ?? 0)
  const birth = r.birthplace.city.toLowerCase()
  const last = (r.places[r.places.length - 1]?.city ?? r.birthplace.city).toLowerCase()
  const link = `life score ${s.total.toFixed(2)} · life #${r.lifeNo} in this world · ${lifeLink(r.lifeId)}`
  if ((r.deathAge ?? 0) < 16) {
    const lived = (r.deathAge ?? 0) < 1 ? `${Math.max(1, Math.round((r.deathAge ?? 0) * 12))} months` : `${age} years`
    return `${first} lived ${lived} in ${birth}. ${r.deathCause}.\ntoo young to leave a tip. some lives are just unfair, and this world counts them too.\n${link}`
  }
  const p = pron(r)
  const kids = r.kin.filter(k => k.relation === 'child').length
  const job = [...r.snaps].reverse().find(x => x.job)?.job
  const who = [job, kids ? `${kids} ${kids === 1 ? 'kid' : 'kids'}` : ''].filter(Boolean).join(', ')
  const t = r.twin
  const gap = t ? (r.deathAge ?? 0) - t.deathAge : 0
  const how = !t ? '' : gap >= 3 ? `, ${Math.round(gap)} years longer than the usual choices would have given ${p.them}` : gap <= -3 ? `; the usual choices would have bought ${Math.round(-gap)} more years` : s.total - t.score.total > 0.05 ? ', a fuller life than the usual choices, same luck' : ''
  const tip = r.lessonsLeft[0]?.rule
  return `${first} made it to ${age} in ${last}${last !== birth ? ` (born in ${birth})` : ''}. ${who ? `${who}${how}.` : `${r.deathCause}${how}.`}\n${tip ? `${p.their} tip for the next one: ${tip} 🌱` : `${r.deathCause}. no tip this time.`}\n${link}`
}

export async function sendEndOfLife(r: LifeRecord) {
  if (!telegramEnv() || muted(r.name)) return
  await send(endOfLifeLine(r))
}

// ---------- commands ----------
const fmtMoney = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n) >= 1000 ? `${(Math.abs(n) / 1000).toFixed(1)}k` : Math.round(Math.abs(n))}`

// returns null for commands that are not ours, so C's dispatcher can call this from its default case
export async function lifeReply(cmd: string, rest: string): Promise<string | null> {
  const s = readTgState()
  const arg = rest.trim().toLowerCase()
  switch (cmd) {
    case '/lives': {
      const now = readNow()
      if (!now.length) return 'nobody is being lived right now'
      return now.map(e => `${e.name} · ${Math.floor(e.age)} · ${e.city}`).join('\n')
    }
    case '/life': {
      if (!arg) return 'usage: /life <name>'
      const live = readNow().find(e => e.name.toLowerCase().startsWith(arg))
      if (live) return `${live.name} · ${Math.floor(live.age)} · ${live.city}\nwork: ${live.job ?? 'none'} · family: ${live.partner ? 'partner' : 'no partner'}, ${live.kids} kids\nfunds: ${fmtMoney(live.income)}/month, ${live.savings < 0 ? `${fmtMoney(-live.savings)} in debt` : `${fmtMoney(live.savings)} saved`} · health ${Math.round(live.health * 100)}/100 · feeling ${live.mood}\n${lifeLink(live.lifeId, live.tick)}`
      for (const w of listWorlds().reverse()) {
        const hit = [...readIndex(w)].reverse().find(x => x.name.toLowerCase().startsWith(arg))
        const r = hit && findLife(hit.lifeId)
        if (r && r.score) return endOfLifeLine(r)
      }
      return `no chosen person called ${arg}`
    }
    case '/mute':
      if (!arg) return 'usage: /mute <name>'
      writeTgState({ ...s, muted: [...new Set([...s.muted, arg])] })
      return `muted ${arg}`
    case '/unmute':
      writeTgState({ ...s, muted: s.muted.filter(m => m !== arg) })
      return `unmuted ${arg}`
    case '/quiet':
      writeTgState({ ...s, quiet: true })
      return 'quiet: one message per finished life, nothing mid-life'
    case '/loud':
      writeTgState({ muted: [], quiet: false })
      return 'back on: one message per life, plus the rare wild moment'
    default:
      return null
  }
}

// our own poller, only while C's evolve (which owns getUpdates) is not running: two pollers on one bot steal each
// other's messages. when evolve runs, C's dispatcher should call lifeReply from its default case
type Update = { update_id: number; message?: { chat: { id: number }; text?: string } }
export function startLifeCommands(evolveRunning: () => boolean): () => void {
  const env = telegramEnv()
  if (!env) return () => {}
  let stopped = false, offset = 0
  const ctrl = new AbortController()
  ;(async () => {
    const old = await tg<Update[]>('getUpdates', { offset: -1, timeout: 0 })
    if (old?.length) offset = old[old.length - 1].update_id + 1
    while (!stopped) {
      if (!evolveRunning()) {
        const updates = await tg<Update[]>('getUpdates', { offset, timeout: 0, allowed_updates: ['message'] }, ctrl.signal)
        for (const u of updates ?? []) {
          offset = u.update_id + 1
          if (String(u.message?.chat.id) !== env.chatId) continue
          const raw = (u.message?.text ?? '').trim()
          const text = await lifeReply(raw.split(/[\s@]/)[0].toLowerCase(), raw.replace(/^\S+\s*/, ''))
          if (text) await send(text)
        }
      }
      if (!stopped) await new Promise(r => setTimeout(r, 2500))
    }
  })()
  return () => { stopped = true; ctrl.abort() }
}
