'use client'
// thin raised ridges where two land tiles belong to different countries. one ChunkSet: batched and
// horizon culled like the tiles themselves. far and mid zoom only
import { useEffect, useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Frame } from '@/lib/types'
import { LAND_TOP, STEP, ZOOM_CLOSE, buildTiles, sceneRefs, toonGradient } from '../lib'
import { ChunkSet } from '../chunks'
import { tileCountries } from './countries'

export default function BorderRidges({ frame }: { frame: Frame }) {
  const { tiles, neighbors } = useMemo(() => buildTiles(frame.regions), [frame.regions])
  const ridges = useMemo(() => {
    const tc = tileCountries(tiles)
    const n = Math.round(Math.sqrt(tiles.length / 6))
    // direct neighbors only (not diagonals): within ~1.3 tile steps
    const lim = Math.cos((Math.PI / 2 / n) * 1.3)
    const out: { tile: number; pos: THREE.Vector3; quat: THREE.Quaternion; len: number }[] = []
    tiles.forEach((t, i) => {
      if (!t.land || t.ice || tc[i] < 0) return
      for (const j of neighbors[i]) {
        if (j <= i) continue
        const u = tiles[j]
        if (!u.land || u.ice || tc[j] < 0 || tc[j] === tc[i]) continue
        if (t.normal.dot(u.normal) < lim) continue
        const mid = t.normal.clone().add(u.normal).normalize()
        const across = u.normal.clone().sub(t.normal)
        across.addScaledVector(mid, -across.dot(mid)).normalize()
        const along = new THREE.Vector3().crossVectors(mid, across).normalize()
        const top = LAND_TOP + Math.max(t.band, u.band) * STEP
        const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, mid, across))
        out.push({ tile: i, pos: mid.clone().multiplyScalar(top + 0.012), quat, len: (t.w + u.w) * 0.5 * 1.04 })
      }
    })
    return out
  }, [tiles, neighbors])

  // thin and soft: a border should read as a seam in the clay, not a fence
  const geo = useMemo(() => new RoundedBoxGeometry(1, 0.035, 0.028, 1, 0.012), [])
  const mat = useMemo(() => new THREE.MeshToonMaterial({ color: '#6F675E', gradientMap: toonGradient() }), [])
  const set = useMemo(() => new ChunkSet(ridges.map((r) => r.tile), tiles, geo, geo, mat), [ridges, tiles, geo, mat])
  useEffect(() => () => set.dispose(), [set])
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), s = new THREE.Vector3()
    ridges.forEach((r, k) => set.setMatrixAt(k, m.compose(r.pos, r.quat, s.set(r.len, 1, 1))))
    set.commitMatrices()
  }, [ridges, set])
  useFrame(({ camera }) => {
    // up close the tiles themselves read as countries; ridges only at far and mid
    set.group.visible = sceneRefs.camDist > ZOOM_CLOSE
    if (set.group.visible) set.update(camera.position, LAND_TOP, 0)
  })
  return <primitive object={set.group} />
}
