import { connection } from 'next/server'
import { execFileSync } from 'node:child_process'
import { gapFile, livesRunning, ollamaQueue } from '@/lib/evolve/lifegap'
import { livingByContinent } from '@/lib/evolve/lives'
import { readNow, readNowFile } from '@/lib/evolve/now'
import { ollamaUp } from '@/lib/evolve/ollama'
import { diskReport } from '@/lib/evolve/retention'
import { isReadOnly, readJson } from '@/lib/evolve/store'
import { sentLogFile, type SentMessage } from '@/lib/notify/telegram'

// GET /api/status: what is running on this machine, for the local status page (A mounts it at /status).
// ?view=html renders a plain page that refreshes itself every 15s. local only: 404 on a deploy or a non-local host
const OWNERS: Record<'A' | 'B' | 'C' | 'D', string[]> = {
  A: ['src/components', 'src/app', ':(exclude)src/app/api', 'src/lib/types.ts', 'src/lib/mock', 'CLAUDE.md'],
  B: ['src/lib/sim', 'src/lib/agent', 'scripts/geo-*'],
  C: ['src/lib/evolve', 'src/lib/notify', 'src/app/api', 'scripts', ':(exclude)scripts/life-*', ':(exclude)scripts/geo-*'],
  D: ['src/lib/life', 'life', 'scripts/life-*'],
}
type Commit = { sha: string; subject: string; at: string } | null

function latestCommits(): Record<string, Commit> {
  const out: Record<string, Commit> = {}
  for (const [who, paths] of Object.entries(OWNERS)) {
    try {
      const line = execFileSync('git', ['log', '-1', '--format=%h%x09%s%x09%cI', 'origin/main', '--', ...paths], { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000 }).trim()
      const [sha, subject, at] = line.split('\t')
      out[who] = sha ? { sha, subject, at } : null
    } catch { out[who] = null }
  }
  return out
}

// the host and any forwarded host must both be this machine (next dev sets x-forwarded-host itself)
const LOCAL = ['localhost', '127.0.0.1', '[::1]', '::1']
const local = (req: Request) => ['host', 'x-forwarded-host'].every(h => {
  const v = req.headers.get(h)
  return h === 'x-forwarded-host' && !v ? true : v!.split(',').every(x => LOCAL.includes(x.trim().replace(/:\d+$/, '')))
})

async function status() {
  const file = readNowFile()
  const alive = readNow()
  const q = ollamaQueue()
  const gap = readJson<{ until: string; pid: number }>(gapFile())
  const disk = diskReport()
  const sent = (readJson<SentMessage[]>(sentLogFile()) ?? []).slice(-10).reverse()
  return {
    at: new Date().toISOString(),
    evolve: {
      running: !!alive,
      pid: file?.pid ?? null,
      lastHeartbeat: file?.lastHeartbeat ?? null,
      generation: file?.generation ?? null,
      world: file ? { index: file.worldIndex, of: file.worldsInGen, runId: file.runId, agentId: file.agentId, date: file.latestFrame?.date ?? null } : null,
      queued: file?.queue.length ?? 0,
      recent: (file?.recent ?? []).slice(0, 5).map(r => ({ runId: r.runId, status: r.status, endDate: r.endDate, score: r.score })),
      stats: file?.stats ?? null,
    },
    ollama: { up: await ollamaUp(), holder: q.holder, waiting: q.waiting, gap: gap && Date.parse(gap.until) > Date.now() ? gap : null },
    lives: { running: livesRunning(), byContinent: livingByContinent() },
    disk: { dataGB: +(disk.dataBytes / 1e9).toFixed(2), freeGB: +(disk.freeBytes / 1e9).toFixed(1), low: disk.low },
    telegram: sent,
    commits: latestCommits(),
  }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const ago = (iso: string | null | undefined) => { if (!iso) return ''; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago` }

function html(s: Awaited<ReturnType<typeof status>>): string {
  const e = s.evolve
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`
  const evolve = e.running
    ? row('evolution', `gen <b class=n>${esc(e.generation)}</b>, world <b class=n>${esc(e.world?.index)}</b> of <b class=n>${esc(e.world?.of)}</b>${e.world?.runId ? `: <span class=n>${esc(e.world.runId)}</span> at <span class=n>${esc(e.world.date)}</span>` : ''}, ${esc(e.queued)} queued`) + row('heartbeat', esc(ago(e.lastHeartbeat)))
    : row('evolution', `<span class=bad>not running</span>${e.lastHeartbeat ? `, last heartbeat ${esc(ago(e.lastHeartbeat))}` : ''}`)
  const pace = e.stats?.avgMinutesPerWorld ? row('pace', `<span class=n>${esc(e.stats.avgMinutesPerWorld)}</span> min a world, best score <span class=n>${esc(e.stats.bestScore)}</span>, ${esc(e.stats.worldsLost)} worlds lost`) : ''
  const o = s.ollama
  const ollama = row('ollama', `${o.up ? 'up' : '<span class=bad>DOWN</span>'}${o.holder ? `, held by <span class=n>${esc(o.holder.label)}</span> (pid ${esc(o.holder.pid)}) since ${esc(ago(o.holder.since))}` : ', free'}${o.gap ? `, lives gap open until ${esc(new Date(o.gap.until).toLocaleTimeString())}` : ''}`)
    + (o.waiting.length ? row('waiting', o.waiting.map(w => `<span class=n>${esc(w.label)}</span> (pid ${esc(w.pid)}, ${esc(ago(w.since))})`).join('<br>')) : '')
  const lives = s.lives.running ? row('lives', s.lives.byContinent.map(g => `${esc(g.continent)}: ${g.people.map(p => `${esc(p.name)} <span class=n>${esc(p.age)}</span> ${esc(p.city)}`).join(', ')}`).join('<br>')) : ''
  const disk = row('disk', `data <span class=n>${esc(s.disk.dataGB)}</span> GB, <span class="n${s.disk.low ? ' bad' : ''}">${esc(s.disk.freeGB)}</span> GB free`)
  const recent = e.recent.length ? row('last worlds', e.recent.map(r => `<span class=n>${esc(r.runId)}</span> ${r.status === 'destroyed' ? '<span class=bad>died</span>' : esc(r.status)} <span class=n>${esc(r.endDate)}</span> score <span class=n>${esc(r.score)}</span>`).join('<br>')) : ''
  const commits = Object.entries(s.commits).map(([who, c]) => row(`agent ${who}`, c ? `<span class=n>${esc(c.sha)}</span> ${esc(c.subject.slice(0, 90))} <span class=dim>${esc(ago(c.at))}</span>` : '<span class=dim>no commits</span>')).join('')
  const tg = s.telegram.map(m => `<li><div class=dim>${esc(ago(m.at))} · ${esc(m.from)}${m.ok ? '' : ' · <span class=bad>not sent</span>'}</div><pre>${esc(m.text)}</pre></li>`).join('')
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta http-equiv=refresh content=15><title>what's running</title>
<style>:root{--bone:#F2EDE4;--ink:#1C1A17;--dim:#1C1A1799;--ember:#C2410C;--line:#1C1A1722}@media (prefers-color-scheme:dark){:root{--bone:#1C1A17;--ink:#F2EDE4;--dim:#F2EDE499;--line:#F2EDE422}}
body{background:var(--bone);color:var(--ink);font:15px/1.5 Georgia,serif;margin:0;padding:24px 16px;max-width:860px;margin:auto}h1{font-weight:500;font-size:26px;margin:0 0 4px}h2{font-weight:500;font-size:18px;margin:28px 0 8px}
table{border-collapse:collapse;width:100%}th{text-align:left;font-weight:400;color:var(--dim);padding:6px 12px 6px 0;vertical-align:top;white-space:nowrap;width:110px}td{padding:6px 0;border-top:1px solid var(--line)}th{border-top:1px solid var(--line)}
.n,pre,.dim{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:13px}.dim{color:var(--dim)}.bad{color:var(--ember)}ul{list-style:none;padding:0;margin:0}li{border-top:1px solid var(--line);padding:8px 0}pre{white-space:pre-wrap;margin:4px 0 0}</style></head>
<body><h1>what's running</h1><div class=dim>${esc(new Date(s.at).toLocaleString())} · refreshes every 15s</div>
<h2>now</h2><table>${evolve}${pace}${ollama}${lives}${disk}${recent}</table>
<h2>latest commits</h2><table>${commits}</table>
<h2>last ${s.telegram.length} telegram messages</h2><ul>${tg || '<li class=dim>none yet</li>'}</ul></body></html>`
}

export async function GET(req: Request) {
  await connection()
  if (isReadOnly() || !local(req)) return Response.json({ error: 'not found' }, { status: 404 })
  const s = await status()
  if (new URL(req.url).searchParams.get('view') === 'html') return new Response(html(s), { headers: { 'content-type': 'text/html; charset=utf-8' } })
  return Response.json(s)
}
