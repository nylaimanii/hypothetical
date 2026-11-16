'use client'
// real power plants (WRI global power plant database via B's data/geo) at their real spots, by fuel, sized by MW.
// coal/gas/oil: dark stacks and smoke. nuclear: rounded cooling towers and steam. solar: glinting panel fields.
// wind: chunky turbines. hydro: dam blocks. other: a small block. retired plants (InfraDiff) crumble grey;
// plants the sim builds rise into place. one instanced mesh per kind, plus one for smoke and steam.
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Frame } from '@/lib/types'
import { groundRadius, latLonToVec3, toonGradient } from '../../lib'
import { useStore } from '../../../state/store'
import { midFade, usePlants } from './stream'
import { useInfraDiffs } from './infraDiffs'

type Kind = 'fossil' | 'nuclear' | 'solar' | 'wind' | 'hydro' | 'other'
const KINDS: Kind[] = ['fossil', 'nuclear', 'solar', 'wind', 'hydro', 'other']
const kindOf = (fuel: string): Kind => (fuel === 'coal' || fuel === 'gas' || fuel === 'oil' ? 'fossil' : (KINDS as string[]).includes(fuel) ? (fuel as Kind) : 'other')
type Site = { id: string; name: string; fuel: string; mw: number; kind: Kind; pos: THREE.Vector3; up: THREE.Vector3; quat: THREE.Quaternion; scale: number; retired: boolean; builtTick?: number }

const tilt = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z)
// merged, low poly, original clay shapes; unit size, y up
function shapes(): Record<Kind, THREE.BufferGeometry> {
  const fossil = mergeGeometries([
    tilt(new THREE.BoxGeometry(0.11, 0.05, 0.08), 0, 0.025, 0),
    tilt(new THREE.CylinderGeometry(0.012, 0.016, 0.16, 8), 0.03, 0.08, 0.02),
    tilt(new THREE.CylinderGeometry(0.012, 0.016, 0.13, 8), -0.025, 0.065, -0.015),
  ])!
  const towerProfile = [0.045, 0.04, 0.03, 0.026, 0.028, 0.032].map((r, i) => new THREE.Vector2(r, i * 0.022))
  const nuclear = mergeGeometries([
    tilt(new THREE.LatheGeometry(towerProfile, 10), -0.03, 0, 0),
    tilt(new THREE.LatheGeometry(towerProfile.map((v) => v.clone().multiplyScalar(0.85)), 10), 0.04, 0, 0.02),
    tilt(new THREE.SphereGeometry(0.03, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0.005, 0, -0.045),
  ])!
  const panel = (x: number, z: number) => tilt(new THREE.BoxGeometry(0.035, 0.006, 0.02).rotateX(-0.35), x, 0.01, z)
  const solar = mergeGeometries([panel(-0.04, -0.03), panel(0, -0.03), panel(0.04, -0.03), panel(-0.04, 0.01), panel(0, 0.01), panel(0.04, 0.01)])!
  const blade = (a: number) => new THREE.BoxGeometry(0.008, 0.07, 0.004).translate(0, 0.035, 0).rotateZ(a).translate(0, 0.13, 0.008)
  const wind = mergeGeometries([new THREE.CylinderGeometry(0.004, 0.007, 0.13, 6).translate(0, 0.065, 0), blade(0), blade((Math.PI * 2) / 3), blade((Math.PI * 4) / 3)])!
  const hydro = mergeGeometries([tilt(new THREE.BoxGeometry(0.14, 0.06, 0.03), 0, 0.03, 0), tilt(new THREE.BoxGeometry(0.03, 0.02, 0.05), 0.04, 0.07, 0)])!
  const other = tilt(new THREE.BoxGeometry(0.05, 0.04, 0.05), 0, 0.02, 0)
  return { fossil, nuclear, solar, wind, hydro, other }
}
const COLOR: Record<Kind, string> = { fossil: '#4A4440', nuclear: '#E7E1D4', solar: '#2E4A6B', wind: '#F1EEE6', hydro: '#9C968B', other: '#8F887C' }
const RETIRED = new THREE.Color('#8E8A84')

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _r = new THREE.Quaternion()
const Y = new THREE.Vector3(0, 1, 0)

// where a plant sits: retired ones slump and lose height, turbines face a varied way, new ones scale up by `rise`
function placeMatrix(s: Site, rise: number) {
  _q.copy(s.quat)
  if (s.kind === 'wind' && !s.retired) _q.multiply(_r.setFromEuler(_e.set(0, (s.mw * 0.37) % 6.28, 0)))
  if (s.retired) _q.multiply(_r.setFromEuler(_e.set(0.35, 0, 0.2)))
  const sc = s.scale * (s.retired ? 0.8 : 1)
  return _m.compose(s.pos, _q, _s.set(sc, sc * rise * (s.retired ? 0.45 : 1), sc))
}

export default function Plants({ frame }: { frame: Frame }) {
  void frame
  const file = usePlants()
  const { diffs, tick } = useInfraDiffs()
  const geos = useMemo(() => shapes(), [])
  const mats = useMemo(() => Object.fromEntries(KINDS.map((k) => [k, new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...(k === 'solar' ? { emissive: new THREE.Color('#1B3350') } : {}) })])) as Record<Kind, THREE.MeshToonMaterial>, [])
  const refs = useRef<Partial<Record<Kind, THREE.InstancedMesh | null>>>({})
  const puffRef = useRef<THREE.InstancedMesh>(null)
  const group = useRef<THREE.Group>(null)
  const firstSeen = useRef(new Map<string, number>())

  // every site: the baked plants (retired ones marked), plus the plants the sim built
  const sites = useMemo(() => {
    const out: Site[] = []
    if (!file) return out
    const retired = new Set(diffs.filter((d) => d.kind === 'plant' && d.op === 'retired').map((d) => d.id))
    const place = (lat: number, lon: number) => {
      const up = latLonToVec3(lat, lon, 1).normalize()
      return { up, pos: up.clone().multiplyScalar(groundRadius(up) + 0.004), quat: new THREE.Quaternion().setFromUnitVectors(Y, up) }
    }
    for (const [id, name, , lat, lon, fi, mw] of file.plants) {
      const fuel = file.fuels[fi] ?? 'other'
      out.push({ id, name, fuel, mw, kind: kindOf(fuel), ...place(lat / file.q, lon / file.q), scale: Math.min(1.1, 0.28 + Math.sqrt(mw / 1000) * 0.38), retired: retired.has(id) })
    }
    for (const d of diffs) if (d.kind === 'plant' && d.op === 'built') out.push({ id: d.id, name: `new ${d.fuel} plant`, fuel: d.fuel, mw: d.mw, kind: kindOf(d.fuel), ...place(d.lat, d.lon), scale: Math.min(2.2, 0.55 + Math.sqrt(d.mw / 1000) * 0.75), retired: false, builtTick: d.tick })
    return out
  }, [file, diffs])
  const byKind = useMemo(() => Object.fromEntries(KINDS.map((k) => [k, sites.filter((s) => s.kind === k)])) as Record<Kind, Site[]>, [sites])
  // smoke and steam: the biggest live fossil and nuclear sites
  const chimneys = useMemo(() => sites.filter((s) => !s.retired && (s.kind === 'fossil' || s.kind === 'nuclear')).sort((a, b) => b.mw - a.mw).slice(0, 220), [sites])
  const PUFFS = 3

  // static placement, written once per set of sites
  useLayoutEffect(() => {
    const col = new THREE.Color()
    for (const k of KINDS) {
      const m = refs.current[k]
      if (!m) continue
      byKind[k].forEach((s, i) => {
        m.setMatrixAt(i, placeMatrix(s, s.builtTick !== undefined ? 0.01 : 1))
        m.setColorAt(i, s.retired ? RETIRED : col.set(COLOR[k]))
      })
      m.count = byKind[k].length
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  }, [byKind])

  useFrame(({ clock, camera }) => {
    const g = group.current
    if (!g) return
    const fade = midFade()
    g.visible = fade > 0.01 && sites.length > 0
    if (!g.visible) return
    const t = clock.elapsedTime, now = performance.now() / 1000
    const col = new THREE.Color()
    // only plants the sim just built animate (a short rise); everything else was written once below
    for (const k of KINDS) {
      const m = refs.current[k]
      if (!m) continue
      let dirty = false
      byKind[k].forEach((s, i) => {
        if (s.builtTick === undefined) return
        if (!firstSeen.current.has(s.id)) firstSeen.current.set(s.id, now)
        const rise = Math.min(1, (now - firstSeen.current.get(s.id)!) / 1.5)
        if (rise >= 1 && firstSeen.current.get(s.id)! < now - 2) return
        m.setMatrixAt(i, placeMatrix(s, rise))
        dirty = true
      })
      if (dirty) m.instanceMatrix.needsUpdate = true
    }
    // puffs rise and fade, only on our side of the planet
    const pm = puffRef.current
    if (pm) {
      const dir = camera.position.clone().normalize()
      let n = 0
      for (const s of chimneys) {
        if (s.up.dot(dir) < 0.2) continue
        for (let k = 0; k < PUFFS; k++) {
          const life = (t * 0.35 + k / PUFFS + (s.mw % 7) / 7) % 1
          _p.copy(s.up).multiplyScalar(0.05 * s.scale + life * 0.22 * s.scale).add(s.pos)
          const r = (0.012 + life * 0.03) * s.scale * (1 - life * 0.5)
          pm.setMatrixAt(n, _m.compose(_p, _q.identity(), _s.set(r, r, r)))
          pm.setColorAt(n, col.set(s.kind === 'fossil' ? '#5E5953' : '#F4F1EA'))
          n++
        }
      }
      pm.count = n
      pm.instanceMatrix.needsUpdate = true
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true
    }
    void tick
  })

  // hover: "drax · coal · 3,900 MW"
  const tip = (k: Kind) => ({
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      const s = e.instanceId != null ? byKind[k][e.instanceId] : undefined
      if (!s) return
      useStore.getState().setTip({ title: s.name, text: `${s.fuel} · ${s.mw.toLocaleString('en-US')} MW${s.retired ? ' · retired' : s.builtTick !== undefined ? ' · built by the core' : ''}`, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
    },
    onPointerOut: () => useStore.getState().setTip(null),
  })

  return (
    <group ref={group} visible={false}>
      {KINDS.map((k) => (
        <instancedMesh key={`${k}-${byKind[k].length}`} ref={(m) => { refs.current[k] = m }} args={[geos[k], mats[k], Math.max(1, byKind[k].length)]} frustumCulled={false} castShadow={k === 'nuclear' || k === 'fossil'} {...tip(k)} />
      ))}
      <instancedMesh ref={puffRef} args={[undefined, undefined, Math.max(1, chimneys.length * PUFFS)]} frustumCulled={false} raycast={() => null}>
        <icosahedronGeometry args={[1, 1]} />
        <meshToonMaterial gradientMap={toonGradient()} transparent opacity={0.75} />
      </instancedMesh>
    </group>
  )
}
