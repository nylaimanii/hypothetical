'use client'
// v3 globe layers that belong to the overlay modes and the explain toggle:
// movement streams, per-region mode labels, the emotion pulse, and the explain callouts.
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Flow, Frame } from '@/lib/types'
import { LAND_TOP, latLonToVec3, sceneRefs } from './lib'
import { useStore } from '../state/store'
import { callouts, tipProps, type Callout } from './explain'
import { EMOTION_HEX, dominantOf, fmtPeople, regionMood, topEnergy } from './modes'

const facing = (p: THREE.Vector3, cam: THREE.Vector3, min = 0.2) => p.clone().normalize().dot(cam) > min

// ---- movement: a stream of tiny pips along an arc for every flow ----
type Stream = { key: string; curve: THREE.QuadraticBezierCurve3; n: number; speed: number; forced: boolean; label: string; mid: THREE.Vector3; width: number }

function streamsFor(frame: Frame): Stream[] {
  const flows: Flow[] = frame.flows ?? (frame.decision?.migrations ?? []).map((m) => ({ ...m, forced: true }))
  const max = Math.max(1, ...flows.map((f) => f.people))
  return flows.flatMap((f, i) => {
    const a = frame.regions.find((r) => r.id === f.from), b = frame.regions.find((r) => r.id === f.to)
    if (!a || !b || a.id === b.id) return []
    const city = f.toCityId ? frame.cities.find((c) => c.id === f.toCityId) : undefined
    const va = latLonToVec3(a.lat, a.lon, LAND_TOP + 0.1)
    const vb = city ? latLonToVec3(city.lat, city.lon, LAND_TOP + 0.1) : latLonToVec3(b.lat, b.lon, LAND_TOP + 0.1)
    const lift = 0.6 + va.distanceTo(vb) * 0.18
    const mid = va.clone().add(vb).multiplyScalar(0.5).normalize().multiplyScalar(LAND_TOP + lift)
    const width = 0.5 + Math.sqrt(f.people / max) * 1.5
    return [{
      key: `${f.from}-${f.to}-${i}`, curve: new THREE.QuadraticBezierCurve3(va, mid, vb), n: Math.round(10 + width * 14), speed: f.forced ? 0.05 : 0.11, forced: f.forced, mid, width,
      label: `${fmtPeople(f.people)} moving from ${a.name} to ${city?.name ?? b.name}: ${f.reason}${f.forced ? ' (ordered)' : ''}`,
    }]
  })
}

export function MovementStreams({ frame }: { frame: Frame }) {
  const overlay = useStore((s) => s.overlay)
  const streams = useMemo(() => streamsFor(frame), [frame])
  const total = streams.reduce((a, s) => a + s.n, 0)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(() => new THREE.SphereGeometry(0.045, 6, 4), [])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), [])
  const camera = useThree((s) => s.camera)
  const labels = useRef<(HTMLDivElement | null)[]>([])
  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    const t = clock.elapsedTime
    const mtx = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    const col = new THREE.Color()
    let k = 0
    for (const st of streams) {
      for (let i = 0; i < st.n; i++) {
        const u = (i / st.n + t * st.speed) % 1
        st.curve.getPoint(u, p)
        // a little lateral spread so thick streams read as crowds
        const j = ((i * 2654435761) % 1000) / 1000 - 0.5
        p.addScaledVector(p.clone().normalize(), j * 0.04 * st.width)
        const sc = 0.7 + st.width * 0.35
        m.setMatrixAt(k, mtx.compose(p, q, s.set(sc, sc, sc)))
        m.setColorAt(k, col.set(st.forced ? '#1D1B19' : '#F4EFE6'))
        k++
      }
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    const c = camera.position.clone().normalize()
    streams.forEach((st, i) => { const el = labels.current[i]; if (el) el.style.opacity = facing(st.mid, c, 0.25) ? '1' : '0' })
  })
  if (overlay !== 'movement' || !streams.length) return null
  return (
    <>
      <instancedMesh key={total} ref={mesh} args={[geo, mat, total]} frustumCulled={false} raycast={() => null} />
      {streams.map((st, i) => (
        <Html key={st.key} position={st.mid} center zIndexRange={[6, 0]}>
          <div ref={(el) => { labels.current[i] = el }} className={`pointer-events-none whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] shadow-sm transition-opacity ${st.forced ? 'bg-ink text-bone' : 'bg-bone/90 text-ink'}`}>{st.label}</div>
        </Html>
      ))}
    </>
  )
}

// ---- a floating word or number over each region in the data modes ----
export function RegionModeLabels({ frame }: { frame: Frame }) {
  const overlay = useStore((s) => s.overlay)
  const camera = useThree((s) => s.camera)
  const refs = useRef<(HTMLDivElement | null)[]>([])
  const spots = useMemo(() => frame.regions.map((r) => {
    let text = '', sub = '', color: string | undefined
    if (overlay === 'population') text = fmtPeople(r.population)
    else if (overlay === 'emotion') { const d = dominantOf(regionMood(frame, r)); if (d) { text = d.emotion; sub = `${Math.round(d.level * 100)}%`; color = EMOTION_HEX[d.emotion] } }
    else if (overlay === 'energy') { const e = topEnergy(r); if (e) { text = e.key; sub = `${Math.round(e.share * 100)}%` } }
    else if (overlay === 'damage') { const d = r.visual?.damage; if (d && d.level > 0.05) { text = d.kind; sub = `${Math.round(d.level * 100)}%` } }
    return { r, text, sub, color, pos: latLonToVec3(r.lat, r.lon, LAND_TOP + 1.1) }
  }), [frame, overlay])
  useFrame(() => {
    const c = camera.position.clone().normalize()
    spots.forEach((s, i) => { const el = refs.current[i]; if (el) el.style.opacity = facing(s.pos, c) ? '1' : '0' })
  })
  if (overlay === 'real' || overlay === 'movement') return null
  return (
    <>
      {spots.filter((s) => s.text).map((s, i) => (
        <Html key={`${overlay}-${s.r.id}`} position={s.pos} center zIndexRange={[6, 0]}>
          <div ref={(el) => { refs.current[i] = el }} className="pointer-events-none flex items-baseline gap-1.5 whitespace-nowrap rounded-full bg-bone/90 px-2.5 py-0.5 text-[12px] text-ink shadow-sm transition-opacity">
            {s.color && <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />}
            <span className={overlay === 'population' ? 'font-mono' : 'font-display'}>{s.text}</span>
            {s.sub && <span className="font-mono text-[10.5px] text-ink/55">{s.sub}</span>}
          </div>
        </Html>
      ))}
    </>
  )
}

// ---- emotion: a soft pulse over each region, faster and bigger when the feeling is stronger ----
export function EmotionPulse({ frame }: { frame: Frame }) {
  const overlay = useStore((s) => s.overlay)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(() => new THREE.CircleGeometry(1, 28), [])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }), [])
  const spots = useMemo(() => frame.regions.map((r) => {
    const d = dominantOf(regionMood(frame, r))
    const n = latLonToVec3(r.lat, r.lon, 1).normalize()
    return { pos: n.clone().multiplyScalar(LAND_TOP + 0.35), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n), color: new THREE.Color(d ? EMOTION_HEX[d.emotion] : '#ffffff'), level: d?.level ?? 0 }
  }), [frame])
  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    const mtx = new THREE.Matrix4(), s = new THREE.Vector3()
    spots.forEach((sp, i) => {
      const beat = 0.5 + 0.5 * Math.sin(clock.elapsedTime * (1.2 + sp.level * 3) + i)
      const r = 0.6 + sp.level * 1.6 + beat * 0.35 * sp.level
      m.setMatrixAt(i, mtx.compose(sp.pos, sp.q, s.set(r, r, r)))
      m.setColorAt(i, sp.color)
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })
  if (overlay !== 'emotion') return null
  return <instancedMesh key={spots.length} ref={mesh} args={[geo, mat, spots.length]} frustumCulled={false} raycast={() => null} />
}

// ---- explain: the ~6 most significant labelled things in view ----
const SLOTS = 6
export function ExplainLayer() {
  const on = useStore((s) => s.explain)
  const camera = useThree((s) => s.camera)
  const groups = useRef<(THREE.Group | null)[]>([])
  const [shown, setShown] = useState<Callout[]>([])
  const acc = useRef(1)
  const frustum = useMemo(() => new THREE.Frustum(), [])
  const pm = useMemo(() => new THREE.Matrix4(), [])
  useFrame((_, dt) => {
    if (!on) return
    acc.current += dt
    if (acc.current > 0.4) {
      acc.current = 0
      pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(pm)
      const c = camera.position.clone().normalize()
      const far = sceneRefs.camDist > 85
      // in the orrery only things out in space get labels; on the globe, only the side facing us
      const all = [...callouts.values()].flat().filter((x) => x.weight > 0 && frustum.containsPoint(x.pos) && (far ? x.pos.length() > 16 : x.pos.length() > 20 || facing(x.pos, c, 0.25)))
      all.sort((a, b) => b.weight - a.weight || Number(!!b.danger) - Number(!!a.danger))
      // keep labels from piling on each other: skip ones too close on screen to a stronger one
      const picked: Callout[] = [], scr: THREE.Vector3[] = []
      // one of each kind of thing, and fewer when the whole globe is in view
      const titles = new Set<string>()
      const cap = sceneRefs.camDist > 40 ? 4 : SLOTS
      for (const x of all) {
        if (titles.has(x.title)) continue
        const p = x.pos.clone().project(camera)
        if (scr.some((q) => Math.abs(q.x - p.x) < 0.22 && Math.abs(q.y - p.y) < 0.09)) continue
        picked.push(x); scr.push(p); titles.add(x.title)
        if (picked.length >= cap) break
      }
      const key = picked.map((p) => p.id).join()
      setShown((prev) => (prev.map((p) => p.id).join() === key ? prev : picked))
    }
    // callout positions can move (orbiting assets); follow them every frame
    shown.forEach((x, i) => { const g = groups.current[i]; if (g) g.position.copy(x.pos) })
  })
  if (!on) return null
  return (
    <>
      {shown.map((x, i) => (
        <group key={x.id} ref={(g) => { groups.current[i] = g }} position={x.pos}>
          <Html center={false} zIndexRange={[7, 0]} style={{ transform: 'translate(10px, -100%)' }}>
            <div className={`pointer-events-none w-max max-w-[13rem] rounded-xl border bg-bone/92 px-2.5 py-1.5 text-[11px] leading-snug text-ink shadow-md backdrop-blur ${x.danger ? 'border-ember/60' : 'border-ink/15'}`}>
              <div className={`font-display text-[12.5px] ${x.danger ? 'text-ember' : ''}`}>{x.title}</div>
              <div className="text-ink/70">{x.text}</div>
            </div>
          </Html>
        </group>
      ))}
    </>
  )
}

export { tipProps }
