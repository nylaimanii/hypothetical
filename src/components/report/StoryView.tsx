'use client'
// /story: every world in order, how it ended and the lesson it left, and whether later worlds listened.
// all sentences come from C's GET /api/report/learning; the best score so far comes from GET /api/learning
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { OutcomeChip, Rich, statusWord, worldHref } from './bits'

type Entry = {
  order: number; runId: string; agentId: string; agentName: string; generation: number; status: string; endDate: string
  cause?: string; lesson?: { id: string; rule: string; mistake: string }
  later: { worlds: number; repeatedBy: string[]; avoided: boolean | null }
}
type Learning = { worlds: number; deaths: number; lessons: number; avoidedShare: number | null; entries: Entry[] }
type Row = { generation: number; bestScore: number }

export default function StoryView() {
  const [data, setData] = useState<Learning | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState(false)
  useEffect(() => {
    fetch('/api/report/learning').then((r) => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => setErr(true))
    fetch('/api/learning').then((r) => (r.ok ? r.json() : [])).then((b) => setRows(Array.isArray(b) ? b : [])).catch(() => {})
  }, [])

  // the best score anyone had reached by each generation
  const bestBy = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of rows) m.set(r.generation, Math.max(m.get(r.generation) ?? 0, r.bestScore))
    let run = 0
    const out = new Map<number, number>()
    for (const g of [...m.keys()].sort((a, b) => a - b)) { run = Math.max(run, m.get(g)!); out.set(g, run) }
    return out
  }, [rows])
  const top = Math.max(0.0001, ...bestBy.values())
  // who repeated whose mistake: for the arrows back up
  const repeatOf = useMemo(() => {
    const m = new Map<string, Entry[]>()
    for (const e of data?.entries ?? []) for (const id of e.later.repeatedBy) m.set(id, [...(m.get(id) ?? []), e])
    return m
  }, [data])
  const byId = useMemo(() => new Map((data?.entries ?? []).map((e) => [e.runId, e])), [data])

  return (
    <main className="page-scroll bg-bone">
      <div className="mx-auto w-full max-w-[44rem] px-5 sm:px-6">
        <nav className="no-print flex items-center justify-between pt-4 text-[13px] text-ink/60">
          <Link href="/" className="hover:text-ink">← hypothetical</Link>
          <button onClick={() => window.print()} className="hover:text-ink">print</button>
        </nav>
        <header className="print-keep pt-10 sm:pt-14">
          <h1 className="font-display text-[clamp(2rem,6vw,3rem)] font-medium leading-[1.05] tracking-tight">the story so far</h1>
          {data && (
            <p className="mt-3 text-[15px] text-ink/70">
              <span className="font-mono">{data.worlds}</span> worlds · <span className="font-mono">{data.deaths}</span> lost · <span className="font-mono">{data.lessons}</span> lessons
              {data.avoidedShare !== null && <> · later worlds avoided <span className="font-mono">{Math.round(data.avoidedShare * 100)}%</span> of the mistakes</>}
            </p>
          )}
        </header>

        {err && <p className="mt-16 text-center text-[15px] text-ink/60">the story could not be loaded.</p>}
        {!data && !err && <div className="mt-10 space-y-4">{[0, 1, 2].map((i) => <div key={i} className="skel h-20 w-full rounded-xl" />)}</div>}
        {data && data.entries.length === 0 && <p className="mt-16 text-center text-[15px] text-ink/60">no worlds have finished yet.</p>}

        {data && data.entries.length > 0 && (
          <ol className="relative mt-10 mb-20 border-l border-ink/15 pl-6 sm:pl-8">
            {data.entries.map((e) => {
              const best = bestBy.get(e.generation)
              const repeated = repeatOf.get(e.runId) ?? []
              return (
                <li key={e.runId} id={`w-${e.runId}`} className="print-keep relative mb-9 scroll-mt-6">
                  <span className="absolute -left-[2.15rem] top-0.5 sm:-left-[2.65rem]"><OutcomeChip status={e.status} size={20} /></span>
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/report/${encodeURIComponent(e.runId)}`} className="font-display text-[clamp(1.1rem,3vw,1.3rem)] leading-snug hover:underline hover:decoration-ink/25 hover:underline-offset-4">
                      world <span className="font-mono text-[0.9em]">#{e.order}</span> · {e.agentName}
                    </Link>
                    {best !== undefined && (
                      // the best score so far climbs down the side
                      <span className="flex shrink-0 items-center gap-2" title="best score reached by this generation">
                        <span className="hidden h-1.5 w-20 rounded-full bg-ink/10 sm:block"><span className="block h-full rounded-full bg-ink/60" style={{ width: `${(best / top) * 100}%` }} /></span>
                        <span className="font-mono text-[12px] text-ink/60">{best.toFixed(2)}</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-ink/55">generation <span className="font-mono">{e.generation}</span> · {statusWord(e.status)} · <span className="font-mono">{e.endDate.slice(0, 4)}</span></div>
                  {e.cause && <p className="mt-2 text-[15.5px] leading-relaxed"><span className="text-ember">how it died:</span> <Rich text={e.cause} /></p>}
                  {e.lesson && <p className="mt-1.5 text-[15.5px] leading-relaxed text-ink/85"><span className="text-ink/50">the lesson it left:</span> <Rich text={e.lesson.rule} /></p>}
                  {e.lesson && e.later.avoided === true && <p className="mt-1.5 text-[13px] text-[#5E8C4A]">↓ none of the <span className="font-mono">{e.later.worlds}</span> worlds after it died of this</p>}
                  {e.later.repeatedBy.length > 0 && (
                    <p className="mt-1.5 text-[13px] text-ink/65">↓ repeated by {e.later.repeatedBy.map((id, i) => { const x = byId.get(id); return <span key={id}>{i > 0 && ', '}<a href={`#w-${id}`} className="underline decoration-ink/25 underline-offset-2">{x ? `world #${x.order}` : id}</a></span> })}</p>
                  )}
                  {repeated.length > 0 && (
                    <p className="mt-1.5 text-[13px] text-ink/65">↑ made the same mistake as {repeated.map((x, i) => <span key={x.runId}>{i > 0 && ', '}<a href={`#w-${x.runId}`} className="underline decoration-ink/25 underline-offset-2">world #{x.order}</a></span>)}</p>
                  )}
                  <Link href={worldHref(e.runId)} className="no-print mt-1.5 inline-block text-[12.5px] text-ink/50 underline decoration-ink/20 underline-offset-2 hover:text-ink">open the world</Link>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </main>
  )
}
