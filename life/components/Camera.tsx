'use client'
// the camera never loses her. it is not an orbit control with a drifting target: every frame it is computed from
// where she is, at a yaw / pitch / distance the viewer controls (drag, scroll, presets), and then checked.
//   default: 3/4 front at chest height, pulled back to see what she is doing and who is around her
//   smooth: target and camera are damped; the yaw follows her heading slowly, so it re-frames when she turns
//   never inside or behind her head by default: minimum distance 0.9, front-facing default
//   walls: the camera stops in front of a building between it and her (except the one she is inside, which cuts away)
//   safety: an invalid position falls back to her last good spot (logged); if her head ever leaves the frame,
//   the camera snaps back to the framing (logged)
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { LiveState } from './ChosenPerson'
import type { WorldNow } from './Scene'

export type CamPreset = 'face' | 'shoulder' | 'side' | 'top' | 'wide'
export type Collider = { box: THREE.Box3; lotId: number }

const PRESETS: Record<CamPreset | 'default', { yaw: number; pitch: number; dist: number }> = {
  default: { yaw: 0.62, pitch: 0.2, dist: 3.4 },
  face: { yaw: 0.12, pitch: 0.06, dist: 0.95 },
  shoulder: { yaw: Math.PI - 0.45, pitch: 0.3, dist: 1.7 },
  side: { yaw: Math.PI / 2, pitch: 0.16, dist: 2.8 },
  top: { yaw: 0.4, pitch: 1.38, dist: 15 },
  wide: { yaw: 0.7, pitch: 0.55, dist: 20 },
}
const damp = (c: number, t: number, r: number, dt: number) => c + (t - c) * (1 - Math.exp(-r * dt))
const dampAngle = (c: number, t: number, r: number, dt: number) => c + Math.atan2(Math.sin(t - c), Math.cos(t - c)) * (1 - Math.exp(-r * dt))
const finite = (v: THREE.Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)

export default function LifeCamera({ live, preset, colliders, insideLot, focus, world, onUserCamera }: {
  live: React.RefObject<LiveState>; preset: { kind: CamPreset; at: number } | null
  colliders: React.RefObject<Collider[]>; insideLot: React.RefObject<number>
  focus: React.RefObject<{ id: string; until: number } | null>; world: React.RefObject<WorldNow>; onUserCamera: () => void
}) {
  const { camera, gl } = useThree()
  const s = useRef({ auto: 0, autoS: 0, autoDist: 0, yaw: PRESETS.default.yaw, pitch: PRESETS.default.pitch, dist: PRESETS.default.dist, want: { ...PRESETS.default }, heading: 0, started: false, lastGood: new THREE.Vector3(), target: new THREE.Vector3(), lost: 0 })
  const tmp = useMemo(() => ({ desired: new THREE.Vector3(), dir: new THREE.Vector3(), ray: new THREE.Ray(), hit: new THREE.Vector3(), ndc: new THREE.Vector3(), chest: new THREE.Vector3() }), [])

  // presets: animate the framing (yaw / pitch / distance), never the raw camera
  useEffect(() => { if (preset) s.current.want = { ...PRESETS[preset.kind] } }, [preset])

  // drag to rotate around her, scroll or pinch to zoom from her face out to the neighborhood
  useEffect(() => {
    const el = gl.domElement
    let down: { x: number; y: number } | null = null
    const pts = new Map<number, { x: number; y: number }>()
    let pinch = 0
    const onDown = (e: PointerEvent) => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); down = { x: e.clientX, y: e.clientY } }
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const S = s.current
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch) S.want.dist = Math.min(45, Math.max(0.9, S.want.dist * pinch / d))
        pinch = d
        onUserCamera()
        return
      }
      if (!down) return
      const dx = e.clientX - down.x, dy = e.clientY - down.y
      down = { x: e.clientX, y: e.clientY }
      S.want.yaw -= dx * 0.007
      S.want.pitch = Math.min(1.45, Math.max(-0.05, S.want.pitch + dy * 0.005))
      if (Math.abs(dx) + Math.abs(dy) > 2) onUserCamera()
    }
    const onUp = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (!pts.size) down = null }
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const S = s.current; S.want.dist = Math.min(45, Math.max(0.9, S.want.dist * Math.exp(e.deltaY * 0.0012))); onUserCamera() }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.style.touchAction = 'none'
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp); el.removeEventListener('wheel', onWheel) }
  }, [gl, onUserCamera])

  useFrame((_, rawDt) => {
    const L = live.current
    if (!L) return
    const S = s.current
    const dt = Math.min(rawDt, 0.05)

    // where she is: validated, with a fallback to the last good spot
    let head: THREE.Vector3 = L.head
    if (!finite(head) || Math.abs(head.x) > 500 || Math.abs(head.z) > 500) {
      console.error('[life camera] invalid position, holding her last known spot', { head: head.toArray(), pos: L.pos.toArray() })
      head = S.lastGood
    } else S.lastGood.copy(head)
    // a family card was clicked: swing to where that person is right now, for a few seconds, then back to her
    const f = focus.current
    const other = f && performance.now() < f.until ? world.current?.kinPos.get(f.id) : undefined
    if (f && !other && performance.now() >= f.until) focus.current = null
    if (other) head = other
    const height = Math.max(0.5, head.y)
    tmp.chest.copy(head)
    tmp.chest.y = head.y - height * 0.2
    if (L.walking) tmp.chest.addScaledVector(L.forward, 0.35)

    // framing follows her heading slowly (re-frames when she turns), plus whatever the viewer set
    S.heading = S.started ? dampAngle(S.heading, L.heading, 1.6, dt) : L.heading
    S.yaw = dampAngle(S.yaw, S.want.yaw, 6, dt)
    S.pitch = damp(S.pitch, S.want.pitch, 6, dt)
    S.dist = damp(S.dist, S.want.dist, 6, dt)
    // kids are smaller, so the default framing comes in a little (an 8 year old still fills the frame)
    const dist = other ? Math.max(4, S.dist) : Math.max(0.75, S.dist * Math.min(1, 0.6 + height / 2.2))
    // walls: in a dense city the camera looks for a clear line to her. it keeps the viewer's framing when that is
    // clear; otherwise it tries nearby angles (usually down the street she is on) and keeps the one it found until it
    // is blocked. never inside a building; if nothing is clear it comes closer, and the building in between cuts away
    const boxes = colliders.current ?? []
    const blocked = (yaw: number, d: number) => {
      const a = S.heading + yaw
      tmp.dir.set(Math.sin(a) * Math.cos(S.pitch), Math.sin(S.pitch), Math.cos(a) * Math.cos(S.pitch))
      tmp.desired.copy(tmp.chest).addScaledVector(tmp.dir, d)
      tmp.ray.origin.copy(tmp.chest); tmp.ray.direction.copy(tmp.dir)
      for (const c of boxes) {
        if (c.lotId === insideLot.current || c.box.containsPoint(tmp.chest)) continue
        if (c.box.containsPoint(tmp.desired)) return true
        if (tmp.ray.intersectBox(c.box, tmp.hit) && tmp.chest.distanceTo(tmp.hit) < d) return true
      }
      return false
    }
    // candidates, as yaw relative to her heading: the viewer's framing, then front angles, then a closer front,
    // then the sides; behind only as a last resort (the face matters more than the view)
    let d1 = dist
    if (S.pitch < 1.2 && !other) {
      if (blocked(S.yaw + S.auto, dist)) {
        const front = [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95]
        const tries: [number, number][] = [...front.map(y => [y, dist] as [number, number]), ...front.map(y => [y, dist * 0.65] as [number, number]), [1.4, dist], [-1.4, dist], [1.9, dist], [-1.9, dist], [Math.PI, dist]]
        const found = tries.find(([y, d]) => !blocked(y, d))
        if (found) { S.auto = found[0] - S.yaw; S.autoDist = found[1] }
      } else if (S.autoDist < dist && !blocked(S.yaw + S.auto, dist)) S.autoDist = dist
      d1 = Math.min(dist, S.autoDist || dist)
    } else { S.auto = 0; S.autoDist = 0 }
    S.autoS = dampAngle(S.autoS, S.auto, 3, dt)
    let d2 = d1
    if (blocked(S.yaw + S.autoS, d2)) { for (d2 = dist; d2 > 0.8 && blocked(S.yaw + S.autoS, d2); d2 -= 0.25); }
    blocked(S.yaw + S.autoS, Math.max(0.75, d2)) // leaves tmp.dir / tmp.desired at the chosen framing
    if (tmp.desired.y < 0.2) tmp.desired.y = 0.2

    // smooth follow, with snaps when far off (a speed switch, a move across the city, a fresh load)
    if (!S.started || camera.position.distanceTo(tmp.desired) > 25) {
      S.started = true
      camera.position.copy(tmp.desired)
      S.target.copy(tmp.chest)
    } else {
      camera.position.x = damp(camera.position.x, tmp.desired.x, 7, dt)
      camera.position.y = damp(camera.position.y, tmp.desired.y, 7, dt)
      camera.position.z = damp(camera.position.z, tmp.desired.z, 7, dt)
      S.target.x = damp(S.target.x, tmp.chest.x, 9, dt)
      S.target.y = damp(S.target.y, tmp.chest.y, 9, dt)
      S.target.z = damp(S.target.z, tmp.chest.z, 9, dt)
    }
    camera.lookAt(S.target)

    // she must be on screen. if her head is outside the frame for more than a few frames, snap
    if (other) return
    tmp.ndc.copy(head).project(camera)
    const off = !(Math.abs(tmp.ndc.x) < 1 && Math.abs(tmp.ndc.y) < 1 && tmp.ndc.z < 1)
    S.lost = off ? S.lost + 1 : 0
    if (S.lost > 3) {
      console.warn('[life camera] she left the frame, snapping back', { ndc: tmp.ndc.toArray() })
      camera.position.copy(tmp.desired)
      S.target.copy(tmp.chest)
      camera.lookAt(S.target)
      S.lost = 0
    }
  })
  return null
}
