'use client'
import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { Frame, RunRecord } from '@/lib/types'
import { frontierRank } from '@/lib/mock/agents'
import { frameIndexAt, useStore } from '../state/store'
import { Num, fmt } from './bits'
import Emblem from './Emblem'
import { frontierLabel } from './Chrome'

const CompareGlobe = dynamic(() => import('../world/CompareGlobe'), { ssr: false })

// one color per agent, never ember
export const AGENT_COLORS = ['#1D1B19', '#5F7FC9', '#C9902F', '#3E9A92']

function Race({ title, records, value, format, playhead }: { title: string; records: RunRecord[]; value: (f: Frame) => number; format: (n: number) => string; playhead: number }) {
  const W = 196, H = 48
  const t1 = Math.max(...records.map((r) => r.frames.at(-1)!.tick), 1)
  const all = records.flatMap((r) => r.frames.map(value))
  const lo = Math.min(...all), hi = Math.max(...all)
  const span = hi - lo || 1
  const y = (v: number) => H - 4 - ((v - lo) / span) * (H - 8)
  const x = (t: number) => (t / t1) * (W - 4) + 2
  return (
    <div className="min-w-0">
      <div className="mb-0.5 flex justify-between text-[10px] uppercase tracking-[0.12em] text-ink/45"><span>{title}</span></div>
      <svg width={W} height={H} className="block overflow-visible">
        <line x1={x(playhead)} x2={x(playhead)} y1={0} y2={H} stroke="var(--ink)" strokeOpacity={0.2} />
        {records.map((r, i) => {
          const pts = r.frames.map((f) => `${x(f.tick)},${y(value(f))}`).join(' ')
          const cur = r.frames[frameIndexAt(r.frames, playhead)]
          return (
            <g key={r.runId}>
              <polyline points={pts} fill="none" stroke={AGENT_COLORS[i]} strokeWidth={1.8} strokeLinejoin="round" />
              <circle cx={x(cur.tick)} cy={y(value(cur))} r={2.6} fill={AGENT_COLORS[i]} />
            </g>
          )
        })}
      </svg>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px]">
        {records.map((r, i) => <Num key={r.runId} style={{ color: AGENT_COLORS[i] }}>{format(value(r.frames[frameIndexAt(r.frames, playhead)]))}</Num>)}
      </div>
    </div>
  )
}

function DiffTable({ records, playhead }: { records: RunRecord[]; playhead: number }) {
  const agents = useStore((s) => s.agents)
  const frames = records.map((r) => r.frames[frameIndexAt(r.frames, playhead)])
  const year = frames[0]?.date.slice(0, 4)
  const rows: { label: string; cell: (f: Frame, r: RunRecord) => React.ReactNode }[] = [
    { label: 'religion', cell: (f) => f.religionPolicy.replace('_', ' ') },
    { label: 'school purpose', cell: (f) => <span className="italic">{f.schoolPolicy.purpose}</span> },
    {
      label: 'budget split', cell: (f) => (
        <div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full">
            {(['food', 'energy', 'education', 'space', 'security', 'welfare', 'research'] as const).map((k, i) => <span key={k} title={`${k} ${fmt.pct(f.budget[k])}`} style={{ width: `${f.budget[k] * 100}%`, background: ['#6FAE7E', '#E0B97E', '#7F98D6', '#1D1B19', '#8D88A3', '#C27FA9', '#56AFA9'][i] }} />)}
          </div>
          <div className="mt-0.5 text-[10px] text-ink/55">space <Num>{fmt.pct(f.budget.space)}</Num> · food <Num>{fmt.pct(f.budget.food)}</Num> · welfare <Num>{fmt.pct(f.budget.welfare)}</Num></div>
        </div>
      ),
    },
    { label: 'laws enacted this year', cell: (f) => (f.decision?.laws.length ? f.decision.laws.map((l) => l.title).join(', ') : <span className="text-ink/40">none</span>) },
    { label: 'cities founded', cell: (f) => (f.cities.length ? f.cities.map((c) => c.name).join(', ') : <span className="text-ink/40">none yet</span>) },
  ]
  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-ink/45">decisions in <Num>{year}</Num></div>
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr>
            <th className="w-28" />
            {records.map((r, i) => { const a = agents.find((x) => x.id === r.agentId); return <th key={r.runId} className="px-2 pb-1 text-left font-normal" style={{ color: AGENT_COLORS[i] }}>{a?.name ?? r.agentId}</th> })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-ink/8 align-top">
              <td className="py-1 pr-2 text-ink/55">{row.label}</td>
              {records.map((r, i) => <td key={r.runId} className="px-2 py-1">{row.cell(frames[i], r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CompareView() {
  const compare = useStore((s) => s.compare)
  const setCompare = useStore((s) => s.setCompare)
  const playhead = useStore((s) => s.playhead)
  const agents = useStore((s) => s.agents)
  const focus = useStore((s) => s.compareFocus)
  const records = useMemo(() => compare?.records ?? [], [compare])
  if (!compare) return null
  const n = records.length
  const grid = n <= 2 ? 'grid-cols-2 grid-rows-1' : 'grid-cols-2 grid-rows-2'
  return (
    <div className="absolute inset-x-3 bottom-[5.5rem] top-[5.25rem] flex flex-col gap-2 xl:inset-x-4">
      <div className={`grid min-h-0 flex-1 gap-2 ${grid}`}>
        {records.map((r, i) => {
          const a = agents.find((x) => x.id === r.agentId)
          const f = r.frames[frameIndexAt(r.frames, playhead)]
          return (
            <div key={r.runId} className={`relative min-h-0 overflow-hidden rounded-2xl border-2 ${focus === i ? 'border-ink' : 'border-ink/15'}`}>
              <CompareGlobe record={r} index={i} />
              <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-2 rounded-full bg-bone/85 py-1 pl-1 pr-3 shadow-sm backdrop-blur">
                {a && <Emblem seed={a.emblemSeed} size={26} glow={a.champion} />}
                <span className="text-[13px]" style={{ color: AGENT_COLORS[i] }}>{a?.name ?? r.agentId}</span>
                <span className={`text-[10px] ${f.status === 'destroyed' ? 'text-ember' : 'text-ink/50'}`}>{f.status}</span>
              </div>
              <div className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-bone/80 px-2.5 py-0.5 text-[10.5px] backdrop-blur">
                <Num>{fmt.people(f.globalPopulation)}</Num> · <Num>{f.globalPeriodLifeExpectancy.toFixed(1)}y</Num> · {frontierLabel(f.frontier)}{f.humanCost.deaths > 0 && <> · <Num className="text-ember">{fmt.people(f.humanCost.deaths)}</Num> dead</>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="panel pointer-events-auto flex max-h-[16rem] shrink-0 flex-col overflow-hidden px-3 pb-2 pt-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.14em] text-ink/45">comparing <Num>{n}</Num> agents{records.every((r) => r.seed === records[0].seed) ? <> on seed <Num>{records[0].seed}</Num></> : ''} · click a globe to inspect it</span>
          <button onClick={() => setCompare(null)} className="rounded-full border border-ink/25 px-3 py-0.5 text-[12px] hover:bg-ink hover:text-bone">exit compare</button>
        </div>
        <div className="scroll-thin flex min-h-0 gap-5 overflow-auto">
        <div className="grid shrink-0 grid-cols-3 gap-x-4 gap-y-2">
          <Race title="population" records={records} value={(f) => f.globalPopulation} format={fmt.people} playhead={playhead} />
          <Race title="period life exp." records={records} value={(f) => f.globalPeriodLifeExpectancy} format={(v) => `${v.toFixed(1)}y`} playhead={playhead} />
          <Race title="frontier stage" records={records} value={(f) => frontierRank(f.frontier) + f.moonProgress * 0.9} format={(v) => `${v.toFixed(1)}`} playhead={playhead} />
          <Race title="approval" records={records} value={(f) => f.humanCost.approval} format={fmt.pct} playhead={playhead} />
          <Race title="deaths" records={records} value={(f) => f.humanCost.deaths} format={fmt.people} playhead={playhead} />
        </div>
        <div className="min-w-[22rem] flex-1"><DiffTable records={records} playhead={playhead} /></div>
        </div>
      </div>
    </div>
  )
}
