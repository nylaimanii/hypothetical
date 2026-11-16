'use client'
import { useMemo, useRef, useState } from 'react'
import type { RunRecord } from '@/lib/types'
import { useStore } from '../../state/store'
import { fmt, Num } from '../bits'
import un from '../../../../data/real/un-wpp-2024.json'
import { biggestEvent, deathsPerYear, ENERGY, emotionSlots, energyMix, FRONTIERS, frontierLabel, metric, moodOf, yearly, yearOfTick, type ViewWorld } from './shared'

type Pt = { tick: number; v: number }
type Series = { id: string; color: string; active: boolean; label: string; pts: Pt[]; dashed?: boolean }

// the real-world baseline: UN World Population Prospects 2024, medium variant (the same file c's realBaseline reads).
// a year's value sits at the end of that year (december), like the world's frame in force then
const UN_COLOR = '#9a948a'
const unLine = (by: Record<string, number>, d: Domain): Series => ({
  id: 'un', color: UN_COLOR, active: false, dashed: true, label: 'UN projection',
  pts: Object.entries(by).map(([y, v]) => ({ tick: (Number(y) - 2026) * 12 + 1, v })).filter((p) => p.tick >= d[0] - 12 && p.tick <= d[1] + 12).sort((a, b) => a.tick - b.tick),
})
const unAt = (by: Record<string, number>, tick: number) => by[String(yearOfTick(tick))]
type Slot = { key: string; label: string; color: string }
type Domain = [number, number]

const W = 340, H = 168, ML = 46, MR = 10, MT = 8, MB = 20
const x = (d: Domain, t: number) => ML + ((t - d[0]) / Math.max(1, d[1] - d[0])) * (W - ML - MR)
const nearest = (pts: Pt[], t: number) => pts.reduce<Pt | null>((b, p) => (!b || Math.abs(p.tick - t) < Math.abs(b.tick - t) ? p : b), null)

// pointer x on the svg -> tick
function useHover(domain: Domain, setHover: (t: number | null) => void) {
  const ref = useRef<SVGSVGElement>(null)
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const px = ((e.clientX - r.left) / r.width) * W
    const t = domain[0] + ((px - ML) / (W - ML - MR)) * (domain[1] - domain[0])
    setHover(Math.max(domain[0], Math.min(domain[1], t)))
  }
  return { ref, onPointerMove: onMove, onPointerLeave: () => setHover(null) }
}

function Frame({ title, sub, children, legend }: { title: string; sub?: string; children: React.ReactNode; legend?: React.ReactNode }) {
  return (
    <figure className="relative flex min-w-0 flex-col rounded-xl border border-ink/10 bg-bone/60 p-3">
      <figcaption className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-display text-[15px]">{title}</span>
        {sub && <span className="text-[10.5px] text-ink/50">{sub}</span>}
      </figcaption>
      {children}
      {legend}
    </figure>
  )
}

function Axes({ domain, lo, hi, yFmt, hover, playhead }: { domain: Domain; lo: number; hi: number; yFmt: (v: number) => string; hover: number | null; playhead: number }) {
  const y = (v: number) => H - MB - ((v - lo) / (hi - lo || 1)) * (H - MT - MB)
  const ticks = [lo, (lo + hi) / 2, hi]
  const years = [domain[0], (domain[0] + domain[1]) / 2, domain[1]]
  return (
    <g>
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.08} />
          <text x={ML - 6} y={y(v) + 3} textAnchor="end" className="fill-ink/45 font-mono text-[9px]">{yFmt(v)}</text>
        </g>
      ))}
      {years.map((t, i) => <text key={i} x={x(domain, t)} y={H - 5} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="fill-ink/45 font-mono text-[9px]">{yearOfTick(t)}</text>)}
      {playhead >= domain[0] && playhead <= domain[1] && <line x1={x(domain, playhead)} x2={x(domain, playhead)} y1={MT} y2={H - MB} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 3" />}
      {hover !== null && <line x1={x(domain, hover)} x2={x(domain, hover)} y1={MT} y2={H - MB} stroke="currentColor" strokeOpacity={0.6} />}
    </g>
  )
}

function Tip({ hover, domain, children }: { hover: number; domain: Domain; children: React.ReactNode }) {
  const left = (x(domain, hover) / W) * 100
  return (
    <div className="pointer-events-none absolute top-9 z-10 w-52 rounded-lg border border-ink/15 bg-bone px-2.5 py-2 text-[11px] shadow-lg" style={left > 55 ? { right: `${100 - left + 3}%` } : { left: `${left + 3}%` }}>
      {children}
    </div>
  )
}

function LineChart({ title, sub, series, domain, hover, setHover, yFmt, step = false, lo: lo0, hi: hi0, event }: {
  title: string; sub?: string; series: Series[]; domain: Domain; hover: number | null; setHover: (t: number | null) => void
  yFmt: (v: number) => string; step?: boolean; lo?: number; hi?: number; event?: (t: number) => string | null
}) {
  const playhead = useStore((s) => s.playhead)
  const h = useHover(domain, setHover)
  // every chart shows the crosshair; only the one under the pointer shows its tooltip
  const [mine, setMine] = useState(false)
  const all = series.flatMap((s) => s.pts.map((p) => p.v))
  if (!all.length) return null
  const lo = lo0 ?? Math.min(...all), hi = hi0 ?? Math.max(...all)
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08
  const L = lo0 ?? lo - pad, Hh = hi0 ?? hi + pad
  const y = (v: number) => H - MB - ((v - L) / (Hh - L || 1)) * (H - MT - MB)
  const path = (pts: Pt[]) => pts.map((p, i) => {
    const px = x(domain, p.tick).toFixed(1), py = y(p.v).toFixed(1)
    if (i === 0) return `M${px},${py}`
    return step ? `H${px}V${py}` : `L${px},${py}`
  }).join('')
  const ordered = [...series].sort((a, b) => Number(a.active) - Number(b.active))
  const ev = hover !== null && event ? event(hover) : null
  return (
    <Frame title={title} sub={sub}>
      <svg {...h} onPointerEnter={() => setMine(true)} onPointerLeave={() => { setMine(false); h.onPointerLeave() }} viewBox={`0 0 ${W} ${H}`} className="w-full cursor-crosshair text-ink" onClick={() => hover !== null && useStore.getState().setPlayhead(Math.round(hover))}>
        <Axes domain={domain} lo={L} hi={Hh} yFmt={yFmt} hover={hover} playhead={playhead} />
        {ordered.map((s) => s.pts.length > 1 && (
          <path key={s.id} d={path(s.pts)} fill="none" stroke={s.color} strokeWidth={s.active ? 2.5 : s.dashed ? 1.5 : 1} strokeOpacity={s.active || s.dashed ? 1 : 0.35} strokeDasharray={s.dashed ? '4 3' : undefined} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover !== null && series.map((s) => { const p = nearest(s.pts, hover); return p && <circle key={s.id} cx={x(domain, p.tick)} cy={y(p.v)} r={s.active ? 4 : 2.5} fill={s.color} stroke="var(--bone)" strokeWidth={2} /> })}
      </svg>
      {hover !== null && mine && (
        <Tip hover={hover} domain={domain}>
          <div className="mb-1 font-mono text-[10px] text-ink/50">{yearOfTick(hover)}</div>
          {series.map((s) => { const p = nearest(s.pts, hover); return p && (
            <div key={s.id} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 shrink-0 rounded" style={s.dashed ? { backgroundImage: `linear-gradient(90deg, ${s.color} 60%, transparent 60%)`, backgroundSize: '4px 2px' } : { background: s.color }} />
              <Num className={s.active ? 'font-semibold' : ''}>{yFmt(p.v)}</Num>
              <span className="truncate text-ink/55">{s.label}</span>
            </div>
          ) })}
          {ev && <div className="mt-1.5 border-t border-ink/10 pt-1 text-ink/70">biggest event: {ev}</div>}
        </Tip>
      )}
    </Frame>
  )
}

function StackChart({ title, sub, slots, rows, domain, hover, setHover }: {
  title: string; sub?: string; slots: Slot[]; rows: { tick: number; vals: Record<string, number> }[]; domain: Domain; hover: number | null; setHover: (t: number | null) => void
}) {
  const playhead = useStore((s) => s.playhead)
  const h = useHover(domain, setHover)
  // every chart shows the crosshair; only the one under the pointer shows its tooltip
  const [mine, setMine] = useState(false)
  if (rows.length < 2) return null
  const norm = rows.map((r) => { const tot = slots.reduce((a, s) => a + (r.vals[s.key] ?? 0), 0) || 1; return { tick: r.tick, vals: Object.fromEntries(slots.map((s) => [s.key, (r.vals[s.key] ?? 0) / tot])) } })
  const y = (v: number) => H - MB - v * (H - MT - MB)
  const areas = slots.map((s, i) => {
    const below = (r: (typeof norm)[number]) => slots.slice(0, i).reduce((a, q) => a + r.vals[q.key], 0)
    const top = norm.map((r) => `${x(domain, r.tick).toFixed(1)},${y(below(r) + r.vals[s.key]).toFixed(1)}`)
    const bot = norm.map((r) => `${x(domain, r.tick).toFixed(1)},${y(below(r)).toFixed(1)}`).reverse()
    return { s, d: `M${top.join('L')}L${bot.join('L')}Z` }
  })
  const near = hover !== null ? norm.reduce((b, r) => (Math.abs(r.tick - hover) < Math.abs(b.tick - hover) ? r : b)) : null
  return (
    <Frame title={title} sub={sub} legend={
      <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10.5px] text-ink/65">
        {slots.map((s) => <span key={s.key} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
      </div>
    }>
      <svg {...h} onPointerEnter={() => setMine(true)} onPointerLeave={() => { setMine(false); h.onPointerLeave() }} viewBox={`0 0 ${W} ${H}`} className="w-full cursor-crosshair text-ink" onClick={() => hover !== null && useStore.getState().setPlayhead(Math.round(hover))}>
        {areas.map(({ s, d }) => <path key={s.key} d={d} fill={s.color} fillOpacity={0.85} stroke="var(--bone)" strokeWidth={1} />)}
        <Axes domain={domain} lo={0} hi={1} yFmt={(v) => fmt.pct(v)} hover={hover} playhead={playhead} />
      </svg>
      {near && hover !== null && mine && (
        <Tip hover={hover} domain={domain}>
          <div className="mb-1 font-mono text-[10px] text-ink/50">{yearOfTick(near.tick)}</div>
          {[...slots].reverse().map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: s.color }} />
              <Num>{fmt.pct(near.vals[s.key])}</Num><span className="text-ink/55">{s.label}</span>
            </div>
          ))}
        </Tip>
      )}
    </Frame>
  )
}

// short frontier names that fit the axis
const SHORT = ['earth', 'moon', 'moon base', 'mars crew', 'mars town', 'mars free', 'asteroids', 'outer']

type DeathKey = 'deaths' | 'famineDeaths' | 'unrestDeaths'
const DEATHS: { key: DeathKey; label: string }[] = [{ key: 'deaths', label: 'all causes' }, { key: 'famineDeaths', label: 'famine' }, { key: 'unrestDeaths', label: 'unrest' }]

function Table({ rec, upTo }: { rec: RunRecord; upTo: number }) {
  const fs = yearly(rec).filter((f) => f.tick <= upTo + 1e-6)
  const deaths = deathsPerYear(fs, 'deaths')
  return (
    <div className="scroll-thin max-h-full overflow-auto rounded-xl border border-ink/10">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-bone text-left text-[10.5px] uppercase tracking-[0.12em] text-ink/50">
          <tr>{['year', 'population', 'UN projection', 'life expectancy', 'UN projection', 'approval', 'deaths that year', 'fertility', 'frontier'].map((h) => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}</tr>
        </thead>
        <tbody>
          {fs.map((f, i) => (
            <tr key={f.tick} className="border-t border-ink/5 hover:bg-ink/5" onClick={() => useStore.getState().setPlayhead(f.tick)}>
              <td className="px-3 py-1"><Num>{yearOfTick(f.tick)}</Num></td>
              <td className="px-3 py-1"><Num>{fmt.people(metric.population(f))}</Num></td>
              <td className="px-3 py-1 text-ink/55">{unAt(un.population.byYear, f.tick) !== undefined && <Num>{fmt.people(unAt(un.population.byYear, f.tick))}</Num>}</td>
              <td className="px-3 py-1">{metric.ple(f) > 0 && <Num>{metric.ple(f).toFixed(1)}</Num>}</td>
              <td className="px-3 py-1 text-ink/55">{unAt(un.lifeExpectancy.byYear, f.tick) !== undefined && <Num>{unAt(un.lifeExpectancy.byYear, f.tick).toFixed(1)}</Num>}</td>
              <td className="px-3 py-1"><Num>{fmt.pct(metric.approval(f))}</Num></td>
              <td className="px-3 py-1">{i > 0 && deaths[i - 1].v > 0 ? <Num className="text-ember">{fmt.people(deaths[i - 1].v)}</Num> : null}</td>
              <td className="px-3 py-1">{metric.fertility(f) > 0 && <Num>{metric.fertility(f).toFixed(2)}</Num>}</td>
              <td className="px-3 py-1">{frontierLabel(f.frontier)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Graphs({ worlds }: { worlds: ViewWorld[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const [deathKey, setDeathKey] = useState<DeathKey>('deaths')
  const [table, setTable] = useState(false)
  const active = worlds.find((w) => w.active) ?? worlds[0]
  const playhead = useStore((s) => s.playhead)
  // the axis spans the loaded record; the worlds' lines stop at the playhead (never the future)
  const all = useMemo(() => worlds.map((w) => ({ w, fs: yearly(w.record) })), [worlds])
  const domain: Domain = useMemo(() => {
    const ts = all.flatMap((d) => d.fs.map((f) => f.tick))
    return ts.length ? [Math.min(...ts), Math.max(...ts)] : [0, 12]
  }, [all])
  const data = useMemo(() => all.map(({ w, fs }) => ({ w, fs: fs.filter((f) => f.tick <= playhead + 1e-6) })), [all, playhead])
  // a value of 0 for life expectancy or fertility means the sim hadn't computed it yet (its first frame): not drawn
  const lines = (get: (f: (typeof data)[number]['fs'][number]) => number, recorded = false): Series[] =>
    data.map(({ w, fs }) => ({ id: w.record.runId, color: w.color, active: w.active, label: w.label, pts: fs.map((f) => ({ tick: f.tick, v: get(f) })).filter((p) => !recorded || p.v > 0) }))
  const deathSeries: Series[] = data.map(({ w, fs }) => ({ id: w.record.runId, color: w.color, active: w.active, label: w.label, pts: deathsPerYear(fs, deathKey) }))
  const activeFs = useMemo(() => data.find((d) => d.w === active)?.fs ?? [], [data, active])
  const energyRows = activeFs.map((f) => ({ tick: f.tick, vals: energyMix(f) })).filter((r): r is { tick: number; vals: Record<string, number> } => !!r.vals)
  const emoSlots = useMemo(() => emotionSlots(activeFs), [activeFs])
  const emoRows = activeFs.map((f) => {
    const m = moodOf(f)
    const named = new Set(emoSlots.map((s) => s.key))
    const vals: Record<string, number> = { other: 0 }
    for (const [k, v] of Object.entries(m)) { if (named.has(k as never)) vals[k] = v; else vals.other += v }
    return { tick: f.tick, vals }
  })
  const event = (t: number) => (active ? biggestEvent(active.record, t)?.text ?? null : null)
  const common = { domain, hover, setHover, event }
  if (!active) return null

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        {worlds.map((w) => (
          <span key={w.record.runId} className={`flex items-center gap-1.5 ${w.active ? 'font-semibold' : 'text-ink/60'}`}>
            <span className="h-[3px] w-5 rounded" style={{ background: w.color, opacity: w.active ? 1 : 0.5 }} />{w.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-ink/60"><span className="h-[2px] w-5" style={{ backgroundImage: `linear-gradient(90deg, ${UN_COLOR} 60%, transparent 60%)`, backgroundSize: '5px 2px' }} />UN projection (<a href={un.population.provenance.original} target="_blank" rel="noreferrer" className="underline decoration-ink/25 underline-offset-2">WPP 2024</a>, medium variant)</span>
        <span className="text-ink/45">bold is the world you are in. hover to read values, click to jump the timeline there</span>
        <button onClick={() => setTable(!table)} className="ml-auto rounded-full border border-ink/20 px-3 py-0.5 text-[11.5px] hover:bg-ink hover:text-bone">{table ? 'show charts' : 'show as table'}</button>
      </div>
      {table ? <Table rec={active.record} upTo={playhead} /> : (
        <div className="scroll-thin grid min-h-0 grid-cols-2 gap-3 overflow-y-auto lg:grid-cols-4">
          <LineChart title="population" sub="people alive · dashed: UN" series={[...lines(metric.population), unLine(un.population.byYear, domain)]} yFmt={fmt.people} {...common} />
          <LineChart title="life expectancy" sub="period, years · dashed: UN" series={[...lines(metric.ple, true), unLine(un.lifeExpectancy.byYear, domain)]} yFmt={(v) => v.toFixed(0)} {...common} />
          <LineChart title="approval" sub="of the core" series={lines(metric.approval)} yFmt={fmt.pct} lo={0} hi={1} {...common} />
          <div className="relative">
            <div className="absolute right-3 top-2.5 z-10 flex gap-1">
              {DEATHS.map((d) => <button key={d.key} onClick={() => setDeathKey(d.key)} className={`rounded-full px-2 text-[10px] ${deathKey === d.key ? 'bg-ink text-bone' : 'text-ink/55 hover:bg-ink/10'}`}>{d.label}</button>)}
            </div>
            <LineChart title="deaths" sub="" series={deathSeries} yFmt={fmt.people} lo={0} {...common} />
          </div>
          <LineChart title="fertility" sub="children per woman" series={lines(metric.fertility, true)} yFmt={(v) => v.toFixed(1)} {...common} />
          <LineChart title="frontier" sub="how far out humanity lives" series={lines(metric.frontier)} yFmt={(v) => SHORT[Math.round(v)] ?? ''} step lo={0} hi={FRONTIERS.length - 1} {...common} />
          <StackChart title="energy mix" sub={`share of power, ${active.label}`} slots={ENERGY.map((e) => ({ ...e }))} rows={energyRows} domain={domain} hover={hover} setHover={setHover} />
          <StackChart title="emotion mix" sub={`how people feel, ${active.label}`} slots={emoSlots} rows={emoRows} domain={domain} hover={hover} setHover={setHover} />
        </div>
      )}
    </div>
  )
}
