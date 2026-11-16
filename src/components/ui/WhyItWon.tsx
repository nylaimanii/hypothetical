'use client'
// the agents' leaderboard (GET /api/leaderboard): each row is an agent with its best world, its score next to how
// that world compares with UN projections, and a row that opens to why it ranked above the next agent. the reasons
// are c's: 'replay' was tested by replaying the lower world with each decision swapped in; 'pattern' is a
// comparison of decisions that has not been tested, and says so. a reason with a tick jumps into the world there.
// while the current sim version has no finished generation, the latest archived board is shown, labeled as such
import { useEffect, useState } from 'react'
import type { RunSummary } from '@/lib/types'
import { Num } from './bits'
import { openRun } from './worlds'
import { dateOfTick } from './truth'

type Reason = { text: string; tick?: number; share?: number; run?: string }
type Gap = { method: 'replay' | 'pattern'; vs: string; decisive: string[]; reasons?: Reason[]; text: string; seed?: number; gap?: number }
export type BoardEntry = { candidateId: string; name: string; score: number; generation: number; best: RunSummary; explainGap?: Gap | null; realBaseline?: { text: string } | null }
type Versions = { current: string; history: { version: string }[] }

async function getJson<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? ((await r.json()) as T) : null } catch { return null }
}

export function useBoard() {
  const [board, setBoard] = useState<{ rows: BoardEntry[]; version?: string; current?: string } | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const rows = await getJson<BoardEntry[]>('/api/leaderboard')
      if (rows?.length) { if (live) setBoard({ rows }); return }
      // nothing yet on this sim version: the newest archived board that has rows
      const v = await getJson<Versions>('/api/versions')
      for (const h of [...(v?.history ?? [])].reverse()) {
        const old = await getJson<BoardEntry[]>(`/api/leaderboard?version=${encodeURIComponent(h.version)}`)
        if (old?.length) { if (live) setBoard({ rows: old, version: h.version, current: v?.current }); return }
      }
      if (live) setBoard({ rows: [] })
    })()
    return () => { live = false }
  }, [])
  return board
}

// the caveat c appends to an untested comparison, shown as written
const caveatOf = (text: string) => text.match(/\(([^()]*)\)\s*$/)?.[1]

function WhyRow({ e, next }: { e: BoardEntry; next?: BoardEntry }) {
  const g = e.explainGap
  if (!g) return <p className="text-[11px] text-ink/50">{next ? 'no comparison with the next agent yet' : 'nothing ranked below it to compare with'}</p>
  const reasons: Reason[] = g.reasons?.length ? g.reasons : g.decisive.map((text) => ({ text }))
  const caveat = g.method === 'pattern' ? caveatOf(g.text) : undefined
  return (
    <div className="text-[11.5px] leading-snug">
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-ink/45">
        <span>why it ranked above {next?.name ?? 'the next agent'}</span>
        <span className={`rounded-full border px-1.5 normal-case tracking-normal ${g.method === 'replay' ? 'border-ink/40 text-ink/70' : 'border-dashed border-ink/40 text-ink/60'}`}>{g.method === 'replay' ? 'tested by replay' : 'untested'}</span>
      </div>
      <ol className="space-y-1">
        {reasons.slice(0, 3).map((r, i) => (
          <li key={i} className="flex gap-1.5">
            <Num className="text-ink/40">{i + 1}</Num>
            {r.tick !== undefined
              ? <button onClick={() => openRun(r.run ?? e.best.runId, r.tick)} className="text-left underline decoration-ink/20 underline-offset-2 hover:text-ink">{r.text} <Num className="text-ink/50">{dateOfTick(r.tick)}</Num>{r.share !== undefined && <> · <Num className="text-ink/50">{Math.round(r.share * 100)}%</Num> <span className="text-ink/50">of the gap</span></>}</button>
              : <span>{r.text}</span>}
          </li>
        ))}
      </ol>
      {caveat && <p className="mt-1 text-[10.5px] text-ink/50">{caveat}</p>}
    </div>
  )
}

export function AgentBoard() {
  const board = useBoard()
  const [open, setOpen] = useState<string | null>(null)
  if (!board?.rows.length) return null
  return (
    <div className="pb-1">
      <div className="px-4 pb-1 text-[10px] uppercase tracking-[0.12em] text-ink/45">
        agents{board.version ? <> · sim <Num>{board.version}</Num> board <span className="normal-case tracking-normal">(sim <Num>{board.current}</Num> has no finished generation yet)</span></> : null}
      </div>
      <ul>
        {board.rows.map((e, i) => (
          <li key={e.candidateId} className="px-4 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => openRun(e.best.runId)} className="flex min-w-0 items-center gap-2 text-left hover:underline">
                <Num className="w-4 text-[11px] text-ink/40">{i + 1}</Num>
                <span className="truncate text-[13px]">{e.name}</span>
              </button>
              <Num className="text-[12px]">{e.score.toFixed(4)}</Num>
            </div>
            <div className="ml-6 text-[11px] text-ink/55">
              <span className={e.best.status === 'destroyed' ? 'text-ember' : ''}>{e.best.status}</span> <Num>{e.best.endDate}</Num> · gen <Num>{e.generation}</Num>
            </div>
            {e.realBaseline?.text && <div className="ml-6 text-[11px] text-ink/55">{e.realBaseline.text}</div>}
            <button onClick={() => setOpen(open === e.candidateId ? null : e.candidateId)} className="ml-6 mt-0.5 text-[11px] text-ink/60 underline decoration-ink/20 underline-offset-2 hover:text-ink">
              {open === e.candidateId ? 'hide why' : 'why it won'}
            </button>
            {open === e.candidateId && <div className="ml-6 mt-1"><WhyRow e={e} next={board.rows[i + 1]} /></div>}
          </li>
        ))}
      </ul>
    </div>
  )
}
