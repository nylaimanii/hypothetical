'use client'
// large airports (ourairports) and ports (natural earth) as small blocky landmarks at mid zoom, with little planes
// taking off and landing at the busy airports and ships running in and out of the busy ports. how busy comes from the
// frame's per country traffic (air / port) times the sim's hourly shape at the hub's local time.
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Frame } from '@/lib/types'
import { groundRadius, latLonToVec3, OCEAN_TOP, toonGradient, sceneRefs } from '../../lib'
import { useStore } from '../../../state/store'
import { localHour, utcHourOf, worldDate } from '../../time'
import { HOURLY, midFade, trafficOf, useHubs } from './stream'

type Hub = { kind: 'air' | 'port'; name: string; country: string; lon: number; up: THREE.Vector3; pos: THREE.Vector3; quat: THREE.Quaternion; heading: number }
const Y = new THREE.Vector3(0, 1, 0)
const MOVERS = 2 // planes or ships per busy hub
const BUSY = 70 // busiest hubs in view that get movers, per kind

function geos() {
  const airport = mergeGeometries([
    new THREE.BoxGeometry(0.16, 0.006, 0.022).translate(0, 0.003, 0), // runway
    new THREE.BoxGeometry(0.05, 0.018, 0.03).translate(-0.03, 0.009, 0.04), // terminal
    new THREE.CylinderGeometry(0.006, 0.008, 0.045, 6).translate(0.03, 0.022, 0.035), // tower
  ])!
  const port = mergeGeometries([
    new THREE.BoxGeometry(0.1, 0.012, 0.04).translate(0, 0.006, 0), // quay
    new THREE.BoxGeometry(0.012, 0.06, 0.012).translate(0.03, 0.03, 0), // crane
    new THREE.BoxGeometry(0.05, 0.008, 0.008).translate(0.045, 0.058, 0),
    new THREE.BoxGeometry(0.02, 0.016, 0.016).translate(-0.025, 0.02, 0.008), // containers
  ])!
  const plane = mergeGeometries([new THREE.BoxGeometry(0.03, 0.006, 0.007), new THREE.BoxGeometry(0.008, 0.002, 0.03)])!
  const ship = mergeGeometries([new THREE.BoxGeometry(0.04, 0.008, 0.012).translate(0, 0.004, 0), new THREE.BoxGeometry(0.012, 0.01, 0.01).translate(-0.01, 0.012, 0)])!
  return { airport, port, plane, ship }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _t = new THREE.Vector3(), _r = new THREE.Quaternion()

export default function Hubs({ frame }: { frame: Frame }) {
  const file = useHubs()
  const g = useMemo(() => geos(), [])
  const mat = useMemo(() => new THREE.MeshToonMaterial({ color: '#D9D2C4', gradientMap: toonGradient() }), [])
  const moverMat = useMemo(() => new THREE.MeshToonMaterial({ color: '#F4F1EA', gradientMap: toonGradient() }), [])
  const shipMat = useMemo(() => new THREE.MeshToonMaterial({ color: '#7A3F2E', gradientMap: toonGradient() }), [])
  const group = useRef<THREE.Group>(null)
  const airRef = useRef<THREE.InstancedMesh>(null), portRef = useRef<THREE.InstancedMesh>(null)
  const planeRef = useRef<THREE.InstancedMesh>(null), shipRef = useRef<THREE.InstancedMesh>(null)

  const hubs = useMemo(() => {
    if (!file) return { air: [] as Hub[], port: [] as Hub[] }
    const place = (kind: Hub['kind'], name: string, country: string, lat: number, lon: number, k: number): Hub => {
      const up = latLonToVec3(lat, lon, 1).normalize()
      const r = kind === 'air' ? groundRadius(up) + 0.004 : Math.max(OCEAN_TOP + 0.02, groundRadius(up) - 0.02)
      return { kind, name, country, lon, up, pos: up.clone().multiplyScalar(r), quat: new THREE.Quaternion().setFromUnitVectors(Y, up).multiply(new THREE.Quaternion().setFromAxisAngle(Y, (k * 2.399) % 6.283)), heading: (k * 2.399) % 6.283 }
    }
    return {
      air: file.airports.map(([code, name, country, lat, lon], k) => place('air', `${name || code}`, country, lat / file.q, lon / file.q, k)),
      port: file.ports.map(([name, country, lat, lon], k) => place('port', `port of ${name}`, country, lat / file.q, lon / file.q, k)),
    }
  }, [file])

  // landmarks never move: written once
  useLayoutEffect(() => {
    for (const [m, list] of [[airRef.current, hubs.air], [portRef.current, hubs.port]] as const) {
      if (!m) continue
      // small: hubs are landmarks, not the subject
      list.forEach((h, i) => m.setMatrixAt(i, _m.compose(h.pos, h.quat, _s.set(0.55, 0.55, 0.55))))
      m.count = list.length
      m.instanceMatrix.needsUpdate = true
    }
  }, [hubs])

  // per country busyness for this frame (country order is listed once on the run's first frame)
  const order = useStore((s) => trafficOf(s.record.frames[0])?.countries)
  const level = useMemo(() => {
    const t = trafficOf(frame)
    return (country: string, mode: 'air' | 'port') => {
      const k = order ? order.indexOf(country) : -1
      return t && k >= 0 ? (mode === 'air' ? t.air[k] : t.port[k]) ?? 0.6 : 0.6
    }
  }, [frame, order])

  const acc = useRef(1)
  const busy = useRef<{ air: Hub[]; port: Hub[] }>({ air: [], port: [] })
  useFrame(({ camera }, dt) => {
    const grp = group.current
    if (!grp) return
    const fade = midFade()
    grp.visible = fade > 0.01 && (hubs.air.length > 0 || hubs.port.length > 0)
    if (!grp.visible) return
    const s = useStore.getState()
    const utc = utcHourOf(worldDate(s.playhead, s.hour, s.playing))
    // every half second: the busiest hubs on our side of the planet get movers
    acc.current += dt
    if (acc.current > 0.5) {
      acc.current = 0
      const dir = camera.position.clone().normalize()
      const pick = (list: Hub[], mode: 'air' | 'port') => list
        .filter((h) => h.up.dot(dir) > 0.35)
        .map((h) => ({ h, b: level(h.country, mode) * HOURLY[mode][Math.floor(localHour(utc, h.lon))] }))
        .filter((x) => x.b > 0.25).sort((a, b) => b.b - a.b).slice(0, BUSY).map((x) => x.h)
      busy.current = { air: pick(hubs.air, 'air'), port: pick(hubs.port, 'port') }
    }
    const t = sceneRefs.wt
    // planes: a loop out along the runway, climbing, then back down
    const pm = planeRef.current
    if (pm) {
      let n = 0
      busy.current.air.forEach((h, i) => {
        for (let k = 0; k < MOVERS; k++) {
          const ph = (t * 0.12 + k / MOVERS + i * 0.37) % 1
          const along = Math.sin(ph * Math.PI * 2) * 0.35, up = Math.sin(ph * Math.PI) * 0.18
          _t.set(Math.cos(h.heading), 0, Math.sin(h.heading)).applyQuaternion(_r.setFromUnitVectors(Y, h.up))
          _p.copy(h.pos).addScaledVector(_t, along).addScaledVector(h.up, 0.02 + up)
          pm.setMatrixAt(n++, _m.compose(_p, h.quat, _s.set(1, 1, 1)))
        }
      })
      pm.count = n
      pm.instanceMatrix.needsUpdate = true
    }
    // ships: out to sea and back
    const sm = shipRef.current
    if (sm) {
      let n = 0
      busy.current.port.forEach((h, i) => {
        for (let k = 0; k < MOVERS; k++) {
          const ph = (t * 0.05 + k / MOVERS + i * 0.29) % 1
          const out = (1 - Math.cos(ph * Math.PI * 2)) * 0.22
          _t.set(Math.cos(h.heading + k), 0, Math.sin(h.heading + k)).applyQuaternion(_r.setFromUnitVectors(Y, h.up))
          _p.copy(h.pos).addScaledVector(_t, 0.06 + out)
          _p.setLength(Math.max(OCEAN_TOP + 0.01, _p.length() - out * 0.02))
          sm.setMatrixAt(n++, _m.compose(_p, h.quat, _s.set(1, 1, 1)))
        }
      })
      sm.count = n
      sm.instanceMatrix.needsUpdate = true
    }
    void _q
  })

  const tip = (list: Hub[]) => ({
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      const h = e.instanceId != null ? list[e.instanceId] : undefined
      if (h) useStore.getState().setTip({ title: h.name, text: h.kind === 'air' ? 'airport' : 'port', x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
    },
    onPointerOut: () => useStore.getState().setTip(null),
  })

  return (
    <group ref={group} visible={false}>
      <instancedMesh key={`a${hubs.air.length}`} ref={airRef} args={[g.airport, mat, Math.max(1, hubs.air.length)]} frustumCulled={false} {...tip(hubs.air)} />
      <instancedMesh key={`p${hubs.port.length}`} ref={portRef} args={[g.port, mat, Math.max(1, hubs.port.length)]} frustumCulled={false} {...tip(hubs.port)} />
      <instancedMesh ref={planeRef} args={[g.plane, moverMat, BUSY * MOVERS]} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={shipRef} args={[g.ship, shipMat, BUSY * MOVERS]} frustumCulled={false} raycast={() => null} />
    </group>
  )
}
