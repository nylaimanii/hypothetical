'use client'
// v4: one small card for a country, state or city. one plain line by default; depth in the full report.
import { useMemo } from 'react'
import type { Frame, PlaceStats, RunRecord } from '@/lib/types'
import { useCurrentFrame, useStore } from '../state/store'
import { Num, Sparkline, fmt } from './bits'
import { regionPlaceStats } from '../world/modes'
import { StoryLine, useLinks } from './chains'

type Place = { kind: 'country' | 'admin' | 'city'; id: string; name: string; stats: PlaceStats; sub: { text: string; go?: () => void }[]; regionId?: string }

const SIX: { key: keyof PlaceStats; label: string }[] = [
  { key: 'happiness', label: 'happiness' }, { key: 'economy', label: 'economy' }, { key: 'livability', label: 'livability' },
  { key: 'foodSecurity', label: 'food' }, { key: 'safety', label: 'safety' }, { key: 'health', label: 'health' },
]
const WORDS: Partial<Record<keyof PlaceStats, string>> = { happiness: 'happiness', economy: 'the economy', livability: 'livability', foodSecurity: 'food', safety: 'safety', health: 'health', jobs: 'jobs', airQuality: 'clean air' }

// find a place in a frame, whichever kind it is
export function findPlace(f: Frame, kind: Place['kind'], id: string): Place | null {
  const sel = useStore.getState().select
  if (kind === 'country') {
    const c = f.countries?.find((x) => x.id === id)
    return c ? { kind, id, name: c.name, stats: c.stats, regionId: c.regionId, sub: [{ text: `part of ${f.regions.find((r) => r.id === c.regionId)?.name ?? 'its region'}`, go: () => sel({ kind: 'region', id: c.regionId }) }] } : null
  }
  if (kind === 'admin') {
    const a = f.adminAreas?.find((x) => x.id === id)
    const c = a && f.countries?.find((x) => x.id === a.countryId)
    return a ? { kind, id, name: a.name, stats: a.stats, regionId: c?.regionId, sub: c ? [{ text: `in ${c.name}`, go: () => sel({ kind: 'country', id: c.id }) }] : [] } : null
  }
  const c = f.cities.find((x) => x.id === id)
  if (!c) return null
  const r = f.regions.find((x) => x.id === c.regionId)
  const stats = c.stats ?? (r ? { ...regionPlaceStats(r), population: c.population } : null)
  if (!stats) return null
  const a = c.adminId ? f.adminAreas?.find((x) => x.id === c.adminId) : undefined
  const co = c.countryId ? f.countries?.find((x) => x.id === c.countryId) : undefined
  const sub = [
    ...(a ? [{ text: a.name, go: () => sel({ kind: 'admin', id: a.id }) }] : []),
    ...(co ? [{ text: co.name, go: () => sel({ kind: 'country', id: co.id }) }] : []),
    ...(!c.real ? [{ text: `founded ${2026 + Math.floor((c.foundedTick + 10) / 12)}` }] : []),
  ]
  return { kind, id, name: c.name, stats, regionId: c.regionId, sub }
}

// the same place a year earlier, for the trend's why
function placeAt(rec: RunRecord, tick: number, kind: Place['kind'], id: string) {
  let f = rec.frames[0]
  for (const x of rec.frames) if (x.tick <= tick) f = x
  return findPlace(f, kind, id)
}

// one plain line: which of the numbers moved most, and which way
function whyLine(now: PlaceStats, before: PlaceStats | null) {
  if (!before) return now.trend === 'stable' ? 'steady so far' : now.trend
  const moves = (Object.keys(WORDS) as (keyof PlaceStats)[])
    .map((k) => ({ k, d: (now[k] as number) - (before[k] as number) }))
    .filter((m) => Math.abs(m.d) >= 0.02)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
  const wanted = now.trend === 'declining' ? moves.filter((m) => m.d < 0) : now.trend === 'rising' ? moves.filter((m) => m.d > 0) : moves
  const top = wanted.slice(0, 2).map((m) => `${WORDS[m.k]} ${m.d > 0 ? 'up' : 'down'} ${Math.round(Math.abs(m.d) * 100)}`)
  if (!top.length) return now.trend === 'stable' ? 'steady this year' : now.trend
  return `${now.trend === 'stable' ? 'steady' : now.trend}: ${top.join(', ')} since last year`
}

export const Arrow = ({ t }: { t: PlaceStats['trend'] }) => (
  <span className={t === 'rising' ? 'text-[#5E8C4A]' : t === 'declining' ? 'text-ember' : 'text-ink/40'} aria-label={t}>{t === 'rising' ? '▲' : t === 'declining' ? '▼' : '■'}</span>
)

function Bar({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-16 text-ink/60">{label}</span>
      <span className="h-1.5 flex-1 rounded-full bg-ink/10"><span className="block h-full rounded-full bg-ink/70" style={{ width: `${Math.round(v * 100)}%` }} /></span>
      <Num className="w-7 text-right text-ink/70">{Math.round(v * 100)}</Num>
    </div>
  )
}

export function PlaceCard({ kind, id }: { kind: Place['kind']; id: string }) {
  const { frame, record, idx } = useCurrentFrame()
  const links = useLinks(record, idx)
  const place = useMemo(() => findPlace(frame, kind, id), [frame, kind, id])
  const before = useMemo(() => placeAt(record, frame.tick - 12, kind, id), [record, frame.tick, kind, id])
  if (!place) return null
  const s = place.stats
  const st = useStore.getState()
  return (
    <div className="sheet-in panel pointer-events-auto w-[20rem] max-w-full p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-display text-[19px] leading-tight"><span className="truncate">{place.name}</span> <Arrow t={s.trend} /></div>
          <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[12px] text-ink/55">
            <span><Num>{fmt.people(s.population)}</Num> people</span>
            {place.sub.map((x) => <span key={x.text}>· {x.go ? <button onClick={x.go} className="underline decoration-ink/20 underline-offset-2 hover:text-ink">{x.text}</button> : x.text}</span>)}
          </div>
        </div>
        <button onClick={() => st.select(null)} aria-label="close" className="text-[16px] leading-none text-ink/40 hover:text-ink">×</button>
      </div>
      <div className="mt-3 space-y-1.5">{SIX.map((k) => <Bar key={k.key} label={k.label} v={s[k.key] as number} />)}</div>
      <div className="mt-3"><StoryLine story={frame.regions.find((r) => r.id === place.regionId)?.story} links={links} frame={frame} fallback={whyLine(s, before?.stats ?? null)} /></div>
      <div className="mt-2 flex gap-4 text-[12px]">
        <button onClick={() => st.setReport(true)} className="text-ink/60 underline decoration-ink/25 underline-offset-2 hover:text-ink">full report</button>
        {kind === 'city' && <button onClick={() => st.setCityView(id)} className="text-ink underline decoration-ink/40 underline-offset-2">visit</button>}
      </div>
    </div>
  )
}

// the full report: every number, how it moved, where it comes from
export function PlaceReport({ kind, id }: { kind: Place['kind']; id: string }) {
  const { frame, record } = useCurrentFrame()
  const place = findPlace(frame, kind, id)
  const series = useMemo(() => {
    const keys: (keyof PlaceStats)[] = ['happiness', 'economy', 'livability', 'foodSecurity', 'safety', 'health', 'jobs', 'airQuality']
    const rows = record.frames.filter((f) => f.tick <= frame.tick && f.tick % 12 === 0).map((f) => findPlace(f, kind, id)?.stats).filter(Boolean) as PlaceStats[]
    return keys.map((k) => ({ k, values: rows.map((r) => r[k] as number) }))
  }, [record, frame.tick, kind, id])
  if (!place) return null
  const country = kind === 'country' ? frame.countries?.find((c) => c.id === id) : undefined
  return (
    <div className="sheet-in panel pointer-events-auto w-[26rem] max-w-full p-5">
      <div className="flex items-baseline justify-between">
        <div className="font-display text-[22px]">{place.name} <Arrow t={place.stats.trend} /></div>
        <button onClick={() => useStore.getState().setReport(false)} className="text-[11.5px] text-ink/60 underline decoration-ink/25 underline-offset-2">back to the card</button>
      </div>
      <div className="mt-1 text-[12.5px] text-ink/60"><Num>{fmt.people(place.stats.population)}</Num> people · housing costs <Num>{place.stats.housingCost.toFixed(1)}</Num>x a local median income</div>
      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
        {series.map((x) => (
          <div key={x.k}>
            <div className="flex justify-between text-[11.5px] text-ink/60"><span>{WORDS[x.k] ?? x.k}</span><Num className="text-ink">{Math.round(((place.stats[x.k] as number) ?? 0) * 100)}</Num></div>
            {x.values.length > 1 && <Sparkline values={x.values} w={170} h={28} />}
          </div>
        ))}
      </div>
      {country && (
        <p className="mt-4 text-[11px] leading-snug text-ink/45">
          population: {country.provenance.population?.kind === 'SOURCED' ? <a href={country.provenance.population.url} target="_blank" rel="noreferrer" className="underline">un world population prospects</a> : 'estimate'}. every other number here is an estimate from the sim.
        </p>
      )}
    </div>
  )
}
