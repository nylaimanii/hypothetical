'use client'
import { useMemo, useState } from 'react'
import type { Budget } from '@/lib/types'
import { mockRuns } from '@/lib/mock/run'
import { useCurrentFrame, useStore } from '../state/store'
import { Bar, Num, Section, fmt } from './bits'
import { api, Offline } from './api'

export function StatusPill({ status }: { status: string }) {
  const danger = status === 'destroyed'
  return (
    <span className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${danger ? 'bg-ember text-bone' : status === 'moon' ? 'bg-ink text-bone' : 'border border-ink/25 text-ink/70'}`}>{status}</span>
  )
}

export function TopLeft() {
  const { frame, record } = useCurrentFrame()
  const source = useStore((s) => s.source)
  return (
    <div className="panel pointer-events-auto px-4 py-3">
      <div className="flex items-center gap-3">
        <Num className="text-2xl tracking-tight">{frame.date}</Num>
        <StatusPill status={frame.status} />
        {source === 'mock' && <span className="rounded border border-dashed border-ink/40 px-1.5 font-mono text-[10px] tracking-[0.2em] text-ink/60">MOCK</span>}
        {source === 'live' && <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink" />live</span>}
      </div>
      <div className="mt-1 flex gap-3 text-[11px] text-ink/55">
        <span>run <Num className="text-ink/80">{record.runId}</Num></span>
        <span>gen <Num className="text-ink/80">{record.generation}</Num></span>
        <span>tick <Num className="text-ink/80">{frame.tick}</Num></span>
      </div>
    </div>
  )
}

export function ModeToggle() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const { record } = useCurrentFrame()
  if (!record.baseline.length) return null
  return (
    <div className="panel pointer-events-auto flex p-1 text-[13px]">
      {(['ai', 'baseline'] as const).map((m) => (
        <button key={m} onClick={() => setMode(m)} className={`rounded-full px-4 py-1.5 transition ${mode === m ? 'bg-ink text-bone' : 'text-ink/70 hover:bg-ink/5'}`}>
          {m === 'ai' ? 'with ai' : 'without ai'}
        </button>
      ))}
    </div>
  )
}

export function TopRight({ onLive }: { onLive: () => void }) {
  const quality = useStore((s) => s.quality)
  const setQuality = useStore((s) => s.setQuality)
  const drawerOpen = useStore((s) => s.drawerOpen)
  const setDrawer = useStore((s) => s.setDrawer)
  const liveRunId = useStore((s) => s.liveRunId)
  return (
    <div className="pointer-events-auto flex items-center gap-2">
      <div className="panel flex p-1 font-mono text-[10px] uppercase tracking-[0.14em]">
        {(['high', 'fast'] as const).map((q) => (
          <button key={q} onClick={() => setQuality(q)} className={`rounded-full px-2.5 py-1 ${quality === q ? 'bg-ink text-bone' : 'text-ink/60 hover:bg-ink/5'}`}>{q}</button>
        ))}
      </div>
      <button onClick={onLive} className={`panel px-4 py-2 text-[13px] ${liveRunId ? 'bg-ink! text-bone' : 'hover:bg-bone'}`}>{liveRunId ? 'live on' : 'play live'}</button>
      <button onClick={() => setDrawer(!drawerOpen)} className={`panel px-4 py-2 text-[13px] ${drawerOpen ? 'bg-ink! text-bone' : 'hover:bg-bone'}`}>world rules</button>
    </div>
  )
}

export function Leaderboard() {
  const runs = useStore((s) => s.runs)
  const runsSource = useStore((s) => s.runsSource)
  const record = useStore((s) => s.record)
  const setRecord = useStore((s) => s.setRecord)
  const setNotice = useStore((s) => s.setNotice)
  const [open, setOpen] = useState(true)
  const sorted = useMemo(() => [...runs].sort((a, b) => b.score - a.score).slice(0, 12), [runs])
  if (!sorted.length) return null
  const load = async (id: string) => {
    const mock = mockRuns().find((r) => r.runId === id)
    if (runsSource === 'mock' && mock) return setRecord(mock, 'mock')
    try { setRecord(await api.run(id), 'api') } catch (e) { setNotice(e instanceof Offline ? 'runner offline' : 'could not load run') }
  }
  return (
    <div className="panel pointer-events-auto w-64 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
        <span className="font-display text-[15px]">leaderboard</span>
        <span className="flex items-center gap-2">
          {runsSource === 'mock' && <span className="font-mono text-[9px] tracking-[0.2em] text-ink/45">MOCK</span>}
          <span className="text-ink/40">{open ? '−' : '+'}</span>
        </span>
      </button>
      {open && (
        <ul className="scroll-thin max-h-[40vh] overflow-y-auto pb-2">
          {sorted.map((r, i) => (
            <li key={r.runId}>
              <button onClick={() => load(r.runId)} className={`w-full px-4 py-1.5 text-left hover:bg-ink/5 ${record.runId === r.runId ? 'bg-ink/[0.07]' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Num className="w-4 text-[11px] text-ink/40">{i + 1}</Num>
                    <Num className="text-[12px]">{r.runId}</Num>
                  </span>
                  <Num className="text-[12px]">{r.score.toFixed(2)}</Num>
                </div>
                <div className="ml-6 flex items-center gap-2 text-[11px] text-ink/55">
                  <span className={r.status === 'destroyed' ? 'text-ember' : ''}>{r.status}</span>
                  <Num>{r.endDate}</Num>
                  <span>gen <Num>{r.generation}</Num></span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const BUDGET_KEYS: (keyof Budget)[] = ['food', 'energy', 'education', 'space', 'security', 'welfare', 'research']
const RELIGION: Record<string, string> = { free: 'free practice', state_neutral: 'state neutral', state_faith: 'state faith', discouraged: 'discouraged' }

export function RulesDrawer() {
  const open = useStore((s) => s.drawerOpen)
  const { frame, record, mode } = useCurrentFrame()
  if (!open) return null
  const b0 = record.frames[0].budget
  return (
    <div className="panel scroll-thin pointer-events-auto max-h-[calc(100vh-15rem)] w-80 overflow-y-auto p-5">
      <div className="text-[11px] uppercase tracking-[0.16em] text-ink/45">{mode === 'ai' ? 'set by the core' : 'frozen 2026 policies'}</div>
      <div className="font-display text-2xl">world rules</div>
      <Section title="religion">
        <div className="text-[14px]">{RELIGION[frame.religionPolicy] ?? frame.religionPolicy}</div>
      </Section>
      <Section title="school">
        {frame.schoolPolicy.purpose && <div className="font-display text-[15px] italic leading-snug">{frame.schoolPolicy.purpose}</div>}
        <div className="mt-1 text-[12px] text-ink/60"><Num>{frame.schoolPolicy.yearsRequired}</Num> years required</div>
        {frame.schoolPolicy.curriculum.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {frame.schoolPolicy.curriculum.map((c) => <span key={c} className="rounded-full border border-ink/20 px-2 py-0.5 text-[11px]">{c}</span>)}
          </div>
        )}
      </Section>
      <Section title="budget">
        <div className="space-y-1.5">
          {BUDGET_KEYS.map((k) => (
            <div key={k}>
              <Bar value={frame.budget[k]} label={k} />
              {mode === 'ai' && Math.abs(frame.budget[k] - b0[k]) > 0.005 && (
                <div className="ml-22 text-[10px] text-ink/45">2026 <Num>{fmt.pct(b0[k])}</Num></div>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
