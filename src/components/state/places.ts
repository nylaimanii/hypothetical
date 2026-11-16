'use server'
// B's per-run places file (data/runs/<runId>.places.*): every year's stats and stories for countries, states and
// real cities. decoded only by B's placesAt(); this hands the browser just what it asks for
import path from 'node:path'
import fs from 'node:fs'
import { loadPlaces, placesAt, type PlacesHeader } from '@/lib/sim/places-replay'
import type { PlaceStats } from '@/lib/types'

const SAFE = /^[a-z0-9][a-z0-9-]{0,80}$/i
const cache = new Map<string, { header: PlacesHeader; bin: Buffer } | null>()

function open(runId: string) {
  if (!SAFE.test(runId)) return null
  if (cache.has(runId)) return cache.get(runId)!
  const base = path.join(process.cwd(), 'data', 'runs', `${runId}.places`)
  let p: { header: PlacesHeader; bin: Buffer } | null = null
  try { if (fs.existsSync(`${base}.json`)) p = loadPlaces(base) } catch { p = null }
  cache.set(runId, p)
  if (cache.size > 4) cache.delete(cache.keys().next().value!)
  return p
}

export type CountriesYear = { tick: number; countries: { id: string; name: string; regionId: string; stats: PlaceStats }[] }

// one year of country stats, for overlays and for frames that don't carry countries
export async function countriesYear(runId: string, tick: number): Promise<CountriesYear | null> {
  const p = open(runId)
  if (!p) return null
  const y = placesAt(p, tick)
  if (!y) return null
  return { tick: y.tick, countries: p.header.countries.flatMap((c) => (y.countries[c.id] ? [{ ...c, stats: y.countries[c.id] }] : [])) }
}

export type PlaceYear = { tick: number; name: string; stats: PlaceStats; story: string | null; history: { tick: number; stats: PlaceStats }[] }

// one place (country, state or city): its stats and story for the year, and its history for the report
export async function placeYear(runId: string, tick: number, kind: 'country' | 'admin' | 'city', id: string): Promise<PlaceYear | null> {
  const p = open(runId)
  if (!p || !SAFE.test(id.replace(/[^a-z0-9-]/gi, 'x'))) return null
  const list = kind === 'country' ? p.header.countries : kind === 'admin' ? p.header.admin1 : p.header.cities
  const meta = list.find((x) => x.id === id)
  if (!meta) return null
  const bucket = kind === 'country' ? 'countries' : kind === 'admin' ? 'admin1' : 'cities'
  const now = placesAt(p, tick)
  if (!now?.[bucket][id]) return null
  const history = p.header.years.flatMap((yr) => { const y = placesAt(p, yr.tick); const s = y?.[bucket][id]; return s ? [{ tick: yr.tick, stats: s }] : [] })
  return { tick: now.tick, name: meta.name, stats: now[bucket][id], story: now.stories[id] ?? null, history }
}
