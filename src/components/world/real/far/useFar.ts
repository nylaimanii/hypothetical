'use client'
// far-zoom real data (baked by bake.ts into public/geo/far): fetched once, on first use, cached for the session
import { useEffect, useState } from 'react'

export type FarTiles = { n: number; classes: string[]; cls: string; lit: string; pop: string; built: string }
export type Hubs = {
  airports: [string, string, number, number, number][] // code, country iso3, lat, lon, busyness (millions of people nearby)
  ports: [string, number, number, number][] // name, lat, lon, natural earth scalerank
  air: [number, number][]
  sea: [number, number][]
}

let tiles: FarTiles | null = null
let hubs: Hubs | null = null
let pTiles: Promise<FarTiles | null> | null = null
let pHubs: Promise<Hubs | null> | null = null
const get = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null)

export function loadFarTiles() { pTiles ??= get<FarTiles>('/geo/far/tiles.json').then((t) => (tiles = t)); return pTiles }
export function loadHubs() { pHubs ??= get<Hubs>('/geo/far/hubs.json').then((h) => (hubs = h)); return pHubs }
export const farTilesNow = () => tiles

export function useFarTiles(): FarTiles | null {
  const [t, setT] = useState<FarTiles | null>(tiles)
  useEffect(() => { if (!tiles) loadFarTiles().then((x) => setT(x)) }, [])
  return t
}
export function useHubs(): Hubs | null {
  const [h, setH] = useState<Hubs | null>(hubs)
  useEffect(() => { if (!hubs) loadHubs().then((x) => setH(x)) }, [])
  return h
}

// decoded per tile values
export const tileClass = (t: FarTiles, i: number) => parseInt(t.cls[i] ?? '0', 36)
export const tileLights = (t: FarTiles, i: number) => parseInt(t.lit[i] ?? '0', 36) / 35 // 0..1
export const tilePeople = (t: FarTiles, i: number) => { const v = parseInt(t.pop[i] ?? '0', 36); return v ? Math.pow(10, v / 3.5) : 0 }
export const tileBuilt = (t: FarTiles, i: number) => parseInt(t.built[i] ?? '0', 36) / 35
