'use client'
import { useEffect, useRef, useState } from 'react'
import { populationOf } from './truth'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { Agent, EvolveNow, Frame, RunSummary } from '@/lib/types'
import { useStore } from '../state/store'
import { normalizeFrame } from '../state/normalize'
import { Num, Skel, fmt } from './bits'
import Emblem from './Emblem'
import { frontierLabel } from './Chrome'
import { loadAgents } from './worlds'
import { formatDay, formatTime, tickToDate } from '../world/time'

const WorldGlobe = dynamic(() => import('../world/WorldGlobe'), { ssr: false })

const POLL_MS = 3000
const DEATH_MS = 4200
const STALE_MS = 10 * 60 * 1000

// "4 min ago", "3 h ago", or a date when it has been days
function ago(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 90) return `${Math.round(s)} s ago`
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 172800) return `${Math.round(s / 3600)} h ago`
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toLowerCase()
}
type Mode = 'loading' | 'idle' | 'live'

// polls the runner; a 404 means nothing is evolving right now
function useEvolveNow() {
  const [mode, setMode] = useState<Mode>('loading')
  const [now, setNow] = useState<EvolveNow | null>(null)
  const [heartbeat, setHeartbeat] = useState<string | null>(null)
  const [staleBeat, setStaleBeat] = useState(false)
  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const res = await fetch('/api/evolve/now', { cache: 'no-store' })
        if (stop) return
        const body = (await res.json().catch(() => null)) as (Partial<EvolveNow> & { error?: string }) | null
        const beat = body?.lastHeartbeat ?? (res.ok ? body?.updatedAt : undefined) ?? null
        if (beat) setHeartbeat(beat)
        // a 404, or a file nobody has touched in 10 minutes, means the runner is gone
        const stale = beat ? Date.now() - Date.parse(beat) > STALE_MS : false
        setStaleBeat(stale)
        if (!res.ok || !body || !body.latestFrame || stale) { setMode('idle'); setNow(null); return }
        setNow({ ...(body as EvolveNow), latestFrame: normalizeFrame(body.latestFrame) })
        setMode('live')
      } catch {
        if (!stop) { setMode('idle'); setNow(null) }
      }
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { stop = true; clearInterval(id) }
  }, [])
  return { mode, now, heartbeat, staleBeat }
}

function Counter({ label, children, danger = false }: { label: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col px-4 py-2">
      <span className="text-[10px] uppercase tracking-[0.16em] text-ink/45">{label}</span>
      <span className={`truncate font-mono text-[22px] tabular-nums leading-tight ${danger ? 'text-ember' : ''}`}>{children}</span>
    </div>
  )
}

function RecentRow({ r, agents }: { r: RunSummary; agents: Agent[] }) {
  const a = agents.find((x) => x.id === r.agentId)
  const dead = r.status === 'destroyed'
  return (
    <li className={`fade-in flex items-center gap-2.5 rounded-xl border-l-2 bg-bone/70 px-2.5 py-2 ${dead ? 'border-ember' : 'border-ink/25'}`}>
      {a ? <Emblem seed={a.emblemSeed} size={28} faded={a.retired} /> : <Skel className="h-7 w-7 rounded-full" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[12.5px]">{a?.name ?? r.agentId}</span><Num className="text-[12px]">{r.score.toFixed(2)}</Num></div>
        <div className={`truncate text-[11px] ${dead ? 'text-ember' : 'text-ink/55'}`}>{dead ? r.causeOfDeath ?? 'world lost' : `${r.status} · ${frontierLabel(r.frontier)} · ${r.endDate}`}</div>
      </div>
    </li>
  )
}

export default function MissionControl() {
  const { mode, now, heartbeat, staleBeat } = useEvolveNow()
  // re-render once a minute so "last seen" keeps counting while offline
  const [, setClock] = useState(0)
  useEffect(() => { const id = setInterval(() => setClock((n) => n + 1), 60000); return () => clearInterval(id) }, [])
  const long = staleBeat
  const storeAgents = useStore((s) => s.agents)
  const agents = storeAgents
  useEffect(() => { loadAgents() }, [])

  // what the globe shows: the live world, or a dying one held for its moment
  const [shown, setShown] = useState<{ frame: Frame; prev?: Frame; runId: string; agentId: string; key: number } | null>(null)
  const [death, setDeath] = useState<{ cause: string; agentId: string } | null>(null)
  const holding = useRef(false)
  const lastRun = useRef<string | null>(null)
  useEffect(() => {
    if (!now || holding.current) return
    const changed = lastRun.current !== null && lastRun.current !== now.runId
    const finished = now.recent.find((r) => r.runId === lastRun.current)
    if (changed && finished?.status === 'destroyed') {
      // the world died: hold it in gray with the cause, then let the next one fade in
      holding.current = true
      setDeath({ cause: finished.causeOfDeath ?? 'the world collapsed', agentId: finished.agentId })
      setTimeout(() => {
        holding.current = false
        setDeath(null)
        lastRun.current = now.runId
        if (now.latestFrame) setShown({ frame: now.latestFrame, runId: now.runId ?? '', agentId: now.agentId ?? '', key: Date.now() })
      }, DEATH_MS)
      return
    }
    lastRun.current = now.runId
    const frame = now.latestFrame
    if (!frame) return
    setShown((s) => ({ frame, prev: s?.runId === now.runId ? s.frame : undefined, runId: now.runId ?? '', agentId: now.agentId ?? '', key: s?.runId === now.runId ? s.key : Date.now() }))
  }, [now])

  const agent = agents.find((a) => a.id === (death?.agentId ?? shown?.agentId))
  const stats = now?.stats
  const champion = agents.find((a) => a.id === stats?.champion || a.name === stats?.champion)
  const d = shown ? tickToDate(shown.frame.tick) : null

  return (
    <main className="flex h-screen w-screen flex-col gap-3 overflow-hidden bg-bone p-3 xl:p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="panel px-3 py-1.5 text-[12px] hover:bg-bone">← world</Link>
          <h1 className="font-display text-2xl">mission control</h1>
          {mode === 'live' && <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink" />live</span>}
          {mode === 'idle' && heartbeat && <span className={`font-mono text-[11px] ${long ? 'text-ember' : 'text-ink/55'}`}>runner offline · last seen {ago(heartbeat)}</span>}
        </div>
        {now && <div className="text-[13px] text-ink/70">generation <Num className="text-ink">{now.generation}</Num> · world <Num className="text-ink">{now.worldIndex}</Num> of <Num className="text-ink">{now.worldsInGen}</Num></div>}
      </header>

      <div className="panel grid shrink-0 grid-cols-3 divide-ink/10 xl:grid-cols-6 xl:divide-x">
        {stats ? (
          <>
            <Counter label="worlds lost" danger={stats.worldsLost > 0}>{stats.worldsLost}</Counter>
            <Counter label="lessons known">{stats.lessonsKnown}</Counter>
            <Counter label="best score">{stats.bestScore.toFixed(2)}</Counter>
            {(champion || stats.champion) && <Counter label="champion"><span className="flex items-center gap-2 font-display text-[19px]">{champion && <Emblem seed={champion.emblemSeed} size={24} glow />}{champion?.name ?? stats.champion}</span></Counter>}
            {stats.avgMinutesPerWorld !== null && <Counter label="min per world">{stats.avgMinutesPerWorld.toFixed(1)}</Counter>}
            {stats.estWorldsByMorning !== null && <Counter label="worlds by morning">{stats.estWorldsByMorning}</Counter>}
          </>
        ) : mode === 'loading' ? (
          Array.from({ length: 6 }, (_, i) => <div key={i} className="px-4 py-2"><Skel className="mb-1.5 h-2.5 w-20" /><Skel className="h-6 w-14" /></div>)
        ) : (
          <div className="col-span-3 px-4 py-3 text-[13px] text-ink/55 xl:col-span-6">counters appear when an evolution is running</div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <section className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border-2 border-ink/15">
          {shown ? (
            <>
              <div key={shown.key} className="fade-in absolute inset-0">
                <WorldGlobe frame={shown.frame} prev={shown.prev} pulseKey={shown.frame.tick} gray={!!death} autoRotate distance={46} />
              </div>
              <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2.5 rounded-full bg-bone/85 py-1.5 pl-1.5 pr-4 shadow-sm">
                {agent ? <Emblem seed={agent.emblemSeed} size={34} glow={agent.champion} /> : <Skel className="h-8 w-8 rounded-full" />}
                <div>
                  <div className="font-display text-[17px] leading-tight">{agent?.name ?? shown.agentId}</div>
                  <div className="text-[10.5px] text-ink/55"><Num>{shown.runId}</Num>{d && <> · <Num>{formatDay(d)} {formatTime(d)}</Num></>}</div>
                </div>
              </div>
              <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-bone/85 px-3 py-1 text-[11.5px]">
                <Num>{fmt.people(populationOf(shown.frame))}</Num> · <Num>{shown.frame.globalPeriodLifeExpectancy.toFixed(1)}y</Num> · {frontierLabel(shown.frame.frontier)}
                {shown.frame.humanCost.deaths > 0 && <> · <Num className="text-ember">{fmt.people(shown.frame.humanCost.deaths)}</Num> dead</>}
              </div>
              {death && (
                <div className="fade-in pointer-events-none absolute inset-x-0 bottom-16 flex justify-center px-6">
                  <div className="max-w-xl rounded-2xl bg-ink/90 px-6 py-4 text-center text-bone shadow-xl">
                    <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-ember">world lost</div>
                    <div className="mt-1.5 font-display text-[20px] leading-snug">{death.cause}</div>
                  </div>
                </div>
              )}
            </>
          ) : mode === 'loading' ? (
            <div className="flex h-full items-center justify-center"><Skel className="h-72 w-72 rounded-full" /></div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              {heartbeat ? (
                <>
                  <div className="font-display text-3xl">runner offline</div>
                  <div className={`font-mono text-[14px] ${long ? 'text-ember' : 'text-ink/70'}`}>last seen {ago(heartbeat)}</div>
                  <p className="max-w-sm text-[13px] text-ink/60">the runner stopped answering. restart it and this screen picks the generation back up.</p>
                </>
              ) : (
                <>
                  <div className="font-display text-3xl">runner idle</div>
                  <p className="max-w-sm text-[13px] text-ink/60">no evolution is running right now. start one from the runner and this screen follows it live.</p>
                </>
              )}
            </div>
          )}
        </section>

        <aside className="scroll-thin flex w-80 shrink-0 flex-col gap-3 overflow-y-auto">
          <div className="panel p-4">
            <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-ink/45">still to run this generation</div>
            {now ? (
              now.queue.length ? (
                <ol className="flex flex-wrap gap-2">
                  {now.queue.map((q, i) => { const id = q.agentId; const a = agents.find((x) => x.id === id); return <li key={`${q.runId}-${i}`} className="flex items-center gap-1.5 rounded-full border border-ink/15 py-0.5 pl-0.5 pr-2.5 text-[12px]">{a ? <Emblem seed={a.emblemSeed} size={20} /> : <Skel className="h-5 w-5 rounded-full" />}{a?.name ?? id}</li> })}
                </ol>
              ) : <p className="text-[12px] text-ink/50">last world of this generation</p>
            ) : mode === 'idle' ? <p className="text-[12px] text-ink/50">no generation running</p> : <div className="flex gap-2">{[0, 1, 2].map((i) => <Skel key={i} className="h-6 w-20 rounded-full" />)}</div>}
          </div>
          <div className="panel p-4">
            <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-ink/45">last finished worlds</div>
            {now ? (
              now.recent.length ? <ul className="space-y-1.5">{now.recent.slice(0, 5).map((r) => <RecentRow key={r.runId} r={r} agents={agents} />)}</ul> : <p className="text-[12px] text-ink/50">the first world of the night is still running</p>
            ) : mode === 'idle' ? <p className="text-[12px] text-ink/50">finished worlds show here while the runner works</p> : <div className="space-y-1.5">{[0, 1, 2].map((i) => <Skel key={i} className="h-11 w-full" />)}</div>}
          </div>
          <div className="panel p-4">
            <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-ink/45">lessons learned this generation</div>
            {now ? (
              now.newLessons.length ? (
                <ul className="space-y-2">{[...now.newLessons].reverse().map((l) => <li key={l.id} className="fade-in text-[12.5px] leading-snug"><span className="font-display text-[14px]">{l.rule}</span><div className="text-[11px] text-ink/55">{l.mistake}, so {l.consequence}</div></li>)}</ul>
              ) : <p className="text-[12px] text-ink/50">no new lessons yet. they appear when a world dies</p>
            ) : mode === 'idle' ? <p className="text-[12px] text-ink/50">lessons appear here when a world dies</p> : <div className="space-y-1.5">{[0, 1].map((i) => <Skel key={i} className="h-9 w-full" />)}</div>}
          </div>
        </aside>
      </div>
    </main>
  )
}
