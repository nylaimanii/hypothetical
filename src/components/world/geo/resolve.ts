// the most specific real place a tile belongs to, and everything a card needs to show it.
// far: the country (states are too small to aim at). mid and close: the city whose footprint covers the tile,
// else the state. sea tiles: the named sea, and the chokepoint if there is one.
// states and countries the sim doesn't track yet roll their numbers up from the country or region, and say so.
import type { Frame, PlaceStats, Region } from '@/lib/types'
import { buildTiles, latLonToVec3, tileIndexAt } from '../lib'
import { regionPlaceStats } from '../modes'
import { COUNTRY_TABLE, countryIndexOf, tileCountries } from './countries'
import { ADMIN1_TABLE, CHOKEPOINTS, OCEAN_TABLE, cityAtTile, tilePlace } from './places'

export type PlaceSel = { kind: 'country' | 'admin' | 'city'; id: string } | { kind: 'sea'; ocean: number; chokepoint?: string }

export function placeForTile(frame: Frame, ti: number, zoom: 'far' | 'mid' | 'close'): PlaceSel | null {
  const { tiles } = buildTiles(frame.regions)
  const t = tiles[ti]
  if (!t) return null
  const land = t.land && !t.ice
  const tc = tileCountries(tiles)[ti]
  const p = tilePlace(ti, land, tc)
  if (!t.land) return p.ocean >= 0 ? { kind: 'sea', ocean: p.ocean, chokepoint: p.chokepoint } : null
  if (zoom === 'far') return p.country >= 0 ? { kind: 'country', id: COUNTRY_TABLE[p.country].iso3 } : null
  const city = cityAtTile(frame, t)
  if (city) return { kind: 'city', id: city.id }
  if (p.admin1 >= 0) return { kind: 'admin', id: ADMIN1_TABLE[p.admin1].id }
  return p.country >= 0 ? { kind: 'country', id: COUNTRY_TABLE[p.country].iso3 } : null
}

// the governor-brief region a point belongs to (for places the sim doesn't place itself)
export function regionAt(frame: Frame, lat: number, lon: number): Region | undefined {
  const { tiles } = buildTiles(frame.regions)
  const t = tiles[tileIndexAt(latLonToVec3(lat, lon, 1))]
  if (t && t.region >= 0) return frame.regions[t.region]
  const v = latLonToVec3(lat, lon, 1)
  return [...frame.regions].sort((a, b) => latLonToVec3(a.lat, a.lon, 1).distanceTo(v) - latLonToVec3(b.lat, b.lon, 1).distanceTo(v))[0]
}

export type Crumb = { text: string; sel?: PlaceSel | { kind: 'region'; id: string } }
export type Resolved = { name: string; stats: PlaceStats; note?: string; crumbs: Crumb[]; region?: Region; popEstimate?: boolean }

const countryRow = (iso: string) => COUNTRY_TABLE[countryIndexOf(iso)]
const countryPop = (iso: string) => ADMIN1_TABLE.reduce((a, s) => a + (s.country === iso ? s.population : 0), 0)

export function resolveCountry(frame: Frame, iso: string): Resolved | null {
  const row = countryRow(iso)
  const tracked = frame.countries?.find((c) => c.id === iso)
  if (!row && !tracked) return null
  const region = (tracked && frame.regions.find((r) => r.id === tracked.regionId)) || (row ? regionAt(frame, row.lat, row.lon) : undefined)
  const crumbs: Crumb[] = region ? [{ text: region.name, sel: { kind: 'region', id: region.id } }] : []
  if (tracked) return { name: tracked.name, stats: tracked.stats, crumbs, region }
  if (!region) return null
  return { name: row.name, stats: { ...regionPlaceStats(region), population: countryPop(iso) }, note: `${region.name} average`, crumbs, region, popEstimate: true }
}

export function resolveAdmin(frame: Frame, id: string): Resolved | null {
  const row = ADMIN1_TABLE.find((a) => a.id === id)
  const sim = frame.adminAreas?.find((a) => a.id === id)
  const iso = sim?.countryId ?? row?.country
  if (!iso || (!row && !sim)) return null
  const country = resolveCountry(frame, iso)
  const name = sim?.name ?? row!.name
  const crumbs: Crumb[] = [{ text: countryRow(iso)?.name ?? iso, sel: { kind: 'country', id: iso } }, ...(country?.crumbs ?? [])]
  if (sim) return { name, stats: sim.stats, crumbs, region: country?.region }
  if (!country) return null
  // no sim numbers for this state yet: its estimated population, everything else from its country
  return { name, stats: { ...country.stats, population: row!.population }, note: country.note ?? 'country average', crumbs, region: country.region, popEstimate: true }
}

export function seaInfo(frame: Frame, sel: { ocean: number; chokepoint?: string }) {
  const name = OCEAN_TABLE[sel.ocean]?.name ?? 'open ocean'
  const cp = sel.chokepoint ? CHOKEPOINTS.find((c) => c.id === sel.chokepoint) : undefined
  // shipping: an estimate from the economies of the nearest regions (real traffic arrives with B's geo layer)
  const at = cp ? latLonToVec3(cp.lat, cp.lon, 1) : null
  const near = at ? [...frame.regions].sort((a, b) => latLonToVec3(a.lat, a.lon, 1).distanceTo(at) - latLonToVec3(b.lat, b.lon, 1).distanceTo(at)).slice(0, 2) : []
  const war = near.some((r) => r.visual?.damage.kind === 'war' || r.unrest > 0.7) || frame.newEvents.some((e) => e.kind === 'war' && near.some((r) => r.id === e.regionId))
  const status = cp ? (war ? 'disrupted: fighting nearby' : 'open') : undefined
  const busy = cp ? (war ? 'thin' : 'heavy') : 'light'
  return { name, chokepoint: cp?.name, status, shipping: busy }
}

export const fmtPop = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)))

// the one-line hover: name and population, or the sea's name
export function hoverLine(frame: Frame, sel: PlaceSel): { title: string; text: string } | null {
  if (sel.kind === 'sea') { const s = seaInfo(frame, sel); return { title: s.name, text: s.chokepoint ? `${s.chokepoint}, ${s.status}` : 'open water' } }
  if (sel.kind === 'city') { const c = frame.cities.find((x) => x.id === sel.id); return c ? { title: c.name, text: `${fmtPop(c.population)} people` } : null }
  const r = sel.kind === 'country' ? resolveCountry(frame, sel.id) : resolveAdmin(frame, sel.id)
  return r ? { title: r.name, text: `${r.popEstimate ? 'about ' : ''}${fmtPop(r.stats.population)} people` } : null
}
