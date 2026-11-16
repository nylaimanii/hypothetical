'use client'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { latLonToVec3 } from './lib'
import { captionFor, shotScore, type FeedKind } from '../ui/events'
import { useCurrentFrame, useStore } from '../state/store'

type Candidate = { kind: FeedKind; regionId?: string; severity: number; text: string; score: number; at: number; tick?: number; force?: boolean; lat?: number; lon?: number; dist?: number }
type Shot = {
  c: Candidate
  phase: 'fly' | 'hold' | 'out'
  el: number // seconds spent in this phase, advanced by capped frame time so a stall never skips ahead
  replaced?: boolean
  fromDir: THREE.Vector3; fromDist: number
  toDir: THREE.Vector3; toDist: number
  fromAim: THREE.Vector3; toAim: THREE.Vector3 // orbit target, lifted toward the core for decisions
  dur: number
}

const HOLD = 3.5
const CORE_AIM = new THREE.Vector3(0, 8, 0)
const OUT = 2.8
const OUT_DIST = 44
const USER_PAUSE_MS = 10000
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

// flies the camera to the biggest thing happening, holds, drifts back out.
// any drag or zoom from the user pauses it for 10s
export default function Director() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const { frame, idx, mode } = useCurrentFrame()
  const juice = useStore((s) => s.juice)
  const shotReq = useStore((s) => s.shot)
  const shot = useRef<Shot | null>(null)
  const pending = useRef<Candidate | null>(null)
  const seenJuice = useRef(0)
  const lastIdx = useRef(idx)
  const frameRef = useRef(frame)
  frameRef.current = frame

  const active = (force = false) => {
    const s = useStore.getState()
    if (force) return true
    return s.director && s.playing && performance.now() > s.directorPausedUntil && frameRef.current.status !== 'destroyed'
  }
  const offer = (c: Candidate) => {
    if (!active(c.force)) return
    if (c.force) { pending.current = c; if (shot.current) shot.current = { ...shot.current, phase: 'out', el: 0, replaced: true }; return }
    if (!pending.current || c.score > pending.current.score) pending.current = c
  }

  // user input pauses the director and drops the current shot
  useEffect(() => {
    if (!controls) return
    const onStart = () => {
      useStore.getState().pauseDirector(USER_PAUSE_MS)
      if (shot.current) { shot.current = null; useStore.getState().setCaption(null) }
      pending.current = null
    }
    controls.addEventListener('start', onStart)
    return () => controls.removeEventListener('start', onStart)
  }, [controls])

  // frame events arrive through the juice stream (live injections too)
  useEffect(() => {
    const now = performance.now() / 1000
    for (const j of juice) {
      if (j.id <= seenJuice.current) continue
      seenJuice.current = j.id
      const injected = j.text === 'injected by you'
      const kind: FeedKind = injected ? 'injected' : j.kind
      const score = shotScore(kind, j.severity)
      if (score <= 0) continue
      offer({ kind: j.kind, regionId: j.regionId, severity: j.severity, text: j.text, score, at: now, tick: j.tick })
    }
  }, [juice]) // eslint-disable-line react-hooks/exhaustive-deps

  // the core deciding is a shot too
  useEffect(() => {
    if (lastIdx.current === idx) return
    lastIdx.current = idx
    if (mode !== 'ai') return
    // the core's decision in two short lines: what it saw -> what it chose, then why
    const rz = frame.decision?.reasoning
    if (frame.decision) offer({ kind: 'decision', severity: 0.4, text: rz ? `saw ${rz.saw[0]} → chose ${rz.chose[0]}\nwhy: ${rz.expected}` : frame.decision.rationale, score: shotScore('decision', 0.4), at: performance.now() / 1000 })
    // a crowd boiling over is worth a shot
    for (const r of frame.regions) for (const c of r.crowds ?? []) {
      if (c.phase === 'outraged' && c.sinceTick === frame.tick) offer({ kind: 'crowd', regionId: r.id, severity: c.intensity, text: `outraged over ${c.topic}`, score: shotScore('crowd', c.intensity), at: performance.now() / 1000 })
    }
  }, [idx, frame, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // explicit requests (event feed clicks) always fly
  useEffect(() => {
    if (!shotReq) return
    const f = frameRef.current
    const ev = f.newEvents.find((e) => e.regionId === shotReq.regionId)
    if (shotReq.target === 'place' && shotReq.lat !== undefined && shotReq.lon !== undefined) {
      offer({ kind: 'migration', severity: 0.3, text: shotReq.label ?? '', score: 99, at: performance.now() / 1000, force: true, lat: shotReq.lat, lon: shotReq.lon, dist: shotReq.dist })
      return
    }
    offer({
      kind: shotReq.target === 'core' ? 'decision' : (ev?.kind ?? 'migration'),
      regionId: shotReq.regionId, severity: ev?.severity ?? 0.5,
      text: shotReq.target === 'core' ? (f.decision?.rationale ?? '') : (ev?.text ?? ''),
      score: 99, at: performance.now() / 1000, force: true,
    })
  }, [shotReq]) // eslint-disable-line react-hooks/exhaustive-deps

  const aim = () => (controls ? controls.target.clone() : new THREE.Vector3())
  const look = (a: THREE.Vector3) => {
    if (controls) controls.target.copy(a)
    camera.lookAt(a)
  }

  const targetFor = (c: Candidate): { dir: THREE.Vector3; dist: number; aim: THREE.Vector3 } => {
    // a point on the planet (a country from the url)
    if (c.lat !== undefined && c.lon !== undefined) return { dir: latLonToVec3(c.lat, c.lon, 1).normalize(), dist: c.dist ?? 30, aim: new THREE.Vector3() }
    if (c.kind === 'decision' || !c.regionId) {
      const az = new THREE.Vector3(camera.position.x, 0, camera.position.z)
      if (az.lengthSq() < 1e-4) az.set(0, 0, 1)
      az.normalize()
      return { dir: az.multiplyScalar(Math.cos(0.42)).add(new THREE.Vector3(0, Math.sin(0.42), 0)).normalize(), dist: 40, aim: CORE_AIM.clone() }
    }
    const r = frameRef.current.regions.find((x) => x.id === c.regionId)
    if (!r) return { dir: camera.position.clone().normalize(), dist: OUT_DIST, aim: new THREE.Vector3() }
    return { dir: latLonToVec3(r.lat, r.lon, 1).add(new THREE.Vector3(0, 0.22, 0)).normalize(), dist: c.kind === 'launch' ? 27 : 24, aim: new THREE.Vector3() }
  }

  const start = (c: Candidate) => {
    const { dir, dist, aim: toAim } = targetFor(c)
    const fromDir = camera.position.clone().normalize()
    const angle = fromDir.angleTo(dir)
    shot.current = { c, phase: 'fly', el: 0, fromDir, fromDist: camera.position.length(), toDir: dir, toDist: dist, fromAim: aim(), toAim, dur: Math.min(3.4, 1.3 + angle * 0.9) }
  }

  // runs right after the orbit controls update, before the close zoom tilt
  useFrame((_, dt) => {
    const now = performance.now() / 1000
    const step = Math.min(dt, 1 / 30)
    const p = pending.current
    if (p && now - p.at > 6 && !p.force) pending.current = null
    const s = shot.current
    const ready = !s || s.phase === 'out' || (s.phase === 'hold' && s.el > HOLD)
    if (pending.current && ready && active(pending.current.force)) {
      start(pending.current)
      pending.current = null
    }
    const cur = shot.current
    if (!cur) {
      // after a core shot the orbit target eases home so user orbits stay centered
      if (controls && controls.target.lengthSq() > 0) look(controls.target.lengthSq() < 1e-4 ? new THREE.Vector3() : controls.target.clone().multiplyScalar(0.95))
      return
    }
    cur.el += step
    const t = cur.el
    if (cur.phase === 'fly') {
      const k = Math.min(1, t / cur.dur)
      const e = ease(k)
      const angle = cur.fromDir.angleTo(cur.toDir)
      const dir = slerpDir(cur.fromDir, cur.toDir, e)
      const dist = THREE.MathUtils.lerp(cur.fromDist, cur.toDist, e) + Math.sin(Math.PI * e) * angle * 5
      camera.position.copy(dir.multiplyScalar(dist))
      look(cur.fromAim.clone().lerp(cur.toAim, e))
      if (k >= 1) {
        shot.current = { ...cur, phase: 'hold', el: 0 }
        const cap = captionFor(cur.c.kind, cur.c.text, cur.c.severity, cur.c.regionId, frameRef.current, cur.c.tick)
        useStore.getState().setCaption(cap)
      }
    } else if (cur.phase === 'hold') {
      if (t > HOLD) {
        shot.current = { ...cur, phase: 'out', el: 0, fromDist: camera.position.length(), fromDir: camera.position.clone().normalize(), fromAim: aim(), toAim: new THREE.Vector3() }
        useStore.getState().setCaption(null)
      }
    } else {
      const k = Math.min(1, Math.max(0, t) / OUT)
      if (cur.replaced) { shot.current = null; return } // a forced shot takes over
      const to = Math.max(cur.fromDist, OUT_DIST)
      camera.position.copy(cur.fromDir.clone().multiplyScalar(THREE.MathUtils.lerp(cur.fromDist, to, ease(k))))
      look(cur.fromAim.clone().lerp(cur.toAim, ease(k)))
      if (k >= 1) shot.current = null
    }
  }, -0.5)

  return null
}

function slerpDir(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const qa = new THREE.Quaternion()
  const qb = new THREE.Quaternion().setFromUnitVectors(a, b)
  return a.clone().applyQuaternion(qa.slerp(qb, t))
}
