'use client'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import type { Frame } from '@/lib/types'
import { C, LAND_TOP, latLonToVec3 } from './lib'
import { useStore } from '../state/store'

export function Labels({ frame }: { frame: Frame }) {
  const zoom = useStore((s) => s.zoom)
  const select = useStore((s) => s.select)
  const camera = useThree((s) => s.camera)
  const refs = useRef<(HTMLDivElement | null)[]>([])
  const spots = useMemo(() => frame.regions.map((r) => ({ r, pos: latLonToVec3(r.lat, r.lon, LAND_TOP + 1.3), n: latLonToVec3(r.lat, r.lon, 1) })), [frame.regions])
  useFrame(() => {
    const c = camera.position.clone().normalize()
    spots.forEach((s, i) => {
      const el = refs.current[i]
      if (!el) return
      const d = s.n.dot(c)
      el.style.opacity = String(Math.max(0, Math.min(1, (d - 0.15) * 3)))
      el.style.pointerEvents = d > 0.3 ? 'auto' : 'none'
    })
  })
  if (zoom !== 'mid') return null
  return (
    <>
      {spots.map((s, i) => (
        <Html key={s.r.id} position={s.pos} center zIndexRange={[20, 0]}>
          <div ref={(el) => { refs.current[i] = el }} onClick={() => select({ kind: 'region', id: s.r.id })}
            className="cursor-pointer select-none whitespace-nowrap rounded-full border border-ink/15 bg-bone/85 px-3 py-1 font-display text-[13px] text-ink shadow-sm backdrop-blur transition-opacity hover:bg-bone">
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
