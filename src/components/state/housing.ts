'use server'
// B's 2026 housing starting point per country (data/geo/housing.json: UN-Habitat urban slum share, UNHCR camp
// residents). the city view reads it to decide how much of a city is informal or a camp
import path from 'node:path'
import fs from 'node:fs'

export type HousingSeed = { slumUrbanShare: number; campResidents: number; renterShare: number }
let table: Map<string, HousingSeed> | null = null

export async function housingSeed(countryId: string): Promise<HousingSeed | null> {
  if (!/^[A-Z]{3}$/.test(countryId)) return null
  if (!table) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'geo', 'housing.json'), 'utf8')) as { countries: (HousingSeed & { id: string })[] }
      table = new Map(raw.countries.map((c) => [c.id, { slumUrbanShare: c.slumUrbanShare ?? 0, campResidents: c.campResidents ?? 0, renterShare: c.renterShare ?? 0 }]))
    } catch { table = new Map() }
  }
  return table.get(countryId) ?? null
}
