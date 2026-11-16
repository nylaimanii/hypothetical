'use client'
// /report/[runId]: one world, read like a magazine piece. every sentence is C's report text, set in type here.
// headline = the epitaph, else the first summary line; standfirst = the rest of the summary;
// the turning point = the run's own most significant event (its text, from the record), with the claims around it
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { WorldEvent } from '@/lib/types'
import { OutcomeChip, RefLinks, Rich, Snapshot, statusWord, worldHref, type Ref } from './bits'

type Claim = { text: string; refs: Ref[] }
type Section = { id: string; title: string; claims: Claim[] }
type Report = { runId: string; agentId: string; agentName: string; generation: number; seed: number; status: string; endDate: string; summary: string[]; epitaph?: string; sections: Section[] }
type Slim = { firstTick: number; lastTick: number; summary: { topEvents: WorldEvent[] } }

// claims in pairs or threes, so a section reads as short paragraphs, not a list
function paragraphs(claims: Claim[]) {
  const out: Claim[][] = []
  for (let i = 0; i < claims.length; i += claims.length > 4 ? 3 : 2) out.push(claims.slice(i, i + (claims.length > 4 ? 3 : 2)))
  return out
}

export default function ReportView({ runId }: { runId: string }) {
  const [rep, setRep] = useState<Report | null>(null)
  const [slim, setSlim] = useState<Slim | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let stop = false
    fetch(`/api/report/${encodeURIComponent(runId)}`).then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() }).then((b) => { if (!stop) setRep(b) }).catch((e) => { if (!stop) setErr(String(e.message)) })
    fetch(`/api/runs/${encodeURIComponent(runId)}?slim=1`).then((r) => (r.ok ? r.json() : null)).then((b) => { if (!stop && b?.summary) setSlim(b) }).catch(() => {})
    return () => { stop = true }
  }, [runId])

  const turning = useMemo(() => {
    const evs = (slim?.summary.topEvents ?? []).filter((e) => e.tick > (slim?.firstTick ?? 0))
    return [...evs].sort((a, b) => (b.significance ?? 0) - (a.significance ?? 0) || a.tick - b.tick)[0] ?? null
  }, [slim])
  // the claims that happened around the turning point
  const around = useMemo(() => {
    if (!rep || !turning) return []
    return rep.sections.flatMap((s) => s.claims).filter((c) => c.refs.some((r) => r.tick !== undefined && Math.abs(r.tick - turning.tick) <= 12)).slice(0, 3)
  }, [rep, turning])
  // globe snapshots at key moments: the start, the turning point, the end
  const moments = useMemo(() => {
    if (!slim) return []
    const m = [{ tick: slim.firstTick, caption: 'the start' }]
    if (turning) m.push({ tick: turning.tick, caption: 'the turning point' })
    m.push({ tick: slim.lastTick, caption: rep?.status === 'destroyed' ? 'the end' : 'the last year' })
    return m.filter((x, i, a) => a.findIndex((y) => Math.abs(y.tick - x.tick) < 12) === i)
  }, [slim, turning, rep?.status])

  if (err) return (
    <Shell>
      <p className="mt-24 text-center text-[15px] text-ink/60">{err === '404' ? 'there is no report for this world yet.' : 'the report could not be loaded.'}</p>
      <p className="mt-2 text-center"><Link href={worldHref(runId)} className="text-[13px] underline decoration-ink/25 underline-offset-2">open the world</Link></p>
    </Shell>
  )
  if (!rep) return <Shell><div className="mt-20 space-y-4"><div className="skel h-10 w-4/5 rounded" /><div className="skel h-5 w-3/5 rounded" /><div className="skel h-28 w-full rounded" /></div></Shell>

  const headline = rep.epitaph ?? rep.summary[0]
  const standfirst = rep.epitaph ? rep.summary : rep.summary.slice(1)
  const dead = rep.status === 'destroyed'
  return (
    <Shell>
      <header className="print-keep pt-10 sm:pt-16">
        <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-ink/50">
          <OutcomeChip status={rep.status} size={14} />
          <span>{rep.agentName} · generation <span className="font-mono">{rep.generation}</span> · {statusWord(rep.status)} · <span className="font-mono">{rep.endDate.slice(0, 4)}</span></span>
        </div>
        <h1 className="mt-3 font-display text-[clamp(1.9rem,6vw,3.1rem)] font-medium leading-[1.06] tracking-tight"><Rich text={headline} /></h1>
        {standfirst.length > 0 && <p className="mt-4 text-[clamp(1.05rem,2.6vw,1.22rem)] italic leading-relaxed text-ink/75">{standfirst.map((l, i) => <Rich key={i} text={`${l} `} />)}</p>}
      </header>

      {moments.length > 0 && (
        <figure className="print-keep my-10 flex flex-wrap justify-center gap-6 sm:gap-10">
          {moments.map((m) => <Snapshot key={m.tick} runId={runId} tick={m.tick} caption={m.caption} dead={dead && m.caption === 'the end'} size={112} />)}
        </figure>
      )}

      {turning && (
        <section className="print-keep my-10 rounded-2xl border border-ink/15 bg-[#F3EDE0] px-5 py-5 sm:px-7">
          <div className="text-[11px] uppercase tracking-[0.2em] text-ink/50">the turning point · <span className="font-mono">{2026 + Math.floor((turning.tick + 10) / 12)}</span></div>
          <p className="mt-2 font-display text-[clamp(1.25rem,3.4vw,1.6rem)] leading-snug"><Rich text={turning.headline ?? turning.text} /></p>
          {around.length > 0 && <p className="mt-3 text-[15.5px] leading-relaxed text-ink/80">{around.map((c, i) => <span key={i}><Rich text={c.text} /><RefLinks refs={c.refs} runId={runId} /> </span>)}</p>}
          <Link href={worldHref(runId, turning.tick)} className="no-print mt-3 inline-block text-[12.5px] underline decoration-ink/25 underline-offset-2">see it happen</Link>
        </section>
      )}

      {rep.sections.map((s) => (
        <section key={s.id} className="mt-10">
          <h2 className="print-keep font-display text-[clamp(1.2rem,3vw,1.45rem)] font-medium">{s.title}</h2>
          {paragraphs(s.claims).map((p, i) => (
            <p key={i} className="mt-3 text-[16.5px] leading-[1.65] text-ink/85">
              {p.map((c, j) => <span key={j}><Rich text={c.text} /><RefLinks refs={c.refs} runId={runId} /> </span>)}
            </p>
          ))}
        </section>
      ))}

      <footer className="no-print mb-16 mt-14 flex flex-wrap gap-x-5 gap-y-2 border-t border-ink/10 pt-5 text-[13px]">
        <Link href={worldHref(runId)} className="underline decoration-ink/25 underline-offset-2">open this world</Link>
        <Link href="/story" className="underline decoration-ink/25 underline-offset-2">the story so far</Link>
        <button onClick={() => window.print()} className="text-ink/60 underline decoration-ink/20 underline-offset-2">print</button>
      </footer>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="page-scroll bg-bone">
      <div className="mx-auto w-full max-w-[40rem] px-5 sm:px-6">
        <nav className="no-print flex items-center justify-between pt-4 text-[13px] text-ink/60">
          <Link href="/" className="hover:text-ink">← hypothetical</Link>
          <Link href="/story" className="hover:text-ink">the story so far</Link>
        </nav>
        {children}
      </div>
    </main>
  )
}
