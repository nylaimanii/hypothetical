'use client'
// the real city behind the city view: its row in the baked city index and its GHSL cells (built share, mean
// building height, population class at 0.05 degrees). the plate is the city's core; the surround continues the
// street grid out to the horizon and samples the real cells outward, so skylines fall off the way the city does
import { useEffect, useState } from 'react'
import type { City, Frame } from '@/lib/types'
import { cellsOf, groupLoaded, loadGroup, loadIndex, type CityCell, type CityRow } from '../real/cities/data'
import { housingSeed, type HousingSeed } from '../../state/housing'

export type CityProfile = {
  row: CityRow
  cells: CityCell[]
  core: { heightM: number; built: number; popC: number } // the densest cells near the centre
  seed: HousingSeed | null
}

// a frame city for a real city id (the sim only founds a few cities of its own)
export function cityFromRow(row: CityRow, frame: Frame): City {
  const resident = frame.citizens.find((c) => (c as { cityId?: string }).cityId === row.id)
  // the region: a resident's, else the nearest region centre
  let regionId = resident?.regionId
  if (!regionId) {
    let best = Infinity
    for (const r of frame.regions) { const d = (r.lat - row.lat) ** 2 + (r.lon - row.lon) ** 2; if (d < best) { best = d; regionId = r.id } }
  }
  return { id: row.id, name: row.name, regionId: regionId ?? frame.regions[0]?.id ?? '', lat: row.lat, lon: row.lon, foundedTick: 0, population: row.pop, reason: '', countryId: row.country, real: true }
}

export function useCityProfile(cityId: string | null): CityProfile | null {
  const [p, setP] = useState<CityProfile | null>(null)
  useEffect(() => {
    if (!cityId) return
    let stop = false
    loadIndex().then(async (idx) => {
      const row = idx.find((c) => c.id === cityId)
      if (!row) { if (!stop) setP(null); return }
      if (!groupLoaded(row.group)) await loadGroup(row.group)
      const cells = cellsOf(row.id) ?? []
      const seed = await housingSeed(row.country).catch(() => null)
      if (stop) return
      setP({ row, cells, core: coreOf(row, cells), seed })
    })
    return () => { stop = true }
  }, [cityId])
  return p && p.row.id === cityId ? p : null
}

const KM_PER_DEG = 111.2
export function coreOf(row: CityRow, cells: CityCell[]) {
  if (!cells.length) return { heightM: 8, built: 0.4, popC: 4 }
  const cl = Math.cos((row.lat * Math.PI) / 180)
  const near = cells.map((c) => ({ c, d: Math.hypot(c.lat - row.lat, (c.lon - row.lon) * cl) * KM_PER_DEG })).sort((a, b) => a.d - b.d).slice(0, 3)
  // the tallest of the three cells nearest the centre: the city's downtown
  const top = near.reduce((a, b) => (b.c.heightM > a.c.heightM ? b : a)).c
  return { heightM: top.heightM, built: top.built, popC: top.popC }
}

// the real cell under a point km east (dx) and km north (dz) of the city centre; null where nothing is built
export function cellAt(p: CityProfile, dxKm: number, dzKm: number): CityCell | null {
  const lat = p.row.lat + dzKm / KM_PER_DEG
  const lon = p.row.lon + dxKm / (KM_PER_DEG * Math.cos((p.row.lat * Math.PI) / 180))
  let best: CityCell | null = null, bd = 0.04 * 0.04
  for (const c of p.cells) { const d = (c.lat - lat) ** 2 + (c.lon - lon) ** 2; if (d < bd) { bd = d; best = c } }
  return best
}
