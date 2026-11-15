'use client'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import type { Frame } from '@/lib/types'
import { C, LAND_TOP, ZOOM_CLOSE, latLonToVec3, sceneRefs } from './lib'
import { useStore } from '../state/store'

// minimal shell: at most 5 names at once, biggest population first, only at mid zoom, fading as you come close.
// always mounted (drei Html roots can't unmount mid-render); hidden ones just go transparent
const MAX_LABELS = 5
export function Labels({ frame }: { frame: Frame }) {
  const select = useStore((s) => s.select)
  const camera = useThree((s) => s.camera)
  const refs = useRef<(HTMLDivElement | null)[]>([])
  const spots = useMemo(() => frame.regions.map((r) => ({ r, pos: latLonToVec3(r.lat, r.lon, LAND_TOP + 1.3), n: latLonToVec3(r.lat, r.lon, 1) })), [frame.regions])
  // bigger regions claim screen space first; a label that would overlap one already placed hides
  const order = useMemo(() => spots.map((_, i) => i).sort((a, b) => spots[b].r.population - spots[a].r.population), [spots])
  const shown = useRef<boolean[]>([])
  const acc = useRef(0)
  useFrame((_, dt) => {
    const c = camera.position.clone().normalize()
    acc.current += dt
    const relayout = acc.current > 0.12
    const zoom = useStore.getState().zoom
    // fade out on approach: full at mid distance, gone by the close threshold
    const near = Math.max(0, Math.min(1, (sceneRefs.camDist - ZOOM_CLOSE) / 6))
    if (relayout) {
      acc.current = 0
      const placed: DOMRect[] = []
      let count = 0
      for (const i of order) {
        const el = refs.current[i]
        const facing = spots[i].n.dot(c) > 0.15
        if (!el || !facing || zoom !== 'mid' || useStore.getState().overlay !== 'real' || count >= MAX_LABELS) { shown.current[i] = false; continue }
        const b = el.getBoundingClientRect()
        const pad = 4
        const hit = placed.some((p) => b.left - pad < p.right && b.right + pad > p.left && b.top - pad < p.bottom && b.bottom + pad > p.top)
        shown.current[i] = !hit
        if (!hit) { placed.push(b); count++ }
      }
    }
    spots.forEach((s, i) => {
      const el = refs.current[i]
      if (!el) return
      const face = Math.max(0, Math.min(1, (s.n.dot(c) - 0.15) * 3))
      const op = shown.current[i] ? face * near : 0
      el.style.opacity = String(op)
      el.style.pointerEvents = op > 0.5 ? 'auto' : 'none'
    })
  })
  return (
    <>
      {spots.map((s, i) => (
        <Html key={s.r.id} position={s.pos} center zIndexRange={[5, 0]}>
          <div ref={(el) => { refs.current[i] = el }} onClick={() => select({ kind: 'region', id: s.r.id })}
            style={{ opacity: 0 }} className="cursor-pointer select-none whitespace-nowrap rounded-full border border-ink/15 bg-bone/85 px-3 py-1 font-display text-[13px] text-ink shadow-sm backdrop-blur transition-opacity duration-200 hover:bg-bone">
            {s.r.name}
            {s.r.unrest > 0.6 && <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-ember align-middle" />}
          </div>
        </Html>
      ))}
    </>
  )
}

export function MigrationLines({ frame }: { frame: Frame }) {
  const zoom = useStore((s) => s.zoom)
  const lines = useMemo(() => (frame.decision?.migrations ?? []).flatMap((m) => {
    const a = frame.regions.find((r) => r.id === m.from), b = frame.regions.find((r) => r.id === m.to)
    if (!a || !b) return []
    const va = latLonToVec3(a.lat, a.lon, 1), vb = latLonToVec3(b.lat, b.lon, 1)
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 48; i++) {
      const t = i / 48
      pts.push(va.clone().lerp(vb, t).normalize().multiplyScalar(LAND_TOP + 0.08 + Math.sin(t * Math.PI) * 0.6))
    }
    return [{ key: m.from + m.to, pts }]
  }), [frame])
  const mats = useRef<(THREE.Material & { dashOffset?: number } | null)[]>([])
  useFrame((_, dt) => { for (const m of mats.current) if (m && 'dashOffset' in m) m.dashOffset = (m.dashOffset ?? 0) - dt * 0.6 })
  if (zoom === 'far' || !lines.length) return null
  return (
    <>
      {lines.map((l, i) => (
        <Line key={l.key} points={l.pts} color={C.ink} lineWidth={2} dashed dashSize={0.25} gapSize={0.18}
          ref={(ln) => { mats.current[i] = (ln?.material as THREE.Material & { dashOffset?: number }) ?? null }} />
      ))}
    </>
  )
}
