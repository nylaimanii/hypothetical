'use client'
// load budget: the place data (states, seas, country shapes) stays out of the first load.
// it is prefetched just after the planet paints, and fetched at once on the first hover or click if that comes sooner
import { useEffect, useState } from 'react'

export type GeoModule = typeof import('./resolve') & typeof import('./countries')
let mod: GeoModule | null = null
let pending: Promise<GeoModule> | null = null
const subs = new Set<(m: GeoModule) => void>()

export function loadGeo(): Promise<GeoModule> {
  if (mod) return Promise.resolve(mod)
  pending ??= Promise.all([import('./resolve'), import('./countries')]).then(([a, b]) => {
    mod = { ...a, ...b }
    for (const f of subs) f(mod)
    return mod
  })
  return pending
}
export const geoNow = () => mod

// re-renders once the data has arrived
export function useGeo(): GeoModule | null {
  const [m, setM] = useState<GeoModule | null>(mod)
  useEffect(() => {
    if (mod) return
    subs.add(setM)
    loadGeo()
    return () => { subs.delete(setM) }
  }, [])
  return m
}
