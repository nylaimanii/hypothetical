'use client'
// client side of the places actions: one request per run and year, shared by every component that asks
import { useEffect, useState } from 'react'
import { countriesYear, placeYear, type CountriesYear, type PlaceYear } from './places'

const yearOf = (tick: number) => Math.floor(tick / 12) * 12
const cy = new Map<string, Promise<CountriesYear | null>>()
const py = new Map<string, Promise<PlaceYear | null>>()
const known = new Map<string, CountriesYear | null>()

export function useCountriesYear(runId: string, tick: number, skip = false): CountriesYear | null {
  const key = `${runId}:${yearOf(tick)}`
  const [v, setV] = useState<{ key: string; val: CountriesYear | null } | null>(known.has(key) ? { key, val: known.get(key)! } : null)
  useEffect(() => {
    if (skip) return
    let stop = false
    if (!cy.has(key)) cy.set(key, countriesYear(runId, yearOf(tick)).catch(() => null))
    cy.get(key)!.then((x) => { known.set(key, x); if (!stop) setV({ key, val: x }) })
    return () => { stop = true }
  }, [key, runId, tick, skip])
  return v && v.key === key ? v.val : null
}

export function usePlaceYear(runId: string, tick: number, kind: 'country' | 'admin' | 'city', id: string): PlaceYear | null | undefined {
  const key = `${runId}:${yearOf(tick)}:${kind}:${id}`
  const [v, setV] = useState<{ key: string; val: PlaceYear | null } | null>(null)
  useEffect(() => {
    let stop = false
    if (!py.has(key)) py.set(key, placeYear(runId, yearOf(tick), kind, id).catch(() => null))
    py.get(key)!.then((x) => { if (!stop) setV({ key, val: x }) })
    return () => { stop = true }
  }, [key, runId, tick, kind, id])
  // undefined = still loading, null = this run has no places data for it
  return v && v.key === key ? v.val : undefined
}
