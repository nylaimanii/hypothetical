'use client'
// thin, light ridges between land tiles of the same country but different states or provinces
// (natural earth 10m admin-1 via tile-places.json). mid zoom and closer. replaces Admin1Lines
import { useEffect, useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Frame } from '@/lib/types'
import { C, LAND_TOP, STEP, ZOOM_FAR, buildTiles, sceneRefs, toonGradient } from '../lib'
import { ChunkSet } from '../chunks'
import { tileCountries } from './countries'
import { tilePlace } from './places'

export default function StateRidges({ frame }: { frame: Frame }) {
  const { tiles, neighbors } = useMemo(() => buildTiles(frame.regions), [frame.regions])
  const ridges = useMemo(() => {
    const tc = tileCountries(tiles)
    const state = tiles.map((t, i) => (t.land && !t.ice ? tilePlace(i, true, tc[i]).admin1 : -1))
    const n = Math.round(Math.sqrt(tiles.length / 6))
    const lim = Math.cos((Math.PI / 2 / n) * 1.3)
    const out: { tile: number; pos: THREE.Vector3; quat: THREE.Quaternion; len: number }[] = []
    tiles.forEach((t, i) => {
      if (state[i] < 0 || tc[i] < 0) return
      for (const j of neighbors[i]) {
        if (j <= i || state[j] < 0 || state[j] === state[i] || tc[j] !== tc[i]) continue
        const u = tiles[j]
        if (t.normal.dot(u.normal) < lim) continue
        const mid = t.normal.clone().add(u.normal).normalize()
        const across = u.normal.clone().sub(t.normal)
        across.addScaledVector(mid, -across.dot(mid)).normalize()
        const along = new THREE.Vector3().crossVectors(mid, across).normalize()
        const top = LAND_TOP + Math.max(t.band, u.band) * STEP
        out.push({ tile: i, pos: mid.clone().multiplyScalar(top + 0.012), quat: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, mid, across)), len: (t.w + u.w) * 0.5 })
      }
    })
    return out
  }, [tiles, neighbors])

  const geo = useMemo(() => new RoundedBoxGeometry(1, 0.03, 0.028, 1, 0.01), [])
  const mat = useMemo(() => new THREE.MeshToonMaterial({ color: new THREE.Color(C.ink).lerp(new THREE.Color(C.bone), 0.45), gradientMap: toonGradient() }), [])
  const set = useMemo(() => new ChunkSet(ridges.map((r) => r.tile), tiles, geo, geo, mat), [ridges, tiles, geo, mat])
  useEffect(() => () => set.dispose(), [set])
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), s = new THREE.Vector3()
    ridges.forEach((r, k) => set.setMatrixAt(k, m.compose(r.pos, r.quat, s.set(r.len, 1, 1))))
    set.commitMatrices()
  }, [ridges, set])
  useFrame(({ camera }) => {
    set.group.visible = sceneRefs.camDist < ZOOM_FAR + 2
    if (set.group.visible) set.update(camera.position, LAND_TOP, 0)
  })
  return <primitive object={set.group} />
}
