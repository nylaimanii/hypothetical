'use client'
import { useMemo } from 'react'
import type { Frontier, Requirement } from '@/lib/types'
import { useCurrentFrame, useStore } from '../state/store'
import { Num, fmt } from './bits'
import { frontierLabel } from './Chrome'

const FRONTIER: Frontier[] = ['none', 'moon_landing', 'moon_base', 'mars_crewed', 'mars_settlement', 'mars_self_sustaining', 'asteroid_mining', 'outer_system']
const FRONTIER_SHORT: Record<Frontier, string> = { none: 'earth', moon_landing: 'moon', moon_base: 'moon base', mars_crewed: 'mars', mars_settlement: 'mars settlement', mars_self_sustaining: 'self sustaining mars', asteroid_mining: 'asteroids', outer_system: 'outer system' }

const PILL_W = 188
const PILL_H = 54
const COL_GAP = 52
const ROW_GAP = 14

// depth = longest prerequisite chain, so the tree reads left to right
function layout(reqs: Requirement[]) {
  const byId = new Map(reqs.map((r) => [r.id, r]))
  const depth = new Map<string, number>()
  const d = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const r = byId.get(id)
    const v = r && r.prereqs.length ? 1 + Math.max(...r.prereqs.filter((p) => byId.has(p)).map((p) => d(p, seen)), -1) : 0
    depth.set(id, v)
    return v
  }
  reqs.forEach((r) => d(r.id))
  const cols = new Map<number, Requirement[]>()
  for (const r of reqs) { const k = depth.get(r.id)!; cols.set(k, [...(cols.get(k) ?? []), r]) }
  const pos = new Map<string, { x: number; y: number }>()
  let h = 0
  for (const [k, list] of cols) list.forEach((r, i) => { const y = i * (PILL_H + ROW_GAP); pos.set(r.id, { x: k * (PILL_W + COL_GAP), y }); h = Math.max(h, y + PILL_H) })
  return { pos, w: (Math.max(...cols.keys()) + 1) * (PILL_W + COL_GAP) - COL_GAP, h }
}

const TIER: Record<Requirement['tier'], string> = {
  proven: 'border-ink/70 border-solid',
  emerging: 'border-dusk border-solid',
  speculative: 'border-ink/40 border-dashed',
}

function Tree({ reqs }: { reqs: Requirement[] }) {
  const select = useStore((s) => s.select)
  const { pos, w, h } = useMemo(() => layout(reqs), [reqs])
  return (
    <div className="relative" style={{ width: w, height: h }}>
      <svg width={w} height={h} className="absolute inset-0 overflow-visible" aria-hidden>
        {reqs.flatMap((r) => r.prereqs.filter((p) => pos.has(p)).map((p) => {
          const a = pos.get(p)!, b = pos.get(r.id)!
          const x1 = a.x + PILL_W, y1 = a.y + PILL_H / 2, x2 = b.x, y2 = b.y + PILL_H / 2
          const done = (reqs.find((x) => x.id === p)?.progress ?? 0) >= 1
          return <path key={`${p}-${r.id}`} d={`M${x1},${y1} C${x1 + COL_GAP / 2},${y1} ${x2 - COL_GAP / 2},${y2} ${x2},${y2}`} fill="none" stroke="var(--ink)" strokeOpacity={done ? 0.7 : 0.22} strokeWidth={2} />
        }))}
      </svg>
      {reqs.map((r) => {
        const p = pos.get(r.id)!
        const lit = r.progress >= 1
        return (
          <button key={r.id} onClick={() => select({ kind: 'requirement', id: r.id })} title={`${r.tier} · ${Math.round(r.progress * 100)}%`}
            className={`absolute overflow-hidden rounded-2xl border-2 text-left shadow-sm transition hover:-translate-y-0.5 ${TIER[r.tier]} ${lit ? 'bg-ink text-bone shadow-[0_0_18px_rgba(242,223,160,0.55)]' : 'bg-bone'}`}
            style={{ left: p.x, top: p.y, width: PILL_W, height: PILL_H }}>
            {!lit && <span className="absolute inset-y-0 left-0 bg-ink/12" style={{ width: `${r.progress * 100}%` }} />}
            <span className="relative flex h-full flex-col justify-center px-3">
              <span className="line-clamp-2 text-[11.5px] leading-[1.15]">{r.name}</span>
              <span className={`flex justify-between text-[10px] ${lit ? 'text-bone/70' : 'text-ink/50'}`}><span>{r.tier}</span><Num>{Math.round(r.progress * 100)}%</Num></span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function FrontierTrack({ frontier }: { frontier: Frontier }) {
  const at = FRONTIER.indexOf(frontier)
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {FRONTIER.map((f, i) => (
        <div key={f} className="flex items-center gap-1">
          <span className={`whitespace-nowrap rounded-full border-2 px-3 py-1 text-[12px] ${i <= at ? 'border-ink bg-ink text-bone' : 'border-ink/20 text-ink/50'} ${i === at ? 'shadow-[0_0_14px_rgba(242,223,160,0.6)]' : ''}`}>{FRONTIER_SHORT[f]}</span>
          {i < FRONTIER.length - 1 && <span className={`h-0.5 w-4 ${i < at ? 'bg-ink' : 'bg-ink/15'}`} />}
        </div>
      ))}
    </div>
  )
}

export default function Roadmap() {
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const { frame } = useCurrentFrame()
  if (!panel) return null
  const off = panel === 'offworld'
  const reqs = frame.requirements.filter((r) => (off ? r.track === 'mars' || r.track === 'outer_planets' || r.track === 'infrastructure' : r.track === 'longevity' || r.track === 'population'))
  const avg = reqs.length ? reqs.reduce((a, r) => a + r.progress, 0) / reqs.length : 0
  return (
    <div className="panel dossier-in scroll-thin pointer-events-auto max-h-full max-w-full overflow-auto p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-ink/45">{off ? 'everything needed for mars and beyond' : 'everything needed for a healthy 200 year life'}</div>
          <div className="font-display text-2xl">{off ? 'off-world' : '200 years'}</div>
          <div className="mt-0.5 text-[12px] text-ink/55">
            {off ? <>frontier: {frontierLabel(frame.frontier)}</> : <>period life expectancy <Num>{frame.globalPeriodLifeExpectancy.toFixed(1)}y</Num></>} · average progress <Num>{fmt.pct(avg)}</Num>
          </div>
        </div>
        <button onClick={() => setPanel(null)} className="rounded-full px-2 text-lg leading-none text-ink/50 hover:bg-ink/10 hover:text-ink" aria-label="close">×</button>
      </div>
      {off && <div className="mt-4"><FrontierTrack frontier={frame.frontier} /></div>}
      {reqs.length ? <div className="mt-5"><Tree reqs={reqs} /></div> : <p className="mt-4 text-[12px] text-ink/50">no requirements reported by this world yet</p>}
      <div className="mt-4 flex gap-4 text-[10.5px] text-ink/55">
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-md border-2 border-ink/70" />proven</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-md border-2 border-dusk" />emerging</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-md border-2 border-dashed border-ink/40" />speculative</span>
        <span>click any pill for its dossier</span>
      </div>
    </div>
  )
}
