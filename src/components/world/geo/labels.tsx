'use client'
// a fixed pool of floating name labels, always mounted (drei Html roots must never unmount mid-render).
// each frame the owner decides which (up to 5) things get a name; text and position are written in place.
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { LAND_TOP } from '../lib'

export type LabelItem = { key: string; text: string; sub?: string; pos: THREE.Vector3; weight: number; onClick?: () => void }

const POOL = 5
const LABEL_CLS = 'cursor-pointer select-none whitespace-nowrap rounded-full border border-ink/15 bg-bone/90 px-3 py-1 font-display text-[13px] text-ink shadow-sm transition-opacity duration-200 hover:bg-bone'

// on our side of the planet and inside the view
export function useInView() {
  const camera = useThree((s) => s.camera)
  const fr = useMemo(() => new THREE.Frustum(), [])
  const pm = useMemo(() => new THREE.Matrix4(), [])
  return () => {
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    fr.setFromProjectionMatrix(pm)
    const d = camera.position.length()
    const dir = camera.position.clone().divideScalar(d)
    const horizon = Math.cos(Math.acos(Math.min(1, LAND_TOP / d)))
    return (p: THREE.Vector3) => p.clone().normalize().dot(dir) > horizon + 0.05 && fr.containsPoint(p)
  }
}

// items(): candidates; opacity(): overall fade (0 hides all). the 5 heaviest in view win, overlapping ones skip
export function LabelPool({ items, opacity }: { items: () => LabelItem[]; opacity: () => number }) {
  const camera = useThree((s) => s.camera)
  const groups = useRef<(THREE.Group | null)[]>([])
  const boxes = useRef<(HTMLDivElement | null)[]>([])
  const shown = useRef<(LabelItem | undefined)[]>([])
  const acc = useRef(1)
  const inView = useInView()
  useFrame((_, dt) => {
    const op = opacity()
    if (op <= 0.01) { boxes.current.forEach((b) => { if (b) { b.style.opacity = '0'; b.style.pointerEvents = 'none' } }); shown.current = []; acc.current = 1; return }
    acc.current += dt
    if (acc.current > 0.25) {
      acc.current = 0
      const vis = inView()
      const all = items().filter((x) => vis(x.pos)).sort((a, b) => b.weight - a.weight)
      const picked: LabelItem[] = [], scr: THREE.Vector3[] = []
      for (const x of all) {
        const p = x.pos.clone().project(camera)
        if (scr.some((q) => Math.abs(q.x - p.x) < 0.16 && Math.abs(q.y - p.y) < 0.06)) continue
        picked.push(x); scr.push(p)
        if (picked.length >= POOL) break
      }
      shown.current = picked
      for (let i = 0; i < POOL; i++) {
        const b = boxes.current[i], x = picked[i]
        if (!b) continue
        if (!x) { b.style.opacity = '0'; b.style.pointerEvents = 'none'; b.dataset.k = ''; continue }
        if (b.dataset.k !== x.key) {
          b.dataset.k = x.key
          const t = b.firstChild as HTMLSpanElement, s = b.lastChild as HTMLSpanElement
          t.textContent = x.text
          s.textContent = x.sub ?? ''
          s.style.display = x.sub ? '' : 'none'
        }
      }
    }
    shown.current.forEach((x, i) => {
      const g = groups.current[i], b = boxes.current[i]
      if (!x || !g || !b) return
      g.position.copy(x.pos)
      b.style.opacity = String(op)
      b.style.pointerEvents = op > 0.5 ? 'auto' : 'none'
    })
  })
  return (
    <>
      {Array.from({ length: POOL }, (_, i) => (
        <group key={i} ref={(g) => { groups.current[i] = g }}>
          <Html center zIndexRange={[5, 0]}>
            <div ref={(el) => { boxes.current[i] = el }} style={{ opacity: 0, pointerEvents: 'none' }} className={LABEL_CLS}
              onClick={() => shown.current[i]?.onClick?.()}>
              <span /><span className="ml-1.5 font-mono text-[10.5px] text-ink/55" style={{ display: 'none' }} />
            </div>
          </Html>
        </group>
      ))}
    </>
  )
}

// mid zoom fade: full between the close and far thresholds, gone outside
export function midFade(camDist: number, close: number, far: number) {
  const inner = Math.max(0, Math.min(1, (camDist - close) / 3))
  const outer = Math.max(0, Math.min(1, (far - camDist) / 4))
  return Math.min(inner, outer)
}
