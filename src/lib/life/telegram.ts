// telegram for chosen people. reuses C's exported send/tg (src/lib/notify/telegram.ts) read-only.
//
// tier 1: instant, one message per big moment (born, died, family, work, health, disaster, moves, money, decisions)
// tier 2: one recap per year of their life
// a life simulates in minutes, so: max 20 messages a minute. when a fast replay would go over, the extra tier 1
// messages are merged into one per person (nothing is lost), and extra recaps merge into one multi-year recap.
// controls: /lives, /life <name>, /mute <name>, /mute recaps, /unmute <name|recaps>, /quiet, /loud
import { send, telegramEnv, tg } from '../notify/telegram'
import { livesFile, readJsonSafe, readNow, writeJsonAtomic, listWorlds, readIndex, findLife } from './store'

export type Tier = 1 | 2
export type Category = 'born' | 'death' | 'family_birth' | 'family_death' | 'family' | 'work' | 'health' | 'disaster' | 'move' | 'money' | 'decision' | 'recap'
// head: "amara · 2034 · lagos". body: the human line. link: that moment on the life site
type Msg = { tier: Tier; who: string; cat: Category; head: string; body: string; link: string; year: number; city: string }

export type TgState = { muted: string[]; recapsMuted: boolean; quiet: boolean }
const stateFile = () => livesFile('telegram.json')
export const readTgState = (): TgState => ({ muted: [], recapsMuted: false, quiet: false, ...(readJsonSafe<TgState>(stateFile()) ?? {}) })
const writeTgState = (s: TgState) => writeJsonAtomic(stateFile(), s, true)

export const lifeLink = (lifeId: string, tick: number) => {
  const base = (process.env.LIFE_SITE_URL ?? 'http://localhost:3100').replace(/\/$/, '')
  return `${base}/life/${lifeId}?t=${tick}`
}

function allowed(m: Msg, s: TgState): boolean {
  const first = m.who.toLowerCase()
  if (s.muted.includes(first)) return false
  if (s.quiet) return m.cat === 'born' || m.cat === 'death' || m.cat === 'family_birth' || m.cat === 'family_death'
  if (m.tier === 2 && s.recapsMuted) return false
  return true
}

const PER_MINUTE = 20
export class LifeTelegram {
  private queue: Msg[] = []
  private sent: number[] = []
  private timer: NodeJS.Timeout | null = null
  readonly enabled = !!telegramEnv()

  push(tier: Tier, cat: Category, p: { who: string; year: number; city: string; body: string; link: string }) {
    if (!this.enabled) return
    const m: Msg = { tier, cat, who: p.who, year: p.year, city: p.city, head: `${p.who} · ${p.year} · ${p.city.toLowerCase()}`, body: p.body, link: p.link }
    if (!allowed(m, readTgState())) return
    this.queue.push(m)
    this.timer ??= setInterval(() => { void this.flush() }, 3000)
  }

  private budget() {
    const now = Date.now()
    this.sent = this.sent.filter(t => now - t < 60_000)
    return PER_MINUTE - this.sent.length
  }

  private merge() {
    const budget = Math.max(1, this.budget())
    if (this.queue.length <= budget) return
    // merge per person and tier, oldest first, so each person's run of events becomes one message
    const groups = new Map<string, Msg[]>()
    for (const m of this.queue) {
      const k = `${m.who}|${m.tier}`
      groups.set(k, [...(groups.get(k) ?? []), m])
    }
    const merged: Msg[] = []
    for (const g of groups.values()) {
      if (g.length === 1) { merged.push(g[0]); continue }
      const first = g[0], last = g[g.length - 1]
      const years = first.year === last.year ? `${first.year}` : `${first.year}-${last.year}`
      const lines = g.map(m => `• ${g.length > 1 && m.year !== first.year ? `${m.year}: ` : ''}${m.body}`)
      merged.push({ ...last, head: `${first.who} · ${years} · ${last.city.toLowerCase()}`, body: `${g.length} ${first.tier === 1 ? 'moments' : 'years'}, fast:\n${lines.join('\n')}`.slice(0, 3800) })
    }
    this.queue = merged
  }

  async flush() {
    if (!this.queue.length) { if (this.timer) { clearInterval(this.timer); this.timer = null } return }
    this.merge()
    while (this.queue.length && this.budget() > 0) {
      const m = this.queue.shift()!
      this.sent.push(Date.now())
      await send(`${m.head}: ${m.body}\n${m.link}`)
    }
  }

  // waits until everything queued is out (at most a few minutes thanks to merging)
  async drain() {
    while (this.queue.length) { await this.flush(); if (this.queue.length) await new Promise(r => setTimeout(r, 3000)) }
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }
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
      if (live) return `${live.name} · ${Math.floor(live.age)} · ${live.city}\nwork: ${live.job ?? 'none'}\nfamily: ${live.partner ? 'partner' : 'no partner'}, ${live.kids} kids\nfunds: ${fmtMoney(live.income)}/month, ${live.savings < 0 ? `${fmtMoney(-live.savings)} in debt` : `${fmtMoney(live.savings)} saved`}\nhealth ${Math.round(live.health * 100)}/100 · feeling ${live.mood}\n${lifeLink(live.lifeId, live.tick)}`
      for (const w of listWorlds().reverse()) {
        const hit = readIndex(w).reverse().find(x => x.name.toLowerCase().startsWith(arg))
        if (hit) {
          const r = findLife(hit.lifeId)
          const last = r?.snaps[r.snaps.length - 1]
          return `${hit.epitaph ?? hit.name}\n${hit.deathAge !== null ? `died at ${Math.floor(hit.deathAge)}: ${hit.deathCause}` : 'alive'}${hit.score !== null ? `\nlife score ${hit.score.toFixed(3)}` : ''}${last ? `\nlast: ${last.job ?? 'no job'}, ${fmtMoney(last.savings)} saved, health ${Math.round(last.health * 100)}/100` : ''}`
        }
      }
      return `no chosen person called ${arg}`
    }
    case '/mute':
      if (!arg) return 'usage: /mute <name> or /mute recaps'
      if (arg === 'recaps') { writeTgState({ ...s, recapsMuted: true }); return 'yearly recaps muted' }
      writeTgState({ ...s, muted: [...new Set([...s.muted, arg])] })
      return `muted ${arg}`
    case '/unmute':
      if (arg === 'recaps') { writeTgState({ ...s, recapsMuted: false }); return 'yearly recaps back on' }
      writeTgState({ ...s, muted: s.muted.filter(m => m !== arg) })
      return `unmuted ${arg}`
    case '/quiet':
      writeTgState({ ...s, quiet: true })
      return 'quiet: only births and deaths'
    case '/loud':
      writeTgState({ muted: [], recapsMuted: false, quiet: false })
      return 'everything back on'
    default:
      return null
  }
}

// our own poller, only while C's evolve (which owns getUpdates) is not running. two pollers on one bot steal each
// other's messages, so scripts/life-*.ts start this only when data/evolve-now.json shows no live evolve process
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
