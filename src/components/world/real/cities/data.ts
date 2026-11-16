'use client'
// the baked city heightfields (public/geo/cities, made by bake.ts from GHSL via data/geo): an index of every city
// over 1M people plus every capital, and per region files of cells, fetched only when a city there is in view
export type CityRow = { id: string; name: string; lat: number; lon: number; pop: number; country: string; group: string; n: number }
// one cell, decoded: centre in degrees, built fraction 0..1, mean building height in meters, population class 0..7
export type CityCell = { lat: number; lon: number; built: number; heightM: number; popC: number }

let indexP: Promise<CityRow[]> | null = null
let indexNow: CityRow[] | null = null
const groups = new Map<string, Promise<void>>()
const done = new Set<string>()
const cells = new Map<string, CityCell[]>()

export function loadIndex(): Promise<CityRow[]> {
  indexP ??= fetch('/geo/cities/index.json').then((r) => (r.ok ? r.json() : { cities: [] })).then((b: { cities: CityRow[] }) => { indexNow = b.cities ?? []; return indexNow }).catch(() => { indexNow = []; return [] })
  return indexP
}
export const indexLoaded = () => indexNow

function decode(raw: { lat0: number; lon0: number; res: number; d: string }): CityCell[] {
  const bin = atob(raw.d)
  const out: CityCell[] = []
  for (let i = 0; i + 3 < bin.length; i += 4) {
    const a = bin.charCodeAt(i), y = bin.charCodeAt(i + 1), built = bin.charCodeAt(i + 2), h = bin.charCodeAt(i + 3)
    const x = a & 31
    out.push({ lat: raw.lat0 - (y + 0.5) * raw.res, lon: raw.lon0 + (x + 0.5) * raw.res, built: built / 255, heightM: h, popC: a >> 5 })
  }
  return out
}

export function loadGroup(key: string): Promise<void> {
  let p = groups.get(key)
  if (!p) {
    p = fetch(`/geo/cities/${encodeURIComponent(key)}.json`).then((r) => (r.ok ? r.json() : { cities: {} })).then((b: { cities: Record<string, { lat0: number; lon0: number; res: number; d: string }> }) => {
      for (const [id, raw] of Object.entries(b.cities ?? {})) cells.set(id, decode(raw))
      done.add(key)
    }).catch(() => { done.add(key) })
    groups.set(key, p)
  }
  return p
}
export const groupLoaded = (key: string) => done.has(key)
export const cellsOf = (id: string) => cells.get(id)

// how urban a spot is (0..1) from what has been loaded: the built fraction of the nearest baked cell within about
// one cell, fading out over half a degree beyond a loaded city's cells. 0 when nothing near is loaded.
export function cityDetailAt(lat: number, lon: number): number {
  const idx = indexNow
  if (!idx) return 0
  let best = 0
  const cl = Math.cos((lat * Math.PI) / 180)
  for (const c of idx) {
    if (Math.abs(c.lat - lat) > 0.7 || Math.abs(c.lon - lon) * cl > 0.7) continue
    const cs = cells.get(c.id)
    if (!cs) {
      // not loaded yet: a rough guess from the city's size and distance
      const d = Math.hypot(c.lat - lat, (c.lon - lon) * cl)
      best = Math.max(best, Math.max(0, 1 - d / 0.5) * Math.min(1, 0.3 + Math.sqrt(c.pop / 37e6)))
      continue
    }
    for (const cell of cs) {
      const d = Math.hypot(cell.lat - lat, (cell.lon - lon) * cl)
      if (d < 0.08) best = Math.max(best, cell.built * Math.max(0, 1 - d / 0.08) + cell.built * 0.3)
    }
  }
  return Math.min(1, best)
}
