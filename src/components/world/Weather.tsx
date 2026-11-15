'use client'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Frame, WorldEvent } from '@/lib/types'
import { LAND_TOP, R, STEP, buildTiles, latLonToVec3, sceneRefs, surfacePoint, tangentBasis, toonGradient } from './lib'
import { useStore } from '../state/store'

// ---------- atmosphere: thin rim, blue by day, warm along the terminator ----------

export function Atmosphere({ tint = '#8CB8E6', haze = 0 }: { tint?: string; haze?: number }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uTint: { value: new THREE.Color('#8CB8E6') }, uHaze: { value: 0 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vView;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uSun; uniform vec3 uTint; uniform float uHaze; varying vec3 vN; varying vec3 vView;
      void main() {
        float rim = pow(1.0 - max(dot(vN, vView), 0.0), 3.2);
        float sun = dot(vN, uSun);
        float day = smoothstep(-0.25, 0.35, sun);
        float dusk = exp(-pow(sun / 0.22, 2.0));
        // v3: each world's air: its tint, and pollution haze thickens the rim and creeps inward
        vec3 col = mix(mix(vec3(0.55, 0.72, 0.9), uTint, 0.55), vec3(1.0, 0.62, 0.38), dusk * (1.0 - uHaze * 0.6));
        float rimH = pow(1.0 - max(dot(vN, vView), 0.0), mix(3.2, 1.6, uHaze));
        float a = rimH * (0.12 + 0.75 * max(day, dusk)) * (1.0 + uHaze * 0.8);
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), [])
  useFrame(() => { mat.uniforms.uSun.value.copy(sceneRefs.sunDir) })
  useEffect(() => { mat.uniforms.uTint.value.set(tint); mat.uniforms.uHaze.value = haze }, [mat, tint, haze])
  return (
    <mesh material={mat} raycast={() => null} renderOrder={3}>
      <sphereGeometry args={[R + 0.75, 64, 48]} />
    </mesh>
  )
}

// ---------- what each event looks like ----------

type Fx = { storm: boolean; flood: boolean; drought: boolean; fire: boolean; sick: boolean }
export function classify(e: Pick<WorldEvent, 'kind' | 'text'>): Fx {
  const t = e.text.toLowerCase()
  const storm = /storm|typhoon|hurricane|cyclone|tornado/.test(t)
  const flood = /flood|river|tsunami|typhoon|monsoon rains|levee/.test(t)
  const drought = e.kind === 'famine' || /drought|harvest|rains failed|dry|crop/.test(t)
  const fire = /fire|wildfire|heat|burn|smoke/.test(t)
  const sick = e.kind === 'pandemic'
  // a disaster the text does not explain still gets a storm, so it is never invisible
  return { storm: storm || (e.kind === 'disaster' && !flood && !fire && !drought), flood, drought, fire, sick }
}

function activeFx(frame: Frame) {
  const now = performance.now()
  const juice = useStore.getState().juice.filter((j) => j.regionId && now - j.at < 20000)
  const list = [...frame.newEvents.filter((e) => e.regionId), ...juice.map((j) => ({ kind: j.kind, text: j.text === 'injected by you' ? j.kind : j.text, regionId: j.regionId }))]
  const by = new Map<string, Fx>()
  for (const e of list) {
    const f = classify(e)
    const cur = by.get(e.regionId!) ?? { storm: false, flood: false, drought: false, fire: false, sick: false }
    by.set(e.regionId!, { storm: cur.storm || f.storm, flood: cur.flood || f.flood, drought: cur.drought || f.drought, fire: cur.fire || f.fire, sick: cur.sick || f.sick })
  }
  return by
}

// ---------- clouds: slow puffs, thicker and darker over trouble ----------

const PUFFS_PER = 4
export function Clouds({ frame }: { frame: Frame }) {
  const zoom = useStore((s) => s.zoom)
  const quality = useStore((s) => s.quality)
  const adaptive = useStore((s) => s.adaptive)
  const juice = useStore((s) => s.juice)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const storm = useRef<THREE.InstancedMesh>(null)
  const base = quality === 'high' ? 70 : 34
  const clusters = useMemo(() => {
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    return Array.from({ length: base }, () => {
      const lat = (Math.asin(rnd() * 2 - 1) * 180) / Math.PI * 0.85
      const lon = rnd() * 360 - 180
      return { lat, lon, r: R + 1.05 + rnd() * 0.3, s: 0.22 + rnd() * 0.22, spin: rnd() * Math.PI * 2, speed: 0.6 + rnd() * 0.8 }
    })
  }, [base])
  // regions with disasters or sickness grow their own low dark cloud banks
  const heavy = useMemo(() => {
    const out: { center: THREE.Vector3; dark: boolean; k: number }[] = []
    for (const [rid, fx] of activeFx(frame)) {
      if (!fx.storm && !fx.sick && !fx.flood) continue
      const r = frame.regions.find((x) => x.id === rid)
      if (!r) continue
      for (let k = 0; k < 9; k++) out.push({ center: latLonToVec3(r.lat, r.lon, 1), dark: fx.storm || fx.sick, k })
    }
    return out
  }, [frame, juice]) // eslint-disable-line react-hooks/exhaustive-deps
  const mat = useMemo(() => new THREE.MeshToonMaterial({ color: '#FBFAF6', gradientMap: toonGradient() }), [])
  const darkMat = useMemo(() => new THREE.MeshToonMaterial({ color: '#8E8C96', gradientMap: toonGradient() }), [])
  const hidden = zoom === 'close' || adaptive >= 1

  useFrame(({ clock }) => {
    if (hidden) return
    const t = clock.elapsedTime
    const m = mesh.current, h = storm.current
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3()
    if (m) {
      clusters.forEach((c, i) => {
        const lon = c.lon + t * c.speed * 0.8
        const center = latLonToVec3(c.lat + Math.sin(t * 0.05 + c.spin) * 2, lon, c.r)
        const { east, north } = tangentBasis(center)
        for (let k = 0; k < PUFFS_PER; k++) {
          const a = c.spin + k * 1.7
          p.copy(center).addScaledVector(east, Math.cos(a) * c.s * 0.9 * (k ? 1 : 0)).addScaledVector(north, Math.sin(a) * c.s * 0.5 * (k ? 1 : 0))
          const s = c.s * (k ? 0.7 : 1) * (1 + Math.sin(t * 0.3 + i + k) * 0.05)
          m.setMatrixAt(i * PUFFS_PER + k, mtx.compose(p, q, sc.set(s, s * 0.75, s)))
        }
      })
      m.instanceMatrix.needsUpdate = true
    }
    if (h) {
      heavy.forEach((c, i) => {
        const { east, north } = tangentBasis(c.center)
        const a = (c.k / 9) * Math.PI * 2 + t * 0.15
        const rr = 0.35 + (c.k % 3) * 0.3
        p.copy(c.center).multiplyScalar(R + 1.0).addScaledVector(east, Math.cos(a) * rr).addScaledVector(north, Math.sin(a) * rr)
        const s = 0.32 + (c.k % 2) * 0.12
        h.setMatrixAt(i, mtx.compose(p, q, sc.set(s, s * 0.7, s)))
        h.setColorAt(i, new THREE.Color(c.dark ? '#7E7C88' : '#E9E8EE'))
      })
      for (let i = heavy.length; i < 60; i++) h.setMatrixAt(i, mtx.makeScale(0, 0, 0))
      h.instanceMatrix.needsUpdate = true
      if (h.instanceColor) h.instanceColor.needsUpdate = true
    }
  })
  return (
    <group visible={!hidden}>
      <instancedMesh ref={mesh} args={[undefined, mat, clusters.length * PUFFS_PER]} frustumCulled={false} raycast={() => null}>
        <icosahedronGeometry args={[1, 1]} />
      </instancedMesh>
      <instancedMesh ref={storm} args={[undefined, darkMat, 60]} frustumCulled={false} raycast={() => null}>
        <icosahedronGeometry args={[1, 1]} />
      </instancedMesh>
    </group>
  )
}

// ---------- disasters you can see ----------

const SWIRL = 36, CRACKS = 120, FLOOD = 90, SMOKE = 60

export function DisasterFx({ frame }: { frame: Frame }) {
  const { tiles, neighbors } = useMemo(() => buildTiles(frame.regions), [frame.regions])
  const juice = useStore((s) => s.juice)
  const fx = useMemo(() => activeFx(frame), [frame, juice]) // eslint-disable-line react-hooks/exhaustive-deps
  const swirl = useRef<THREE.InstancedMesh>(null)
  const crack = useRef<THREE.InstancedMesh>(null)
  const flood = useRef<THREE.InstancedMesh>(null)
  const smoke = useRef<THREE.InstancedMesh>(null)
  const startedAt = useRef(0)
  const lastKey = useRef('')

  // where each effect goes, worked out once per frame change
  const plan = useMemo(() => {
    const storms: THREE.Vector3[] = [], fires: THREE.Vector3[] = []
    const cracks: { pos: THREE.Vector3; quat: THREE.Quaternion; len: number }[] = []
    const floods: { pos: THREE.Vector3; quat: THREE.Quaternion; w: number; d: number; ring: number }[] = []
    let seed = 3
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (const [rid, f] of fx) {
      const ri = frame.regions.findIndex((x) => x.id === rid)
      if (ri < 0) continue
      const r = frame.regions[ri]
      const center = latLonToVec3(r.lat, r.lon, 1)
      if (f.storm) storms.push(center)
      if (f.fire) fires.push(center)
      const mine = tiles.map((t, i) => ({ t, i })).filter(({ t }) => t.region === ri && t.normal.dot(center) > Math.cos(0.32))
      if (f.drought) {
        for (const { t } of mine.slice(0, 40)) {
          const top = LAND_TOP + t.band * STEP + 0.006
          for (let k = 0; k < 3 && cracks.length < CRACKS; k++) {
            const p = surfacePoint(t.normal, (rnd() - 0.5) * t.w * 0.6, (rnd() - 0.5) * t.d * 0.6, top)
            const q = t.quat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI))
            cracks.push({ pos: p, quat: q, len: 0.12 + rnd() * 0.14 })
          }
        }
      }
      if (f.flood) {
        // coast first, then one ring inland
        const coast = mine.filter(({ i }) => Array.from(neighbors[i]).some((j) => !tiles[j].land))
        const coastIds = new Set(coast.map((c) => c.i))
        const inland = mine.filter(({ i }) => !coastIds.has(i) && Array.from(neighbors[i]).some((j) => coastIds.has(j)))
        for (const [ring, list] of [[0, coast], [1, inland]] as const) for (const { t } of list) {
          if (floods.length >= FLOOD) break
          floods.push({ pos: t.normal.clone().multiplyScalar(LAND_TOP + t.band * STEP + 0.012), quat: t.quat, w: t.w, d: t.d, ring })
        }
      }
    }
    return { storms, fires, cracks, floods }
  }, [fx, tiles, neighbors, frame.regions])

  const mats = useMemo(() => ({
    swirl: new THREE.MeshToonMaterial({ color: '#F1F0F4', gradientMap: toonGradient() }),
    crack: new THREE.MeshBasicMaterial({ color: '#5E4A38' }),
    flood: new THREE.MeshToonMaterial({ color: '#6FA3BE', gradientMap: toonGradient(), transparent: true, opacity: 0.92 }),
    smoke: new THREE.MeshToonMaterial({ color: '#77727A', gradientMap: toonGradient() }),
  }), [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const key = `${frame.tick}:${plan.floods.length}`
    if (key !== lastKey.current) { lastKey.current = key; startedAt.current = t }
    const since = t - startedAt.current
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3()
    const zero = mtx.clone().makeScale(0, 0, 0)
    // storm swirls: three chunky arms on a spiral around a calm eye
    const sw = swirl.current
    if (sw) {
      let n = 0
      for (const c of plan.storms) {
        const { up, east, north } = tangentBasis(c)
        for (let arm = 0; arm < 3; arm++) for (let k = 0; k < 4 && n < SWIRL; k++) {
          const a = arm * ((Math.PI * 2) / 3) + k * 0.55 - t * 0.8
          const rr = 0.25 + k * 0.22
          p.copy(up).multiplyScalar(R + 0.95 + k * 0.03).addScaledVector(east, Math.cos(a) * rr).addScaledVector(north, Math.sin(a) * rr)
          const s = 0.2 - k * 0.025
          sw.setMatrixAt(n++, mtx.compose(p, q, sc.set(s, s * 0.6, s)))
        }
      }
      for (; n < SWIRL; n++) sw.setMatrixAt(n, zero)
      sw.instanceMatrix.needsUpdate = true
    }
    const cr = crack.current
    if (cr) {
      plan.cracks.forEach((c, i) => cr.setMatrixAt(i, mtx.compose(c.pos, c.quat, sc.set(c.len, 1, 1))))
      for (let i = plan.cracks.length; i < CRACKS; i++) cr.setMatrixAt(i, zero)
      cr.instanceMatrix.needsUpdate = true
    }
    // floods creep in from the coast, hold, then drain, on a 10 second loop
    const fl = flood.current
    if (fl) {
      const cyc = since % 10
      plan.floods.forEach((f, i) => {
        const start = f.ring * 1.5
        const k = THREE.MathUtils.clamp((cyc - start) / 1.5, 0, 1) * THREE.MathUtils.clamp((9 - cyc) / 1.5, 0, 1)
        fl.setMatrixAt(i, k > 0.01 ? mtx.compose(f.pos, f.quat, sc.set(f.w * k, 1, f.d * k)) : zero)
      })
      for (let i = plan.floods.length; i < FLOOD; i++) fl.setMatrixAt(i, zero)
      fl.instanceMatrix.needsUpdate = true
    }
    // wildfire smoke rises and spreads
    const sm = smoke.current
    if (sm) {
      let n = 0
      for (const c of plan.fires) {
        const { up, east, north } = tangentBasis(c)
        for (let k = 0; k < 15 && n < SMOKE; k++) {
          const life = ((t * 0.35 + k / 15) % 1)
          const a = k * 2.4
          p.copy(up).multiplyScalar(LAND_TOP + 0.1 + life * 1.4).addScaledVector(east, Math.cos(a) * (0.2 + life * 0.5)).addScaledVector(north, Math.sin(a) * (0.2 + life * 0.5))
          const s = 0.08 + life * 0.22
          sm.setMatrixAt(n++, mtx.compose(p, q, sc.setScalar(life < 0.9 ? s : s * (1 - life) * 10)))
        }
      }
      for (; n < SMOKE; n++) sm.setMatrixAt(n, zero)
      sm.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group>
      <instancedMesh ref={swirl} args={[undefined, mats.swirl, SWIRL]} frustumCulled={false} raycast={() => null}><icosahedronGeometry args={[1, 1]} /></instancedMesh>
      <instancedMesh ref={crack} args={[undefined, mats.crack, CRACKS]} frustumCulled={false} raycast={() => null}><boxGeometry args={[1, 0.01, 0.02]} /></instancedMesh>
      <instancedMesh ref={flood} args={[undefined, mats.flood, FLOOD]} frustumCulled={false} raycast={() => null}><boxGeometry args={[1, 0.02, 1]} /></instancedMesh>
      <instancedMesh ref={smoke} args={[undefined, mats.smoke, SMOKE]} frustumCulled={false} raycast={() => null}><icosahedronGeometry args={[1, 1]} /></instancedMesh>
    </group>
  )
}
