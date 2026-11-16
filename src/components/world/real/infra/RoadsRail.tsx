'use client'
// real roads and rail (natural earth via B's data/geo), streamed by view at mid zoom: chunky raised ribbons draped on the
// land, rail darker with a faint warm glow on the night side, and tiny traffic dots riding them. dot density follows
// the country's traffic in the frame (trafficFrame, per country) times the sim's hourly shape at the dot's local time.
// three draw calls in total: roads, rail, dots.
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Frame } from '@/lib/types'
import { groundRadius, latLonToVec3, sceneRefs } from '../../lib'
import { useStore } from '../../../state/store'
import { utcHourOf, worldDate } from '../../time'
import { HOURLY, decode, midFade, trafficOf, useInfraCells, type CellData } from './stream'

const ROAD_W = 0.012, RAIL_W = 0.012 // thin: roads read as quiet seams at mid zoom
const LIFT = 0.014
const MAX_DOTS = 14000
const SLOTS = 64

type Built = { roads: THREE.BufferGeometry; rail: THREE.BufferGeometry; dots: THREE.BufferGeometry; countries: string[] }

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _s = new THREE.Vector3()

// one ribbon per polyline, flat on the surface, merged into a single geometry
function ribbons(lines: { pts: [number, number][] }[], width: number) {
  const pos: number[] = [], nor: number[] = [], idx: number[] = []
  for (const { pts } of lines) {
    for (let i = 0; i < pts.length - 1; i++) {
      latLonToVec3(pts[i][1], pts[i][0], 1, _a); latLonToVec3(pts[i + 1][1], pts[i + 1][0], 1, _b)
      _n.copy(_a).add(_b).normalize()
      const ra = groundRadius(_a) + LIFT, rb = groundRadius(_b) + LIFT
      _s.copy(_b).sub(_a).cross(_n).normalize().multiplyScalar(width / 2)
      if (!Number.isFinite(_s.x)) continue
      const v = pos.length / 3
      const pa = _a.clone().multiplyScalar(ra), pb = _b.clone().multiplyScalar(rb)
      pos.push(pa.x + _s.x, pa.y + _s.y, pa.z + _s.z, pa.x - _s.x, pa.y - _s.y, pa.z - _s.z, pb.x + _s.x, pb.y + _s.y, pb.z + _s.z, pb.x - _s.x, pb.y - _s.y, pb.z - _s.z)
      for (let k = 0; k < 4; k++) nor.push(_n.x, _n.y, _n.z)
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

function build(cells: CellData[]): Built {
  const countries: string[] = []
  const slot = (code: string) => { let i = countries.indexOf(code); if (i < 0 && countries.length < SLOTS) { countries.push(code); i = countries.length - 1 } return Math.max(0, i) }
  const roadLines: { pts: [number, number][] }[] = [], railLines: { pts: [number, number][] }[] = []
  // dots: per segment endpoints, phase, speed, country slot, mode, longitude, threshold
  const A: number[] = [], B: number[] = [], P: number[] = [], S: number[] = [], C: number[] = [], M: number[] = [], L: number[] = [], T: number[] = []
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const addDots = (pts: [number, number][], code: string, mode: number, major: boolean) => {
    const sl = slot(code)
    for (let i = 0; i < pts.length - 1 && A.length / 3 < MAX_DOTS; i++) {
      const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
      const n = Math.min(6, Math.round(len * (mode ? 3 : major ? 4 : 2) + rnd() * 0.8))
      if (!n) continue
      latLonToVec3(pts[i][1], pts[i][0], 1, _a); latLonToVec3(pts[i + 1][1], pts[i + 1][0], 1, _b)
      const ra = groundRadius(_a) + LIFT + 0.01, rb = groundRadius(_b) + LIFT + 0.01
      for (let k = 0; k < n; k++) {
        A.push(_a.x * ra, _a.y * ra, _a.z * ra); B.push(_b.x * rb, _b.y * rb, _b.z * rb)
        P.push(rnd()); S.push((mode ? 0.5 : 0.25) * (0.7 + rnd() * 0.6) / Math.max(0.2, len)); C.push(sl); M.push(mode); L.push(pts[i][0]); T.push(rnd())
      }
    }
  }
  for (const c of cells) {
    for (const [t, ci, e] of c.roads) { const pts = decode(e, c.q); roadLines.push({ pts }); addDots(pts, c.countries[ci], 0, t === 1) }
    for (const [ci, e] of c.rail) { const pts = decode(e, c.q); railLines.push({ pts }); addDots(pts, c.countries[ci], 1, true) }
  }
  const dots = new THREE.BufferGeometry()
  dots.setAttribute('position', new THREE.Float32BufferAttribute(A, 3))
  dots.setAttribute('aB', new THREE.Float32BufferAttribute(B, 3))
  dots.setAttribute('aPhase', new THREE.Float32BufferAttribute(P, 1))
  dots.setAttribute('aSpeed', new THREE.Float32BufferAttribute(S, 1))
  dots.setAttribute('aSlot', new THREE.Float32BufferAttribute(C, 1))
  dots.setAttribute('aMode', new THREE.Float32BufferAttribute(M, 1))
  dots.setAttribute('aLon', new THREE.Float32BufferAttribute(L, 1))
  dots.setAttribute('aTh', new THREE.Float32BufferAttribute(T, 1))
  dots.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12)
  return { roads: ribbons(roadLines, ROAD_W), rail: ribbons(railLines, RAIL_W), dots, countries }
}

// rail glows warm where the sun has set
function railMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: '#4B4540' })
  const u = { uSun: { value: new THREE.Vector3(1, 0, 0) }, uFade: { value: 1 } }
  m.transparent = true
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vUp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvUp = normalize(position);')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSun; uniform float uFade; varying vec3 vUp;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nfloat night = smoothstep(0.05, -0.25, dot(vUp, uSun));\ngl_FragColor.rgb += vec3(1.0, 0.62, 0.3) * night * 0.35;\ngl_FragColor.a *= uFade;')
  }
  return { m, u }
}

const DOT_VS = `
  attribute vec3 aB; attribute float aPhase; attribute float aSpeed; attribute float aSlot; attribute float aMode; attribute float aLon; attribute float aTh;
  uniform float uTime; uniform float uUtc; uniform float uFade; uniform float uRoad[24]; uniform float uRail[24];
  uniform float uActRoad[${SLOTS}]; uniform float uActRail[${SLOTS}];
  varying float vVis; varying float vMode; varying vec3 vUp;
  void main() {
    float t = fract(aPhase + uTime * aSpeed);
    vec3 p = mix(position, aB, t);
    float h = mod(uUtc + aLon / 15.0 + 24.0, 24.0);
    int hi = int(floor(h));
    int s = int(aSlot);
    float prof = aMode > 0.5 ? uRail[hi] : uRoad[hi];
    float act = aMode > 0.5 ? uActRail[s] : uActRoad[s];
    vVis = (act * prof > aTh ? 1.0 : 0.0) * uFade;
    vMode = aMode;
    vUp = normalize(p);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = vVis > 0.0 ? (aMode > 0.5 ? 46.0 : 34.0) / -mv.z : 0.0;
  }`
const DOT_FS = `
  uniform vec3 uSun; varying float vVis; varying float vMode; varying vec3 vUp;
  void main() {
    if (vVis <= 0.0) discard;
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    float night = smoothstep(0.05, -0.25, dot(vUp, uSun));
    vec3 day = mix(vec3(0.95, 0.93, 0.88), vec3(0.85, 0.83, 0.8), vMode);
    vec3 dark = mix(vec3(1.0, 0.78, 0.45), vec3(1.0, 0.9, 0.7), vMode);
    gl_FragColor = vec4(mix(day, dark, night), vVis);
  }`

export default function RoadsRail({ frame }: { frame: Frame }) {
  const cells = useInfraCells()
  const built = useMemo(() => (cells.length ? build(cells) : null), [cells])
  useEffect(() => () => { if (built) { built.roads.dispose(); built.rail.dispose(); built.dots.dispose() } }, [built])
  const group = useRef<THREE.Group>(null)
  // roads read as quiet seams in the clay, not a bright web
  // roads read as quiet seams in the clay by day; at night their street lights glow warm
  const roadMat = useMemo(() => new THREE.MeshLambertMaterial({ color: '#8C8377', emissive: '#FFB45A', emissiveIntensity: 0, transparent: true, depthWrite: false }), [])
  const rail = useMemo(() => railMaterial(), [])
  const dotMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: DOT_VS, fragmentShader: DOT_FS, transparent: true, depthWrite: false, toneMapped: false,
    uniforms: {
      uTime: { value: 0 }, uUtc: { value: 8 }, uFade: { value: 0 }, uSun: { value: new THREE.Vector3(1, 0, 0) },
      uRoad: { value: HOURLY.road }, uRail: { value: HOURLY.rail },
      uActRoad: { value: new Array(SLOTS).fill(0.7) }, uActRail: { value: new Array(SLOTS).fill(0.6) },
    },
  }), [])
  // per country traffic for the slots in view; the country order is listed once on the run's first frame
  const order = useStore((s) => trafficOf(s.record.frames[0])?.countries)
  useEffect(() => {
    if (!built) return
    const t = trafficOf(frame)
    const road = dotMat.uniforms.uActRoad.value as number[], railA = dotMat.uniforms.uActRail.value as number[]
    built.countries.forEach((code, i) => {
      const k = order ? order.indexOf(code) : -1
      road[i] = t && k >= 0 ? t.road[k] ?? 0.7 : 0.7
      railA[i] = t && k >= 0 ? t.rail[k] ?? 0.6 : 0.6
    })
  }, [frame, built, order, dotMat])

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const fade = midFade()
    g.visible = fade > 0.01 && !!built
    if (!g.visible) return
    const s = useStore.getState()
    dotMat.uniforms.uTime.value = clock.elapsedTime
    dotMat.uniforms.uUtc.value = utcHourOf(worldDate(s.playhead, s.hour, s.playing))
    dotMat.uniforms.uFade.value = fade
    ;(dotMat.uniforms.uSun.value as THREE.Vector3).copy(sceneRefs.sunDir)
    rail.u.uSun.value.copy(sceneRefs.sunDir)
    rail.u.uFade.value = fade
    roadMat.opacity = fade * (0.55 + 0.35 * sceneRefs.night)
    roadMat.emissiveIntensity = 1.4 * sceneRefs.night
  })
  return (
    <group ref={group} visible={false}>
      {built && (
        <>
          <mesh geometry={built.roads} material={roadMat} raycast={() => null} />
          <mesh geometry={built.rail} material={rail.m} raycast={() => null} renderOrder={1} />
          <points geometry={built.dots} material={dotMat} frustumCulled={false} raycast={() => null} renderOrder={2} />
        </>
      )}
    </group>
  )
}
