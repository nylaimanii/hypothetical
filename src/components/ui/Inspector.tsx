'use client'
import { useMemo, useState } from 'react'
import type { Budget, Citizen, Frame, Layer, Migration, Region, RunRecord } from '@/lib/types'
import { MOON_STAGES } from '@/lib/mock/run'
import { valence } from '@/lib/mock/mood'
import { layerMetric } from '../world/lib'
import { useCurrentFrame, useStore } from '../state/store'
import { Bar, Delta, Num, Prov, Section, Sparkline, fmt } from './bits'
import { api, Offline } from './api'
import { sendOverride } from './actions'

const LAYER_BUDGET: Partial<Record<Layer, keyof Budget>> = {
  physics: 'space', biology: 'food', government: 'security', economy: 'energy', tech: 'research', family: 'welfare',
}
const MOOD = (m: number) => (m > 0.66 ? 'hopeful' : m > 0.45 ? 'steady' : m > 0.3 ? 'uneasy' : 'angry')

function migrationsUpTo(rec: RunRecord, idx: number): (Migration & { tick: number })[] {
  return rec.frames.slice(0, idx + 1).flatMap((f) => (f.decision?.migrations ?? []).map((m) => ({ ...m, tick: f.tick })))
}

function Shell({ kicker, title, children }: { kicker: string; title: React.ReactNode; children: React.ReactNode }) {
  const select = useStore((s) => s.select)
  return (
    <div className="panel pointer-events-auto w-[22rem] shrink-0 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-ink/45">{kicker}</div>
          <div className="font-display text-2xl leading-tight">{title}</div>
        </div>
        <button onClick={() => select(null)} className="rounded-full px-2 text-lg leading-none text-ink/50 hover:bg-ink/10 hover:text-ink" aria-label="close">×</button>
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value, prov, delta }: { label: string; value: string; prov?: Region['provenance'][string]; delta?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-ink/8 py-1">
      <span className="text-[12px] text-ink/65">{label}</span>
      <span className="flex items-baseline gap-2">
        {delta}
        <Num className="text-[13px]">{value}</Num>
        <Prov p={prov} />
      </span>
    </div>
  )
}

function PipCard({ c, frame, record, idx }: { c: Citizen; frame: Frame; record: RunRecord; idx: number }) {
  const region = frame.regions.find((r) => r.id === c.regionId)
  const origin = record.frames[0].citizens.find((x) => x.id === c.id)?.regionId
  const originName = record.frames[0].regions.find((r) => r.id === origin)?.name
  const laws = frame.laws.filter((l) => !l.vetoed)
  const moves = migrationsUpTo(record, idx).filter((m) => m.from === c.regionId || m.to === c.regionId)
  const select = useStore((s) => s.select)
  const migrated = Boolean(origin && origin !== c.regionId)
  const otherMoves = moves.filter((m) => !(migrated && m.to === c.regionId)).slice(-3)
  return (
    <Shell kicker={region?.name ?? 'citizen'} title={c.name}>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
        <div><div className="text-ink/45">age</div><Num>{c.age}</Num></div>
        <div><div className="text-ink/45">sex</div>{c.sex}</div>
        <div><div className="text-ink/45">height</div><Num>{c.heightCm}cm</Num></div>
        <div><div className="text-ink/45">job</div>{c.job}</div>
        <div><div className="text-ink/45">belief</div>{c.belief}</div>
        <div><div className="text-ink/45">mood</div><span className={valence(c.mood) < 0.3 ? 'text-ember' : ''}>{MOOD(valence(c.mood))} <Num className="text-ink/50">{valence(c.mood).toFixed(2)}</Num></span></div>
      </div>
      {c.thought && <p className="mt-4 rounded-xl bg-ink/5 px-3 py-2 font-display text-[15px] italic leading-snug">&ldquo;{c.thought}&rdquo;</p>}
      {(migrated || laws.length > 0 || otherMoves.length > 0) && <Section title="what the ai did to me">
        <ul className="space-y-1 text-[12.5px]">
          {migrated && <li>moved from <b>{originName}</b> to <b>{region?.name}</b></li>}
          {laws.map((l) => (
            <li key={l.id}><button className="text-left underline decoration-ink/20 underline-offset-2 hover:decoration-ink" onClick={() => select({ kind: 'law', id: l.id })}>{l.title}</button> <span className="text-ink/45">since <Num>{record.frames.find((f) => f.tick >= l.enactedTick)?.date}</Num></span></li>
          ))}
          {otherMoves.map((m, i) => (
            <li key={i} className="text-ink/60"><Num>{fmt.people(m.people)}</Num> moved {m.from === c.regionId ? 'out of' : 'into'} my region: {m.reason}</li>
          ))}
        </ul>
      </Section>}
    </Shell>
  )
}

function RegionCard({ r, frame, record, idx }: { r: Region; frame: Frame; record: RunRecord; idx: number }) {
  const select = useStore((s) => s.select)
  const ai = record.frames[idx].regions.find((x) => x.id === r.id)!
  const twinF = [...record.baseline].reverse().find((b) => b.tick <= record.frames[idx].tick)
  const twin = twinF?.regions.find((x) => x.id === r.id)
  const d = (k: 'population' | 'foodKcalPerCapita' | 'unrest' | 'techLevel' | 'education', f: (n: number) => string, invert = false) =>
    twin ? <span title="vs no-ai twin"><Delta v={ai[k] - twin[k]} format={f} invert={invert} /></span> : null
  const moves = migrationsUpTo(record, idx)
  const inn = moves.filter((m) => m.to === r.id), out = moves.filter((m) => m.from === r.id)
  const laws = frame.laws.filter((l) => !l.vetoed)
  const p = r.provenance
  return (
    <Shell kicker="region" title={r.name}>
      <Section title="stats · delta vs no-ai twin">
        <Stat label="population" value={fmt.people(r.population)} prov={p.population} delta={d('population', fmt.people)} />
        <Stat label="aged 65+" value={fmt.pct(r.share65plus)} prov={p.share65plus} />
        <Stat label="gdp" value={fmt.usd(r.gdpUsd)} prov={p.gdpUsd} />
        <Stat label="energy twh" value={fmt.twh(r.energyTWh)} prov={p.energyTWh} />
        <Stat label="kcal / person" value={fmt.kcal(r.foodKcalPerCapita)} prov={p.foodKcalPerCapita} delta={d('foodKcalPerCapita', (n) => n.toFixed(0))} />
        <Stat label="education" value={fmt.pct(r.education)} prov={p.education} delta={d('education', fmt.pct)} />
        <Stat label="faith" value={fmt.pct(r.faith)} prov={p.faith} />
        <Stat label="unrest" value={fmt.pct(r.unrest)} prov={p.unrest} delta={d('unrest', fmt.pct, true)} />
        <Stat label="tech level" value={fmt.pct(r.techLevel)} prov={p.techLevel} delta={d('techLevel', fmt.pct)} />
        <Stat label="compliance" value={fmt.pct(r.compliance)} prov={p.compliance} />
      </Section>
      {laws.length > 0 && (
        <Section title="active laws · support / compliance">
          <div className="space-y-2">
            {laws.map((l) => (
              <button key={l.id} className="block w-full rounded-lg p-1.5 text-left hover:bg-ink/5" onClick={() => select({ kind: 'law', id: l.id })}>
                <div className="text-[13px]">{l.title}</div>
                <Bar value={l.support} label="support" />
                <Bar value={Math.min(l.compliance, r.compliance + 0.15)} label="compliance" danger={r.compliance < 0.35} />
              </button>
            ))}
          </div>
        </Section>
      )}
      {(inn.length > 0 || out.length > 0) && (
        <Section title="migrations">
          <ul className="space-y-1 text-[12px]">
            {inn.map((m, i) => <li key={`i${i}`}>in <Num>{fmt.people(m.people)}</Num> from {m.from} · {m.reason}</li>)}
            {out.map((m, i) => <li key={`o${i}`}>out <Num>{fmt.people(m.people)}</Num> to {m.to} · {m.reason}</li>)}
          </ul>
        </Section>
      )}
    </Shell>
  )
}

function LayerCard({ layer, regionId, frame, record, idx }: { layer: Layer; regionId: string; frame: Frame; record: RunRecord; idx: number }) {
  const r = frame.regions.find((x) => x.id === regionId)
  const select = useStore((s) => s.select)
  const laws = frame.laws.filter((l) => l.layer === layer)
  const key = LAYER_BUDGET[layer]
  const series = record.frames.slice(0, idx + 1).map((f) => {
    const rr = f.regions.find((x) => x.id === regionId)
    return rr ? layerMetric(layer as Parameters<typeof layerMetric>[0], rr, f.regions) : 0
  })
  return (
    <Shell kicker={`${layer} layer · ${r?.name ?? ''}`} title={layer}>
      {key && (
        <Section title="budget share">
          <Bar value={frame.budget[key]} label={key} />
        </Section>
      )}
      {series.length > 1 && (
        <Section title="effect over time">
          <Sparkline values={series} w={300} />
        </Section>
      )}
      {laws.length > 0 && (
        <Section title="laws in this layer">
          <ul className="space-y-1">
            {laws.map((l) => (
              <li key={l.id}><button onClick={() => select({ kind: 'law', id: l.id })} className={`text-left text-[13px] underline decoration-ink/20 underline-offset-2 hover:decoration-ink ${l.vetoed ? 'line-through opacity-50' : ''}`}>{l.title}</button></li>
            ))}
          </ul>
        </Section>
      )}
    </Shell>
  )
}

function LawCard({ id, frame, record }: { id: string; frame: Frame; record: RunRecord }) {
  const law = frame.laws.find((l) => l.id === id) ?? record.frames.flatMap((f) => f.laws).find((l) => l.id === id)
  const liveRunId = useStore((s) => s.liveRunId)
  const overrides = useStore((s) => s.overrides)
  const [busy, setBusy] = useState(false)
  if (!law) return null
  const resisting = frame.regions.filter((r) => r.compliance < 0.45 || r.unrest > 0.6)
  const sent = overrides.find((o) => o.kind === 'veto_law' && o.lawId === law.id)
  return (
    <Shell kicker={`law · ${law.layer}`} title={law.title}>
      <p className="mt-3 text-[14px] leading-relaxed">{law.text}</p>
      <div className="mt-3 space-y-1">
        <Bar value={law.support} label="support" />
        <Bar value={law.compliance} label="compliance" />
      </div>
      <div className="mt-2 text-[11px] text-ink/50">enacted <Num>{record.frames.find((f) => f.tick >= law.enactedTick)?.date}</Num></div>
      {resisting.length > 0 && (
        <Section title="resisting regions">
          <div className="flex flex-wrap gap-1.5">
            {resisting.map((r) => <span key={r.id} className="rounded-full border border-ember/50 px-2 py-0.5 text-[11px] text-ember">{r.name}</span>)}
          </div>
        </Section>
      )}
      {law.vetoed && <div className="mt-4 rounded-lg border border-ink/20 px-3 py-2 text-[12px]">vetoed by you</div>}
      {liveRunId && !law.vetoed && !sent && (
        <button disabled={busy} onClick={async () => { setBusy(true); try { await sendOverride({ kind: 'veto_law', lawId: law.id }) } finally { setBusy(false) } }}
          className="mt-4 w-full rounded-full bg-ink py-2 font-mono text-[12px] uppercase tracking-[0.2em] text-bone hover:bg-ink/85 disabled:opacity-50">veto</button>
      )}
      {sent && !law.vetoed && <div className="mt-4 text-[12px] text-ink/60">veto sent{sent.responded ? ', the core responded' : ', waiting for the core'}</div>}
    </Shell>
  )
}

function CoreCard({ record, idx, frame }: { record: RunRecord; idx: number; frame: Frame }) {
  const setPlayhead = useStore((s) => s.setPlayhead)
  const overrides = useStore((s) => s.overrides)
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const decisions = record.frames.slice(0, idx + 1).filter((f) => f.decision).map((f) => ({ f, d: f.decision! }))
  const latest = decisions.at(-1)
  const ask = async () => {
    if (!q.trim()) return
    setBusy(true); setAnswer(null)
    try {
      const r = await api.ask(record.runId, q.trim())
      setAnswer(r.answer)
    } catch (e) {
      setAnswer(e instanceof Offline ? 'runner offline' : 'the core did not answer')
    } finally { setBusy(false) }
  }
  return (
    <Shell kicker="the core · ai governor" title={frame.status === 'destroyed' ? 'the core is dark' : 'the core'}>
      <Section title="constitution">
        <p className="font-display text-[15px] italic leading-snug">{record.constitution}</p>
      </Section>
      {latest && (
        <Section title={`latest rationale · ${latest.f.date}`}>
          <p className="text-[13.5px] leading-relaxed">{latest.d.rationale}</p>
          {latest.d.respondedToOverrides.length > 0 && <div className="mt-1 text-[11px] text-ink/60">responding to <Num>{latest.d.respondedToOverrides.length}</Num> of your overrides</div>}
        </Section>
      )}
      {decisions.length > 0 && (
        <Section title="decisions">
          <ul className="space-y-1">
            {[...decisions].reverse().map(({ f, d }) => {
              const touched = d.respondedToOverrides.some((id) => overrides.some((o) => o.id === id))
              return (
                <li key={f.tick}>
                  <button onClick={() => setPlayhead(f.tick)} className="w-full rounded-lg px-2 py-1 text-left hover:bg-ink/5">
                    <Num className="text-[11px] text-ink/50">{f.date}</Num>
                    {touched && <span className="ml-2 rounded-full bg-ink px-1.5 font-mono text-[9px] text-bone">you</span>}
                    <div className="line-clamp-2 text-[12.5px]">{d.rationale}</div>
                  </button>
                </li>
              )
            })}
          </ul>
        </Section>
      )}
      <Section title="ask the core">
        <form onSubmit={(e) => { e.preventDefault(); ask() }} className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="why move people to the corridor?" className="min-w-0 flex-1 rounded-full border border-ink/20 bg-bone px-3 py-1.5 text-[13px] outline-none focus:border-ink/60" />
          <button disabled={busy} className="rounded-full bg-ink px-3 font-mono text-[11px] uppercase text-bone disabled:opacity-50">{busy ? '...' : 'ask'}</button>
        </form>
        {answer && <p className={`mt-2 text-[13px] leading-relaxed ${answer === 'runner offline' ? 'text-ink/45' : ''}`}>{answer}</p>}
      </Section>
    </Shell>
  )
}

function MoonCard({ record, idx, frame }: { record: RunRecord; idx: number; frame: Frame }) {
  const stageIdx = MOON_STAGES.indexOf(frame.moonStage)
  const space = record.frames.slice(0, idx + 1).map((f) => f.budget.space)
  const launches = record.frames.slice(0, idx + 1).flatMap((f) => f.newEvents.filter((e) => e.kind === 'launch').map((e) => ({ ...e, date: f.date })))
  return (
    <Shell kicker="moon program" title={frame.moonStage === 'crewed_landing' ? 'boots on the moon' : 'the moon'}>
      <Section title="progress">
        <Bar value={frame.moonProgress} />
        <ol className="mt-3 space-y-1">
          {MOON_STAGES.slice(1).map((s, i) => (
            <li key={s} className={`flex items-center gap-2 text-[12.5px] ${i + 1 <= stageIdx ? '' : 'text-ink/40'}`}>
              <span className={`inline-block h-2.5 w-2.5 rounded-full border border-ink/50 ${i + 1 <= stageIdx ? 'bg-ink' : ''}`} />
              {s.replace('_', ' ')}
            </li>
          ))}
        </ol>
      </Section>
      {space.length > 1 && (
        <Section title="space budget over time">
          <Sparkline values={space} w={300} />
          <div className="mt-1 text-[11px] text-ink/50">now <Num>{fmt.pct(frame.budget.space)}</Num></div>
        </Section>
      )}
      {launches.length > 0 && (
        <Section title="launch history">
          <ul className="space-y-1 text-[12.5px]">
            {launches.map((l, i) => (
              <li key={i} className={/fail/i.test(l.text) ? 'text-ember' : ''}><Num className="mr-2 text-[11px] text-ink/50">{l.date}</Num>{l.text}</li>
            ))}
          </ul>
        </Section>
      )}
    </Shell>
  )
}

export default function Inspector() {
  const selection = useStore((s) => s.selection)
  const { frame, record, idx } = useCurrentFrame()
  const body = useMemo(() => {
    if (!selection) return null
    switch (selection.kind) {
      case 'pip': {
        const c = frame.citizens.find((x) => x.id === selection.id)
        return c ? <PipCard c={c} frame={frame} record={record} idx={idx} /> : null
      }
      case 'region': {
        const r = frame.regions.find((x) => x.id === selection.id)
        return r ? <RegionCard r={r} frame={frame} record={record} idx={idx} /> : null
      }
      case 'layer': return <LayerCard layer={selection.layer} regionId={selection.regionId} frame={frame} record={record} idx={idx} />
      case 'law': return <LawCard id={selection.id} frame={frame} record={record} />
      case 'core': return <CoreCard record={record} idx={idx} frame={frame} />
      case 'moon': return <MoonCard record={record} idx={idx} frame={frame} />
    }
  }, [selection, frame, record, idx])
  return body
}
