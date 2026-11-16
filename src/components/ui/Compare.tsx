'use client'
import { useMemo } from 'react'
import { populationOf } from './truth'
import dynamic from 'next/dynamic'
import type { DecisionRow, RunRecord, YearRow } from '@/lib/types'
import { frontierRank } from '@/lib/mock/agents'
import { frameIndexAt, useStore } from '../state/store'
import { slimFromRecord } from '../state/frames'
import { Num, fmt } from './bits'
import Emblem from './Emblem'
import { frontierLabel } from './Chrome'
import { dateOfTick, recorded } from './truth'
import { abName, type AB } from './ab'

const CompareGlobe = dynamic(() => import('../world/CompareGlobe'), { ssr: false })

// one color per agent, never ember
export const AGENT_COLORS = ['#1D1B19', '#5F7FC9', '#C9902F', '#3E9A92']

type Rows = { runId: string; years: YearRow[]; decisions: DecisionRow[] }

// latest row at or before the scrubber
const at = <T extends { tick: number }>(rows: T[], tick: number): T | undefined => { let best: T | undefined; for (const r of rows) { if (r.tick <= tick + 1e-6) best = r; else break } return best ?? rows[0] }

// stat races read the slim yearly rows, so they cover the whole run even when frames are lazy
// skip: rows that hold no value yet (life expectancy is 0 in the first frame of older records)
function Race({ title, runs: all0, value, format, playhead, skip }: { title: string; runs: Rows[]; value: (y: YearRow) => number; format: (n: number) => string; playhead: number; skip?: (v: number) => boolean }) {
  const runs = skip ? all0.map((r) => ({ ...r, years: r.years.filter((y) => !skip(value(y))) })) : all0
  const W = 196, H = 48
  const t1 = Math.max(1, ...runs.map((r) => r.years.at(-1)?.tick ?? 0))
  const all = runs.flatMap((r) => r.years.map(value))
  if (!all.length) return null
  const lo = Math.min(...all), hi = Math.max(...all)
  const span = hi - lo || 1
  const y = (v: number) => H - 4 - ((v - lo) / span) * (H - 8)
  const x = (t: number) => (t / t1) * (W - 4) + 2
  return (
    <div className="min-w-0">
      <div className="mb-0.5 flex justify-between text-[10px] uppercase tracking-[0.12em] text-ink/45"><span>{title}</span></div>
      <svg width={W} height={H} className="block overflow-visible">
        <line x1={x(playhead)} x2={x(playhead)} y1={0} y2={H} stroke="var(--ink)" strokeOpacity={0.2} />
        {runs.map((r, i) => {
          const cur = at(r.years, playhead)
          return (
            <g key={r.runId}>
              <polyline points={r.years.map((p) => `${x(p.tick)},${y(value(p))}`).join(' ')} fill="none" stroke={AGENT_COLORS[i]} strokeWidth={1.8} strokeLinejoin="round" />
              {cur && <circle cx={x(cur.tick)} cy={y(value(cur))} r={2.6} fill={AGENT_COLORS[i]} />}
            </g>
          )
        })}
      </svg>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px]">
        {runs.map((r, i) => { const cur = at(r.years, playhead); return cur ? <Num key={r.runId} style={{ color: AGENT_COLORS[i] }}>{format(value(cur))}</Num> : null })}
      </div>
    </div>
  )
}

const BUDGET_KEYS = ['food', 'energy', 'education', 'space', 'security', 'welfare', 'research'] as const
const BUDGET_COLORS = ['#6FAE7E', '#E0B97E', '#7F98D6', '#1D1B19', '#8D88A3', '#C27FA9', '#56AFA9']

// the diff table reads the slim decision rows: the latest decision of each world at the scrubber
function DiffTable({ runs, records, playhead, ab }: { runs: Rows[]; records: RunRecord[]; playhead: number; ab?: AB }) {
  const agents = useStore((s) => s.agents)
  const rows = runs.map((r) => ({ cur: at(r.decisions, playhead), cities: r.decisions.filter((d) => d.tick <= playhead + 1e-6).flatMap((d) => d.citiesFounded) }))
  const year = rows.find((r) => r.cur)?.cur?.date.slice(0, 4)
  if (!rows.some((r) => r.cur)) return <p className="text-[12px] text-ink/50">no decisions yet</p>
  const cell = (label: string, f: (r: (typeof rows)[number]) => React.ReactNode) => (
    <tr key={label} className="border-t border-ink/8 align-top">
      <td className="py-1 pr-2 text-ink/55">{label}</td>
      {rows.map((r, i) => <td key={runs[i].runId} className="px-2 py-1">{r.cur ? f(r) : <span className="text-ink/40">none yet</span>}</td>)}
    </tr>
  )
  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-ink/45">latest decisions as of <Num>{year}</Num></div>
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr>
            <th className="w-28" />
            {records.map((r, i) => { const a = agents.find((x) => x.id === r.agentId); return <th key={r.runId} className="px-2 pb-1 text-left font-normal" style={{ color: AGENT_COLORS[i] }}>{ab ? abName(ab, r.runId) : a?.name ?? r.agentId}</th> })}
          </tr>
        </thead>
        <tbody>
          {cell('religion', (r) => r.cur!.religionPolicy.replace('_', ' '))}
          {cell('school purpose', (r) => <span className="italic">{r.cur!.schoolPurpose}</span>)}
          {cell('budget split', (r) => (
            <div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full">
                {BUDGET_KEYS.map((k, i) => <span key={k} title={`${k} ${fmt.pct(r.cur!.budget[k])}`} style={{ width: `${r.cur!.budget[k] * 100}%`, background: BUDGET_COLORS[i] }} />)}
              </div>
              <div className="mt-0.5 text-[10px] text-ink/55">space <Num>{fmt.pct(r.cur!.budget.space)}</Num> · food <Num>{fmt.pct(r.cur!.budget.food)}</Num> · welfare <Num>{fmt.pct(r.cur!.budget.welfare)}</Num></div>
            </div>
          ))}
          {cell('laws enacted', (r) => (r.cur!.lawsEnacted.length ? r.cur!.lawsEnacted.join(', ') : <span className="text-ink/40">none</span>))}
          {cell('cities founded', (r) => (r.cities.length ? r.cities.join(', ') : <span className="text-ink/40">none yet</span>))}
        </tbody>
      </table>
    </div>
  )
}

// what the pair is: same seed, the one change and when it applies, and the first recorded difference
function AbHeader({ ab, seed }: { ab: AB; seed: number }) {
  const setPlayhead = useStore((s) => s.setPlayhead)
  return (
    <div className="min-w-0 text-[12px] leading-snug">
      <div className="text-[11px] uppercase tracking-[0.14em] text-ink/45">a/b on seed <Num>{seed}</Num>, one change</div>
      <div>
        <span className="text-ink/60">{ab.kind === 'rerun' ? 'from the start: ' : <>from <button onClick={() => setPlayhead(ab.splitTick)} className="underline decoration-ink/25 underline-offset-2"><Num>{dateOfTick(ab.splitTick)}</Num></button>: </>}</span>{ab.change}
      </div>
      {ab.firstDiff
        ? <button onClick={() => setPlayhead(ab.firstDiff!.tick)} className="text-left text-ink/60 underline decoration-ink/20 underline-offset-2 hover:text-ink">{ab.firstDiff.text}</button>
        : <div className="text-ink/50">no recorded difference yet</div>}
      {ab.simText ? <div className="text-[11px] text-ink/60">{ab.simText}</div> : ab.sims && <div className="text-[11px] text-ink/60">A ran on {ab.sims.a ? <>sim <Num>{ab.sims.a}</Num></> : 'an older sim (its version is not recorded)'}, B on {ab.sims.b ? <>sim <Num>{ab.sims.b}</Num></> : 'an older sim (its version is not recorded)'}, so part of the difference comes from the sim itself, not only from the change</div>}
      {ab.exact === false && <div className="text-[11px] text-ink/50">after the change the governor decides again, so later choices can also differ for that reason</div>}
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
  const slim = useStore((s) => s.slim)
  const runs: Rows[] = useMemo(() => records.map((r) => { const m = slim[r.runId] ?? slimFromRecord(r); return { runId: r.runId, years: m.years, decisions: m.decisions } }), [records, slim])
  if (!compare) return null
  const n = records.length
  const grid = n <= 2 ? 'grid-cols-2 grid-rows-1' : 'grid-cols-2 grid-rows-2'
  return (
    <div className="absolute inset-x-3 bottom-[5.5rem] top-[9.25rem] flex flex-col gap-2 min-[1720px]:top-[5.25rem] xl:inset-x-4">
      <div className={`grid min-h-0 flex-1 gap-2 ${grid}`}>
        {records.map((r, i) => {
          const a = agents.find((x) => x.id === r.agentId)
          const f = r.frames[frameIndexAt(r.frames, playhead)]
          return (
            <div key={r.runId} className={`relative min-h-0 overflow-hidden rounded-2xl border-2 ${focus === i ? 'border-ink' : 'border-ink/15'}`}>
              <CompareGlobe record={r} index={i} />
              <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-2 rounded-full bg-bone/85 py-1 pl-1 pr-3 shadow-sm">
                {a && <Emblem seed={a.emblemSeed} size={26} glow={a.champion} />}
                <span className="text-[13px]" style={{ color: AGENT_COLORS[i] }}>{compare.ab ? abName(compare.ab, r.runId) : a?.name ?? r.agentId}</span>
                {compare.ab && r.runId === compare.ab.b && playhead < compare.ab.splitTick && <span className="text-[10px] text-ink/50">same as A until the change</span>}
                <span className={`text-[10px] ${f.status === 'destroyed' ? 'text-ember' : 'text-ink/50'}`}>{f.status}</span>
              </div>
              <div className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-bone/80 px-2.5 py-0.5 text-[10.5px]">
                <Num>{fmt.people(populationOf(f))}</Num> · {recorded(f.globalPeriodLifeExpectancy) !== undefined ? <Num>{f.globalPeriodLifeExpectancy.toFixed(1)}y</Num> : <span className="text-ink/50">life exp. not computed yet</span>} · {frontierLabel(f.frontier)}{f.humanCost.deaths > 0 && <> · <Num className="text-ember">{fmt.people(f.humanCost.deaths)}</Num> dead</>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="panel pointer-events-auto flex max-h-[16rem] shrink-0 flex-col overflow-hidden px-3 pb-2 pt-2">
        <div className="mb-1 flex items-center justify-between">
          {compare.ab ? <AbHeader ab={compare.ab} seed={records[0].seed} /> : <span className="text-[11px] uppercase tracking-[0.14em] text-ink/45">comparing <Num>{n}</Num> agents{records.every((r) => r.seed === records[0].seed) ? <> on seed <Num>{records[0].seed}</Num></> : ''} · click a globe to inspect it</span>}
          <button onClick={() => setCompare(null)} className="rounded-full border border-ink/25 px-3 py-0.5 text-[12px] hover:bg-ink hover:text-bone">exit compare</button>
        </div>
        <div className="scroll-thin flex min-h-0 gap-5 overflow-auto">
        <div className="grid shrink-0 grid-cols-3 gap-x-4 gap-y-2">
          <Race title="population" runs={runs} value={(y) => y.globalPopulation} format={fmt.people} playhead={playhead} />
          <Race title="period life exp." runs={runs} value={(y) => y.globalPeriodLifeExpectancy} format={(v) => `${v.toFixed(1)}y`} playhead={playhead} skip={(v) => recorded(v) === undefined} />
          <Race title="frontier stage" runs={runs} value={(y) => frontierRank(y.frontier) + y.moonProgress * 0.9} format={(v) => `${v.toFixed(1)}`} playhead={playhead} />
          <Race title="approval" runs={runs} value={(y) => y.approval} format={fmt.pct} playhead={playhead} />
          <Race title="deaths" runs={runs} value={(y) => y.deaths} format={fmt.people} playhead={playhead} />
        </div>
        <div className="min-w-[22rem] flex-1"><DiffTable runs={runs} records={records} playhead={playhead} ab={compare.ab} /></div>
        </div>
      </div>
    </div>
  )
}
