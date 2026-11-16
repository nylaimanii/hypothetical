'use client'
// streams the baked road and rail cells (public/geo/infra, see bake.ts) for what the camera can see at mid zoom.
// only cells on our side of the planet and inside the view load; at most ~40 stay cached, least recently seen go first.
// plants and hubs are one small file each, loaded once on first use.
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { R, ZOOM_CLOSE, ZOOM_FAR, latLonToVec3, sceneRefs } from '../../lib'

export type CellIndex = { cell: number; q: number; cells: { key: string; bbox: [number, number, number, number]; bytes: number }[] }
// road: [type 1 major | 2 secondary, country idx, coords]; rail: [country idx, coords]. coords are 0.01 deg ints, delta encoded
export type CellData = { key: string; q: number; countries: string[]; roads: [number, number, number[]][]; rail: [number, number[]][] }
export type PlantsFile = { q: number; fuels: string[]; plants: [string, string, string, number, number, number, number][] }
export type HubsFile = { q: number; airports: [string, string, string, number, number][]; ports: [string, string, number, number, number][] }

const BASE = '/geo/infra'
const MAX_CELLS = 40

const once = new Map<string, Promise<unknown>>()
export function loadJson<T>(url: string): Promise<T> {
  if (!once.has(url)) once.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() }).catch((e) => { once.delete(url); throw e }))
  return once.get(url) as Promise<T>
}

// [lon, lat] pairs from the delta encoded ints
export function decode(e: number[], q: number): [number, number][] {
  const out: [number, number][] = []
  let x = 0, y = 0
  for (let i = 0; i < e.length; i += 2) {
    if (i === 0) { x = e[0]; y = e[1] } else { x += e[i]; y += e[i + 1] }
    out.push([x / q, y / q])
  }
  return out
}

// mid zoom only: fades in below the far threshold, out before close (same as the crowd dots)
export function midFade() {
  const d = sceneRefs.camDist
  return THREE.MathUtils.clamp((ZOOM_FAR - d) / 3, 0, 1) * THREE.MathUtils.clamp((d - (ZOOM_CLOSE - 0.5)) / 3, 0, 1)
}

// is a lat/lon box on our side of the planet and in view?
const _f = new THREE.Frustum(), _m = new THREE.Matrix4(), _s = new THREE.Sphere()
function cellVisible(b: [number, number, number, number], cam: THREE.Camera) {
  const lat = (b[1] + b[3]) / 2, lon = (b[0] + b[2]) / 2
  const c = latLonToVec3(lat, lon, R)
  // a 15 degree cell spans about 0.19 rad; give its corners room past the horizon
  const d = cam.position.length()
  const horizon = Math.acos(Math.min(1, R / d))
  if (c.clone().normalize().angleTo(cam.position.clone().normalize()) > horizon + 0.2) return false
  _f.setFromProjectionMatrix(_m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
  return _f.intersectsSphere(_s.set(c, R * 0.16))
}

// the cells in view at mid zoom, loaded and cached; returns a stable array that changes only when the set changes
export function useInfraCells(): CellData[] {
  const camera = useThree((s) => s.camera)
  const [cells, setCells] = useState<CellData[]>([])
  const cache = useRef(new Map<string, { data: CellData; seen: number }>())
  const index = useRef<CellIndex | null>(null)
  const acc = useRef(1)
  const lastKey = useRef('')
  useEffect(() => { loadJson<CellIndex>(`${BASE}/index.json`).then((x) => { index.current = x }).catch(() => {}) }, [])
  useFrame((_, dt) => {
    acc.current += dt
    if (acc.current < 0.5) return
    acc.current = 0
    const idx = index.current
    if (!idx || midFade() <= 0) return
    const now = performance.now()
    const want = idx.cells.filter((c) => cellVisible(c.bbox, camera)).map((c) => c.key)
    for (const k of want) {
      const hit = cache.current.get(k)
      if (hit) { hit.seen = now; continue }
      loadJson<CellData>(`${BASE}/cells/${k}.json`).then((data) => {
        cache.current.set(k, { data, seen: performance.now() })
        // evict the least recently seen beyond the cap
        if (cache.current.size > MAX_CELLS) {
          const old = [...cache.current.entries()].sort((a, b) => a[1].seen - b[1].seen).slice(0, cache.current.size - MAX_CELLS)
          for (const [ok] of old) { cache.current.delete(ok); once.delete(`${BASE}/cells/${ok}.json`) }
        }
        acc.current = 1 // refresh the visible list next frame
      }).catch(() => {})
    }
    const have = want.filter((k) => cache.current.has(k))
    const key = have.join(',')
    if (key !== lastKey.current) { lastKey.current = key; setCells(have.map((k) => cache.current.get(k)!.data)) }
  })
  return cells
}

export function usePlants(): PlantsFile | null {
  const [p, setP] = useState<PlantsFile | null>(null)
  useEffect(() => { loadJson<PlantsFile>(`${BASE}/plants.json`).then(setP).catch(() => {}) }, [])
  return p
}
export function useHubs(): HubsFile | null {
  const [h, setH] = useState<HubsFile | null>(null)
  useEffect(() => { loadJson<HubsFile>(`${BASE}/hubs.json`).then(setH).catch(() => {}) }, [])
  return h
}

// traffic in frames is per country, in the order listed once on the first frame (trafficFrame in world-layer.ts)
export type Traffic = { countries?: string[]; road: number[]; rail: number[]; port: number[]; air: number[] }
export function trafficOf(frame: unknown): Traffic | null {
  const t = (frame as { traffic?: Traffic } | null)?.traffic
  return t && Array.isArray(t.road) ? t : null
}
// the hourly shape per mode, the same numbers the sim uses (HOURLY in world-layer.ts)
export const HOURLY = {
  road: [0.15, 0.1, 0.08, 0.08, 0.12, 0.3, 0.6, 0.95, 1, 0.75, 0.6, 0.6, 0.65, 0.62, 0.6, 0.65, 0.8, 1, 0.95, 0.7, 0.5, 0.4, 0.3, 0.2],
  rail: [0.05, 0.02, 0.02, 0.02, 0.05, 0.25, 0.7, 1, 0.95, 0.5, 0.4, 0.4, 0.45, 0.4, 0.4, 0.5, 0.8, 1, 0.9, 0.55, 0.35, 0.25, 0.15, 0.08],
  port: [0.7, 0.7, 0.7, 0.7, 0.75, 0.8, 0.9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.7],
  air: [0.2, 0.1, 0.05, 0.05, 0.1, 0.4, 0.8, 1, 1, 0.95, 0.9, 0.9, 0.9, 0.9, 0.9, 0.95, 1, 1, 0.95, 0.85, 0.7, 0.55, 0.4, 0.3],
}
