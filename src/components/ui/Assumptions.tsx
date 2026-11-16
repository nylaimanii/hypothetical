'use client'
// /assumptions: every rule the sim runs on (b's data/assumptions.json via GET /api/assumptions), with its value,
// its range and its source. ?run=<id> also shows what that world ran with. where the server can run worlds
// (capabilities.rerun, local only), the values can be changed and the world rerun on the same seed and agent.
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { RunSummary } from '@/lib/types'
import { Num } from './bits'

type Rule = { id: string; label: string; value: number; unit: string; source: string; min: number; max: number; file: string }
type Clamp = { id: string; asked: number; used: number; min: number; max: number; text: string }
type Used = { overridden: Record<string, number>; clamped: Clamp[]; changes: string[] }
// waiting: the model is busy with another world (one at a time); null means the first frame comes in seconds
// sim.text: set when the source world ran on another sim version (c words it; shown as is)
type Rerun = { runId: string; from: string; clamped: Clamp[]; changes: string[]; waiting?: { behind: string; minutes: number; text: string } | null; sim?: { text: string | null } }

const groupOf = (file: string) => file.replace(/\.ts$/, '').replace(/[-_]/g, ' ')
const isUrl = (s: string) => /^https?:\/\//.test(s)
const host = (s: string) => { try { return new URL(s).host.replace(/^www\./, '') } catch { return s } }
const show = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(Number(v.toPrecision(4))))

export default function Assumptions() {
  const q = useSearchParams()
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [err, setErr] = useState(false)
  const [canRerun, setCanRerun] = useState(false)
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [run, setRun] = useState(q.get('run') ?? '')
  const [usedFor, setUsedFor] = useState<{ run: string; used: Used | null } | null>(null)
  const used = usedFor?.run === run ? usedFor.used : null
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Rerun | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/assumptions', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject())).then((x) => setRules(Array.isArray(x) ? x : [])).catch(() => setErr(true))
    fetch('/api/capabilities', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((c) => setCanRerun(!!c?.rerun)).catch(() => {})
    fetch('/api/runs', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then((x) => { if (Array.isArray(x)) { setRuns(x); setRun((cur) => cur || x[0]?.runId || '') } }).catch(() => {})
  }, [])
  useEffect(() => {
    if (!run) return
    fetch(`/api/assumptions?runId=${encodeURIComponent(run)}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((x) => setUsedFor({ run, used: x })).catch(() => {})
  }, [run])

  const groups = useMemo(() => {
    const m = new Map<string, Rule[]>()
    for (const r of rules ?? []) { const g = groupOf(r.file); m.set(g, [...(m.get(g) ?? []), r]) }
    return [...m.entries()]
  }, [rules])
  const guesses = (rules ?? []).filter((r) => !isUrl(r.source)).length
  const changed = Object.entries(edits).filter(([id, v]) => v.trim() !== '' && Number(v) !== rules?.find((r) => r.id === id)?.value)

  const rerun = async () => {
    setBusy(true); setProblem(null); setResult(null)
    try {
      const assumptions = Object.fromEntries(changed.map(([id, v]) => [id, Number(v)]))
      const res = await fetch('/api/rerun', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: run, assumptions }) })
      const body = await res.json().catch(() => null)
      if (!res.ok) setProblem(body?.error ?? (res.status === 503 ? 'this server cannot run worlds' : 'the rerun did not start'))
      else {
        setResult(body as Rerun)
        // the main site's waiting screen says the same while the rerun queues for the model
        try { if (body?.waiting?.text) sessionStorage.setItem(`hyp:waiting:${body.runId}`, body.waiting.text) } catch { /* storage off */ }
      }
    } catch { setProblem('the world runner is offline') } finally { setBusy(false) }
  }

  return (
    <main className="page-scroll bg-bone">
      <div className="mx-auto w-full max-w-[44rem] px-5 pb-24 sm:px-6">
        <nav className="flex items-center justify-between pt-4 text-[13px] text-ink/60">
          <Link href="/" className="hover:text-ink">← hypothetical</Link>
          <Link href="/story" className="hover:text-ink">the story so far</Link>
        </nav>
        <header className="pt-10 sm:pt-14">
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink/50">assumptions</div>
          <h1 className="mt-2 font-display text-[30px] leading-tight sm:text-[36px]">what the simulation takes as given</h1>
          {rules && (
            <p className="mt-3 text-[14.5px] leading-relaxed text-ink/70">
              <Num>{rules.length}</Num> rules decide how people are born, age, work, move and die in every world. <Num>{rules.length - guesses}</Num> come from a published source;{' '}
              <Num>{guesses}</Num> are our own estimates, marked as such.
            </p>
          )}
        </header>

        {runs.length > 0 && (
          <section className="mt-8 rounded-xl border border-ink/15 px-4 py-3">
            <label className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-ink/60">world</span>
              <select value={run} onChange={(e) => { setRun(e.target.value); setResult(null); setProblem(null) }} className="min-w-0 max-w-full rounded-full border border-ink/20 bg-transparent px-3 py-1 font-mono text-[12px]">
                {runs.map((r) => <option key={r.runId} value={r.runId}>{r.runId}</option>)}
              </select>
            </label>
            {used && (Object.keys(used.overridden).length === 0
              ? <p className="mt-2 text-[13px] text-ink/60">this world ran with every rule at the values below.</p>
              : <ul className="mt-2 space-y-1 text-[13px]">{used.changes.map((c, i) => <li key={i}>{c}</li>)}{used.clamped.map((c) => <li key={c.id} className="text-ink/60">{c.text}</li>)}</ul>)}
          </section>
        )}

        {err && <p className="mt-16 text-center text-[15px] text-ink/60">the assumptions could not be loaded.</p>}
        {!rules && !err && <div className="mt-10 space-y-3"><div className="skel h-6 w-2/3 rounded" /><div className="skel h-24 w-full rounded" /><div className="skel h-24 w-full rounded" /></div>}

        {groups.map(([g, rs]) => (
          <section key={g} className="mt-10">
            <h2 className="border-b border-ink/15 pb-1.5 font-display text-[19px]">{g}</h2>
            <ul className="divide-y divide-ink/10">
              {rs.map((r) => {
                const ran = used?.overridden[r.id]
                const v = edits[r.id] ?? ''
                const out = v.trim() !== '' && (Number.isNaN(Number(v)) || Number(v) < r.min || Number(v) > r.max)
                return (
                  <li key={r.id} className="py-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-[14px] leading-snug">{r.label}</span>
                      <span className="shrink-0 text-right"><Num className="text-[15px]">{show(r.value)}</Num> <span className="text-[11.5px] text-ink/55">{r.unit}</span></span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[11.5px] text-ink/55">
                      <span>{isUrl(r.source) ? <>source: <a href={r.source} target="_blank" rel="noreferrer" className="underline decoration-ink/25 underline-offset-2 hover:text-ink">{host(r.source)}</a></> : r.source}</span>
                      <span>range <Num>{show(r.min)}</Num> to <Num>{show(r.max)}</Num></span>
                    </div>
                    {ran !== undefined && <div className="mt-1 text-[12px]">this world ran with <Num>{show(ran)}</Num></div>}
                    {canRerun && run && (
                      <label className="mt-2 flex items-center gap-2 text-[12px] text-ink/60">
                        <span>rerun with</span>
                        <input inputMode="decimal" value={v} placeholder={show(r.value)} onChange={(e) => setEdits({ ...edits, [r.id]: e.target.value })}
                          className={`w-24 rounded-full border bg-transparent px-2.5 py-0.5 font-mono text-[12px] text-ink ${out ? 'border-ink' : 'border-ink/20'}`} />
                        {out && <span>{Number.isNaN(Number(v)) ? 'not a number' : `outside ${show(r.min)} to ${show(r.max)}, the rerun will use the nearest limit`}</span>}
                      </label>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        {canRerun && run && rules && (
          <section className="sticky bottom-0 mt-10 border-t border-ink/15 bg-bone py-3">
            {problem && <p className="mb-2 text-[13px]">{problem}</p>}
            {result ? (
              <div className="space-y-1 text-[13px]">
                <p>rerunning <span className="font-mono text-[12px]">{result.from}</span> from 2026 on the same seed and agent{result.changes.length ? ':' : '.'}</p>
                {result.changes.map((c, i) => <p key={i} className="text-ink/70">{c}</p>)}
                {result.clamped.map((c) => <p key={c.id} className="text-ink/70">{c.text}</p>)}
                {result.sim?.text && <p className="text-ink/70">{result.sim.text}</p>}
                {result.waiting && <p className="text-ink/70">{result.waiting.text}</p>}
                <p className="pt-1"><Link href={`/?live=${encodeURIComponent(result.runId)}`} className="underline decoration-ink/30 underline-offset-2">watch the rerun</Link> · <Link href={`/?ab=${encodeURIComponent(result.runId)}`} className="underline decoration-ink/30 underline-offset-2">compare it with the original</Link> <span className="text-ink/50">(kept off the leaderboard)</span></p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] text-ink/60">{changed.length ? <><Num>{changed.length}</Num> rule{changed.length === 1 ? '' : 's'} changed</> : 'change any value above to rerun this world with it'}</span>
                <button disabled={busy || !changed.length} onClick={rerun} className="rounded-full bg-ink px-4 py-1.5 font-mono text-[12px] uppercase tracking-[0.14em] text-bone disabled:opacity-40">{busy ? 'starting' : 'rerun this world'}</button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
