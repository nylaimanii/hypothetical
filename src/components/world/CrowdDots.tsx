'use client'
// v4 crowd dots: at mid zoom every city on earth gets a small street grid and tiny dots streaming
// between homes, work and shops. all motion runs in the vertex shader: one Points draw for every dot
// in every city, one LineSegments draw for every street. the cpu only updates a few per-city uniforms
// (how busy the city is at its local hour, revolt, night glow, horizon visibility) once per frame.
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Frame } from '@/lib/types'
import { LAND_TOP, ZOOM_CLOSE, ZOOM_FAR, groundRadius, latLonToVec3, sceneRefs, tangentBasis } from './lib'
import { localHour, utcHourOf, worldDate } from './time'
import { useStore } from '../state/store'
import { useCallouts, type Callout } from './explain'

const MAX_CITIES = 64
const MAX_DOTS = 20000

// how busy streets are at a local hour: rush hours, a moderate midday, near empty nights
export function busyAt(h: number) {
  const bump = (x: number, c: number, w: number) => Math.exp(-((x - c) * (x - c)) / (2 * w * w))
  const night = 0.04
  const morning = bump(h, 8, 0.9)
  const evening = 0.9 * bump(h, 17.5, 1.2)
  const day = h > 9.5 && h < 16 ? 0.45 : 0.45 * Math.max(bump(h, 9.5, 0.6), bump(h, 16, 0.6))
  const eve = h > 19 && h < 22.5 ? 0.22 : 0
  return Math.min(1, Math.max(night, morning, evening, day, eve))
}

// tiny deterministic rng per city
function rng(seed: number) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

type CitySpot = { id: string; name: string; regionId: string; lon: number; pop: number; n: THREE.Vector3; top: THREE.Vector3; rail: boolean }

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  uniform float uSize;
  uniform float uAct[${MAX_CITIES}];
  uniform float uRevolt[${MAX_CITIES}];
  uniform float uNight[${MAX_CITIES}];
  uniform float uVis[${MAX_CITIES}];
  uniform vec3 uCenter[${MAX_CITIES}];
  attribute vec3 aP1;
  attribute vec3 aP2;
  attribute vec4 aDot; // city index, phase, speed, threshold
  attribute float aRail;
  varying float vAlpha;
  varying float vNight;
  varying float vRail;
  void main() {
    int ci = int(aDot.x + 0.5);
    float act = uAct[ci];
    float vis = uVis[ci] * step(aDot.w, act) * uFade;
    vec3 p0 = position;
    float rad = length(p0) + 0.012;
    // out to work or the shop and back home: a triangle wave along an L shaped street path
    float t = fract(uTime * aDot.z + aDot.y);
    float tri = 1.0 - abs(2.0 * t - 1.0);
    float l1 = distance(p0, aP1), l2 = distance(aP1, aP2);
    float s = tri * (l1 + l2);
    vec3 p = s < l1 ? mix(p0, aP1, s / max(l1, 1e-4)) : mix(aP1, aP2, (s - l1) / max(l2, 1e-4));
    // revolt: most people leave the streets for the central square and mill about there
    float rev = uRevolt[ci] * step(0.15, fract(aDot.y * 7.31));
    vec3 c = uCenter[ci];
    vec3 square = mix(c, p0, 0.07 + 0.05 * sin(uTime * 1.3 + aDot.y * 40.0));
    p = mix(p, square, rev);
    p = normalize(p) * rad;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = vis > 0.0 ? uSize * (1.0 + aRail * 0.5) / -mv.z : 0.0;
    vAlpha = vis;
    vNight = uNight[ci];
    vRail = aRail;
  }
`

const fragment = /* glsl */ `
  varying float vAlpha;
  varying float vNight;
  varying float vRail;
  void main() {
    if (vAlpha <= 0.0) discard;
    vec2 q = gl_PointCoord - 0.5;
    float r = dot(q, q);
    if (r > 0.25) discard;
    // bone white by day, a faint warm glow at night; rail riders a touch brighter
    vec3 day = vec3(0.96, 0.93, 0.87);
    vec3 night = vec3(1.35, 1.0, 0.62);
    vec3 col = mix(day, night, vNight) * (1.0 + vRail * 0.35);
    gl_FragColor = vec4(col, vAlpha * (1.0 - r * 2.0));
  }
`

function buildCities(frame: Frame): CitySpot[] {
  return frame.cities
    .filter((c) => !c.offWorld)
    .slice(0, MAX_CITIES)
    .map((c) => {
      const n = latLonToVec3(c.lat, c.lon, 1).normalize()
      const region = frame.regions.find((r) => r.id === c.regionId)
      const top = n.clone().multiplyScalar(groundRadius(n.clone().multiplyScalar(LAND_TOP)) + 0.02)
      return { id: c.id, name: c.name, regionId: c.regionId, lon: c.lon, pop: Math.max(5e4, c.population), n, top, rail: !!region?.visual?.railLinks?.length }
    })
}

// grid size and dot budget per city
const halfOf = (pop: number) => Math.min(0.8, Math.max(0.3, 0.26 + Math.sqrt(pop / 1e6) * 0.12))
const dotsOf = (pop: number) => Math.min(1400, Math.max(80, Math.round(Math.sqrt(pop / 1e6) * 300)))

function buildGeometry(cities: CitySpot[]) {
  const total0 = cities.reduce((a, c) => a + dotsOf(c.pop) + (c.rail ? 40 : 0), 0)
  const scale = Math.min(1, MAX_DOTS / Math.max(1, total0))
  const p0: number[] = [], p1: number[] = [], p2: number[] = [], dot: number[] = [], rail: number[] = []
  const streets: number[] = []
  const v = new THREE.Vector3()
  cities.forEach((c, ci) => {
    const { east, north } = tangentBasis(c.n)
    const r = c.top.length()
    const H = halfOf(c.pop)
    const G = c.pop > 8e6 ? 6 : c.pop > 2e6 ? 5 : 4
    const step = (2 * H) / (G - 1)
    const at = (u: number, w: number, rad = r) => v.copy(c.n).multiplyScalar(rad).addScaledVector(east, u).addScaledVector(north, w).normalize().multiplyScalar(rad)
    // streets: grid lines, each cut into short pieces so they hug the curved surface
    for (let i = 0; i < G; i++) {
      const k = -H + i * step
      for (let s = 0; s < 6; s++) {
        const a = -H + (2 * H * s) / 6, b = -H + (2 * H * (s + 1)) / 6
        streets.push(...at(k, a, r - 0.004).toArray(), ...at(k, b, r - 0.004).toArray())
        streets.push(...at(a, k, r - 0.004).toArray(), ...at(b, k, r - 0.004).toArray())
      }
    }
    const rand = rng(1 + ci * 7919 + Math.round(c.pop / 1000))
    const node = (bias: number) => {
      // work and shops lean toward the middle of town, homes spread out
      const pick = () => { const x = rand() * 2 - 1; return Math.round(((Math.sign(x) * Math.pow(Math.abs(x), bias) + 1) / 2) * (G - 1)) }
      return [-H + pick() * step, -H + pick() * step] as const
    }
    const n = Math.round(dotsOf(c.pop) * scale)
    for (let d = 0; d < n; d++) {
      const kind = rand()
      const a = kind < 0.85 ? node(1) : node(2.2)
      const b = kind < 0.6 ? node(2.2) : node(1.6)
      const corner = rand() < 0.5 ? [a[0], b[1]] : [b[0], a[1]]
      p0.push(...at(a[0], a[1]).toArray())
      p1.push(...at(corner[0], corner[1]).toArray())
      p2.push(...at(b[0], b[1]).toArray())
      // ci, phase, speed (round trips per second), visibility threshold
      dot.push(ci, rand(), 0.025 + rand() * 0.035, rand() * 0.98)
      rail.push(0)
    }
    if (c.rail) {
      // one straight line through town, a little brighter and faster
      for (let d = 0; d < Math.round(40 * scale); d++) {
        const w = (rand() - 0.5) * 0.04
        p0.push(...at(-H * 1.4, w).toArray())
        p1.push(...at(0, w).toArray())
        p2.push(...at(H * 1.4, w).toArray())
        dot.push(ci, rand(), 0.06 + rand() * 0.03, rand() * 0.9)
        rail.push(1)
      }
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(p0, 3))
  g.setAttribute('aP1', new THREE.Float32BufferAttribute(p1, 3))
  g.setAttribute('aP2', new THREE.Float32BufferAttribute(p2, 3))
  g.setAttribute('aDot', new THREE.Float32BufferAttribute(dot, 4))
  g.setAttribute('aRail', new THREE.Float32BufferAttribute(rail, 1))
  const lines = new THREE.BufferGeometry()
  lines.setAttribute('position', new THREE.Float32BufferAttribute(streets, 3))
  return { dots: g, lines }
}

const fmtPeople = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : `${Math.round(n / 1000)} thousand`)

export default function CrowdDots({ frame }: { frame: Frame }) {
  // rebuild the layout only when the set of cities changes, not every month
  const key = frame.cities.filter((c) => !c.offWorld).map((c) => `${c.id}:${Math.round(Math.log2(Math.max(1, c.population)))}`).join() +
    '|' + frame.regions.map((r) => (r.visual?.railLinks?.length ? 1 : 0)).join('')
  const cities = useMemo(() => buildCities(frame), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const geo = useMemo(() => buildGeometry(cities), [cities])
  useEffect(() => () => { geo.dots.dispose(); geo.lines.dispose() }, [geo])
  const frameRef = useRef(frame)
  useEffect(() => { frameRef.current = frame }, [frame])

  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uTime: { value: 0 }, uFade: { value: 0 }, uSize: { value: 42 },
      uAct: { value: new Array(MAX_CITIES).fill(0) }, uRevolt: { value: new Array(MAX_CITIES).fill(0) },
      uNight: { value: new Array(MAX_CITIES).fill(0) }, uVis: { value: new Array(MAX_CITIES).fill(0) },
      uCenter: { value: Array.from({ length: MAX_CITIES }, () => new THREE.Vector3()) },
    },
    transparent: true, depthWrite: false, toneMapped: false,
  }), [])
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#1D1B19', transparent: true, opacity: 0, depthWrite: false }), [])
  useEffect(() => () => { mat.dispose(); lineMat.dispose() }, [mat, lineMat])
  useEffect(() => { cities.forEach((c, i) => (mat.uniforms.uCenter.value as THREE.Vector3[])[i].copy(c.top)) }, [cities, mat])

  const group = useRef<THREE.Group>(null)
  const camDir = useMemo(() => new THREE.Vector3(), [])
  const act = useRef<number[]>(new Array(MAX_CITIES).fill(0))
  const [callout, setCallout] = useState<Callout[]>([])
  const calloutKey = useRef('')
  useCallouts('crowds', callout)

  useFrame(({ camera }, dt) => {
    const g = group.current
    if (!g) return
    // mid zoom only: fade in below the far threshold, out before close
    const d = sceneRefs.camDist
    const fadeFar = THREE.MathUtils.clamp((ZOOM_FAR - d) / 3, 0, 1)
    const fadeClose = THREE.MathUtils.clamp((d - (ZOOM_CLOSE - 0.5)) / 3, 0, 1)
    const fade = fadeFar * fadeClose
    g.visible = fade > 0.01
    if (!g.visible) {
      if (calloutKey.current) { calloutKey.current = ''; setCallout([]) }
      return
    }
    const s = useStore.getState()
    const utc = utcHourOf(worldDate(s.playhead, s.hour, s.playing))
    const f = frameRef.current
    camDir.copy(camera.position).normalize()
    const horizonCos = Math.cos(Math.acos(Math.min(1, LAND_TOP / camera.position.length())) + 0.12)
    const u = mat.uniforms
    const A = u.uAct.value as number[], R = u.uRevolt.value as number[], N = u.uNight.value as number[], V = u.uVis.value as number[]
    let best = -1, bestAct = 0
    for (let i = 0; i < cities.length; i++) {
      const c = cities[i]
      const region = f.regions.find((r) => r.id === c.regionId)
      const revolt = !!region && (region.unrest > 0.6 || region.visual?.damage.kind === 'revolt')
      // ease toward the target so fast playback doesn't strobe the streets
      act.current[i] += (busyAt(localHour(utc, c.lon)) - act.current[i]) * Math.min(1, dt * 3)
      A[i] = revolt ? Math.max(0.6, act.current[i]) : act.current[i]
      R[i] = revolt ? 1 : 0
      N[i] = THREE.MathUtils.clamp(-c.n.dot(sceneRefs.sunDir) * 3 + 0.3, 0, 1)
      V[i] = c.n.dot(camDir) > horizonCos ? 1 : 0
      if (V[i] && !revolt && act.current[i] > bestAct) { bestAct = act.current[i]; best = i }
    }
    u.uTime.value = sceneRefs.wt
    u.uFade.value = fade
    lineMat.opacity = 0.32 * fade
    // explain: the busiest city in view, only during a real rush hour
    const k = best >= 0 && bestAct > 0.75 && fade > 0.5 ? `${cities[best].id}:${Math.round(bestAct * 4)}` : ''
    if (k !== calloutKey.current) {
      calloutKey.current = k
      if (!k) setCallout([])
      else {
        const c = cities[best]
        setCallout([{ id: `crowds-${c.id}`, pos: c.top, title: 'rush hour', text: `rush hour in ${c.name}: about ${fmtPeople(c.pop * 0.3 * bestAct)} people on the move`, weight: 1.5 }])
      }
    }
  })

  if (!cities.length) return null
  return (
    <group ref={group} visible={false}>
      <lineSegments geometry={geo.lines} material={lineMat} frustumCulled={false} raycast={() => null} renderOrder={3} />
      <points geometry={geo.dots} material={mat} frustumCulled={false} raycast={() => null} renderOrder={4} />
    </group>
  )
}
