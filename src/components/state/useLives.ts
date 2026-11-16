'use client'
// lives for a world, fetched once per world through the server action, with a link builder
import { useEffect, useState } from 'react'
import { livesOf, type Lives, type LifeLink } from './lives'

const cache = new Map<string, Promise<Lives>>()
export function useLives(worldId: string | undefined): Lives | null {
  const [v, setV] = useState<Lives | null>(null)
  useEffect(() => {
    if (!worldId) return
    let stop = false
    if (!cache.has(worldId)) cache.set(worldId, livesOf(worldId))
    cache.get(worldId)!.then((x) => { if (!stop) setV(x) }).catch(() => {})
    return () => { stop = true }
  }, [worldId])
  return v
}

// the life born nearest a place, within about 150 km
export function lifeNear(l: Lives | null, lat: number, lon: number): LifeLink | undefined {
  if (!l) return undefined
  const rad = Math.PI / 180
  const km = (a: LifeLink) => 6371 * Math.acos(Math.min(1, Math.sin(lat * rad) * Math.sin(a.lat * rad) + Math.cos(lat * rad) * Math.cos(a.lat * rad) * Math.cos((lon - a.lon) * rad)))
  return [...l.lives].map((x) => ({ x, d: km(x) })).filter((y) => y.d < 150).sort((a, b) => a.d - b.d)[0]?.x
}
export const lifeHref = (l: Lives, life: LifeLink) => `${l.site}/live?life=${encodeURIComponent(life.lifeId)}`
