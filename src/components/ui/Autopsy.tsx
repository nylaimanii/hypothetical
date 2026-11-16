'use client'
// how a world died, as a vertical timeline: the autopsy from GET /api/evidence/[runId] (b's chain in the record for
// sim 5.10.2+, c's walk of the cause links for older records). each step is a link into the world at that moment.
// nothing here is written on the page: every line is a field of the autopsy
import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { Num, fmt } from './bits'
import { dateOfTick } from './truth'

type Step = { tick: number; date: string; place: string; what: string; because: string; byWhom: string; again: string[] }
export type AutopsyData = {
  runId: string; died: string; kind: string; cause: string | null
  chain: Step[]
  decision: { tick: number; date: string; what: string; said: string | null } | null
  lost: { kind: string; regions: string[]; since: string }[]
  cost: { deaths: number; famineDeaths: number; unrestDeaths: number; displaced: number } | null
}

export function useAutopsy(runId: string, dead: boolean) {
  const [got, setGot] = useState<{ runId: string; a: AutopsyData | null } | null>(null)
  useEffect(() => {
    if (!dead) return
    let live = true
    fetch(`/api/evidence/${encodeURIComponent(runId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((e: { autopsy?: AutopsyData | null } | null) => { if (live) setGot({ runId, a: e?.autopsy ?? null }) })
      .catch(() => { if (live) setGot({ runId, a: null }) })
    return () => { live = false }
  }, [runId, dead])
  return got?.runId === runId ? got.a : null
}

// jump into the world at that moment, on the globe
const jump = (tick: number) => {
  const s = useStore.getState()
  s.setPlaying(false)
  s.setPlayhead(tick)
  s.setView('globe')
}

function Dot({ danger }: { danger?: boolean }) {
  return <span className={`absolute -left-[0.36rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-bone ${danger ? 'bg-ember' : 'bg-ink'}`} />
}

export function AutopsyTimeline({ a }: { a: AutopsyData }) {
  // the core's call is the first core link of the chain; it is shown once, in its place, with its reasoning
  const d = a.decision
  const chain = a.chain.filter((s) => !(d && s.byWhom === 'core' && s.tick === d.tick))
  const before = d ? chain.filter((s) => s.tick < d.tick) : [], after = d ? chain.filter((s) => s.tick >= d.tick) : chain
  const step = (s: Step, i: number) => (
    <li key={`${s.tick}-${i}`} className="relative pb-3 pl-4">
      <Dot />
      <button onClick={() => jump(s.tick)} className="text-left">
        <span className="text-[11px] text-ink/50"><Num className="underline decoration-ink/20 underline-offset-2">{dateOfTick(s.tick)}</Num> · {s.place}</span>
        <div className="text-[12.5px]">{s.what}</div>
      </button>
      <p className="text-[11.5px] text-ink/60">because {s.because}{s.byWhom ? <> · by {s.byWhom}</> : null}</p>
      {s.again.length > 0 && <p className="text-[11px] text-ink/50">again in <Num>{s.again.join(', ')}</Num></p>}
    </li>
  )
  return (
    <div id="autopsy">
      <h3 className="font-display text-[17px] text-ember">how it died</h3>
      {a.cause && <p className="mb-2 text-[12px] text-ink/65">{a.cause}</p>}
      <ol className="relative ml-1.5 border-l border-ink/20">
        {before.map(step)}
        {a.decision && (
          <li className="relative pb-3 pl-4">
            <Dot />
            <button onClick={() => jump(a.decision!.tick)} className="text-left">
              <Num className="text-[11px] text-ink/50 underline decoration-ink/20 underline-offset-2">{dateOfTick(a.decision.tick)}</Num>
              <div className="text-[12.5px]">the core&apos;s call: {a.decision.what}</div>
            </button>
            {a.decision.said && <p className="text-[11.5px] text-ink/60">its reasoning that year: <span className="italic">&ldquo;{a.decision.said}&rdquo;</span></p>}
          </li>
        )}
        {after.map(step)}
        <li className="relative pl-4">
          <Dot danger />
          <Num className="text-[11px] text-ink/50">{a.died}</Num>
          <div className="text-[12.5px] text-ember">the world {a.kind === 'collapse' ? 'collapsed' : `ended: ${a.kind}`}</div>
          {a.cost && (
            <p className="text-[11.5px] text-ink/60">
              <Num className="text-ember">{fmt.people(a.cost.deaths)}</Num> deaths (<Num>{fmt.people(a.cost.famineDeaths)}</Num> famine, <Num>{fmt.people(a.cost.unrestDeaths)}</Num> unrest), <Num>{fmt.people(a.cost.displaced)}</Num> displaced
            </p>
          )}
          {a.lost.map((l) => <p key={l.kind} className="text-[11px] text-ink/55">lost {l.regions.join(', ')} to {l.kind} by <Num>{l.since}</Num></p>)}
        </li>
      </ol>
    </div>
  )
}
