'use client'
import { useMemo, useState } from 'react'
import type { Frame, WorldEvent } from '@/lib/types'
import { useCurrentFrame, useStore } from '../state/store'
import { Num } from './bits'
import { isDanger } from './events'
import { frontierLabel } from './Chrome'

// small chunky glyphs per event kind, no letters
export function KindIcon({ kind, danger = false }: { kind: WorldEvent['kind']; danger?: boolean }) {
  const c = danger ? 'var(--ember)' : 'var(--ink)'
  const s = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true } as const
  switch (kind) {
    case 'launch': return <svg {...s}><path d="M8 1.5c2.4 2 3 5 2.4 8.5H5.6C5 6.5 5.6 3.5 8 1.5z" fill={c} /><path d="M5.8 10.5L4 14h2.6l.6-2.2M10.2 10.5L12 14H9.4l-.6-2.2" fill={c} /></svg>
    case 'famine': return <svg {...s}><path d="M2.5 7h11c-.4 3.5-2.7 6-5.5 6s-5.1-2.5-5.5-6z" fill="none" stroke={c} strokeWidth="1.8" /><path d="M6 4.5h4" stroke={c} strokeWidth="1.8" strokeLinecap="round" /></svg>
    case 'revolt': return <svg {...s}><rect x="3" y="2" width="1.8" height="12" rx=".9" fill={c} /><path d="M4.8 2.5h8l-2 3 2 3h-8z" fill={c} /></svg>
    case 'war': return <svg {...s}><path d="M3 3l10 10M13 3L3 13" stroke={c} strokeWidth="2.2" strokeLinecap="round" /></svg>
    case 'disaster': return <svg {...s}><path d="M1.5 10c2-2.5 3.5-2.5 5.5 0s3.5 2.5 7.5-1M1.5 6c2-2.5 3.5-2.5 5.5 0s3.5 2.5 7.5-1" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" /></svg>
    case 'pandemic': return <svg {...s}><circle cx="8" cy="8" r="3.4" fill={c} />{[0, 60, 120, 180, 240, 300].map((a) => <circle key={a} cx={8 + Math.cos((a * Math.PI) / 180) * 6} cy={8 + Math.sin((a * Math.PI) / 180) * 6} r="1.2" fill={c} />)}</svg>
    case 'breakthrough': return <svg {...s}>{[0, 60, 120].map((a) => <rect key={a} x="1.5" y="7.1" width="13" height="1.8" rx=".9" fill={c} transform={`rotate(${a + 30} 8 8)`} />)}<circle cx="8" cy="8" r="2" fill={c} /></svg>
    case 'migration': return <svg {...s}><path d="M2 5h9m-2.5-2.5L11 5 8.5 7.5M14 11H5m2.5-2.5L5 11l2.5 2.5" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
    case 'law': return <svg {...s}><rect x="3" y="2" width="10" height="12" rx="2" fill="none" stroke={c} strokeWidth="1.7" /><path d="M5.5 6h5M5.5 9h5" stroke={c} strokeWidth="1.5" strokeLinecap="round" /></svg>
    default: return <svg {...s}><rect x="4" y="4" width="8" height="8" rx="1.5" transform="rotate(45 8 8)" fill={c} /></svg>
  }
}

const KINDS: WorldEvent['kind'][] = ['launch', 'breakthrough', 'famine', 'disaster', 'pandemic', 'revolt', 'war', 'migration']

// the world's major events, significance 0.6 and up
export default function Chronicle() {
  const { record } = useCurrentFrame()
  const setPlayhead = useStore((s) => s.setPlayhead)
  const requestShot = useStore((s) => s.requestShot)
  const select = useStore((s) => s.select)
  const playhead = useStore((s) => s.playhead)
  const [off, setOff] = useState<Set<string>>(new Set())
  // only what has happened by the playhead (never the future). the frontier stage comes from frame.frontier, the
  // same field the hud reads, labelled the same way; the sim's own [frontier: ...] event lines are left out so the
  // two can't disagree (frames are often yearly, so those lines can be missing)
  const items = useMemo(() => {
    const out: { e: WorldEvent; index: number; f: Frame; frontier?: boolean }[] = []
    let stage = record.frames[0]?.frontier
    for (const f of record.frames) {
      if (f.tick > playhead + 1e-6) break
      if (f.frontier !== stage) {
        stage = f.frontier
        out.push({ e: { kind: 'breakthrough', severity: 1, significance: 1, text: `frontier: ${frontierLabel(f.frontier)}`, headline: `frontier: ${frontierLabel(f.frontier)}` } as WorldEvent, index: -1, f, frontier: true })
      }
      f.newEvents.forEach((e, index) => { if ((e.significance ?? e.severity) >= 0.6 && !/\[frontier: /.test(e.text)) out.push({ e, index, f }) })
    }
    return out
  }, [record, playhead])
  const present = KINDS.filter((k) => items.some((x) => x.e.kind === k))
  const shown = items.filter((x) => !off.has(x.e.kind))
  const regions = record.frames[0].regions
  return (
    <div className="panel pointer-events-auto flex min-h-0 w-64 flex-col overflow-hidden">
      <div className="px-4 pt-3 font-display text-[15px]">chronicle</div>
      {present.length > 1 && (
        <div className="flex flex-wrap gap-1 px-4 pb-1 pt-2">
          {present.map((k) => (
            <button key={k} onClick={() => setOff((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })} title={k}
              className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${off.has(k) ? 'border-ink/10 text-ink/30' : 'border-ink/30'}`}>
              <KindIcon kind={k} />{k}
            </button>
          ))}
        </div>
      )}
      <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.map(({ e, index, f, frontier }) => {
          const danger = isDanger(e.kind, e.severity, e.text)
          return (
            <li key={`${f.tick}-${index}`}>
              <button onClick={() => { setPlayhead(f.tick); requestShot(e.regionId ? { target: 'region', regionId: e.regionId, force: true } : { target: 'core', force: true }); if (!frontier) select({ kind: 'event', tick: f.tick, index }) }}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink/5">
                <span className="mt-0.5"><KindIcon kind={e.kind} danger={danger} /></span>
                <span className="min-w-0">
                  <span className="flex gap-2 text-[10px] text-ink/50"><Num>{f.date}</Num><span className="truncate">{regions.find((r) => r.id === e.regionId)?.name}</span></span>
                  <span className={`block text-[12px] leading-snug ${danger ? 'text-ember' : ''}`}>{e.headline ?? e.text}</span>
                </span>
              </button>
            </li>
          )
        })}
        {!shown.length && <li className="px-2 py-2 text-[12px] text-ink/50">no major events yet</li>}
      </ol>
    </div>
  )
}
