'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Agent, HallEntry } from '@/lib/types'
import { rootOf } from '@/lib/mock/agents'
import { useStore } from '../state/store'
import { Num, Skel } from './bits'
import Emblem from './Emblem'
import { frontierLabel } from './Chrome'
import { loadHall, openRun, startCompare } from './worlds'
import { tickToDate, formatDay } from '../world/time'

function Badge({ a }: { a: Agent }) {
  if (a.champion) return <span className="rounded-full bg-ink px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-bone">champion</span>
  if (a.retired) return <span className="rounded-full border border-ink/25 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-ink/50">retired</span>
  return null
}

function Card({ a, checked, onCheck }: { a: Agent; checked: boolean; onCheck: (v: boolean) => void }) {
  const select = useStore((s) => s.select)
  return (
    <div className={`relative rounded-2xl border bg-bone/80 p-3 transition hover:-translate-y-0.5 hover:shadow-md ${a.champion ? 'border-ink shadow-[0_0_16px_rgba(242,223,160,0.55)]' : 'border-ink/15'} ${a.retired ? 'opacity-70' : ''}`}>
      <label className="absolute right-3 top-3 flex items-center gap-1 text-[10px] text-ink/50" onClick={(e) => e.stopPropagation()}>
        compare <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--ink)]" />
      </label>
      <button onClick={() => select({ kind: 'agent', id: a.id })} className="block w-full text-left">
        <div className="flex items-center gap-3 pr-16">
          <Emblem seed={a.emblemSeed} size={44} glow={a.champion} faded={a.retired} />
          <div className="min-w-0">
            <div className="truncate font-display text-[17px] leading-tight">{a.name}</div>
            <div className="text-[10.5px] text-ink/50">gen <Num>{a.generation}</Num> · {a.origin}</div>
          </div>
        </div>
        <p className="mt-2 line-clamp-2 text-[12px] italic leading-snug text-ink/75">{a.philosophy}</p>
        <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-0.5 text-[10.5px]">
          <span className="text-ink/50">worlds <Num className="text-ink">{a.worlds}</Num></span>
          <span className="text-ink/50">deaths <Num className={a.deaths ? 'text-ember' : 'text-ink'}>{a.deaths}</Num></span>
          <span className="text-ink/50">avg <Num className="text-ink">{a.avgScore.toFixed(2)}</Num></span>
          <span className="col-span-2 truncate text-ink/50">frontier <span className="text-ink">{frontierLabel(a.bestFrontier)}</span></span>
          <span className="text-ink/50">life <Num className="text-ink">{a.bestPeriodLifeExpectancy.toFixed(0)}y</Num></span>
        </div>
        <div className="mt-2 flex items-center justify-between"><Badge a={a} /><Num className="text-[12px]">best {a.bestScore.toFixed(2)}</Num></div>
      </button>
    </div>
  )
}

// generations top to bottom, children under their parents, crossovers drawn dashed
function FamilyTree({ agents }: { agents: Agent[] }) {
  const select = useStore((s) => s.select)
  const layout = useMemo(() => {
    const gens = [...new Set(agents.map((a) => a.generation))].sort((a, b) => a - b)
    const pos = new Map<string, { x: number; y: number }>()
    const W = 132, H = 118
    let width = 0
    for (const g of gens) {
      const row = agents.filter((a) => a.generation === g)
      const keyX = (a: Agent) => (a.parentIds.length ? a.parentIds.reduce((s, p) => s + (pos.get(p)?.x ?? 0), 0) / a.parentIds.length : agents.indexOf(a) * W)
      row.sort((a, b) => keyX(a) - keyX(b))
      row.forEach((a, i) => {
        const want = a.parentIds.length ? keyX(a) : i * W
        const prev = i > 0 ? pos.get(row[i - 1].id)!.x + W : 0
        pos.set(a.id, { x: Math.max(want, prev), y: g * H })
        width = Math.max(width, pos.get(a.id)!.x + W)
      })
    }
    // a lineage is dead when every agent in it is retired
    const deadRoots = new Set([...new Set(agents.map((a) => rootOf(a.id, agents)))].filter((root) => agents.filter((a) => rootOf(a.id, agents) === root).every((a) => a.retired)))
    return { pos, width, height: gens.length * H, deadRoots }
  }, [agents])
  const { pos, width, height, deadRoots } = layout
  return (
    <div className="relative mt-4" style={{ width, height }}>
      <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
        {agents.flatMap((a) => a.parentIds.map((p) => {
          const from = pos.get(p), to = pos.get(a.id)
          if (!from || !to) return null
          const x1 = from.x + 56, y1 = from.y + 62, x2 = to.x + 56, y2 = to.y + 8
          const dead = deadRoots.has(rootOf(a.id, agents))
          return <path key={`${p}-${a.id}`} d={`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`} fill="none" stroke="var(--ink)" strokeOpacity={dead ? 0.15 : 0.5} strokeWidth={2.5} strokeDasharray={a.origin === 'crossover' ? '6 5' : undefined} />
        }))}
      </svg>
      {agents.map((a) => {
        const p = pos.get(a.id)!
        const dead = deadRoots.has(rootOf(a.id, agents))
        return (
          <button key={a.id} onClick={() => select({ kind: 'agent', id: a.id })} className={`absolute flex w-28 flex-col items-center gap-1 text-center ${dead ? 'opacity-40' : ''}`} style={{ left: p.x, top: p.y }}>
            <span className={`rounded-full p-1 ${a.champion ? 'bg-bone shadow-[0_0_22px_rgba(242,223,160,0.95)]' : ''}`}><Emblem seed={a.emblemSeed} size={52} glow={a.champion} faded={a.retired && !dead} /></span>
            <span className="text-[11.5px] leading-tight">{a.name}</span>
            <span className="text-[9.5px] text-ink/45">gen <Num>{a.generation}</Num>{a.retired ? ' · retired' : ''}</span>
          </button>
        )
      })}
    </div>
  )
}

export function AgentsPanel() {
  const agents = useStore((s) => s.agents)
  const source = useStore((s) => s.agentsSource)
  const setPanel = useStore((s) => s.setPanel)
  const [tab, setTab] = useState<'roster' | 'family tree'>('roster')
  const [sort, setSort] = useState<'score' | 'generation' | 'name'>('score')
  const [picked, setPicked] = useState<string[]>([])
  const sorted = useMemo(() => [...agents].sort((a, b) => (sort === 'score' ? b.bestScore - a.bestScore : sort === 'generation' ? a.generation - b.generation || b.bestScore - a.bestScore : a.name.localeCompare(b.name))), [agents, sort])
  const check = (id: string, v: boolean) => setPicked((p) => (v ? [...p.filter((x) => x !== id), id].slice(-4) : p.filter((x) => x !== id)))
  return (
    <div className="panel dossier-in scroll-thin pointer-events-auto max-h-full w-full max-w-5xl overflow-auto p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-ink/45">every governor that has run a world{source === 'mock' ? ' · mock' : ''}</div>
          <div className="font-display text-2xl">agents</div>
        </div>
        <div className="flex items-center gap-2">
          {picked.length >= 2 && <button onClick={() => startCompare(picked)} className="rounded-full bg-ink px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-bone">compare <Num>{picked.length}</Num></button>}
          <button onClick={() => setPanel(null)} className="rounded-full px-2 text-lg leading-none text-ink/50 hover:bg-ink/10 hover:text-ink" aria-label="close">×</button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 text-[12px]">
          {(['roster', 'family tree'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 ${tab === t ? 'bg-ink text-bone' : 'text-ink/60 hover:bg-ink/5'}`}>{t}</button>)}
        </div>
        {tab === 'roster' && (
          <div className="flex items-center gap-1 text-[11px] text-ink/55">sort
            {(['score', 'generation', 'name'] as const).map((s) => <button key={s} onClick={() => setSort(s)} className={`rounded-full px-2 py-0.5 ${sort === s ? 'bg-ink text-bone' : 'hover:bg-ink/5'}`}>{s}</button>)}
          </div>
        )}
      </div>
      {tab === 'roster' && (
        <>
          {picked.length > 0 && picked.length < 2 && <p className="mt-2 text-[11px] text-ink/50">pick one more to compare (up to four)</p>}
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {sorted.length ? sorted.map((a) => <Card key={a.id} a={a} checked={picked.includes(a.id)} onCheck={(v) => check(a.id, v)} />) : Array.from({ length: 6 }, (_, i) => <Skel key={i} className="h-44 rounded-2xl" />)}
          </div>
        </>
      )}
      {tab === 'family tree' && <FamilyTree agents={agents} />}
    </div>
  )
}

const KIND_ORDER: HallEntry['kind'][] = ['milestone', 'first', 'record', 'catastrophe']

export function HallPanel() {
  const setPanel = useStore((s) => s.setPanel)
  const agents = useStore((s) => s.agents)
  const [hall, setHall] = useState<{ entries: HallEntry[]; mock: boolean } | null>(null)
  useEffect(() => { loadHall().then(setHall) }, [])
  return (
    <div className="panel dossier-in scroll-thin pointer-events-auto max-h-full w-full max-w-2xl overflow-auto p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-ink/45">records across every world{hall?.mock ? ' · mock' : ''}</div>
          <div className="font-display text-2xl">hall of history</div>
        </div>
        <button onClick={() => setPanel(null)} className="rounded-full px-2 text-lg leading-none text-ink/50 hover:bg-ink/10 hover:text-ink" aria-label="close">×</button>
      </div>
      {KIND_ORDER.map((k) => {
        const list = hall?.entries.filter((e) => e.kind === k) ?? []
        if (!list.length) return null
        return (
          <div key={k} className="mt-4">
            <div className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-ink/45">{k === 'first' ? 'firsts' : k === 'record' ? 'records' : k === 'catastrophe' ? 'catastrophes' : 'milestones'}</div>
            <ul className="space-y-1.5">
              {list.map((e) => {
                const a = agents.find((x) => x.id === e.agentId)
                return (
                  <li key={e.id} className={`flex items-center gap-3 rounded-xl border-l-2 bg-bone/70 px-3 py-2 ${k === 'catastrophe' ? 'border-ember' : 'border-ink/25'}`}>
                    {a && <Emblem seed={a.emblemSeed} size={30} glow={a.champion} />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px]">{e.title} <span className="text-ink/50">· {a?.name ?? e.agentId}</span></div>
                      <div className="truncate text-[11.5px] text-ink/65">{e.text}</div>
                    </div>
                    <button onClick={() => { openRun(e.runId, e.tick); setPanel(null) }} className="shrink-0 rounded-full border border-ink/25 px-2.5 py-0.5 text-[11px] hover:bg-ink hover:text-bone">
                      <Num>{formatDay(tickToDate(e.tick)).split(' ').slice(1).join(' ')}</Num> →
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      {!hall && <div className="mt-4 space-y-2">{Array.from({ length: 5 }, (_, i) => <Skel key={i} className="h-14 rounded-xl" />)}</div>}
      {hall && !hall.entries.length && <p className="mt-4 text-[12px] text-ink/50">no history yet. records appear as worlds finish</p>}
    </div>
  )
}
