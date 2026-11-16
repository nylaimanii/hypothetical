'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Budget, Frontier } from '@/lib/types'
import { learningByLineage } from '@/lib/mock/agents'
import type { Agent } from '@/lib/types'
import { useCurrentFrame, useStore } from '../state/store'
import { Bar, Num, Section, fmt } from './bits'
import { AGENT_COLORS } from './Compare'
import { api, Offline } from './api'
import { DirectorToggle, SoundControls, replayIntro } from './Extras'
import { formatDay, formatTime, tickToDate } from '../world/time'
import { openRun } from './worlds'

export function StatusPill({ status }: { status: string }) {
  const danger = status === 'destroyed'
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${danger ? 'bg-ember text-bone' : status === 'goal_achieved' || status === 'complete' ? 'bg-ink text-bone' : 'border border-ink/25 text-ink/70'}`}>{status}</span>
  )
}

const FRONTIER_LABEL: Record<Frontier, string> = {
  none: 'earth only', moon_landing: 'moon landing', moon_base: 'moon base', mars_crewed: 'crew on mars', mars_settlement: 'mars settlement',
  mars_self_sustaining: 'self sustaining mars', asteroid_mining: 'asteroid mining', outer_system: 'outer system',
}
export const frontierLabel = (f: Frontier) => FRONTIER_LABEL[f] ?? f

// the clock interpolates between monthly frames, so it reads the playhead directly
function Clock() {
  const playhead = useStore((s) => s.playhead)
  const d = tickToDate(playhead)
  return <Num className="text-[15px] tracking-tight xl:text-[17px]">{formatDay(d)} <span className="text-ink/40">·</span> {formatTime(d)}</Num>
}

export function TopLeft() {
  const { frame, record } = useCurrentFrame()
  const source = useStore((s) => s.source)
  const compare = useStore((s) => s.compare)
  return (
    <div className="panel pointer-events-auto shrink-0 whitespace-nowrap px-3 py-2 xl:px-4 xl:py-2.5">
      <Clock />
      <div className="mt-1 flex items-center gap-2">
        <StatusPill status={frame.status} />
        {source === 'mock' && !compare && <span className="rounded border border-dashed border-ink/40 px-1.5 font-mono text-[10px] tracking-[0.2em] text-ink/60">MOCK</span>}
        {source === 'live' && !compare && <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink" />live</span>}
        {compare && <span className="text-[11px] text-ink/55">comparing <Num>{compare.records.length}</Num> worlds</span>}
      </div>
      {!compare && record.branchedFrom && (
        <button onClick={() => openRun(record.branchedFrom!.runId, record.branchedFrom!.tick)} className="mt-1 block text-[11px] text-ink/60 underline decoration-ink/25 underline-offset-2 hover:text-ink">
          branched from <Num>{record.branchedFrom.runId}</Num> at <Num>{formatDay(tickToDate(record.branchedFrom.tick))}</Num>
        </button>
      )}
    </div>
  )
}

// always visible: the mission and its human cost, side by side
export function MissionBar() {
  const { frame, record, mode } = useCurrentFrame()
  const select = useStore((s) => s.select)
  const setPanel = useStore((s) => s.setPanel)
  // mock ids end in a world number; real ids end in a seed, so fall back to the generation
  const worldNo = record.runId.match(/-(\d{3,4})$/)?.[1]
  const worldLabel = worldNo ? `world #${Number(worldNo)}` : `gen ${record.generation}`
  const cost = frame.humanCost
  const item = (label: string, value: React.ReactNode, onClick?: () => void, danger = false) => (
    <button onClick={onClick} disabled={!onClick} className={`flex flex-col items-start px-2.5 text-left ${onClick ? 'hover:bg-ink/5' : 'cursor-default'} rounded-xl py-0.5`}>
      <span className="text-[9.5px] uppercase tracking-[0.14em] text-ink/45">{label}</span>
      <span className={`whitespace-nowrap text-[13px] ${danger ? 'text-ember' : ''}`}>{value}</span>
    </button>
  )
  return (
    <div className="panel pointer-events-auto flex shrink-0 items-center divide-x divide-ink/10 whitespace-nowrap px-1.5 py-1.5">
      {frame.globalPopulation > 0 && item('people', <Num>{fmt.people(frame.globalPopulation)}</Num>)}
      {frame.globalPeriodLifeExpectancy > 0 && item('life exp.', <Num>{frame.globalPeriodLifeExpectancy.toFixed(1)}y</Num>, () => setPanel('longevity'))}
      {item('frontier', frontierLabel(frame.frontier), () => setPanel('offworld'))}
      {mode === 'ai' && cost.deaths > 0 && item('deaths', <Num>{fmt.people(cost.deaths)}</Num>, undefined, true)}
      {mode === 'ai' && cost.displaced > 0 && item('displaced', <Num>{fmt.people(cost.displaced)}</Num>)}
      {cost.approval > 0 && item('approval', <Num>{fmt.pct(cost.approval)}</Num>)}
      {item(worldLabel, frame.lessonsKnown > 0 ? <span>lessons <Num>{frame.lessonsKnown}</Num></span> : <span>first lessons pending</span>, () => select({ kind: 'core' }))}
    </div>
  )
}

export function ModeToggle() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const { record } = useCurrentFrame()
  if (!record.baseline.length) return null
  return (
    <div className="flex shrink-0 whitespace-nowrap rounded-full border border-ink/15 p-0.5 text-[12px]">
      {(['ai', 'baseline'] as const).map((m) => (
        <button key={m} onClick={() => setMode(m)} className={`whitespace-nowrap rounded-full px-3 py-1 transition ${mode === m ? 'bg-ink text-bone' : 'text-ink/70 hover:bg-ink/5'}`}>
          {m === 'ai' ? 'with ai' : 'without ai'}
        </button>
      ))}
    </div>
  )
}

const Gear = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <rect key={a} x="7.1" y="1" width="1.8" height="3" rx="0.6" fill="currentColor" transform={`rotate(${a} 8 8)`} />)}</svg>
)

export function TopRight({ onLive }: { onLive: () => void }) {
  const canLive = useStore((s) => s.caps.playLive)
  const drawerOpen = useStore((s) => s.drawerOpen)
  const setDrawer = useStore((s) => s.setDrawer)
  const liveRunId = useStore((s) => s.liveRunId)
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const advanced = useStore((s) => s.advancedOpen)
  const setAdvanced = useStore((s) => s.setAdvanced)
  const btn = (on: boolean) => `panel h-9 whitespace-nowrap px-3 text-[12px] xl:text-[13px] ${on ? 'bg-ink! text-bone' : 'hover:bg-bone'}`
  return (
    <div className="pointer-events-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <button onClick={() => setPanel(panel === 'offworld' ? null : 'offworld')} className={btn(panel === 'offworld')}>off-world</button>
      <button onClick={() => setPanel(panel === 'longevity' ? null : 'longevity')} className={btn(panel === 'longevity')}>200 years</button>
      <button onClick={() => useStore.getState().setDaily({ open: true, year: null, peek: null })} className={btn(false)}>the daily</button>
      <button onClick={() => setPanel(panel === 'agents' ? null : 'agents')} className={btn(panel === 'agents')}>agents</button>
      <button onClick={() => setPanel(panel === 'hall' ? null : 'hall')} className={btn(panel === 'hall')}>hall</button>
      <Link href="/mission" className={`${btn(false)} flex items-center`}>mission</Link>
      <DirectorToggle />
      <SoundControls />
      {canLive && <button onClick={onLive} className={btn(!!liveRunId)}>{liveRunId ? 'live on' : 'play live'}</button>}
      <button onClick={() => setDrawer(!drawerOpen)} className={btn(drawerOpen)}>rules</button>
      <button onClick={() => useStore.getState().setShortcuts(true)} aria-label="keyboard shortcuts" title="keyboard shortcuts (?)" className={`${btn(false)} flex w-9 items-center justify-center px-0 font-mono`}>?</button>
      <button onClick={() => setAdvanced(!advanced)} aria-label="advanced settings" title="advanced settings" className={`${btn(advanced)} flex w-9 items-center justify-center px-0`}><Gear /></button>
    </div>
  )
}

// advanced settings: render quality and the hidden no-ai twin
export function AdvancedDrawer() {
  const open = useStore((s) => s.advancedOpen)
  const quality = useStore((s) => s.quality)
  const setQuality = useStore((s) => s.setQuality)
  const showTwin = useStore((s) => s.showTwin)
  const setShowTwin = useStore((s) => s.setShowTwin)
  if (!open) return null
  return (
    <div className="panel pointer-events-auto w-72 p-4 text-[12.5px]">
      <div className="font-display text-[17px]">advanced</div>
      <div className="mt-3 flex items-center justify-between">
        <span>render quality</span>
        <div className="flex rounded-full border border-ink/15 p-0.5 font-mono text-[10px] uppercase tracking-[0.14em]">
          {(['high', 'fast'] as const).map((q) => <button key={q} onClick={() => setQuality(q)} className={`rounded-full px-2.5 py-1 ${quality === q ? 'bg-ink text-bone' : 'text-ink/60'}`}>{q}</button>)}
        </div>
      </div>
      <label className="mt-3 flex items-center justify-between gap-3">
        <span>show the no-ai twin</span>
        <input type="checkbox" checked={showTwin} onChange={(e) => setShowTwin(e.target.checked)} className="h-4 w-4 accent-[var(--ink)]" />
      </label>
      {showTwin && <div className="mt-2 flex justify-end"><ModeToggle /></div>}
      {showTwin && <p className="mt-2 text-[11px] leading-snug text-ink/50">the same seed with 2026 policies frozen. shown here for comparison only</p>}
      <button onClick={replayIntro} className="mt-4 text-[12px] text-ink/60 underline decoration-ink/25 underline-offset-2 hover:text-ink">replay intro</button>
    </div>
  )
}

// best score per generation, one line per lineage
function LineageCurve({ rows, agents }: { rows: { generation: number; bestScore: number; lineage?: string }[]; agents: Agent[] }) {
  const W = 220, H = 46
  const lineages = [...new Set(rows.map((r) => r.lineage ?? 'all'))]
  const gMax = Math.max(1, ...rows.map((r) => r.generation))
  const sMax = Math.max(0.01, ...rows.map((r) => r.bestScore))
  const x = (g: number) => 3 + (g / gMax) * (W - 6)
  const y = (v: number) => H - 3 - (v / sMax) * (H - 8)
  const color = (i: number) => AGENT_COLORS[i % AGENT_COLORS.length]
  // nothing scored yet: no chart, not a row of zeros
  if (!rows.some((r) => r.bestScore > 0)) return <p className="text-[10.5px] text-ink/45">scores appear after the first finished worlds</p>
  // one generation so far: a line needs two points, so show the best score per lineage as bars
  if (gMax === 0 || new Set(rows.map((r) => r.generation)).size < 2) {
    const best = lineages.map((l) => ({ l, v: Math.max(...rows.filter((r) => (r.lineage ?? 'all') === l).map((r) => r.bestScore)) })).sort((a, b) => b.v - a.v)
    return (
      <ul className="space-y-0.5">
        {best.slice(0, 7).map(({ l, v }, i) => (
          <li key={l} className="flex items-center gap-2 text-[10px]">
            <span className="w-16 truncate" style={{ color: color(i) }}>{agents.find((a) => a.id === l)?.name ?? l}</span>
            <span className="h-1.5 flex-1 rounded-full bg-ink/10"><span className="block h-full rounded-full" style={{ width: `${(v / sMax) * 100}%`, background: color(i) }} /></span>
            <Num className="w-8 text-right">{v.toFixed(2)}</Num>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div>
      <svg width={W} height={H} className="block overflow-visible">
        {lineages.map((l, i) => {
          const pts = rows.filter((r) => (r.lineage ?? 'all') === l).sort((a, b) => a.generation - b.generation)
          return (
            <g key={l} opacity={agents.length && agents.filter((a) => a.id === l || a.parentIds.includes(l)).every((a) => a.retired) ? 0.35 : 1}>
              {pts.length > 1 && <polyline points={pts.map((p) => `${x(p.generation)},${y(p.bestScore)}`).join(' ')} fill="none" stroke={color(i)} strokeWidth={1.6} strokeLinejoin="round" />}
              {pts.map((p) => <circle key={p.generation} cx={x(p.generation)} cy={y(p.bestScore)} r={2.2} fill={color(i)} />)}
            </g>
          )
        })}
      </svg>
      {lineages.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px]">
          {lineages.map((l, i) => <span key={l} style={{ color: color(i) }}>{agents.find((a) => a.id === l)?.name ?? l}</span>)}
        </div>
      )}
    </div>
  )
}

export function Leaderboard() {
  const runs = useStore((s) => s.runs)
  const record = useStore((s) => s.record)
  const setRecord = useStore((s) => s.setRecord)
  const setNotice = useStore((s) => s.setNotice)
  const [open, setOpen] = useState(true)
  const sorted = useMemo(() => [...runs].sort((a, b) => b.score - a.score).slice(0, 12), [runs])
  const agents = useStore((s) => s.agents)
  const [apiCurve, setApiCurve] = useState<{ generation: number; bestScore: number; lineage?: string }[] | null>(null)
  useEffect(() => { api.learning().then((c) => { if (Array.isArray(c) && c.length > 1) setApiCurve(c) }).catch(() => {}) }, [])
  // the learning curve from the api, else computed from the real agents; nothing when neither has data
  const curve = apiCurve ?? (agents.length ? learningByLineage(agents) : [])
  if (!sorted.length) return null
  const load = async (id: string) => {
    try { setRecord(await api.run(id), 'api') } catch (e) { setNotice(e instanceof Offline ? 'runner offline' : 'could not load run') }
  }
  return (
    <div className="panel pointer-events-auto flex min-h-0 w-64 shrink-0 flex-col overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
        <span className="font-display text-[15px]">leaderboard</span>
        <span className="flex items-center gap-2">
          <span className="text-ink/40">{open ? '−' : '+'}</span>
        </span>
      </button>
      {open && curve.length > 1 && (
        <div className="px-4 pb-2">
          <div className="flex items-baseline justify-between text-[10px] text-ink/50"><span>best score by generation</span><Num>gen {Math.max(...curve.map((p) => p.generation))}</Num></div>
          <LineageCurve rows={curve} agents={agents} />
        </div>
      )}
      {open && (
        <ul className="scroll-thin min-h-0 max-h-[40vh] overflow-y-auto pb-2">
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
    <div className="panel pointer-events-auto w-[22rem] shrink-0 p-5">
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
