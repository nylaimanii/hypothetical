'use client'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Frame } from '@/lib/types'
import type { Biome } from './geodata'
import { buildTiles, C, LAND_TOP, OCEAN_TOP, R, STEP, toonGradient } from './lib'
import { tickToDate } from './time'
import { useStore } from '../state/store'

const TILE_H = 0.5

// muted clay biome colors; regions tint them so borders still read
const BIOME_HEX: Record<Biome, string> = {
  rainforest: '#3F7A4E', savanna: '#C4AF63', desert: '#E3C68C', temperate: '#79A85E', taiga: '#4D7A63', tundra: '#A9AF98', ice: '#F2F4F3',
}
const DEPTH_HEX = ['#86BBCB', '#5F97B0', '#4A7F9D', '#3A6886']
const SNOW = new THREE.Color('#F3F2EE')
const ROCK = new THREE.Color('#9D978D')
const DRY = new THREE.Color('#EADFC6')

// ocean and foam move in the vertex shader: no per frame cpu work
function animated(base: THREE.MeshToonMaterial, kind: 'ocean' | 'foam') {
  const uniforms = { uTime: { value: 0 } }
  base.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vWave;')
      .replace('#include <begin_vertex>', kind === 'ocean'
        ? `#include <begin_vertex>
           vec3 ip = instanceMatrix[3].xyz;
           vWave = sin(uTime * 0.9 + ip.x * 2.1 - ip.y * 1.4 + ip.z * 0.7);
           transformed.y += sin(uTime * 1.2 + ip.x * 1.7 + ip.z * 1.3) * 0.012;`
        : `#include <begin_vertex>
           vec3 ip = instanceMatrix[3].xyz;
           float pulse = 0.78 + 0.22 * sin(uTime * 1.8 + ip.x * 5.0 + ip.z * 3.0);
           vWave = pulse;
           transformed *= pulse;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWave;')
      .replace('#include <color_fragment>', kind === 'ocean'
        ? '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 + vWave * 0.055;'
        : '#include <color_fragment>')
  }
  base.customProgramCacheKey = () => kind
  return { mat: base, uniforms }
}

export default function Planet({ frame }: { frame: Frame }) {
  const { tiles, neighbors } = useMemo(() => buildTiles(frame.regions), [frame.regions])
  const landRef = useRef<THREE.InstancedMesh>(null)
  const stackRef = useRef<THREE.InstancedMesh>(null)
  const oceanRef = useRef<THREE.InstancedMesh>(null)
  const foamRef = useRef<THREE.InstancedMesh>(null)
  const glowRef = useRef<THREE.InstancedMesh>(null)
  const glowMat = useRef<THREE.MeshBasicMaterial>(null)
  const select = useStore((s) => s.select)
  const quality = useStore((s) => s.quality)
  // seasons move monthly: recolor when the month changes, not every frame
  const month = useStore((s) => Math.floor(s.playhead))

  const geo = useMemo(() => new RoundedBoxGeometry(1, TILE_H, 1, 2, 0.09), [])
  const blockGeo = useMemo(() => new RoundedBoxGeometry(1, STEP, 1, 2, 0.03), [])
  const foamGeo = useMemo(() => new RoundedBoxGeometry(0.13, 0.035, 0.08, 2, 0.015), [])
  const landMat = useMemo(() => new THREE.MeshToonMaterial({ gradientMap: toonGradient() }), [])
  const ocean = useMemo(() => animated(new THREE.MeshToonMaterial({ gradientMap: toonGradient() }), 'ocean'), [])
  const foam = useMemo(() => animated(new THREE.MeshToonMaterial({ color: '#E4EEEE', gradientMap: toonGradient() }), 'foam'), [])

  const layout = useMemo(() => {
    const land: number[] = [], sea: number[] = [], stacks: { tile: number; level: number }[] = []
    const coast: { tile: number; toward: THREE.Vector3 }[] = []
    tiles.forEach((t, i) => {
      if (t.land) {
        land.push(i)
        for (let k = 1; k <= t.band; k++) stacks.push({ tile: i, level: k })
      } else sea.push(i)
    })
    // coastline: ocean tiles next to land (found from the land side)
    const coastSet = new Map<number, THREE.Vector3>()
    for (const i of land) for (const j of neighbors[i]) if (!tiles[j].land && !coastSet.has(j)) coastSet.set(j, tiles[i].normal)
    for (const [tile, toward] of coastSet) coast.push({ tile, toward })
    const border = tiles.map((t, i) => t.land && !t.ice && Array.from(neighbors[i]).some((j) => tiles[j].region !== t.region))
    return { land, sea, stacks, coast, border }
  }, [tiles, neighbors])

  useLayoutEffect(() => {
    const L = landRef.current, S = stackRef.current, O = oceanRef.current, F = foamRef.current, G = glowRef.current
    if (!L || !S || !O || !F || !G) return
    const mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3()
    layout.land.forEach((ti, k) => {
      const t = tiles[ti]
      pos.copy(t.normal).multiplyScalar(LAND_TOP - TILE_H / 2)
      L.setMatrixAt(k, mtx.compose(pos, t.quat, scl.set(t.w * 1.03, 1, t.d * 1.03)))
      const top = LAND_TOP + t.band * STEP
      pos.copy(t.normal).multiplyScalar(top - TILE_H / 2)
      G.setMatrixAt(k, mtx.compose(pos, t.quat, layout.border[ti] ? scl.set(t.w * 1.02, 1.08, t.d * 1.02) : scl.set(0, 0, 0)))
    })
    layout.stacks.forEach(({ tile, level }, k) => {
      const t = tiles[tile]
      // each block a little narrower than the one under it: chunky stepped ridges
      const inset = 1 - level * 0.09
      pos.copy(t.normal).multiplyScalar(LAND_TOP + (level - 0.5) * STEP)
      S.setMatrixAt(k, mtx.compose(pos, t.quat, scl.set(t.w * inset, 1, t.d * inset)))
    })
    layout.sea.forEach((ti, k) => {
      const t = tiles[ti]
      pos.copy(t.normal).multiplyScalar(OCEAN_TOP - TILE_H / 2 - t.depth * 0.02)
      O.setMatrixAt(k, mtx.compose(pos, t.quat, scl.set(t.w * 1.03, 1, t.d * 1.03)))
    })
    layout.coast.forEach(({ tile, toward }, k) => {
      const t = tiles[tile]
      const dir = toward.clone().sub(t.normal)
      dir.addScaledVector(t.normal, -dir.dot(t.normal)).normalize()
      // one soft foam block on the shore side of each coastal tile
      const jitter = ((tile * 2654435761) % 100) / 100 - 0.5
      const side = new THREE.Vector3().crossVectors(t.normal, dir).multiplyScalar(jitter * t.w * 0.4)
      pos.copy(t.normal).multiplyScalar(OCEAN_TOP + 0.015).addScaledVector(dir, t.w * 0.34).add(side)
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(t.normal, dir), t.normal, dir))
      F.setMatrixAt(k, mtx.compose(pos, q, scl.set(1 + Math.abs(jitter), 1, 1)))
    })
    for (const m of [L, S, O, F, G]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere() }
  }, [tiles, layout])

  // colors: biome tinted by region, real seasonal snow, drought pales, unrest glows ember on borders
  useEffect(() => {
    const L = landRef.current, S = stackRef.current, O = oceanRef.current, G = glowRef.current
    if (!L || !S || !O || !G) return
    const d = tickToDate(month)
    const doy = (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000
    // northern snow line: about 40N in mid january, back to 60N by mid july
    const winter = (Math.cos(((doy - 15) / 365) * Math.PI * 2) + 1) / 2
    const snowLat = 60 - 20 * winter
    const regionCols = frame.regions.map((r) => new THREE.Color(r.color))
    const dry = frame.regions.map((r) => r.foodKcalPerCapita < 2150 || frame.newEvents.some((e) => (e.kind === 'famine' || /drought/i.test(e.text)) && e.regionId === r.id))
    const ember = new THREE.Color(C.ember), off = new THREE.Color(0, 0, 0)
    const col = new THREE.Color(), tmp = new THREE.Color()
    const surface = (ti: number, level: number) => {
      const t = tiles[ti]
      col.set(BIOME_HEX[t.biome])
      if (t.region >= 0) col.lerp(regionCols[t.region], 0.22)
      if (t.region >= 0 && dry[t.region]) col.lerp(DRY, 0.55)
      if (level >= 2) col.lerp(ROCK, 0.25 * level)
      const snowy = t.biome !== 'desert' && (t.lat > snowLat || (t.band === 3 && level === 3) || (t.band >= 2 && level === t.band && t.lat > snowLat - 14))
      if (snowy) col.lerp(SNOW, 0.85)
      col.multiplyScalar(0.96 + ((ti * 2654435761) % 1000) / 1000 * 0.08)
      return col
    }
    layout.land.forEach((ti, k) => {
      L.setColorAt(k, tiles[ti].band > 0 ? tmp.copy(surface(ti, 0)).multiplyScalar(0.9) : surface(ti, 0))
      const t = tiles[ti]
      const u = t.region >= 0 ? frame.regions[t.region].unrest : 0
      const g = layout.border[ti] && u > 0.45 ? (u - 0.45) / 0.55 : 0
      G.setColorAt(k, g > 0 ? tmp.copy(ember).multiplyScalar(0.25 + g * 0.75) : off)
    })
    layout.stacks.forEach(({ tile, level }, k) => S.setColorAt(k, surface(tile, level)))
    layout.sea.forEach((ti, k) => O.setColorAt(k, col.set(DEPTH_HEX[tiles[ti].depth]).multiplyScalar(0.97 + ((ti * 7919) % 100) / 100 * 0.06)))
    for (const m of [L, S, O, G]) if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [frame, tiles, layout, month])

  useFrame(({ clock }) => {
    ocean.uniforms.uTime.value = clock.elapsedTime
    foam.uniforms.uTime.value = clock.elapsedTime
    if (glowMat.current) glowMat.current.opacity = 0.55 + Math.sin(clock.elapsedTime * 2.4) * 0.25
  })

  const pick = (list: number[]) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.instanceId == null) return
    const t = tiles[list[e.instanceId]]
    if (t && t.region >= 0) select({ kind: 'region', id: frame.regions[t.region].id })
  }
  const stackTiles = useMemo(() => layout.stacks.map((s) => s.tile), [layout])
  const hover = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = 'pointer' },
    onPointerOut: () => { document.body.style.cursor = '' },
  }
  const shadow = quality === 'high'

  return (
    <group>
      <mesh>
        <sphereGeometry args={[R - 0.2, 64, 48]} />
        <meshToonMaterial color={C.grout} gradientMap={toonGradient()} />
      </mesh>
      <instancedMesh ref={oceanRef} args={[geo, ocean.mat, layout.sea.length]} receiveShadow raycast={() => null} />
      <instancedMesh ref={foamRef} args={[foamGeo, foam.mat, Math.max(1, layout.coast.length)]} raycast={() => null} />
      <instancedMesh ref={landRef} args={[geo, landMat, layout.land.length]} castShadow={shadow} receiveShadow onClick={pick(layout.land)} {...hover} />
      <instancedMesh ref={stackRef} args={[blockGeo, landMat, Math.max(1, layout.stacks.length)]} castShadow={shadow} receiveShadow onClick={pick(stackTiles)} {...hover} />
      <instancedMesh ref={glowRef} args={[geo, undefined, layout.land.length]} raycast={() => null} renderOrder={2}>
        <meshBasicMaterial ref={glowMat} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.BackSide} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
