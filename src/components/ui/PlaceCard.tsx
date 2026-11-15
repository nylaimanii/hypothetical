'use client'
// v4: one small card for a country, state or city. one plain line by default; depth in the full report.
import { useMemo } from 'react'
import type { Frame, PlaceStats, RunRecord } from '@/lib/types'
import { useCurrentFrame, useStore } from '../state/store'
import { Num, Sparkline, fmt } from './bits'
import { regionPlaceStats } from '../world/modes'
import { StoryLine, useLinks } from './chains'
import type { Crumb } from '../world/geo/resolve'
import { geoNow, useGeo } from '../world/geo/lazy'

// crumbs sit above the name ("texas · united states · north america"); tap one to jump up
type Place = { kind: 'country' | 'admin' | 'city'; id: string; name: string; stats: PlaceStats; crumbs: Crumb[]; meta: string[]; note?: string; popEstimate?: boolean; regionId?: string }

const SIX: { key: keyof PlaceStats; label: string }[] = [
  { key: 'happiness', label: 'happiness' }, { key: 'economy', label: 'economy' }, { key: 'livability', label: 'livability' },
  { key: 'foodSecurity', label: 'food' }, { key: 'safety', label: 'safety' }, { key: 'health', label: 'health' },
]
const WORDS: Partial<Record<keyof PlaceStats, string>> = { happiness: 'happiness', economy: 'the economy', livability: 'livability', foodSecurity: 'food', safety: 'safety', health: 'health', jobs: 'jobs', airQuality: 'clean air' }

// find a place in a frame, whichever kind it is. untracked states and countries roll up their numbers and say so
export function findPlace(f: Frame, kind: Place['kind'], id: string): Place | null {
  const geo = geoNow()
  if (!geo) return null
  const { resolveAdmin, resolveCountry } = geo
  if (kind === 'country' || kind === 'admin') {
    const r = kind === 'country' ? resolveCountry(f, id) : resolveAdmin(f, id)
    return r ? { kind, id, name: r.name, stats: r.stats, crumbs: r.crumbs, meta: [], note: r.note, popEstimate: r.popEstimate, regionId: r.region?.id } : null
  }
  const c = f.cities.find((x) => x.id === id)
  if (!c) return null
  const r = f.regions.find((x) => x.id === c.regionId)
  const co = c.countryId ? resolveCountry(f, c.countryId) : null
  const stats = c.stats ?? (co ? { ...co.stats, population: c.population } : r ? { ...regionPlaceStats(r), population: c.population } : null)
  if (!stats) return null
  const a = c.adminId ? resolveAdmin(f, c.adminId) : null
  const crumbs: Crumb[] = [
    ...(a && c.adminId ? [{ text: a.name, sel: { kind: 'admin' as const, id: c.adminId } }] : []),
    ...(co && c.countryId ? [{ text: co.name, sel: { kind: 'country' as const, id: c.countryId } }, ...co.crumbs] : r ? [{ text: r.name, sel: { kind: 'region' as const, id: r.id } }] : []),
  ]
  return { kind, id, name: c.name, stats, crumbs, meta: !c.real ? [`founded ${2026 + Math.floor((c.foundedTick + 10) / 12)}`] : [], note: c.stats ? undefined : co ? 'country average' : 'region average', regionId: c.regionId }
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
  const geo = useGeo()
  const { frame, record, idx } = useCurrentFrame()
  const links = useLinks(record, idx)
  const place = useMemo(() => (geo ? findPlace(frame, kind, id) : null), [frame, kind, id, geo])
  const before = useMemo(() => (geo ? placeAt(record, frame.tick - 12, kind, id) : null), [record, frame.tick, kind, id, geo])
  if (!place) return null
  const s = place.stats
  const st = useStore.getState()
  return (
    <div className="sheet-in panel pointer-events-auto w-[20rem] max-w-full p-4 [.phone-sheet_&]:w-full [.phone-sheet_&]:rounded-none [.phone-sheet_&]:border-0 [.phone-sheet_&]:shadow-none">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {place.crumbs.length > 0 && (
            <div className="mb-0.5 flex flex-wrap gap-x-1 text-[11px] text-ink/50">
              {place.crumbs.map((x, i) => <span key={x.text}>{i > 0 && '· '}<button onClick={() => x.sel && st.select(x.sel)} className="hover:text-ink hover:underline hover:decoration-ink/25 hover:underline-offset-2">{x.text}</button></span>)}
            </div>
          )}
          <div className="flex items-center gap-2 font-display text-[19px] leading-tight"><span className="truncate">{place.name}</span> <Arrow t={s.trend} /></div>
          <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[12px] text-ink/55">
            <span>{place.popEstimate && 'about '}<Num>{fmt.people(s.population)}</Num> people{place.popEstimate && <span className="text-ink/40"> (estimate)</span>}</span>
            {place.meta.map((m) => <span key={m}>· {m}</span>)}
          </div>
        </div>
        <button onClick={() => st.select(null)} aria-label="close" className="text-[16px] leading-none text-ink/40 hover:text-ink">×</button>
      </div>
      <div className="mt-3 space-y-1.5">{SIX.map((k) => <Bar key={k.key} label={k.label} v={s[k.key] as number} />)}</div>
      {place.note && <div className="mt-1 text-right text-[10.5px] text-ink/45">numbers: {place.note}</div>}
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
  const geo = useGeo()
  const { frame, record } = useCurrentFrame()
  const place = findPlace(frame, kind, id)
  const series = useMemo(() => {
    const keys: (keyof PlaceStats)[] = ['happiness', 'economy', 'livability', 'foodSecurity', 'safety', 'health', 'jobs', 'airQuality']
    const rows = record.frames.filter((f) => f.tick <= frame.tick && f.tick % 12 === 0).map((f) => findPlace(f, kind, id)?.stats).filter(Boolean) as PlaceStats[]
    return keys.map((k) => ({ k, values: rows.map((r) => r[k] as number) }))
  }, [record, frame.tick, kind, id, geo]) // eslint-disable-line react-hooks/exhaustive-deps
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

// a sea: its name, shipping, and the chokepoint if this is one
export function SeaCard({ ocean, chokepoint }: { ocean: number; chokepoint?: string }) {
  const geo = useGeo()
  const { frame } = useCurrentFrame()
  if (!geo) return null
  const info = geo.seaInfo(frame, { ocean, chokepoint })
  return (
    <div className="sheet-in panel pointer-events-auto w-[20rem] max-w-full p-4 [.phone-sheet_&]:w-full [.phone-sheet_&]:rounded-none [.phone-sheet_&]:border-0 [.phone-sheet_&]:shadow-none">
      <div className="flex items-start justify-between gap-2">
        <div>
          {info.chokepoint && <div className="mb-0.5 text-[11px] text-ink/50">{info.name}</div>}
          <div className="font-display text-[19px] leading-tight">{info.chokepoint ?? info.name}</div>
        </div>
        <button onClick={() => useStore.getState().select(null)} aria-label="close" className="text-[16px] leading-none text-ink/40 hover:text-ink">×</button>
      </div>
      <p className="mt-2 text-[12.5px] leading-snug text-ink/75">
        shipping: {info.shipping}{info.status && <>. chokepoint: <span className={info.status.startsWith('open') ? '' : 'text-ember'}>{info.status}</span></>}
      </p>
      <p className="mt-1 text-[10.5px] text-ink/45">traffic is an estimate until real shipping lanes arrive</p>
    </div>
  )
}
