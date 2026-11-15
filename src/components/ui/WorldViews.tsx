'use client'
// v3: each world has its own views (globe · daily · graphs · people · steps), overlay pills on the globe,
// the epitaph of a dead world, and the plain-words hover tip.
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useCurrentFrame, useStore, type Overlay, type View } from '../state/store'
import { ensureWindow } from '../state/frames'
import { legendFor } from '../world/modes'
import { tickToDate } from '../world/time'
import { FrontPage, go } from './Daily'
import { buildIssue } from './dailyIssue'
import { Num } from './bits'
import Emblem from './Emblem'
import { WORLD_COLORS, agentOf, prettyAgent, switchTab, worldNumber } from './WorldTabs'
import type { ViewWorld } from './views/shared'

const Graphs = dynamic(() => import('./views/Graphs'), { ssr: false })
const People = dynamic(() => import('./views/People'), { ssr: false })
const Steps = dynamic(() => import('./views/Steps'), { ssr: false })

const VIEWS: View[] = ['globe', 'daily', 'graphs', 'people', 'steps']
const OVERLAYS: Overlay[] = ['real', 'emotion', 'population', 'movement', 'energy', 'damage']

// every open world as the views see it: one color each, the active one bold
export function useViewWorlds(): ViewWorld[] {
  const tabs = useStore((s) => s.tabs)
  const recs = useStore((s) => s.tabRecords)
  const record = useStore((s) => s.record)
  const agents = useStore((s) => s.agents)
  const runs = useStore((s) => s.runs)
  return useMemo(() => tabs.flatMap((id, i) => {
    const rec = id === record.runId ? record : recs[id]
    if (!rec) return []
    const agent = agentOf(rec, agents)
    return [{ record: rec, agent, color: WORLD_COLORS[i % WORLD_COLORS.length], active: id === record.runId, label: `world #${worldNumber(id, runs)} · ${agent?.name ?? prettyAgent(rec.agentId)}` }]
  }), [tabs, recs, record, agents, runs])
}

export function ViewBar() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const overlay = useStore((s) => s.overlay)
  const setOverlay = useStore((s) => s.setOverlay)
  const explain = useStore((s) => s.explain)
  const setExplain = useStore((s) => s.setExplain)
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2">
      <div className="panel flex gap-0.5 p-1 text-[12.5px]" role="tablist" aria-label="views of this world">
        {VIEWS.map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-full px-3 py-1 ${view === v ? 'bg-ink text-bone' : 'text-ink/65 hover:bg-ink/5'}`}>{v}</button>
        ))}
      </div>
      {view === 'globe' && (
        <>
          <div className="panel flex gap-0.5 p-1 text-[12px]" aria-label="what the globe shows">
            {OVERLAYS.map((o) => (
              <button key={o} onClick={() => setOverlay(o)} className={`rounded-full px-2.5 py-1 ${overlay === o ? 'bg-ink/85 text-bone' : 'text-ink/60 hover:bg-ink/5'}`}>{o}</button>
            ))}
          </div>
          <button onClick={() => setExplain(!explain)} aria-pressed={explain} className={`panel px-3 py-1.5 text-[12px] ${explain ? '' : 'text-ink/50'}`}>
            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${explain ? 'bg-ink' : 'border border-ink/40'}`} />explain
          </button>
        </>
      )}
    </div>
  )
}

// the legend in words for the active overlay, sitting low on the globe
export function OverlayLegend() {
  const view = useStore((s) => s.view)
  const overlay = useStore((s) => s.overlay)
  const { frame } = useCurrentFrame()
  const legend = useMemo(() => legendFor(overlay, frame), [overlay, frame])
  if (view !== 'globe' || overlay === 'real') return null
  return (
    <div className="panel pointer-events-auto max-w-[34rem] px-3.5 py-2.5 text-[12px]">
      <p className="text-ink/80">{legend.line}</p>
      {legend.items.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {legend.items.map((it) => <li key={it.text} className="flex items-center gap-1.5 text-ink/70"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: it.color }} />{it.text}</li>)}
        </ul>
      )}
    </div>
  )
}

function DailyView() {
  const { record, frame } = useCurrentFrame()
  const worlds = useViewWorlds()
  const year = Math.floor(frame.tick / 12)
  const [shown, setShown] = useState<number | null>(null)
  const y = shown ?? year
  useEffect(() => { ensureWindow(record.runId, y * 12 + 6) }, [record.runId, y])
  const issue = useMemo(() => buildIssue(record, y), [record, y])
  // same day, other worlds: the lead story every other open world printed that year
  const others = useMemo(() => worlds.filter((w) => !w.active).map((w) => {
    const last = w.record.frames[w.record.frames.length - 1]
    const alive = y * 12 <= (last?.tick ?? 0)
    const iss = alive ? buildIssue(w.record, y) : null
    return { w, headline: iss?.lead.headline ?? null, gone: !alive }
  }), [worlds, y])
  const date = tickToDate(y * 12 + 1)
  return (
    <div className="flex h-full min-h-0 gap-4">
      <div className="scroll-thin min-w-0 flex-1 overflow-y-auto rounded-sm bg-[#F3EDE0] p-7 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.4)] [background-image:radial-gradient(rgba(29,27,25,0.035)_1px,transparent_1px)] [background-size:3px_3px]">
        <div className="mb-3 flex items-center justify-between text-[12px]">
          <button disabled={y <= 0} onClick={() => setShown(y - 1)} className="rounded-full border border-ink/20 px-3 py-0.5 disabled:opacity-40">← older</button>
          {shown !== null && shown !== year && <button onClick={() => setShown(null)} className="text-ink/60 underline decoration-ink/25 underline-offset-2">back to the current year</button>}
          <button disabled={y >= year} onClick={() => setShown(y + 1)} className="rounded-full border border-ink/20 px-3 py-0.5 disabled:opacity-40">newer →</button>
        </div>
        {issue ? <FrontPage issue={issue} onGo={(s) => { go(s, () => {}); useStore.getState().setView('globe') }} /> : <div className="space-y-3 py-10"><div className="skel mx-auto h-12 w-64 rounded" /><div className="skel h-24 w-full rounded" /></div>}
      </div>
      {others.length > 0 && (
        <aside className="scroll-thin flex w-72 shrink-0 flex-col gap-2 overflow-y-auto">
          <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-ink/50">same day, other worlds · <Num>{date.getUTCFullYear()}</Num></div>
          {others.map(({ w, headline, gone }) => (
            <button key={w.record.runId} onClick={() => switchTab(w.record.runId)} className="panel flex flex-col gap-1 p-3 text-left hover:bg-bone">
              <span className="flex items-center gap-2 text-[11.5px] text-ink/60"><span className="h-2 w-2 rounded-full" style={{ background: w.color }} />{w.agent && <Emblem seed={w.agent.emblemSeed} size={16} />}{w.label}</span>
              {headline ? <span className="font-display text-[15px] leading-snug">{headline}</span> : <span className="text-[12.5px] italic text-ink/50">{gone ? 'this world was already gone. no paper was printed.' : 'loading'}</span>}
            </button>
          ))}
        </aside>
      )}
    </div>
  )
}

export function ViewHost() {
  const view = useStore((s) => s.view)
  const worlds = useViewWorlds()
  const active = worlds.find((w) => w.active)
  if (view === 'globe') return null
  return (
    <div className="panel pointer-events-auto absolute inset-0 z-30 flex min-h-0 flex-col p-4">
      <div className="min-h-0 flex-1">
        {view === 'daily' && <DailyView />}
        {view === 'graphs' && <Graphs worlds={worlds} />}
        {view === 'people' && active && <People world={active} />}
        {view === 'steps' && <Steps worlds={worlds} />}
      </div>
    </div>
  )
}

// a dead world gets its epitaph, fading in over the globe
export function EpitaphCard() {
  const { record, frame } = useCurrentFrame()
  const view = useStore((s) => s.view)
  const runs = useStore((s) => s.runs)
  const agents = useStore((s) => s.agents)
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (frame.status !== 'destroyed' || view !== 'globe' || dismissed === record.runId) return null
  const agent = agentOf(record, agents)
  const ep = record.summary.epitaph
  const from = 2026, to = tickToDate(frame.tick).getUTCFullYear()
  const seeSteps = () => {
    useStore.getState().setView('steps')
    setTimeout(() => document.getElementById('steps-killed')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }
  return (
    <div className="epitaph-in panel pointer-events-auto relative w-[30rem] max-w-full px-6 py-5 text-center shadow-xl">
      <button onClick={() => setDismissed(record.runId)} aria-label="dismiss" className="absolute right-3 top-2 text-[14px] text-ink/40 hover:text-ink">×</button>
      <div className="text-[11px] uppercase tracking-[0.22em] text-ink/50">here lies</div>
      <div className="mt-1 font-display text-[22px] leading-tight">world #<Num>{worldNumber(record.runId, runs)}</Num> · governed by {agent?.name ?? prettyAgent(record.agentId)} · <Num>{from}</Num> to <Num>{to}</Num></div>
      {ep && <p className="mt-2 font-display text-[16px] italic leading-snug text-ink/85">{ep.line}</p>}
      {record.summary.causeOfDeath && <p className="mt-2 text-[12.5px] text-ink/65">cause of death: <span className="text-ember">{record.summary.causeOfDeath}</span></p>}
      <button onClick={seeSteps} className="mt-3 rounded-full border border-ink/30 px-4 py-1.5 text-[12px] hover:bg-ink hover:text-bone">see the steps that killed it</button>
    </div>
  )
}

export function HoverTip() {
  const tip = useStore((s) => s.tip)
  if (!tip) return null
  return (
    <div className="pointer-events-none fixed z-50 max-w-[16rem] rounded-xl border border-ink/15 bg-bone/95 px-2.5 py-1.5 text-[11.5px] leading-snug text-ink shadow-lg" style={{ left: tip.x + 14, top: tip.y + 14 }}>
      <div className="font-display text-[12.5px]">{tip.title}</div>
      <div className="text-ink/70">{tip.text}</div>
    </div>
  )
}
