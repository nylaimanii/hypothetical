'use client'
// shared pieces for the reading pages. all words come from C's report api; these only set type and links.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Frame } from '@/lib/types'
import { Thumb } from '../ui/WorldTabs'

// numbers in jetbrains mono, words around them untouched
const NUM = /(\d[\d,.]*(?:%|[kmb]\b|[KMB]\b)?)/g
export function Rich({ text, className = '' }: { text: string; className?: string }) {
  const parts = text.split(NUM)
  return <span className={className}>{parts.map((p, i) => (i % 2 ? <span key={i} className="font-mono text-[0.92em] tracking-tight">{p}</span> : p))}</span>
}

// the world, opened at a tick
export const worldHref = (runId: string, tick?: number) => `/?tabs=${encodeURIComponent(runId)}&active=${encodeURIComponent(runId)}${tick !== undefined ? `&t=${tick}` : ''}`

export type Ref = { tick?: number; date?: string; url?: string; runId?: string }
export function RefLinks({ refs, runId }: { refs: Ref[]; runId: string }) {
  const shown = refs.slice(0, 3)
  if (!shown.length) return null
  return (
    <span className="ml-1 whitespace-nowrap align-baseline text-[0.72em] text-ink/45">
      {shown.map((r, i) => {
        const label = r.date ?? (r.url ? 'source' : r.runId ? 'world' : '')
        if (!label) return null
        const cls = 'mx-0.5 underline decoration-ink/20 underline-offset-2 hover:text-ink'
        if (r.url) return <a key={i} href={r.url} target="_blank" rel="noreferrer" className={cls}>{label}</a>
        if (r.runId) return <Link key={i} href={`/report/${encodeURIComponent(r.runId)}`} className={cls}>{label}</Link>
        return <Link key={i} href={worldHref(runId, r.tick)} className={`${cls} font-mono`}>{label}</Link>
      })}
    </span>
  )
}

// a little globe at a tick, fetched only when it scrolls into view (a frame is a few hundred kb)
export function Snapshot({ runId, tick, caption, size = 132, dead = false }: { runId: string; tick: number; caption?: string; size?: number; dead?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [frame, setFrame] = useState<Frame | undefined>()
  const [want, setWant] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setWant(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!want) return
    let stop = false
    // frames aren't stored for every tick: ask for the year around it and take the nearest
    fetch(`/api/runs/${encodeURIComponent(runId)}/frames?from=${Math.max(0, tick - 6)}&to=${tick + 6}`).then((r) => (r.ok ? r.json() : null)).then((b) => {
      const fs: Frame[] = b?.frames ?? []
      const near = [...fs].sort((x, y) => Math.abs(x.tick - tick) - Math.abs(y.tick - tick))[0]
      if (!stop && near) setFrame(near)
    }).catch(() => {})
    return () => { stop = true }
  }, [want, runId, tick])
  const year = 2026 + Math.floor((tick + 10) / 12)
  return (
    <Link ref={ref} href={worldHref(runId, tick)} className="print-keep group inline-flex flex-col items-center gap-1.5 text-center" title="open the world here">
      <Thumb frame={frame} dead={dead} size={size} />
      <span className="text-[11.5px] leading-tight text-ink/55 group-hover:text-ink"><span className="font-mono">{year}</span>{caption ? ` · ${caption}` : ''}</span>
    </Link>
  )
}

// a tiny globe chip colored by how the world ended
export function OutcomeChip({ status, size = 22 }: { status: string; size?: number }) {
  const c = status === 'destroyed' ? ['#B9B4AC', '#77726B'] : status === 'goal_achieved' ? ['#F2D27A', '#C9A227'] : status === 'complete' ? ['#B8C7D4', '#5E7A92'] : ['#BFE0B4', '#5E8C4A']
  return (
    <span aria-hidden className={`inline-block shrink-0 rounded-full ${status === 'destroyed' ? 'ring-1 ring-ember/70' : ''}`}
      style={{ width: size, height: size, background: `radial-gradient(circle at 32% 30%, ${c[0]}, ${c[1]} 70%)` }} />
  )
}

export const statusWord = (s: string) => (s === 'destroyed' ? 'lost' : s === 'goal_achieved' ? 'goal reached' : s === 'complete' ? 'reached 2126' : 'still alive')
