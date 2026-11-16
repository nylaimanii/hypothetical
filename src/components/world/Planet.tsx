'use client'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Frame } from '@/lib/types'
import type { Biome } from './geodata'
import { buildTiles, C, LAND_TOP, OCEAN_TOP, R, STEP, toonGradient } from './lib'
import { tickToDate } from './time'
import { useStore } from '../state/store'
import { ChunkSet } from './chunks'
import { isStatMode, regionModeColor, statColor } from './modes'
import { useGeo } from './geo/lazy'
import { tileClass, useFarTiles } from './real/far/useFar'
import { realLandColor } from './real/far/landColor'

const TILE_H = 0.5

// muted clay biome colors; regions tint them so borders still read
const BIOME_HEX: Record<Biome, string> = {
  rainforest: '#3F7A4E', savanna: '#C4AF63', desert: '#E3C68C', temperate: '#79A85E', taiga: '#4D7A63', tundra: '#A9AF98', ice: '#F2F4F3',
}
const DEPTH_HEX = ['#86BBCB', '#5F97B0', '#4A7F9D', '#3A6886']
const SNOW = new THREE.Color('#F3F2EE')
const ROCK = new THREE.Color('#9D978D')
const DRY = new THREE.Color('#EADFC6')
// v3: the world repainted by its decisions
const FOREST = new THREE.Color('#3B6B43')
const FIELD = new THREE.Color('#CDBB62')
const SMOG = new THREE.Color('#8C7A5B')
const MURK = new THREE.Color('#5E6B5A')
const PALE_SEA = new THREE.Color('#C9D3D2')
const SCAR: Record<string, THREE.Color> = { famine: new THREE.Color('#9C7F57'), revolt: new THREE.Color('#5F5853'), war: new THREE.Color('#57524E'), collapse: new THREE.Color('#8A8782'), disaster: new THREE.Color('#6B5E52') }
const hash01 = (i: number) => ((i * 2654435761) % 1000) / 1000

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
  const select = useStore((s) => s.select)
  const quality = useStore((s) => s.quality)
  // seasons move monthly: recolor when the month changes, not every frame
  const month = useStore((s) => Math.floor(s.playhead))
  const overlay = useStore((s) => s.overlay)
  // place data (states, seas, country shapes) arrives just after the first paint
  const places = useGeo()
  const farTiles = useFarTiles()
  // population mode: land rises with the people on it
  const popKey = overlay === 'population' ? frame.regions.map((r) => Math.round(r.population / 1e7)).join() : ''
  const lift = useMemo(() => {
    if (!popKey) return null
    const max = Math.max(...frame.regions.map((r) => r.population))
    return frame.regions.map((r) => Math.sqrt(r.population / max) * 0.55)
  }, [popKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // lod: rounded clay tiles up close, a 1-segment bevel (about a sixth of the triangles) further out
  const geo = useMemo(() => new RoundedBoxGeometry(1, TILE_H, 1, 2, 0.09), [])
  const geoLo = useMemo(() => new RoundedBoxGeometry(1, TILE_H, 1, 1, 0.09), [])
  const blockGeo = useMemo(() => new RoundedBoxGeometry(1, STEP, 1, 2, 0.03), [])
  const blockGeoLo = useMemo(() => new RoundedBoxGeometry(1, STEP, 1, 1, 0.03), [])
  const foamGeo = useMemo(() => new THREE.BoxGeometry(0.13, 0.035, 0.08), [])
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, toneMapped: false }), [])
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

  const shadow = quality === 'high'
  // perf: every tile type is batched into cube-sphere patches (see chunks.ts): culled off screen and past the horizon, lod by distance
  const sets = useMemo(() => {
    const L = new ChunkSet(layout.land, tiles, geo, geoLo, landMat, { cast: shadow, receive: true, pick: true })
    const S = new ChunkSet(layout.stacks.map((x) => x.tile), tiles, blockGeo, blockGeoLo, landMat, { cast: shadow, receive: true, pick: true })
    const O = new ChunkSet(layout.sea, tiles, geoLo, geoLo, ocean.mat, { receive: true, pick: true })
    const F = new ChunkSet(layout.coast.map((x) => x.tile), tiles, foamGeo, foamGeo, foam.mat)
    const G = new ChunkSet(layout.land, tiles, geoLo, geoLo, glowMat, { renderOrder: 2 })
    return { L, S, O, F, G }
  }, [layout, tiles, geo, geoLo, blockGeo, blockGeoLo, foamGeo, landMat, ocean.mat, foam.mat, glowMat, shadow])
  useEffect(() => () => { for (const x of Object.values(sets)) x.dispose() }, [sets])

  useLayoutEffect(() => {
    const { L, S, O, F, G } = sets
    const mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3()
    layout.land.forEach((ti, k) => {
      const t = tiles[ti]
      const up = lift && t.region >= 0 ? lift[t.region] : 0
      pos.copy(t.normal).multiplyScalar(LAND_TOP - TILE_H / 2 + up / 2)
      L.setMatrixAt(k, mtx.compose(pos, t.quat, scl.set(t.w * 1.03, 1 + up / TILE_H, t.d * 1.03)))
      const top = LAND_TOP + t.band * STEP + (lift && t.region >= 0 ? lift[t.region] : 0)
      pos.copy(t.normal).multiplyScalar(top - TILE_H / 2)
      G.setMatrixAt(k, mtx.compose(pos, t.quat, layout.border[ti] ? scl.set(t.w * 1.02, 1.08, t.d * 1.02) : scl.set(0, 0, 0)))
    })
    layout.stacks.forEach(({ tile, level }, k) => {
      const t = tiles[tile]
      // each block a little narrower than the one under it: chunky stepped ridges
      const inset = 1 - level * 0.09
      pos.copy(t.normal).multiplyScalar(LAND_TOP + (level - 0.5) * STEP + (lift && t.region >= 0 ? lift[t.region] : 0))
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
    for (const m of [L, S, O, F, G]) m.commitMatrices()
  }, [tiles, layout, lift, sets])

  // colors: biome tinted by region, real seasonal snow, drought pales, unrest glows ember on borders
  useEffect(() => {
    const { L, S, O, G } = sets
    const d = tickToDate(month)
    const doy = (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000
    // northern snow line: about 40N in mid january, back to 60N by mid july
    const winter = (Math.cos(((doy - 15) / 365) * Math.PI * 2) + 1) / 2
    const snowLat = 60 - 20 * winter
    const regionCols = frame.regions.map((r) => new THREE.Color(r.color))
    const dry = frame.regions.map((r) => r.foodKcalPerCapita < 2150 || frame.newEvents.some((e) => (e.kind === 'famine' || /drought/i.test(e.text)) && e.regionId === r.id))
    const ember = new THREE.Color(C.ember), off = new THREE.Color(0, 0, 0)
    const col = new THREE.Color(), tmp = new THREE.Color()
    const modeCols = frame.regions.map((r) => { const h = regionModeColor(overlay, frame, r); return h ? new THREE.Color(h) : null })
    // v4: the place-stat overlays use the tile's real country when the sim tracks it
    const byIso = new Map((frame.countries ?? []).map((c) => [c.id, c]))
    const countryCols = isStatMode(overlay) && places ? places.COUNTRY_TABLE.map((ct) => { const c = byIso.get(ct.iso3); return c ? new THREE.Color(statColor(overlay, c.stats)) : null }) : null
    const tc = countryCols && places ? places.tileCountries(tiles) : null
    const surface = (ti: number, level: number) => {
      const t = tiles[ti]
      const cc = tc && countryCols && tc[ti] >= 0 ? countryCols[tc[ti]] : null
      const mc = cc ?? (t.region >= 0 ? modeCols[t.region] : null)
      if (mc) return col.copy(mc).multiplyScalar(0.94 + hash01(ti) * 0.08 + level * 0.03)
      const vis = t.region >= 0 ? frame.regions[t.region].visual : undefined
      // v5: real land (B's land classes: forest, cropland, desert, built...) once the far tiles have loaded
      if (farTiles && !t.ice && realLandColor(ti, col, { snowLat, lat: t.lat, forest: vis?.forest, pollution: vis?.pollution })) {
        if (vis && vis.damage.level > 0.05 && SCAR[vis.damage.kind]) col.lerp(SCAR[vis.damage.kind], vis.damage.level * 0.65)
        // a food-short region dries its fields and grassland, never its forests
        const cls = tileClass(farTiles, ti) // 4 grass/scrub, 7 cropland (see public/geo/far/tiles.json classes)
        if (t.region >= 0 && dry[t.region] && (cls === 7 || cls === 4)) col.lerp(DRY, 0.3)
        if (level >= 2) col.lerp(ROCK, 0.25 * level)
        col.multiplyScalar(0.96 + ((ti * 2654435761) % 1000) / 1000 * 0.08)
        return col
      }
      col.set(BIOME_HEX[t.biome])
      if (t.region >= 0) col.lerp(regionCols[t.region], 0.22)
      if (vis && overlay === 'real' && !t.ice) {
        if (t.biome !== 'desert' && t.biome !== 'tundra') col.lerp(FOREST, Math.max(0, vis.forest - 0.3) * 0.5)
        if ((t.biome === 'temperate' || t.biome === 'savanna') && hash01(ti * 31) < vis.farmland * 0.55) col.lerp(FIELD, 0.45)
        col.lerp(SMOG, vis.pollution * 0.3)
        if (vis.damage.level > 0.05 && SCAR[vis.damage.kind]) col.lerp(SCAR[vis.damage.kind], vis.damage.level * 0.65)
      }
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
    // pollution murks the ocean; data modes pale it so the land reads
    const murk = overlay === 'real' ? frame.regions.reduce((a, r) => a + (r.visual?.pollution ?? 0) * r.population, 0) / Math.max(1, frame.regions.reduce((a, r) => a + r.population, 0)) : 0
    layout.sea.forEach((ti, k) => {
      col.set(DEPTH_HEX[tiles[ti].depth]).multiplyScalar(0.97 + ((ti * 7919) % 100) / 100 * 0.06)
      if (overlay !== 'real') col.lerp(PALE_SEA, 0.55)
      else if (murk > 0.2) col.lerp(MURK, (murk - 0.2) * 0.7)
      O.setColorAt(k, col)
    })
    for (const m of [L, S, O, G]) m.commitColors()
  }, [frame, tiles, layout, month, overlay, sets, places, farTiles])

  useFrame(({ clock, camera }) => {
    ocean.uniforms.uTime.value = clock.elapsedTime
    foam.uniforms.uTime.value = clock.elapsedTime
    glowMat.opacity = 0.55 + Math.sin(clock.elapsedTime * 2.4) * 0.25
    // high poly only for patches within ~9 units of the camera: only ever true up close
    for (const x of Object.values(sets)) x.update(camera.position, LAND_TOP, 9)
  })

  const pick = (list: number[], set: ChunkSet) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.instanceId == null) return
    const k = set.globalId(e.object, e.instanceId)
    const ti = k !== undefined ? list[k] : -1
    const t = ti >= 0 ? tiles[ti] : undefined
    if (!t) return
    const sel = placeForTile(ti)
    if (sel) select(sel)
    else if (t.region >= 0) select({ kind: 'region', id: frame.regions[t.region].id })
  }
  // the most specific real place a tile belongs to (see geo/resolve.ts)
  const placeForTile = (ti: number) => (places ? places.placeForTile(frame, ti, useStore.getState().zoom) : null)
  const stackTiles = useMemo(() => layout.stacks.map((s) => s.tile), [layout])
  // hovering land names its region in one plain line: the labels only show the biggest few
  const tipFor = (list: number[], set: ChunkSet) => (e: ThreeEvent<PointerEvent>) => {
    const k = e.instanceId != null ? set.globalId(e.object, e.instanceId) : undefined
    if (k === undefined) return
    // one line: the place's name and population (or the sea's name)
    const sel = placeForTile(list[k])
    const line = sel && places ? places.hoverLine(frame, sel) : null
    if (line) useStore.getState().setTip({ ...line, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
  }
  const hoverOn = (list: number[], set: ChunkSet) => ({
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = 'pointer' },
    onPointerMove: tipFor(list, set),
    onPointerOut: () => { document.body.style.cursor = ''; useStore.getState().setTip(null) },
  })
  return (
    <group>
      <mesh>
        <sphereGeometry args={[R - 0.2, 64, 48]} />
        <meshToonMaterial color={C.grout} gradientMap={toonGradient()} />
      </mesh>
      <primitive object={sets.O.group} onClick={pick(layout.sea, sets.O)} {...hoverOn(layout.sea, sets.O)} />
      <primitive object={sets.F.group} />
      <primitive object={sets.L.group} onClick={pick(layout.land, sets.L)} {...hoverOn(layout.land, sets.L)} />
      <primitive object={sets.S.group} onClick={pick(stackTiles, sets.S)} {...hoverOn(stackTiles, sets.S)} />
      <primitive object={sets.G.group} />
    </group>
  )
}
