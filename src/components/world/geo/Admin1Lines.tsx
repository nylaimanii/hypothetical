'use client'
// state and province lines (natural earth admin-1, see SOURCES.md): faint ink, draped over the land, mid zoom only
import { useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Frame } from '@/lib/types'
import { C, LAND_TOP, STEP, ZOOM_CLOSE, ZOOM_FAR, groundRadius, latLonToVec3, sceneRefs } from '../lib'
import data from './admin1-lines.json'
import { midFade } from './labels'

const LINES = (data as { lines: number[][] }).lines

export default function Admin1Lines({ frame }: { frame: Frame }) {
  void frame
  const geo = useMemo(() => {
    const pos: number[] = []
    const v = new THREE.Vector3(), w = new THREE.Vector3()
    // lift each point to the ground under it plus a hair, and subdivide long segments so they hug the sphere
    const at = (lon: number, lat: number, out: THREE.Vector3) => { latLonToVec3(lat, lon, 1, out); return out.setLength(groundRadius(out) + STEP * 0.35) }
    for (const flat of LINES) {
      for (let k = 0; k + 3 < flat.length; k += 2) {
        at(flat[k], flat[k + 1], v)
        at(flat[k + 2], flat[k + 3], w)
        const steps = Math.max(1, Math.ceil(v.distanceTo(w) / 0.12))
        let prev = v.clone()
        for (let s = 1; s <= steps; s++) {
          const p = v.clone().lerp(w, s / steps)
          p.setLength(Math.max(LAND_TOP, groundRadius(p)) + STEP * 0.35)
          pos.push(prev.x, prev.y, prev.z, p.x, p.y, p.z)
          prev = p
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.computeBoundingSphere()
    return g
  }, [])
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: C.ink, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }), [])
  useFrame(() => {
    const op = midFade(sceneRefs.camDist, ZOOM_CLOSE, ZOOM_FAR) * 0.35
    mat.opacity = op
    mat.visible = op > 0.01
  })
  return <lineSegments geometry={geo} material={mat} raycast={() => null} renderOrder={3} />
}
