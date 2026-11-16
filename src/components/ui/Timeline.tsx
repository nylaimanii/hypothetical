'use client'
import { useRef, useState } from 'react'
import type { Divergence } from '@/lib/types'
import { useCurrentFrame, useStore, speedLabel } from '../state/store'
import { Num } from './bits'
import Emblem from './Emblem'
import { Offline } from './api'

// plays the world's top events by significance, back to back, through the director
export function startReel() {
  const s = useStore.getState()
  if (s.reel) { stopReel(); return }
  const rec = s.compare ? s.compare.records[s.compareFocus ?? 0] : s.record
  // the highlight reel replays what has happened so far, never the future
  const stops = rec.frames.filter((f) => f.tick <= s.playhead + 1e-6).flatMap((f) => f.newEvents.filter((e) => e.kind !== 'law').map((e) => ({ tick: f.tick, regionId: e.regionId, kind: e.kind, sig: e.significance ?? e.severity })))
    .sort((a, b) => b.sig - a.sig).slice(0, 10).sort((a, b) => a.tick - b.tick).map(({ tick, regionId, kind }) => ({ tick, regionId, kind }))
  if (!stops.length) { s.setNotice('nothing big has happened in this world yet'); return }
  s.setReel({ stops, i: 0, returnTo: s.playhead, wasPlaying: s.playing })
}
export function stopReel() {
  const s = useStore.getState()
  const r = s.reel
  if (!r) return
  s.setReel(null)
  s.setCaption(null)
  s.setPlayhead(r.returnTo)
  s.setPlaying(r.wasPlaying)
}

function BranchPicker({ onClose }: { onClose: () => void }) {
  const agents = useStore((s) => s.agents)
  const record = useStore((s) => s.record)
  const playhead = useStore((s) => s.playhead)
  const [busy, setBusy] = useState<string | null>(null)
  const branch = async (agentId: string) => {
    const s = useStore.getState()
    setBusy(agentId)
    try {
      const res = await fetch('/api/branch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: record.runId, tick: Math.floor(playhead), agentId }) })
      if (!res.ok) throw new Offline(String(res.status))
      const { runId } = (await res.json()) as { runId: string }
      s.setRunnerOffline(false)
      s.setLive(runId)
      s.setPlaying(true)
      s.setNotice('branched into a new live world')
      onClose()
    } catch {
      s.setNotice('runner offline, cannot branch')
    } finally { setBusy(null) }
  }
  return (
    <div className="panel absolute bottom-full right-0 z-30 mb-3 w-72 p-3">
      <div className="mb-2 flex items-center justify-between"><span className="font-display text-[15px]">branch from here</span><button onClick={onClose} className="text-ink/50 hover:text-ink">×</button></div>
      <p className="mb-2 text-[11px] text-ink/55">a new live world starts from this moment, governed by:</p>
      <ul className="scroll-thin max-h-64 space-y-0.5 overflow-y-auto">
        {agents.filter((a) => !a.retired).map((a) => (
          <li key={a.id}>
            <button disabled={!!busy} onClick={() => branch(a.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-ink/5 disabled:opacity-50">
              <Emblem seed={a.emblemSeed} size={22} glow={a.champion} /><span className="text-[12.5px]">{a.name}</span>{busy === a.id && <span className="ml-auto text-[10px] text-ink/50">...</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Timeline() {
  const { record } = useCurrentFrame()
  const playhead = useStore((s) => s.playhead)
  const setPlayhead = useStore((s) => s.setPlayhead)
  const playing = useStore((s) => s.playing)
  const setPlaying = useStore((s) => s.setPlaying)
  const speed = useStore((s) => s.speed)
  const setSpeed = useStore((s) => s.setSpeed)
  const overrides = useStore((s) => s.overrides)
  const bar = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ x: number; text: string; date: string } | null>(null)
  // lazy runs only hold frames near the scrubber; the slim meta knows the whole span
  const meta = useStore((s) => s.slim[record.runId])
  const t0 = meta?.lazy ? meta.firstTick : record.frames[0].tick
  const t1 = Math.max(t0 + 1, meta?.lazy ? meta.lastTick : record.frames.at(-1)!.tick)
  const firstDate = meta?.lazy ? meta.years[0]?.date ?? record.frames[0].date : record.frames[0].date
  const lastDate = meta?.lazy ? meta.years.at(-1)?.date ?? record.frames.at(-1)!.date : record.frames.at(-1)!.date
  const x = (t: number) => ((t - t0) / (t1 - t0)) * 100
  const scrub = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    setPlayhead(t0 + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (t1 - t0))
  }
  // the governor's decisions so far (a future decision's reasoning would be a spoiler)
  const decisions = (meta?.lazy
    ? meta.decisions.map((d) => ({ tick: d.tick, date: d.date, text: record.frames.find((f) => f.tick === d.tick)?.decision?.rationale ?? (d.lawsEnacted.length ? `enacted ${d.lawsEnacted.join(', ')}` : 'the core decides') }))
    : record.frames.filter((f) => f.decision).map((f) => ({ tick: f.tick, date: f.date, text: f.decision!.rationale }))).filter((d) => d.tick <= playhead + 1e-6)
  const compare = useStore((s) => s.compare)
  const reel = useStore((s) => s.reel)
  const agents = useStore((s) => s.agents)
  const [split, setSplit] = useState<Divergence | null>(null)
  const [branching, setBranching] = useState(false)
  const name = (runId: string) => { const r = compare?.records.find((x) => x.runId === runId); return agents.find((a) => a.id === r?.agentId)?.name ?? r?.agentId ?? runId }
  // marks on the track only up to the playhead (the timeline shouldn't give away what's coming)
  const dangers = record.frames.filter((f) => f.tick <= playhead + 1e-6 && f.newEvents.some((e) => e.severity >= 0.7 && ['famine', 'revolt', 'war', 'disaster', 'pandemic'].includes(e.kind)))
  return (
    // minimal shell: thin, translucent, icons instead of words
    <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-bone/85 px-2 py-1 shadow-sm">
      <button onClick={() => { if (playhead >= t1) setPlayhead(t0); setPlaying(!playing) }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-bone" aria-label={playing ? 'pause' : 'play'}>
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1" width="3" height="10" rx="1" fill="currentColor" /><rect x="7.5" y="1" width="3" height="10" rx="1" fill="currentColor" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
        )}
      </button>
      <div className="hidden shrink-0 whitespace-nowrap rounded-full p-0.5 font-mono text-[10px] sm:flex">
        {([1, 4, 16] as const).map((s) => (
          <button key={s} onClick={() => setSpeed(s)} className={`rounded-full px-2 py-0.5 ${speed === s ? 'bg-ink text-bone' : 'text-ink/60'}`} title={`${speedLabel(s)} of world time per real second`}>{speedLabel(s)}</button>
        ))}
      </div>
      <Num className="hidden shrink-0 whitespace-nowrap text-[11px] text-ink/50 sm:block">{firstDate}</Num>
      <div ref={bar} className="relative h-7 flex-1 cursor-pointer select-none"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setPlaying(false); scrub(e.clientX) }}
        onPointerMove={(e) => { if (e.buttons === 1) scrub(e.clientX) }}>
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-ink/10" />
        <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-ink/60" style={{ width: `${x(Math.min(playhead, t1))}%` }} />
        {dangers.map((f) => (
          <div key={`d${f.tick}`} className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 translate-y-2 rounded-full bg-ember" style={{ left: `${x(f.tick)}%` }} />
        ))}
        {decisions.map((f) => (
          <div key={f.tick} className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${decisions.length > 30 ? 'h-2 w-px bg-ink/50' : 'h-2.5 w-0.5 bg-ink/60'}`}
            style={{ left: `${x(f.tick)}%` }}
            onPointerEnter={() => setHover({ x: x(f.tick), text: f.text, date: f.date })}
            onPointerLeave={() => setHover(null)} />
        ))}
        {compare?.divergences.map((d) => (
          <button key={`${d.runB}-${d.tick}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => setSplit(split === d ? null : d)} title="where they split"
            className="absolute top-0 h-3 w-3 -translate-x-1/2 -translate-y-1 rotate-45 border-2 border-ink bg-dusk" style={{ left: `${x(d.tick)}%` }} />
        ))}
        {split && (
          <div onPointerDown={(e) => e.stopPropagation()} className="absolute bottom-full z-20 mb-3 w-80 -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-[12px] leading-snug text-bone shadow-lg" style={{ left: `${Math.max(14, Math.min(86, x(split.tick)))}%` }}>
            <div className="flex justify-between text-[10px] text-bone/60"><span>where {name(split.runA)} and {name(split.runB)} split</span><button onClick={() => setSplit(null)}>×</button></div>
            <div className="mt-1">{split.decisionDiff}</div>
            <div className="mt-1 text-bone/75">{split.consequence}</div>
          </div>
        )}
        {overrides.map((o) => (
          <div key={o.id} title={`your ${o.kind.replace('_', ' ')}${o.responded ? ', the core responded' : ''}`}
            className={`absolute top-0 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border border-ink ${o.responded ? 'bg-ink ring-2 ring-ink/30 ring-offset-1' : 'bg-bone'}`}
            style={{ left: `${x(o.tick)}%` }} />
        ))}
        <div className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-bone shadow" style={{ left: `${x(Math.min(playhead, t1))}%` }} />
        {hover && (
          <div className="pointer-events-none absolute bottom-full mb-3 w-72 -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-[12px] leading-snug text-bone shadow-lg" style={{ left: `${Math.max(12, Math.min(88, hover.x))}%` }}>
            <Num className="text-[10px] text-bone/60">{hover.date}</Num>
            <div>{hover.text}</div>
          </div>
        )}
      </div>
      <Num className="hidden shrink-0 whitespace-nowrap text-right text-[11px] text-ink/50 sm:block">{lastDate}</Num>
      <button onClick={startReel} title={reel ? 'stop the highlight reel' : 'highlight reel: the ten biggest moments'} aria-label="highlight reel" className={`flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] ${reel ? 'bg-ink text-bone' : 'text-ink/60 hover:bg-ink/5 hover:text-ink'}`}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><rect x="1.5" y="3" width="11" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M6 5.3v3.4l3-1.7z" fill="currentColor" /></svg>
        {reel && <Num>{reel.i + 1}/{reel.stops.length}</Num>}
      </button>
      {!compare && (
        <div className="relative shrink-0">
          <button onClick={() => setBranching(!branching)} title="branch: hand this world to another agent from here" aria-label="branch" className={`flex h-7 w-7 items-center justify-center rounded-full ${branching ? 'bg-ink text-bone' : 'text-ink/60 hover:bg-ink/5 hover:text-ink'}`}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><circle cx="4" cy="3" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" /><circle cx="4" cy="11" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" /><circle cx="10.5" cy="5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M4 4.6v4.8M10.5 6.6c0 2-2.5 2.2-5.5 3.4" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
          </button>
          {branching && <BranchPicker onClose={() => setBranching(false)} />}
        </div>
      )}
    </div>
  )
}
