// decode the per-run places file (data/runs/<runId>.places.json + .places.bin.gz): yearly stats, trends and
// stories for every country, admin-1 state and real city. the ui and api call placesAt(); nobody decodes bytes.
import fs from 'node:fs'
import zlib from 'node:zlib'
import type { PlaceStats, Trend } from '../types'

export type PlacesHeader = {
  runId: string; rowBytes: number; keys: string[]; trendCodes: Trend[]
  countries: { id: string; name: string; regionId: string }[]
  admin1: { id: string; countryId: string; name: string }[]
  cities: { id: string; countryId: string; name: string }[]
  years: { tick: number; stories: Record<string, string> }[]
}
export type PlacesYear = { tick: number; countries: Record<string, PlaceStats>; admin1: Record<string, PlaceStats>; cities: Record<string, PlaceStats>; stories: Record<string, string> }

export function loadPlaces(base: string): { header: PlacesHeader; bin: Buffer } {
  return { header: JSON.parse(fs.readFileSync(`${base}.json`, 'utf8')) as PlacesHeader, bin: zlib.gunzipSync(fs.readFileSync(`${base}.bin.gz`)) }
}

function row(h: PlacesHeader, bin: Buffer, o: number): PlaceStats {
  const s: Record<string, number | string> = { population: Math.round(bin.readFloatLE(o)) }
  let k = 4
  for (const key of h.keys.slice(1)) { const b = bin[o + k++]; s[key] = key === 'housingCost' ? b / 10 : Math.round(b / 250 * 1000) / 1000 }
  s.trend = h.trendCodes[bin[o + k]]
  return s as unknown as PlaceStats
}

// stats for the last recorded year at or before `tick`
export function placesAt(p: { header: PlacesHeader; bin: Buffer }, tick: number): PlacesYear | null {
  const { header: h, bin } = p
  const yi = h.years.map(y => y.tick).filter(t => t <= tick).length - 1
  if (yi < 0) return null
  const n = h.countries.length + h.admin1.length + h.cities.length
  const base = yi * n * h.rowBytes
  const out: PlacesYear = { tick: h.years[yi].tick, countries: {}, admin1: {}, cities: {}, stories: h.years[yi].stories }
  h.countries.forEach((c, i) => { out.countries[c.id] = row(h, bin, base + i * h.rowBytes) })
  h.admin1.forEach((a, i) => { out.admin1[a.id] = row(h, bin, base + (h.countries.length + i) * h.rowBytes) })
  h.cities.forEach((c, i) => { out.cities[c.id] = row(h, bin, base + (h.countries.length + h.admin1.length + i) * h.rowBytes) })
  return out
}
