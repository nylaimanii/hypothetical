'use client'
import { useRef, useState } from 'react'
import { useCurrentFrame, useStore } from '../state/store'
import { Num } from './bits'

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
  const t0 = record.frames[0].tick
  const t1 = Math.max(t0 + 1, record.frames.at(-1)!.tick)
  const x = (t: number) => ((t - t0) / (t1 - t0)) * 100
  const scrub = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    setPlayhead(t0 + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (t1 - t0))
  }
  const decisions = record.frames.filter((f) => f.decision)
  const dangers = record.frames.filter((f) => f.newEvents.some((e) => e.severity >= 0.7 && ['famine', 'revolt', 'war', 'disaster', 'pandemic'].includes(e.kind)))
  return (
    <div className="panel pointer-events-auto flex items-center gap-4 px-4 py-3">
      <button onClick={() => { if (playhead >= t1) setPlayhead(t0); setPlaying(!playing) }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-bone" aria-label={playing ? 'pause' : 'play'}>
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1" width="3" height="10" rx="1" fill="currentColor" /><rect x="7.5" y="1" width="3" height="10" rx="1" fill="currentColor" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
        )}
      </button>
      <div className="flex shrink-0 whitespace-nowrap rounded-full border border-ink/15 p-0.5 font-mono text-[10px]">
        {([1, 4, 16] as const).map((s) => (
          <button key={s} onClick={() => setSpeed(s)} className={`rounded-full px-2 py-0.5 ${speed === s ? 'bg-ink text-bone' : 'text-ink/60'}`}>{s}x</button>
        ))}
      </div>
      <Num className="shrink-0 whitespace-nowrap text-[12px] text-ink/60">{record.frames[0].date}</Num>
      <div ref={bar} className="relative h-9 flex-1 cursor-pointer select-none"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setPlaying(false); scrub(e.clientX) }}
        onPointerMove={(e) => { if (e.buttons === 1) scrub(e.clientX) }}>
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-ink/10" />
        <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-ink/70" style={{ width: `${x(Math.min(playhead, t1))}%` }} />
        {dangers.map((f) => (
          <div key={`d${f.tick}`} className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 translate-y-2 rounded-full bg-ember" style={{ left: `${x(f.tick)}%` }} />
        ))}
        {decisions.map((f) => (
          <div key={f.tick} className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
            style={{ left: `${x(f.tick)}%` }}
            onPointerEnter={() => setHover({ x: x(f.tick), text: f.decision!.rationale, date: f.date })}
            onPointerLeave={() => setHover(null)} />
        ))}
        {overrides.map((o) => (
          <div key={o.id} title={`your ${o.kind.replace('_', ' ')}${o.responded ? ', the core responded' : ''}`}
            className={`absolute top-0 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border border-ink ${o.responded ? 'bg-ink ring-2 ring-ink/30 ring-offset-1' : 'bg-bone'}`}
            style={{ left: `${x(o.tick)}%` }} />
        ))}
        <div className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-bone shadow" style={{ left: `${x(Math.min(playhead, t1))}%` }} />
        {hover && (
          <div className="pointer-events-none absolute bottom-full mb-3 w-72 -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-[12px] leading-snug text-bone shadow-lg" style={{ left: `${Math.max(12, Math.min(88, hover.x))}%` }}>
            <Num className="text-[10px] text-bone/60">{hover.date}</Num>
            <div>{hover.text}</div>
          </div>
        )}
      </div>
      <Num className="shrink-0 whitespace-nowrap text-right text-[12px] text-ink/60">{record.frames.at(-1)!.date}</Num>
    </div>
  )
}
