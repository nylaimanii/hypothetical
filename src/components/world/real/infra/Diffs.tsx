'use client'
// the sim's changes drawn on top of the real world (B's InfraDiff, up to the playhead): new rail in the agent's accent
// color, new and growing cities rising as block clusters, damaged cities with rubble. positions come from the frame's
// own cities and regions; a diff that can't be placed is skipped. up to 3 explain callouts tell why, in B's words.
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Agent, Frame } from '@/lib/types'
import type { InfraDiff } from '@/lib/types-v5'
import { archStyleFor } from '@/lib/mock/v3'
import { groundRadius, latLonToVec3, toonGradient } from '../../lib'
import { useStore } from '../../../state/store'
import { useCallouts, type Callout } from '../../explain'
import { midFade, usePlants } from './stream'
import { useInfraDiffs } from './infraDiffs'

const Y = new THREE.Vector3(0, 1, 0)
const yearOf = (tick: number) => 2026 + Math.floor((tick + 10) / 12)
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler()
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296 }

type Block = { pos: THREE.Vector3; quat: THREE.Quaternion; w: number; h: number; key: string; tick: number; accent: boolean }
type Rubble = { pos: THREE.Vector3; quat: THREE.Quaternion; s: number }

export default function Diffs({ frame, agent }: { frame: Frame; agent?: Agent }) {
  const { diffs } = useInfraDiffs()
  const plants = usePlants()
  const recordAgent = useStore((s) => s.record.agentId)
  const accent = useMemo(() => new THREE.Color((agent?.archStyle ?? archStyleFor(agent?.id ?? recordAgent)).accent), [agent, recordAgent])
  const group = useRef<THREE.Group>(null)
  const blockRef = useRef<THREE.InstancedMesh>(null), rubbleRef = useRef<THREE.InstancedMesh>(null)
  const firstSeen = useRef(new Map<string, number>())

  // where things are: the frame's cities (B's real city ids) and region centers
  const where = useMemo(() => {
    const m = new Map<string, { lat: number; lon: number; name: string }>()
    for (const r of frame.regions) m.set(r.id, { lat: r.lat, lon: r.lon, name: r.name })
    for (const c of frame.cities) if (!c.offWorld) m.set(c.id, { lat: c.lat, lon: c.lon, name: c.name })
    return m
  }, [frame.regions, frame.cities])

  // the latest state per city, and every rail line built so far
  const { blocks, rubble, rails } = useMemo(() => {
    const cityLast = new Map<string, Extract<InfraDiff, { kind: 'city' }>>()
    const rails: Extract<InfraDiff, { kind: 'rail' }>[] = []
    for (const d of diffs) {
      if (d.kind === 'city') cityLast.set(d.id, d)
      if (d.kind === 'rail' && d.op === 'built') rails.push(d)
    }
    const blocks: Block[] = [], rubble: Rubble[] = []
    for (const [id, d] of cityLast) {
      const at = where.get(id)
      if (!at) continue
      const up = latLonToVec3(at.lat, at.lon, 1).normalize()
      const base = new THREE.Quaternion().setFromUnitVectors(Y, up)
      const east = new THREE.Vector3().crossVectors(Y, up).normalize()
      if (east.lengthSq() < 1e-6) east.set(1, 0, 0)
      const north = new THREE.Vector3().crossVectors(up, east)
      if (d.op === 'grew' || d.op === 'founded') {
        // a cluster of new blocks around the city, more for bigger places
        const n = Math.min(9, 3 + Math.round(Math.log10(Math.max(10, d.population)) - 4))
        for (let k = 0; k < n; k++) {
          const a = hash(`${id}${k}`) * Math.PI * 2, r = 0.03 + hash(`${id}r${k}`) * 0.08
          const p = up.clone().addScaledVector(east, Math.cos(a) * r / 10).addScaledVector(north, Math.sin(a) * r / 10).normalize()
          blocks.push({ pos: p.multiplyScalar(groundRadius(p)), quat: base, w: 0.025 + hash(`${id}w${k}`) * 0.02, h: 0.04 + hash(`${id}h${k}`) * 0.1, key: `${id}:${d.tick}`, tick: d.tick, accent: d.op === 'founded' })
        }
      }
      if (d.op === 'damaged' && (d.damage ?? 0) > 0.05) {
        const n = Math.min(14, Math.round(4 + (d.damage ?? 0) * 12))
        for (let k = 0; k < n; k++) {
          const a = hash(`${id}d${k}`) * Math.PI * 2, r = hash(`${id}dr${k}`) * 0.1
          const p = up.clone().addScaledVector(east, Math.cos(a) * r / 10).addScaledVector(north, Math.sin(a) * r / 10).normalize()
          rubble.push({ pos: p.multiplyScalar(groundRadius(p) + 0.004), quat: base.clone().multiply(new THREE.Quaternion().setFromEuler(_e.set(hash(`${k}x${id}`) * 0.8, hash(`${k}y${id}`) * 3, hash(`${k}z${id}`) * 0.8))), s: 0.012 + hash(`${id}s${k}`) * 0.02 })
        }
      }
    }
    return { blocks, rubble, rails }
  }, [diffs, where])

  // new rail: one merged tube in the agent's accent color
  const railGeo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    for (const d of rails) {
      const a = where.get(d.from), b = where.get(d.to)
      if (!a || !b) continue
      const va = latLonToVec3(a.lat, a.lon, 1).normalize(), vb = latLonToVec3(b.lat, b.lon, 1).normalize()
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 24; i++) { const t = i / 24; const v = va.clone().lerp(vb, t).normalize(); pts.push(v.multiplyScalar(groundRadius(v) + 0.03 + Math.sin(t * Math.PI) * 0.05)) }
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.012, 5, false))
    }
    if (!parts.length) return null
    const g = parts.length === 1 ? parts[0] : mergeGeometries(parts)!
    g.computeBoundingSphere()
    return g
  }, [rails, where])
  const railMat = useMemo(() => new THREE.MeshToonMaterial({ gradientMap: toonGradient() }), [])
  useLayoutEffect(() => { railMat.color.copy(accent); railMat.emissive.copy(accent).multiplyScalar(0.25) }, [railMat, accent])

  // rubble never moves: written once
  useLayoutEffect(() => {
    const m = rubbleRef.current
    if (!m) return
    rubble.forEach((r, i) => m.setMatrixAt(i, _m.compose(r.pos, r.quat, _s.set(r.s, r.s * 0.6, r.s))))
    m.count = rubble.length
    m.instanceMatrix.needsUpdate = true
  }, [rubble])

  useFrame(() => {
    const g = group.current
    if (!g) return
    const fade = midFade()
    g.visible = fade > 0.01 && (blocks.length > 0 || rubble.length > 0 || !!railGeo)
    if (!g.visible) return
    const m = blockRef.current
    if (!m) return
    const now = performance.now() / 1000
    const col = new THREE.Color()
    blocks.forEach((b, i) => {
      // a short rise the first time a change is seen
      if (!firstSeen.current.has(b.key)) firstSeen.current.set(b.key, now)
      const rise = Math.min(1, (now - firstSeen.current.get(b.key)!) / 1.6)
      _p.copy(b.pos).addScaledVector(b.pos.clone().normalize(), (b.h * rise) / 2)
      _q.copy(b.quat)
      m.setMatrixAt(i, _m.compose(_p, _q, _s.set(b.w, Math.max(0.001, b.h * rise), b.w)))
      m.setColorAt(i, b.accent ? accent : col.set('#E9E2D3'))
    })
    m.count = blocks.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  // up to 3 callouts, most recent first, in B's words (the diff's `because`)
  const callouts = useMemo<Callout[]>(() => {
    const out: Callout[] = []
    const plantById = new Map((plants?.plants ?? []).map((p) => [p[0], p]))
    for (const d of [...diffs].reverse()) {
      if (out.length >= 3) break
      if (d.kind === 'plant' && d.op === 'retired') {
        const p = plantById.get(d.id)
        if (!p || !plants) continue
        const lat = p[3] / plants.q, lon = p[4] / plants.q
        const up = latLonToVec3(lat, lon, 1).normalize()
        out.push({ id: `infra-${d.id}`, pos: up.multiplyScalar(groundRadius(up) + 0.08), title: `${p[1]} retired`, text: `${plants.fuels[p[5]]}, ${p[6].toLocaleString('en-US')} MW, ${yearOf(d.tick)}. ${d.because}`, weight: 2 })
      } else if (d.kind === 'plant' && d.op === 'built') {
        const up = latLonToVec3(d.lat, d.lon, 1).normalize()
        out.push({ id: `infra-${d.id}`, pos: up.multiplyScalar(groundRadius(up) + 0.08), title: `new ${d.fuel} plant`, text: `${d.mw.toLocaleString('en-US')} MW, ${yearOf(d.tick)}. ${d.because}`, weight: 2 })
      } else if (d.kind === 'city' && (d.op === 'damaged' || d.op === 'founded' || d.op === 'grew')) {
        const at = where.get(d.id)
        if (!at) continue
        const up = latLonToVec3(at.lat, at.lon, 1).normalize()
        out.push({ id: `infra-${d.id}-${d.tick}`, pos: up.multiplyScalar(groundRadius(up) + 0.1), title: `${at.name} ${d.op}`, text: `${yearOf(d.tick)}. ${d.because}`, weight: d.op === 'damaged' ? 3 : 1, danger: d.op === 'damaged' })
      } else if (d.kind === 'rail' && d.op === 'built') {
        const a = where.get(d.from), b = where.get(d.to)
        if (!a || !b) continue
        const up = latLonToVec3((a.lat + b.lat) / 2, (a.lon + b.lon) / 2, 1).normalize()
        out.push({ id: `infra-${d.id}`, pos: up.multiplyScalar(groundRadius(up) + 0.1), title: `new rail: ${a.name} to ${b.name}`, text: `${yearOf(d.tick)}. ${d.because}`, weight: 2 })
      }
    }
    return out
  }, [diffs, plants, where])
  useCallouts('infra', callouts)

  return (
    <group ref={group} visible={false}>
      <instancedMesh key={`b${blocks.length}`} ref={blockRef} args={[undefined, undefined, Math.max(1, blocks.length)]} frustumCulled={false} raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshToonMaterial gradientMap={toonGradient()} />
      </instancedMesh>
      <instancedMesh key={`r${rubble.length}`} ref={rubbleRef} args={[undefined, undefined, Math.max(1, rubble.length)]} frustumCulled={false} raycast={() => null}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshToonMaterial color="#5C5650" gradientMap={toonGradient()} />
      </instancedMesh>
      {railGeo && <mesh geometry={railGeo} material={railMat} raycast={() => null} />}
    </group>
  )
}
