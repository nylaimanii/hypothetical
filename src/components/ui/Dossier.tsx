'use client'
import { ReasoningLines, layerSentence, useLinks, whyDoing } from './chains'
import { todayOf } from '../world/city/day'
import { localHour, utcHourOf, worldDate } from '../world/time'
import { useState } from 'react'
import type { Budget, Citizen, Emotion, Frame, Law, Layer, Migration, Precedent, Region, RunRecord, Why } from '@/lib/types'
import { EMOTIONS, valence } from '@/lib/mock/mood'
import { MOON_STAGES, mockRuns } from '@/lib/mock/run'
import Emblem from './Emblem'
import { openRun } from './worlds'
import { layerMetric } from '../world/lib'
import { useCurrentFrame, useStore, type Selection } from '../state/store'
import { Bar, Num, Prov, Section, Sparkline, fmt } from './bits'
import { api, Offline } from './api'
import { sendOverride } from './actions'

// ---------- shared bits ----------

const LAYER_BUDGET: Partial<Record<Layer, keyof Budget>> = { physics: 'space', biology: 'food', government: 'security', economy: 'energy', tech: 'research', family: 'welfare' }
const words = (s: string) => s.replace(/_/g, ' ')
const dateAt = (rec: RunRecord, tick: number) => (rec.frames.find((f) => f.tick >= tick) ?? rec.frames.at(-1)!).date

function Link({ to, children, className = '' }: { to: Selection; children: React.ReactNode; className?: string }) {
  const select = useStore((s) => s.select)
  return <button onClick={() => select(to)} className={`text-left underline decoration-ink/25 underline-offset-2 hover:decoration-ink ${className}`}>{children}</button>
}

function Chip({ children, tone = 'ink' }: { children: React.ReactNode; tone?: 'ink' | 'ember' | 'soft' }) {
  const c = tone === 'ember' ? 'border-ember/50 text-ember' : tone === 'soft' ? 'border-ink/15 text-ink/60' : 'border-ink/30 text-ink/80'
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${c}`}>{children}</span>
}

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: T[]; value: T; onChange: (t: T) => void }) {
  if (tabs.length < 2) return null
  return (
    <div className="sticky top-0 z-10 -mx-5 mt-3 flex gap-1 overflow-x-auto border-b border-ink/10 bg-bone/95 px-5 pb-2">
      {tabs.map((t) => (
        <button key={t} onClick={() => onChange(t)} className={`whitespace-nowrap rounded-full px-3 py-1 text-[12px] ${value === t ? 'bg-ink text-bone' : 'text-ink/60 hover:bg-ink/5'}`}>{t}</button>
      ))}
    </div>
  )
}

function Drawer({ kicker, title, children }: { kicker: string; title: React.ReactNode; children: React.ReactNode }) {
  const select = useStore((s) => s.select)
  return (
    <div className="panel dossier-in scroll-thin pointer-events-auto max-h-full w-[24rem] shrink-0 overflow-y-auto px-5 pb-5 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[11px] uppercase tracking-[0.16em] text-ink/45">{kicker}</div>
          <div className="font-display text-2xl leading-tight">{title}</div>
        </div>
        <button onClick={() => select(null)} className="rounded-full px-2 text-lg leading-none text-ink/50 hover:bg-ink/10 hover:text-ink" aria-label="close">×</button>
      </div>
      {children}
    </div>
  )
}

function useTab<T extends string>(first: T) { return useState<T>(first) }

// a number with its "why?" chain from the sim
function StatRow({ label, value, prov, why, raw }: { label: string; value: string; prov?: Region['provenance'][string]; why?: Why; raw?: number }) {
  const [open, setOpen] = useState(false)
  // a stat the sim has not reported yet is hidden, not shown as zero
  if (raw !== undefined && raw === 0) return null
  return (
    <div className="border-b border-ink/8 py-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-ink/65">{label}</span>
        <span className="flex items-baseline gap-2">
          <Num className="text-[13px]">{value}</Num>
          <Prov p={prov} />
          {why && why.drivers.length > 0 && <button onClick={() => setOpen(!open)} className={`rounded-full border px-1.5 text-[10px] ${open ? 'border-ink bg-ink text-bone' : 'border-ink/25 text-ink/60 hover:border-ink'}`}>why?</button>}
        </span>
      </div>
      {open && why && (
        <ul className="mt-1 space-y-0.5 rounded-lg bg-ink/5 px-2 py-1.5">
          {why.drivers.map((d, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 text-[11.5px]">
              <span className="min-w-0">{d.source ? <a href={d.source} target="_blank" rel="noreferrer" className="underline decoration-ink/25 underline-offset-2">{d.label}</a> : d.label}</span>
              <Num className="shrink-0 text-ink/70">{d.delta > 0 ? '+' : ''}{Math.abs(d.delta) >= 100 ? fmt.people(d.delta) : d.delta.toFixed(Math.abs(d.delta) < 1 ? 3 : 1)}</Num>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EmotionBars({ mood }: { mood: Record<Emotion, number> }) {
  const sorted = [...EMOTIONS].sort((a, b) => mood[b] - mood[a])
  return <div className="space-y-1">{sorted.map((e) => <Bar key={e} value={mood[e]} label={e} danger={e === 'anger' && mood[e] > 0.7} />)}</div>
}

function migrationsUpTo(rec: RunRecord, idx: number): (Migration & { tick: number })[] {
  return rec.frames.slice(0, idx + 1).flatMap((f) => (f.decision?.migrations ?? []).map((m) => ({ ...m, tick: f.tick })))
}
const precedentsFor = (rec: RunRecord, law: Law): Precedent[] => law.precedentIds.map((id) => rec.precedents?.find((p) => p.id === id)).filter(Boolean) as Precedent[]

// does a law's loved/hated group describe this citizen
function lawHits(law: Law, c: Citizen): { how: 'helped' | 'hurt'; group: string } | null {
  const match = (g: string) =>
    (g.includes('low income') && c.group.incomeBand === 'low') || (g.includes('elder') && c.age > 66) || (g.includes('young') && c.group.ageBand === 'young') ||
    (g.includes('corridor') && c.regionId === 'sam') || g.includes(c.archetype.replace(/_/g, ' ')) || (g.includes('parents') && c.family.kids > 0) ||
    (g.includes('religious') && c.belief === 'religious') || (g.includes('secular') && c.belief === 'secular') || g.includes(c.job)
  const loved = law.lovedBy.find(match)
  if (loved) return { how: 'helped', group: loved }
  const hated = law.hatedBy.find(match)
  if (hated) return { how: 'hurt', group: hated }
  return null
}

// ---------- pip ----------

function PipDossier({ c, frame, record }: { c: Citizen; frame: Frame; record: RunRecord }) {
  const [tab, setTab] = useTab<'who' | 'feelings' | 'life' | 'laws'>('who')
  const region = frame.regions.find((r) => r.id === c.regionId)
  const partner = c.family.partnerId ? frame.citizens.find((x) => x.id === c.family.partnerId) : undefined
  const op = c.opinionOfCore
  const hits = frame.laws.filter((l) => !l.vetoed).map((l) => ({ l, hit: lawHits(l, c) })).filter((x) => x.hit)
  const idx = record.frames.indexOf(frame)
  const links = useLinks(record, idx < 0 ? record.frames.length - 1 : idx)
  const why = whyDoing(c, frame, links)
  // today: their day plan by the local hour where they live
  const hour = useStore((s) => s.hour)
  const playing = useStore((s) => s.playing)
  const playhead = useStore((s) => s.playhead)
  const home = frame.cities.find((x) => x.id === c.cityId) ?? frame.regions.find((r) => r.id === c.regionId)
  const today = c.dayPlan && home ? todayOf(c, localHour(utcHourOf(worldDate(playhead, hour, playing)), home.lon)) : null
  return (
    <Drawer kicker={`${region?.name ?? 'citizen'} · ${words(c.archetype)}`} title={c.name}>
      {why && <p className="mb-1 text-[12.5px] leading-snug text-ink/80">{why}</p>}
      {today && <p className="mb-2 text-[12px] leading-snug text-ink/65"><span className="text-ink/45">today</span> {today.place}, until {today.until}. {today.why}</p>}
      <Tabs tabs={['who', 'feelings', 'life', 'laws']} value={tab} onChange={setTab} />
      {tab === 'who' && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
            <div><div className="text-ink/45">age</div><Num>{c.age}</Num></div>
            <div><div className="text-ink/45">sex</div>{c.sex}</div>
            <div><div className="text-ink/45">job</div>{c.job}</div>
            <div><div className="text-ink/45">belief</div>{c.belief}</div>
            <div><div className="text-ink/45">doing</div><span className={c.behavior === 'rioting' ? 'text-ember' : ''}>{words(c.behavior)}</span></div>
            <div><div className="text-ink/45">feeling</div><Num>{valence(c.mood).toFixed(2)}</Num></div>
          </div>
          {c.thought && <p className="mt-4 rounded-xl bg-ink/5 px-3 py-2 font-display text-[15px] italic leading-snug">&ldquo;{c.thought}&rdquo;</p>}
          <Section title="group">
            <div className="flex flex-wrap gap-1.5"><Chip>{c.group.ageBand}</Chip><Chip>{c.group.jobSector}</Chip><Chip>{c.group.belief}</Chip><Chip>{c.group.incomeBand} income</Chip>{region && <Link to={{ kind: 'region', id: region.id }}><Chip>{region.name}</Chip></Link>}</div>
          </Section>
          <Section title="opinion of the core">
            <div className="relative h-2 rounded-full bg-ink/10"><div className="absolute top-0 h-2 w-0.5 bg-ink/40" style={{ left: '50%' }} /><div className={`absolute top-0 h-2 rounded-full ${op < 0 ? 'bg-ink/50' : 'bg-ink/80'}`} style={{ left: `${Math.min(50, 50 + op * 50)}%`, width: `${Math.abs(op) * 50}%` }} /></div>
            <div className="mt-1 flex justify-between text-[10px] text-ink/45"><span>hates it</span><Num>{op.toFixed(2)}</Num><span>loves it</span></div>
          </Section>
          {(partner || c.family.kids > 0) && (
            <Section title="family">
              <div className="text-[12.5px]">
                {partner && <>partner <Link to={{ kind: 'pip', id: partner.id }}>{partner.name}</Link></>}
                {partner && c.family.kids > 0 && ' · '}
                {c.family.kids > 0 && <><Num>{c.family.kids}</Num> kid{c.family.kids === 1 ? '' : 's'}</>}
              </div>
            </Section>
          )}
        </>
      )}
      {tab === 'feelings' && <Section title="every emotion"><EmotionBars mood={c.mood} /></Section>}
      {tab === 'life' && (
        <Section title="life">
          <ol className="space-y-1.5 border-l border-ink/15 pl-3">
            {[...c.lifeEvents].reverse().map((e, i) => (
              <li key={i} className="text-[12.5px] leading-snug"><Num className="mr-2 text-[10.5px] text-ink/45">{dateAt(record, e.tick)}</Num>{e.text}</li>
            ))}
          </ol>
        </Section>
      )}
      {tab === 'laws' && (
        <Section title="laws that hit them">
          {hits.length ? (
            <ul className="space-y-2">
              {hits.map(({ l, hit }) => (
                <li key={l.id} className="text-[12.5px]"><Link to={{ kind: 'law', id: l.id }}>{l.title}</Link> <span className={hit!.how === 'hurt' ? 'text-ink/60' : ''}>{hit!.how} them as {hit!.group}</span></li>
              ))}
            </ul>
          ) : <p className="text-[12px] text-ink/50">no active law targets people like them directly</p>}
        </Section>
      )}
    </Drawer>
  )
}

// ---------- region ----------

function RegionDossier({ r, frame, record, idx }: { r: Region; frame: Frame; record: RunRecord; idx: number }) {
  const [tab, setTab] = useTab<'stats' | 'people' | 'power' | 'places'>('stats')
  const showTwin = useStore((s) => s.showTwin)
  const w = (k: string) => r.whys?.find((x) => x.stat === k)
  const p = r.provenance
  const twin = showTwin ? [...record.baseline].reverse().find((b) => b.tick <= record.frames[idx].tick)?.regions.find((x) => x.id === r.id) : undefined
  const people = frame.citizens.filter((c) => c.regionId === r.id)
  const bands = ['kid', 'young', 'adult', 'elder'] as const
  const factions = frame.factions.filter((f) => f.regionIds.includes(r.id))
  const laws = frame.laws.filter((l) => !l.vetoed)
  const moves = migrationsUpTo(record, idx)
  return (
    <Drawer kicker="region" title={r.name}>
      <Tabs tabs={['stats', 'people', 'power', 'places']} value={tab} onChange={setTab} />
      {tab === 'stats' && (
        <Section title="every number, with its why">
          <StatRow label="population" value={fmt.people(r.population)} prov={p.population} why={w('population')} />
          <StatRow label="period life expectancy" value={`${r.periodLifeExpectancy.toFixed(1)}y`} prov={p.periodLifeExpectancy} why={w('periodLifeExpectancy')}  raw={r.periodLifeExpectancy} />
          <StatRow label="cohort life expectancy" value={`${r.lifeExpectancy.toFixed(1)}y`} prov={p.lifeExpectancy}  raw={r.lifeExpectancy} />
          <StatRow label="approval of the core" value={fmt.pct(r.approval)} why={w('approval')}  raw={r.approval} />
          <StatRow label="unrest" value={fmt.pct(r.unrest)} prov={p.unrest} why={w('unrest')} />
          <StatRow label="kcal / person" value={fmt.kcal(r.foodKcalPerCapita)} prov={p.foodKcalPerCapita} why={w('foodKcalPerCapita')} />
          <StatRow label="fertility" value={r.fertility.toFixed(2)} prov={p.fertility}  raw={r.fertility} />
          <StatRow label="disease burden" value={fmt.pct(r.diseaseBurden)} prov={p.diseaseBurden}  raw={r.diseaseBurden} />
          <StatRow label="aged 65+" value={fmt.pct(r.share65plus)} prov={p.share65plus} />
          <StatRow label="education" value={fmt.pct(r.education)} prov={p.education} why={w('education')} />
          <StatRow label="tech level" value={fmt.pct(r.techLevel)} prov={p.techLevel} why={w('techLevel')} />
          <StatRow label="compliance" value={fmt.pct(r.compliance)} prov={p.compliance} />
          <StatRow label="faith" value={fmt.pct(r.faith)} prov={p.faith} />
          <StatRow label="gdp" value={fmt.usd(r.gdpUsd)} prov={p.gdpUsd} />
          <StatRow label="energy twh" value={fmt.twh(r.energyTWh)} prov={p.energyTWh} />
          <StatRow label="hours to nearest city" value={r.travelHoursToNearest.toFixed(1)} prov={p.travelHoursToNearest}  raw={r.travelHoursToNearest} />
          {twin && <div className="mt-2 text-[11px] text-ink/50">no-ai twin: population <Num>{fmt.people(twin.population)}</Num> · unrest <Num>{fmt.pct(twin.unrest)}</Num> · kcal <Num>{fmt.kcal(twin.foodKcalPerCapita)}</Num></div>}
        </Section>
      )}
      {tab === 'people' && (
        <>
          {r.crowds.length > 0 && (
            <Section title="crowds">
              <ul className="space-y-2">
                {r.crowds.map((c) => (
                  <li key={c.topic}>
                    <div className="flex items-center justify-between gap-2 text-[12.5px]"><span>{c.topic}</span><Chip tone={c.phase === 'outraged' ? 'ink' : 'soft'}>{words(c.phase)}</Chip></div>
                    <Bar value={c.intensity} label="intensity" />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="approval"><Bar value={r.approval} /></Section>
          <Section title="emotion mix by group">
            <div className="space-y-2">
              {bands.map((b) => {
                const g = people.filter((c) => c.group.ageBand === b)
                if (!g.length) return null
                const avg = Object.fromEntries(EMOTIONS.map((e) => [e, g.reduce((a, c) => a + c.mood[e], 0) / g.length])) as Record<Emotion, number>
                const top = [...EMOTIONS].sort((x, y) => avg[y] - avg[x]).slice(0, 3)
                return (
                  <div key={b}>
                    <div className="text-[11px] text-ink/55">{b} <Num>({g.length})</Num></div>
                    {top.map((e) => <Bar key={e} value={avg[e]} label={e} />)}
                  </div>
                )
              })}
            </div>
          </Section>
          <Section title="people here">
            <div className="flex flex-wrap gap-1.5">{people.map((c) => <Link key={c.id} to={{ kind: 'pip', id: c.id }}><Chip tone="soft">{c.name}</Chip></Link>)}</div>
          </Section>
        </>
      )}
      {tab === 'power' && (
        <>
          {factions.length > 0 && (
            <Section title="factions">
              <ul className="space-y-1.5">{factions.map((f) => <li key={f.id} className="flex items-center justify-between gap-2 text-[12.5px]"><Link to={{ kind: 'faction', id: f.id }}>{f.name}</Link><span className="text-[11px] text-ink/55">power <Num>{fmt.pct(f.power)}</Num> · hostility <Num>{fmt.pct(f.hostility)}</Num></span></li>)}</ul>
            </Section>
          )}
          {laws.length > 0 && (
            <Section title="precedents triggered by current laws">
              <ul className="space-y-2">
                {laws.map((l) => (
                  <li key={l.id} className="text-[12.5px]">
                    <Link to={{ kind: 'law', id: l.id }}>{l.title}</Link>
                    {precedentsFor(record, l).map((pr) => (
                      <div key={pr.id} className="ml-3 text-[11.5px] text-ink/65"><a href={pr.url} target="_blank" rel="noreferrer" className="underline decoration-ink/25 underline-offset-2">{pr.country} <Num>{pr.year}</Num></a>: {pr.reaction}</div>
                    ))}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
      {tab === 'places' && (
        <>
          {frame.cities.some((c) => c.regionId === r.id) && (
            <Section title="cities"><ul className="space-y-1">{frame.cities.filter((c) => c.regionId === r.id).map((c) => <li key={c.id} className="flex justify-between text-[12.5px]"><Link to={{ kind: 'city', id: c.id }}>{c.name}</Link><Num className="text-ink/60">{fmt.people(c.population)}</Num></li>)}</ul></Section>
          )}
          {frame.companies.some((c) => c.regionId === r.id) && (
            <Section title="companies"><ul className="space-y-1">{frame.companies.filter((c) => c.regionId === r.id).map((c) => <li key={c.id} className="flex justify-between text-[12.5px]"><Link to={{ kind: 'company', id: c.id }}>{c.name}</Link><span className="text-[11px] text-ink/55">{c.sector} · <Num>{fmt.people(c.workers)}</Num></span></li>)}</ul></Section>
          )}
          {moves.some((m) => m.to === r.id || m.from === r.id) && (
            <Section title="migrations">
              <ul className="space-y-1 text-[12px]">
                {moves.filter((m) => m.to === r.id).map((m, i) => <li key={`i${i}`}>in <Num>{fmt.people(m.people)}</Num> from {m.from} · {m.reason}</li>)}
                {moves.filter((m) => m.from === r.id).map((m, i) => <li key={`o${i}`}>out <Num>{fmt.people(m.people)}</Num> to {m.to} · {m.reason}</li>)}
              </ul>
            </Section>
          )}
        </>
      )}
    </Drawer>
  )
}

// ---------- law ----------

function LawDossier({ id, frame, record }: { id: string; frame: Frame; record: RunRecord }) {
  const [tab, setTab] = useTab<'law' | 'precedents' | 'effect'>('law')
  const law = frame.laws.find((l) => l.id === id) ?? record.frames.flatMap((f) => f.laws).find((l) => l.id === id)
  const liveRunId = useStore((s) => s.liveRunId)
  const overrides = useStore((s) => s.overrides)
  const [busy, setBusy] = useState(false)
  if (!law) return null
  const resisting = frame.regions.filter((r) => r.compliance < 0.45 || r.unrest > 0.6)
  const sent = overrides.find((o) => o.kind === 'veto_law' && o.lawId === law.id)
  const at = record.frames.find((f) => f.tick >= law.enactedTick) ?? record.frames[0]
  const avg = (f: Frame, k: (r: Region) => number) => f.regions.reduce((a, r) => a + k(r) * r.population, 0) / f.regions.reduce((a, r) => a + r.population, 0)
  const effects = [
    { label: 'approval', a: avg(at, (r) => r.approval), b: avg(frame, (r) => r.approval), f: fmt.pct },
    { label: 'unrest', a: avg(at, (r) => r.unrest), b: avg(frame, (r) => r.unrest), f: fmt.pct },
    { label: 'kcal / person', a: avg(at, (r) => r.foodKcalPerCapita), b: avg(frame, (r) => r.foodKcalPerCapita), f: (n: number) => Math.round(n).toString() },
    { label: 'period life exp.', a: at.globalPeriodLifeExpectancy, b: frame.globalPeriodLifeExpectancy, f: (n: number) => `${n.toFixed(1)}y` },
  ]
  const precs = precedentsFor(record, law)
  return (
    <Drawer kicker={`law · ${law.layer} · ${words(law.policyKind)}`} title={law.title}>
      <Tabs tabs={['law', 'precedents', 'effect']} value={tab} onChange={setTab} />
      {tab === 'law' && (
        <>
          <p className="mt-3 text-[14px] leading-relaxed">{law.text}</p>
          <div className="mt-3 space-y-1"><Bar value={law.support} label="support" /><Bar value={law.compliance} label="compliance" /></div>
          <div className="mt-2 text-[11px] text-ink/50">enacted <Num>{at.date}</Num></div>
          {law.lovedBy.length > 0 && <Section title="loved by"><div className="flex flex-wrap gap-1.5">{law.lovedBy.map((g) => <Chip key={g}>{g}</Chip>)}</div></Section>}
          {law.hatedBy.length > 0 && <Section title="hated by"><div className="flex flex-wrap gap-1.5">{law.hatedBy.map((g) => <Chip key={g} tone="soft">{g}</Chip>)}</div></Section>}
          {resisting.length > 0 && <Section title="resisting regions"><div className="flex flex-wrap gap-1.5">{resisting.map((r) => <Link key={r.id} to={{ kind: 'region', id: r.id }}><Chip tone="soft">{r.name}</Chip></Link>)}</div></Section>}
          {law.vetoed && <div className="mt-4 rounded-lg border border-ink/20 px-3 py-2 text-[12px]">vetoed by you</div>}
          {liveRunId && !law.vetoed && !sent && (
            <button disabled={busy} onClick={async () => { setBusy(true); try { await sendOverride({ kind: 'veto_law', lawId: law.id }) } finally { setBusy(false) } }}
              className="mt-4 w-full rounded-full bg-ink py-2 font-mono text-[12px] uppercase tracking-[0.2em] text-bone hover:bg-ink/85 disabled:opacity-50">veto</button>
          )}
          {sent && !law.vetoed && <div className="mt-4 text-[12px] text-ink/60">veto sent{sent.responded ? ', the core responded' : ', waiting for the core'}</div>}
        </>
      )}
      {tab === 'precedents' && (
        <Section title="what happened when people tried this">
          {precs.length ? (
            <ul className="space-y-3">
              {precs.map((pr) => (
                <li key={pr.id} className="text-[12.5px] leading-snug">
                  <div className="font-display text-[14px]">{pr.event}</div>
                  <div className="text-ink/60">{pr.country} · <Num>{pr.year}</Num> · lasted <Num>{pr.durationMonths}</Num> months · magnitude <Num>{pr.magnitude.toFixed(2)}</Num></div>
                  <div>{pr.reaction}</div>
                  <a href={pr.url} target="_blank" rel="noreferrer" className="text-[11px] underline decoration-ink/25 underline-offset-2">source</a>
                </li>
              ))}
            </ul>
          ) : <p className="text-[12px] text-ink/50">no matched precedent in the library</p>}
        </Section>
      )}
      {tab === 'effect' && (
        <Section title={`measured since ${at.date}`}>
          {effects.map((e) => (
            <div key={e.label} className="flex items-baseline justify-between border-b border-ink/8 py-1 text-[12px]">
              <span className="text-ink/65">{e.label}</span>
              <span><Num className="text-ink/50">{e.f(e.a)}</Num> → <Num>{e.f(e.b)}</Num></span>
            </div>
          ))}
          <p className="mt-2 text-[11px] text-ink/45">world averages since enactment, not isolated to this law</p>
        </Section>
      )}
    </Drawer>
  )
}

// ---------- city / company ----------

function PlaceDossier({ kind, id, frame, record, idx }: { kind: 'city' | 'company'; id: string; frame: Frame; record: RunRecord; idx: number }) {
  const city = kind === 'city' ? frame.cities.find((c) => c.id === id) : undefined
  const co = kind === 'company' ? frame.companies.find((c) => c.id === id) : undefined
  const thing = city ?? co
  if (!thing) return null
  const region = frame.regions.find((r) => r.id === thing.regionId)
  const series = record.frames.slice(0, idx + 1).map((f) => (city ? f.cities.find((c) => c.id === id)?.population : f.companies.find((c) => c.id === id)?.workers) ?? 0).filter((v) => v > 0)
  const movers = frame.citizens.filter((c) => c.lifeEvents.some((e) => e.text.includes(thing.name)))
  return (
    <Drawer kicker={`${kind}${co ? ` · ${co.sector}` : ''} · ${region?.name ?? ''}`} title={thing.name}>
      <Section title="why it exists"><p className="text-[13.5px] leading-relaxed">{city ? city.reason : co!.purpose}</p><div className="mt-1 text-[11px] text-ink/50">founded <Num>{dateAt(record, thing.foundedTick)}</Num></div></Section>
      <Section title={city ? 'population over time' : 'workers over time'}>
        <div className="flex items-end justify-between gap-3"><Sparkline values={series} w={240} /><Num className="text-[14px]">{fmt.people(city ? city.population : co!.workers)}</Num></div>
      </Section>
      {movers.length > 0 && (
        <Section title="who moved there and why">
          <ul className="space-y-1.5">{movers.map((c) => <li key={c.id} className="text-[12.5px]"><Link to={{ kind: 'pip', id: c.id }}>{c.name}</Link>: {c.lifeEvents.find((e) => e.text.includes(thing.name))!.text}</li>)}</ul>
        </Section>
      )}
    </Drawer>
  )
}

// ---------- requirement ----------

function RequirementDossier({ id, frame, record }: { id: string; frame: Frame; record: RunRecord }) {
  const q = frame.requirements.find((x) => x.id === id)
  if (!q) return null
  const unlocks = frame.requirements.filter((x) => x.prereqs.includes(q.id))
  return (
    <Drawer kicker={`requirement · ${words(q.track)}`} title={q.name}>
      <div className="mt-3 flex flex-wrap gap-1.5"><Chip tone={q.tier === 'speculative' ? 'soft' : 'ink'}>{q.tier}</Chip>{q.costUsd && <Chip tone="soft"><Num>{fmt.usd(q.costUsd)}</Num> est.</Chip>}{q.unlockedTick !== undefined && <Chip>done <Num>{dateAt(record, q.unlockedTick)}</Num></Chip>}</div>
      <Section title="progress in this world"><Bar value={q.progress} /></Section>
      <Section title="where the real world stood in 2026">
        <p className="text-[13px] leading-relaxed">{q.realWorld2026}</p>
        {q.url && <a href={q.url} target="_blank" rel="noreferrer" className="text-[11px] underline decoration-ink/25 underline-offset-2">source</a>}
      </Section>
      {q.prereqs.length > 0 && <Section title="needs first"><div className="flex flex-wrap gap-1.5">{q.prereqs.map((p) => { const r = frame.requirements.find((x) => x.id === p); return r ? <Link key={p} to={{ kind: 'requirement', id: p }}><Chip tone={r.progress >= 1 ? 'ink' : 'soft'}>{r.name} <Num>{fmt.pct(r.progress)}</Num></Chip></Link> : null })}</div></Section>}
      {unlocks.length > 0 && <Section title="unlocks"><div className="flex flex-wrap gap-1.5">{unlocks.map((u) => <Link key={u.id} to={{ kind: 'requirement', id: u.id }}><Chip tone="soft">{u.name}</Chip></Link>)}</div></Section>}
    </Drawer>
  )
}

// ---------- faction ----------

function FactionDossier({ id, frame, record, idx }: { id: string; frame: Frame; record: RunRecord; idx: number }) {
  const f = frame.factions.find((x) => x.id === id)
  if (!f) return null
  const opposes = frame.laws.filter((l) => l.hatedBy.some((g) => g.includes(f.name)))
  const backs = frame.laws.filter((l) => l.lovedBy.some((g) => g.includes(f.name)))
  const did = record.frames.slice(0, idx + 1).flatMap((fr) => fr.newEvents.filter((e) => e.regionId && f.regionIds.includes(e.regionId) && ['revolt', 'war'].includes(e.kind)).map((e) => ({ ...e, date: fr.date })))
  const crowds = frame.regions.filter((r) => f.regionIds.includes(r.id)).flatMap((r) => r.crowds.map((c) => ({ r, c })))
  return (
    <Drawer kicker={`faction · ${words(f.kind)}`} title={f.name}>
      <Section title="what they want"><p className="text-[13.5px] leading-relaxed">{f.wants}</p></Section>
      <Section title="strength"><Bar value={f.power} label="power" /><Bar value={f.hostility} label="hostility" danger={f.hostility > 0.7} /></Section>
      <Section title="where"><div className="flex flex-wrap gap-1.5">{f.regionIds.map((rid) => { const r = frame.regions.find((x) => x.id === rid); return r ? <Link key={rid} to={{ kind: 'region', id: rid }}><Chip tone="soft">{r.name}</Chip></Link> : null })}</div></Section>
      {(opposes.length > 0 || backs.length > 0) && (
        <Section title="on the laws">
          <ul className="space-y-1 text-[12.5px]">
            {backs.map((l) => <li key={l.id}>backs <Link to={{ kind: 'law', id: l.id }}>{l.title}</Link></li>)}
            {opposes.map((l) => <li key={l.id}>fights <Link to={{ kind: 'law', id: l.id }}>{l.title}</Link></li>)}
          </ul>
        </Section>
      )}
      {(did.length > 0 || crowds.length > 0) && (
        <Section title="what has happened on their ground">
          <ul className="space-y-1 text-[12.5px]">
            {did.map((e, i) => <li key={i}><Num className="mr-2 text-[10.5px] text-ink/45">{e.date}</Num>{e.text}</li>)}
            {crowds.map(({ r, c }) => <li key={r.id + c.topic}>{r.name}: crowd {words(c.phase)} over {c.topic}</li>)}
          </ul>
        </Section>
      )}
    </Drawer>
  )
}

// ---------- the core ----------

function CoreDossier({ record, idx, frame }: { record: RunRecord; idx: number; frame: Frame }) {
  const [tab, setTab] = useTab<'mandate' | 'decisions' | 'lessons'>('mandate')
  const setPlayhead = useStore((s) => s.setPlayhead)
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const decisions = record.frames.slice(0, idx + 1).filter((f) => f.decision).map((f) => ({ f, d: f.decision! }))
  const applied = new Set(decisions.flatMap(({ d }) => d.lessonsApplied))
  const lessons = record.lessons ?? []
  const dead = new Set(lessons.map((l) => l.fromRunId)).size
  const ask = async () => {
    if (!q.trim()) return
    setBusy(true); setAnswer(null)
    try { setAnswer((await api.ask(record.runId, q.trim())).answer) } catch (e) { setAnswer(e instanceof Offline ? 'runner offline' : 'the core did not answer') } finally { setBusy(false) }
  }
  return (
    <Drawer kicker="the core · ai governor" title={frame.status === 'destroyed' ? 'the core is dark' : 'the core'}>
      {(() => { const last = [...decisions].reverse().find(({ d }) => d.reasoning); return last ? <div className="mb-3 rounded-xl bg-ink/5 px-3 py-2"><div className="mb-0.5 text-[10.5px] uppercase tracking-[0.14em] text-ink/45">last decision · <Num>{last.f.date}</Num></div><ReasoningLines r={last.d.reasoning} />{last.d.reasoning?.outcome && <div className="mt-1 text-[11.5px] text-ink/55">{last.d.reasoning.outcome}</div>}</div> : null })()}
      <Tabs tabs={['mandate', 'decisions', 'lessons']} value={tab} onChange={setTab} />
      {tab === 'mandate' && (
        <>
          <Section title="constitution"><p className="font-display text-[15px] italic leading-snug">{record.constitution}</p></Section>
          {dead > 0 && <Section title="lineage"><p className="text-[13px]">learned from <Num>{dead}</Num> dead world{dead === 1 ? '' : 's'} · knows <Num>{frame.lessonsKnown || lessons.length}</Num> lessons</p></Section>}
          {decisions.some(({ d }) => d.publicStatement) && (
            <Section title="what it told the public">
              <ul className="space-y-1.5">{[...decisions].reverse().filter(({ d }) => d.publicStatement).map(({ f, d }) => <li key={f.tick} className="text-[12.5px]"><Num className="mr-2 text-[10.5px] text-ink/45">{f.date}</Num>&ldquo;{d.publicStatement}&rdquo;</li>)}</ul>
            </Section>
          )}
          <Section title="ask the core">
            <form onSubmit={(e) => { e.preventDefault(); ask() }} className="flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="why move people to the corridor?" className="min-w-0 flex-1 rounded-full border border-ink/20 bg-bone px-3 py-1.5 text-[13px] outline-none focus:border-ink/60" />
              <button disabled={busy} className="rounded-full bg-ink px-3 font-mono text-[11px] uppercase text-bone disabled:opacity-50">{busy ? '...' : 'ask'}</button>
            </form>
            {answer && <p className={`mt-2 text-[13px] leading-relaxed ${answer === 'runner offline' ? 'text-ink/45' : ''}`}>{answer}</p>}
          </Section>
        </>
      )}
      {tab === 'decisions' && (
        <Section title="decisions">
          <ul className="space-y-1">
            {[...decisions].reverse().map(({ f, d }) => (
              <li key={f.tick}>
                <button onClick={() => setPlayhead(f.tick)} className="w-full rounded-lg px-2 py-1 text-left hover:bg-ink/5">
                  <Num className="text-[11px] text-ink/50">{f.date}</Num>
                  <div className="text-[12.5px]">{d.rationale}</div>
                  {(d.foundCities.length > 0 || d.charterCompanies.length > 0 || d.researchFocus.length > 0) && (
                    <div className="mt-0.5 text-[11px] text-ink/55">
                      {d.foundCities.map((c) => `founded ${c.name}`).concat(d.charterCompanies.map((c) => `chartered ${c.name}`)).concat(d.researchFocus.length ? [`research: ${d.researchFocus.map(words).join(', ')}`] : []).join(' · ')}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {tab === 'lessons' && (
        <Section title="lessons from dead worlds">
          {lessons.length ? (
            <ul className="space-y-2.5">
              {lessons.map((l) => (
                <li key={l.id} className="text-[12.5px] leading-snug">
                  <div className="flex items-center gap-2"><span className="font-display text-[14px]">{l.rule}</span>{applied.has(l.id) && <Chip>applied</Chip>}</div>
                  <div className="text-ink/60">{l.mistake}, so {l.consequence}</div>
                  <div className="text-[10.5px] text-ink/45">from <Num>{l.fromRunId}</Num> · gen <Num>{l.generation}</Num></div>
                </li>
              ))}
            </ul>
          ) : <p className="text-[12px] text-ink/50">this is a first generation governor, nothing learned yet</p>}
        </Section>
      )}
    </Drawer>
  )
}

// ---------- event ----------

function EventDossier({ tick, index, record }: { tick: number; index: number; record: RunRecord }) {
  const f = record.frames.find((x) => x.tick === tick)
  const e = f?.newEvents[index]
  if (!f || !e) return null
  const r = f.regions.find((x) => x.id === e.regionId)
  const hit = f.citizens.filter((c) => c.regionId === e.regionId && c.lifeEvents.some((l) => l.tick === tick))
  return (
    <Drawer kicker={`event · ${e.kind} · ${f.date}`} title={e.text}>
      <Section title="what happened">
        <div className="flex flex-wrap gap-1.5">{r && <Link to={{ kind: 'region', id: r.id }}><Chip>{r.name}</Chip></Link>}<Chip tone="soft">severity <Num>{e.severity.toFixed(2)}</Num></Chip></div>
      </Section>
      {r && (r.whys?.length ?? 0) > 0 && (
        <Section title="why">
          {r.whys.filter((w) => ['unrest', 'foodKcalPerCapita', 'approval'].includes(w.stat)).map((w) => (
            <StatRow key={w.stat} label={words(w.stat === 'foodKcalPerCapita' ? 'kcal per person' : w.stat)} value={w.value > 10 ? Math.round(w.value).toString() : fmt.pct(w.value)} why={w} />
          ))}
        </Section>
      )}
      {hit.length > 0 && (
        <Section title="who it hit">
          <ul className="space-y-1.5">{hit.map((c) => <li key={c.id} className="text-[12.5px]"><Link to={{ kind: 'pip', id: c.id }}>{c.name}</Link>: {c.lifeEvents.find((l) => l.tick === tick)!.text}</li>)}</ul>
        </Section>
      )}
    </Drawer>
  )
}

// ---------- layer + moon (kept from v1) ----------

function LayerDossier({ layer, regionId, frame, record, idx }: { layer: Layer; regionId: string; frame: Frame; record: RunRecord; idx: number }) {
  const r = frame.regions.find((x) => x.id === regionId)
  const laws = frame.laws.filter((l) => l.layer === layer)
  const key = LAYER_BUDGET[layer]
  const series = record.frames.slice(0, idx + 1).map((f) => { const rr = f.regions.find((x) => x.id === regionId); return rr ? layerMetric(layer as Parameters<typeof layerMetric>[0], rr, f.regions) : 0 })
  // never just a chart: one plain sentence first, then the chart with the big events marked on it
  const sentence = layerSentence(layer, regionId, record, idx, series)
  const marks = record.frames.slice(0, idx + 1).map((f, i) => ({ i, e: f.newEvents.find((e) => e.regionId === regionId && e.kind !== 'law' && e.severity >= 0.5) })).filter((x) => x.e)
  return (
    <Drawer kicker={`${layer} layer · ${r?.name ?? ''}`} title={layer}>
      {sentence && <p className="mb-2 text-[13px] leading-snug">{sentence}</p>}
      {series.length > 1 && (
        <Section title="over time">
          <div className="relative w-[300px]">
            <Sparkline values={series} w={300} />
            {marks.map(({ i, e }) => <span key={i} title={e!.text} className={`absolute top-0 h-full w-px ${['famine', 'war', 'disaster', 'pandemic'].includes(e!.kind) ? 'bg-ember/60' : 'bg-ink/30'}`} style={{ left: `${(i / Math.max(1, series.length - 1)) * 100}%` }} />)}
          </div>
          {marks.length > 0 && <div className="mt-1 text-[11px] text-ink/50">lines mark the big events: {marks.slice(-3).map(({ e }) => e!.text.toLowerCase()).join('; ')}</div>}
        </Section>
      )}
      {key && <Section title="budget share"><Bar value={frame.budget[key]} label={key} /></Section>}
      {laws.length > 0 && <Section title="laws in this layer"><ul className="space-y-1">{laws.map((l) => <li key={l.id}><Link to={{ kind: 'law', id: l.id }} className={`text-[13px] ${l.vetoed ? 'line-through opacity-50' : ''}`}>{l.title}</Link></li>)}</ul></Section>}
    </Drawer>
  )
}

function MoonDossier({ record, idx, frame }: { record: RunRecord; idx: number; frame: Frame }) {
  const stageIdx = MOON_STAGES.indexOf(frame.moonStage)
  const space = record.frames.slice(0, idx + 1).map((f) => f.budget.space)
  const launches = record.frames.slice(0, idx + 1).flatMap((f) => f.newEvents.filter((e) => e.kind === 'launch').map((e) => ({ ...e, date: f.date })))
  return (
    <Drawer kicker="launch program" title={frame.moonStage === 'crewed_landing' ? 'boots on the moon' : 'the moon'}>
      <Section title="moon track"><Bar value={frame.moonProgress} />
        <ol className="mt-3 space-y-1">{MOON_STAGES.slice(1).map((s, i) => <li key={s} className={`flex items-center gap-2 text-[12.5px] ${i + 1 <= stageIdx ? '' : 'text-ink/40'}`}><span className={`inline-block h-2.5 w-2.5 rounded-full border border-ink/50 ${i + 1 <= stageIdx ? 'bg-ink' : ''}`} />{words(s)}</li>)}</ol>
      </Section>
      {space.length > 1 && <Section title="space budget over time"><Sparkline values={space} w={300} /><div className="mt-1 text-[11px] text-ink/50">now <Num>{fmt.pct(frame.budget.space)}</Num></div></Section>}
      {launches.length > 0 && <Section title="launch history"><ul className="space-y-1 text-[12.5px]">{launches.map((l, i) => <li key={i} className={/fail/i.test(l.text) ? 'text-ember' : ''}><Num className="mr-2 text-[11px] text-ink/50">{l.date}</Num>{l.text}</li>)}</ul></Section>}
    </Drawer>
  )
}

// ---------- agent ----------

function AgentDossier({ id }: { id: string }) {
  const [tab, setTab] = useTab<'constitution' | 'lineage' | 'worlds' | 'lessons'>('constitution')
  const agents = useStore((s) => s.agents)
  const runs = useStore((s) => s.runs)
  const a = agents.find((x) => x.id === id)
  if (!a) return null
  const parents = a.parentIds.map((p) => agents.find((x) => x.id === p)).filter(Boolean) as typeof agents
  const children = agents.filter((x) => x.parentIds.includes(a.id))
  const summaries = [...mockRuns().map((r) => r.summary), ...runs].filter((r, i, all) => (r.agentId === a.id || a.runIds.includes(r.runId)) && all.findIndex((x) => x.runId === r.runId) === i)
  const records = mockRuns().filter((r) => r.agentId === a.id)
  const applied = new Set(records.flatMap((r) => r.frames.flatMap((f) => f.decision?.lessonsApplied ?? [])))
  const known = records.flatMap((r) => r.lessons ?? []).filter((l, i, all) => all.findIndex((x) => x.id === l.id) === i)
  return (
    <Drawer kicker={`agent · gen ${a.generation} · ${a.origin}${a.champion ? ' · champion' : a.retired ? ' · retired' : ''}`} title={<span className="flex items-center gap-3"><Emblem seed={a.emblemSeed} size={40} glow={a.champion} />{a.name}</span>}>
      <Tabs tabs={['constitution', 'lineage', 'worlds', 'lessons']} value={tab} onChange={setTab} />
      {tab === 'constitution' && (
        <>
          <Section title="philosophy"><p className="font-display text-[15px] italic">{a.philosophy}</p></Section>
          <Section title="full constitution"><p className="text-[13.5px] leading-relaxed">{a.constitution}</p></Section>
          <Section title="record">
            <div className="grid grid-cols-2 gap-1 text-[12px]">
              <span>worlds <Num>{a.worlds}</Num></span><span>deaths <Num className={a.deaths ? 'text-ember' : ''}>{a.deaths}</Num></span>
              <span>best score <Num>{a.bestScore.toFixed(2)}</Num></span><span>avg score <Num>{a.avgScore.toFixed(2)}</Num></span>
              <span>best frontier {words(a.bestFrontier)}</span><span>best life <Num>{a.bestPeriodLifeExpectancy.toFixed(1)}y</Num></span>
            </div>
          </Section>
        </>
      )}
      {tab === 'lineage' && (
        <>
          <Section title={a.origin === 'seed' ? 'a seed governor' : a.origin === 'crossover' ? 'crossed from' : 'mutated from'}>
            {parents.length ? <div className="flex flex-wrap gap-2">{parents.map((p) => <Link key={p.id} to={{ kind: 'agent', id: p.id }}><span className="flex items-center gap-1.5"><Emblem seed={p.emblemSeed} size={22} />{p.name}</span></Link>)}</div> : <p className="text-[12px] text-ink/55">no parents, written by hand at the start</p>}
          </Section>
          {children.length > 0 && <Section title="descendants"><div className="flex flex-wrap gap-2">{children.map((c) => <Link key={c.id} to={{ kind: 'agent', id: c.id }}><span className="flex items-center gap-1.5"><Emblem seed={c.emblemSeed} size={22} faded={c.retired} />{c.name}</span></Link>)}</div></Section>}
        </>
      )}
      {tab === 'worlds' && (
        <Section title="every world it ran">
          {summaries.length ? (
            <ul className="space-y-1">
              {summaries.map((r) => (
                <li key={r.runId}>
                  <button onClick={() => openRun(r.runId)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left hover:bg-ink/5">
                    <span><Num className="text-[12px]">{r.runId}</Num><span className={`ml-2 text-[11px] ${r.status === 'destroyed' ? 'text-ember' : 'text-ink/55'}`}>{r.status}</span></span>
                    <span className="text-[11px] text-ink/55"><Num>{r.endDate}</Num> · <Num>{r.score.toFixed(2)}</Num></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-[12px] text-ink/50">its worlds are not loaded here</p>}
        </Section>
      )}
      {tab === 'lessons' && (
        <Section title="lessons it applied">
          {known.length ? (
            <ul className="space-y-2">{known.map((l) => <li key={l.id} className="text-[12.5px] leading-snug"><span className="font-display text-[14px]">{l.rule}</span>{applied.has(l.id) && <> <Chip>applied</Chip></>}<div className="text-[11px] text-ink/55">from <Num>{l.fromRunId}</Num></div></li>)}</ul>
          ) : <p className="text-[12px] text-ink/50">no lessons recorded for its worlds</p>}
        </Section>
      )}
    </Drawer>
  )
}

// ---------- router ----------

export default function Dossier() {
  const selection = useStore((s) => s.selection)
  const { frame, record, idx } = useCurrentFrame()
  if (!selection) return null
  const key = JSON.stringify(selection)
  switch (selection.kind) {
    case 'pip': { const c = frame.citizens.find((x) => x.id === selection.id); return c ? <PipDossier key={key} c={c} frame={frame} record={record} /> : null }
    case 'region': { const r = frame.regions.find((x) => x.id === selection.id); return r ? <RegionDossier key={key} r={r} frame={frame} record={record} idx={idx} /> : null }
    case 'law': return <LawDossier key={key} id={selection.id} frame={frame} record={record} />
    case 'city': case 'company': return <PlaceDossier key={key} kind={selection.kind} id={selection.id} frame={frame} record={record} idx={idx} />
    case 'requirement': return <RequirementDossier key={key} id={selection.id} frame={frame} record={record} />
    case 'faction': return <FactionDossier key={key} id={selection.id} frame={frame} record={record} idx={idx} />
    case 'core': return <CoreDossier key={key} record={record} idx={idx} frame={frame} />
    case 'event': return <EventDossier key={key} tick={selection.tick} index={selection.index} record={record} />
    case 'layer': return <LayerDossier key={key} layer={selection.layer} regionId={selection.regionId} frame={frame} record={record} idx={idx} />
    case 'moon': return <MoonDossier key={key} record={record} idx={idx} frame={frame} />
    case 'agent': return <AgentDossier key={key} id={selection.id} />
  }
}
