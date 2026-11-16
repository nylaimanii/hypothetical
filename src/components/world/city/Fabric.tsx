'use client'
// renders the city fabric built by fabricBuild.ts (the real city around the lots, and the surround into the fog):
// facades whose windows light up by the hour, roofs by kind, informal homes, tents, shop signs that glow at night,
// rooftop tanks, poles and wires, lamps with pools of light, trees. it grows up out of the ground on arrival.
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { toonGradient } from '../lib'
import { FLOOR, GROUND_FLOOR as GF, ROAD_Y } from './grid'
import { SUR, type Built, type Item } from './fabricBuild'
import type { Look } from './looks'

// ---- materials ----
// facades with windows in world space (a floor every FLOOR, a column every 0.62), lit at night by uLit;
// shop fronts glow in the evening. windows blur to their average far away so they never shimmer
export function wallMaterial(u: { uNight: { value: number }; uLit: { value: number }; uShop: { value: number } }, base: number) {
  const m = new THREE.MeshToonMaterial({ gradientMap: toonGradient() })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aShop;\nvarying vec3 vW;\nvarying vec3 vNw;\nvarying float vSeed;\nvarying float vShop;\nvarying float vLy;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLy = position.y;
        vec4 wq = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vW = wq.xyz;
        vNw = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        vSeed = float(gl_InstanceID);
        vShop = aShop;`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; uniform float uLit; uniform float uShop;
        varying vec3 vW; varying vec3 vNw; varying float vSeed; varying float vShop; varying float vLy;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        {
          float side = step(0.5, 1.0 - abs(vNw.y));
          float hz = abs(vNw.x) > abs(vNw.z) ? vW.z : vW.x;
          float fy = vW.y - ${base.toFixed(3)} - (vShop > 0.5 ? ${GF.toFixed(2)} : 0.0);
          vec2 g = vec2(hz / 0.62, fy / ${FLOOR.toFixed(2)});
          vec2 f = fract(g);
          float win = step(0.24, f.x) * step(f.x, 0.76) * step(0.3, f.y) * step(f.y, 0.8) * step(0.0, fy) * step(vLy, 0.985);
          float lit = step(h21(floor(g) + vSeed * 1.37), uLit);
          // far away (or tiny on screen): the average of the pattern instead of the pattern
          float aa = clamp(1.6 - fwidth(g.x) * 2.5, 0.0, 1.0);
          float winA = mix(0.26 * step(0.0, fy) * step(vLy, 0.985), win, aa);
          float litA = mix(uLit, lit, aa);
          vec3 glass = vec3(0.23, 0.26, 0.3);
          vec3 warm = vec3(1.0, 0.77, 0.46);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(glass, warm * 2.1, litA * uNight), winA * side * 0.9);
          float gfy = vW.y - ${base.toFixed(3)};
          float shopf = vShop * side * step(0.08, gfy) * step(gfy, ${(GF * 0.78).toFixed(2)}) * step(0.12, fract(hz / 1.3)) * step(fract(hz / 1.3), 0.88);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(vec3(0.2, 0.22, 0.24), warm * 1.9, uShop), shopf * 0.9);
        }`)
  }
  m.customProgramCacheKey = () => 'citywall'
  return m
}

export const toon = (color = '#ffffff') => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() })

// a roof prism: ridge along x, unit size, base at y 0
export function prismGeo() {
  const s = new THREE.Shape()
  s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.lineTo(-0.5, 0)
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false })
  g.translate(0, 0, -0.5)
  g.rotateY(Math.PI / 2)
  g.computeVertexNormals()
  return g
}
// a tent: a low prism
const tentGeo = prismGeo

export function Inst({ geo, mat, items, shadow = false, receive = true, attr }: { geo: THREE.BufferGeometry; mat: THREE.Material; items: Item[]; shadow?: boolean; receive?: boolean; attr?: 'shop' }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color()
    const shop = new Float32Array(Math.max(1, items.length))
    items.forEach((it, i) => {
      q.setFromEuler(e.set(0, it.ry ?? 0, 0))
      m.setMatrixAt(i, mtx.compose(new THREE.Vector3(...it.p), q, new THREE.Vector3(...it.s)))
      if (it.c) m.setColorAt(i, col.set(it.c))
      shop[i] = it.shop ?? 0
    })
    if (attr) geo.setAttribute('aShop', new THREE.InstancedBufferAttribute(shop, 1))
    m.count = items.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [items, geo, attr])
  if (!items.length) return null
  return <instancedMesh ref={ref} args={[geo, mat, items.length]} castShadow={shadow} receiveShadow={receive} raycast={() => null} frustumCulled={false} />
}

export default function Fabric({ built: B, look, groundY, night, litShare, shopLit }: { built: Built; look: Look; groundY: number; night: () => number; litShare: () => number; shopLit: () => number }) {
  const u = useMemo(() => ({ uNight: { value: 0 }, uLit: { value: 0 }, uShop: { value: 0 } }), [])
  // the city grows up out of the ground on arrival (one scale on the whole group, so roofs stay on their walls)
  const group = useRef<THREE.Group>(null)
  const grow = useRef(0)
  const geos = useMemo(() => {
    const unitBox = new THREE.BoxGeometry(1, 1, 1); unitBox.translate(0, 0.5, 0)
    const unitBoxFar = unitBox.clone()
    return {
      box: unitBox, boxFar: unitBoxFar, plain: new THREE.BoxGeometry(1, 1, 1), prism: prismGeo(), tent: tentGeo(),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10), cap: new THREE.ConeGeometry(0.5, 1, 10),
      crown: new THREE.IcosahedronGeometry(0.5, 1), palm: (() => { const g = new THREE.ConeGeometry(0.5, 1, 7, 1, true); g.rotateX(Math.PI); return g })(),
      umbrella: new THREE.ConeGeometry(0.5, 1, 8), disc: (() => { const g = new THREE.CircleGeometry(0.5, 20); g.rotateX(-Math.PI / 2); return g })(),
    }
  }, [])
  const mats = useMemo(() => {
    const glow = (k: number) => new THREE.ShaderMaterial({
      uniforms: { uNight: u.uNight, uK: { value: k } },
      vertexShader: 'varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uNight; uniform float uK; varying vec2 vP; void main() { float d = length(vP) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.0) * uK * uNight; gl_FragColor = vec4(vec3(1.0, 0.78, 0.48) * a, a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    })
    return {
      wall: wallMaterial(u, groundY), roof: toon(), shack: toon(), tent: toon(),
      pad: toon(), sidewalk: toon(look.sidewalk), green: toon(look.trees.kind === 'palm' || look.id === 'mideast' ? '#9DA56E' : '#8DA86F'), sign: new THREE.MeshBasicMaterial({ toneMapped: false }),
      steel: toon('#8E9196'), pole: toon(), wire: new THREE.MeshBasicMaterial({ color: '#2B2B2D' }), lampHead: new THREE.MeshBasicMaterial({ color: '#E8E4D8', toneMapped: false }),
      glow: glow(0.55), farGlow: glow(0.9), trunk: toon(), crown: toon(), umbrella: toon(), table: toon(),
    }
  }, [u, groundY, look])

  useFrame((_, dt) => {
    grow.current = Math.min(1, grow.current + dt * 0.9)
    if (group.current) group.current.scale.y = Math.max(0.001, 1 - Math.pow(1 - grow.current, 3))
    const n = night()
    u.uNight.value = n
    u.uLit.value = litShare()
    u.uShop.value = shopLit()
    // signs are painted by day and lit at night; lamp heads come on at dusk
    mats.sign.color.setScalar(0.85 + 1.1 * n)
    mats.lampHead.color.set(n > 0.3 ? look.lamp : '#C9C6BE').multiplyScalar(n > 0.3 ? 2.2 : 1)
  })

  return (
    <group ref={group}>
      {/* the ground of the surround: streets everywhere, blocks sit on it */}
      <mesh position={[0, ROAD_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[SUR + 40, 48]} />
        <meshToonMaterial color={look.street} gradientMap={toonGradient()} />
      </mesh>
      <Inst geo={geos.plain} mat={mats.sidewalk} items={B.sidewalks} />
      <Inst geo={geos.plain} mat={mats.pad} items={B.pads} />
      <Inst geo={geos.plain} mat={mats.green} items={B.green} />
      <Inst geo={geos.box} mat={mats.wall} items={B.walls} shadow attr="shop" />
      <Inst geo={geos.boxFar} mat={mats.wall} items={B.wallsFar} attr="shop" />
      <Inst geo={geos.plain} mat={mats.roof} items={B.flat} />
      <Inst geo={geos.prism} mat={mats.roof} items={B.prism} shadow />
      <Inst geo={geos.prism} mat={mats.roof} items={B.iron} shadow />
      <Inst geo={geos.box} mat={mats.shack} items={B.shackWalls} shadow />
      <Inst geo={geos.plain} mat={mats.roof} items={B.shackRoofs} />
      <Inst geo={geos.tent} mat={mats.tent} items={B.tents} shadow />
      <Inst geo={geos.plain} mat={mats.sign} items={B.signs} receive={false} />
      <Inst geo={geos.cyl} mat={mats.roof} items={B.tanks} />
      <Inst geo={geos.cap} mat={mats.roof} items={B.tankCaps} />
      <Inst geo={geos.plain} mat={mats.roof} items={B.ac} />
      <Inst geo={geos.plain} mat={mats.steel} items={B.steel} shadow />
      <Inst geo={geos.plain} mat={mats.pole} items={B.poles} />
      <Inst geo={geos.plain} mat={mats.wire} items={B.wires} receive={false} />
      <Inst geo={geos.plain} mat={mats.pole} items={B.lamps} />
      <Inst geo={geos.plain} mat={mats.lampHead} items={B.lampHeads} receive={false} />
      <Inst geo={geos.disc} mat={mats.glow} items={B.glows} receive={false} />
      <Inst geo={geos.disc} mat={mats.farGlow} items={B.farGlows} receive={false} />
      <Inst geo={geos.cyl} mat={mats.trunk} items={B.trunks} shadow />
      <Inst geo={geos.crown} mat={mats.crown} items={B.crowns} shadow />
      <Inst geo={geos.palm} mat={mats.crown} items={B.palms} shadow />
    </group>
  )
}
