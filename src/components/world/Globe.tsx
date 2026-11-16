'use client'
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls, PerformanceMonitor, SoftShadows, Stats } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { C, LAND_TOP, MAX_DIST, MIN_DIST, R, ZOOM_CLOSE, ZOOM_FAR, latLonToVec3, sceneRefs } from './lib'
import Planet from './Planet'
import Core from './Core'
import Moon from './Moon'
import Symbols, { spaceportId } from './Symbols'
import Launches from './Launches'
import Director from './Director'
import { soundState } from '../sound/engine'
import { MigrationLines } from './Overlays'
import { pipRegistry, usePhys } from './pipShared'
import { sunDirection, worldDate } from './time'
import { Atmosphere, Clouds, DisasterFx } from './Weather'
import { useCurrentFrame, useStore } from '../state/store'
// load budget: the planet itself paints first; every other layer is its own chunk, mounted just after
// (physics only on the first close zoom, the city diorama only on the first visit)
import { loadGeo } from './geo/lazy'
import { loadFarTiles, loadHubs } from './real/far/useFar'
import { isPhoneNow } from '../ui/usePhone'
const Pips = lazy(() => import('./Pips'))
const Structures = lazy(() => import('./Structures'))
const CityView = lazy(() => import('./city/CityView'))
const CrowdDots = lazy(() => import('./CrowdDots'))
const CityMarkers = lazy(() => import('./geo/CityMarkers'))
const CountryNames = lazy(() => import('./geo/CountryNames'))
const BorderRidges = lazy(() => import('./geo/BorderRidges'))
const StateRidges = lazy(() => import('./geo/StateRidges'))
const TrendArrows = lazy(() => import('./geo/TrendArrows'))
const Orrery = lazy(() => import('./Orrery'))
const RealCities = lazy(() => import('./real/cities/RealCities'))
const InfraLayer = lazy(() => import('./real/infra/InfraLayer'))
const NightLights = lazy(() => import('./real/far/NightLights'))
const FlightArcs = lazy(() => import('./real/far/FlightArcs'))
const ShippingLanes = lazy(() => import('./real/far/FlightArcs').then((m) => ({ default: m.ShippingLanes })))
const PhysicsRoot = lazy(() => import('./PhysicsRoot'))
const MovementStreams = lazy(() => import('./V3Layers').then((m) => ({ default: m.MovementStreams })))
const RegionModeLabels = lazy(() => import('./V3Layers').then((m) => ({ default: m.RegionModeLabels })))
const EmotionPulse = lazy(() => import('./V3Layers').then((m) => ({ default: m.EmotionPulse })))
const ExplainLayer = lazy(() => import('./V3Layers').then((m) => ({ default: m.ExplainLayer })))

// mounts its children a moment after the first frame, so the planet paints before the detail arrives
function Prefetch() {
  useEffect(() => { const id = setTimeout(() => { loadGeo(); loadFarTiles(); loadHubs() }, 300); return () => clearTimeout(id) }, [])
  return null
}

function Later({ children, ms = 120 }: { children: ReactNode; ms?: number }) {
  const [on, setOn] = useState(false)
  useEffect(() => { const id = setTimeout(() => setOn(true), ms); return () => clearTimeout(id) }, [ms])
  return on ? <Suspense fallback={null}>{children}</Suspense> : null
}
import DeadWorld, { CoreShards, useDeathMood } from './DeadWorld'
import { setDeathMuffle } from '../sound/engine'

// the world clock: advances only while the timeline plays
function WorldClock() {
  useFrame((_, dt) => {
    const playing = useStore.getState().playing
    sceneRefs.wdt = playing ? Math.min(dt, 0.1) : 0
    sceneRefs.wt += sceneRefs.wdt
  }, -100)
  return null
}

export function Sky({ grey = 0 }: { grey?: number }) {
  const scene = useThree((s) => s.scene)
  // night in view, in steps of a fifth, so the gradient is redrawn only a few times across dusk
  const [nightStep, setNightStep] = useState(0)
  useFrame(() => { const st = Math.round(sceneRefs.night * 5) / 5; if (st !== nightStep) setNightStep(st) })
  useEffect(() => {
    const cv = document.createElement('canvas')
    cv.width = 4; cv.height = 256
    const g = cv.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, 0, 256)
    // a collapsed world loses its color: the sky goes flat grey
    const mixG = (hex: string, to: string, night: string) => { const a = new THREE.Color(hex).lerp(new THREE.Color(to), grey); return `#${a.lerp(new THREE.Color(night), nightStep * 0.92).getHexString()}` }
    grad.addColorStop(0, mixG('#9C97B2', '#8C8A87', '#0E1324')) // muted dusk, deep navy at night
    grad.addColorStop(0.55, mixG('#D4CCC6', '#B5B2AE', '#1A2036'))
    grad.addColorStop(1, mixG(C.bone, '#CFCBC5', '#2A2D3E'))
    g.fillStyle = grad
    g.fillRect(0, 0, 4, 256)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    scene.background = tex
    return () => { scene.background = null; tex.dispose() }
  }, [scene, grey, nightStep])
  return null
}

// the key light is the sun. paused: the real sun for that date and time, so night falls where it should.
// playing: a month passes every third of a second, so the real sun would strobe. the light then eases to a
// readable softbox beside the camera that keeps only the season's tilt
export function KeyLight({ high }: { high: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null)
  const moon = useRef<THREE.DirectionalLight>(null)
  const amb = useRef<THREE.AmbientLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const moonDir = useMemo(() => new THREE.Vector3(), [])
  const real = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, dt) => {
    const l = light.current
    if (!l) return
    const s = useStore.getState()
    sunDirection(worldDate(s.playhead, s.hour, s.playing), real)
    let target = real
    if (s.playing) {
      const dir = camera.position.clone().normalize()
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize()
      const up = new THREE.Vector3().crossVectors(dir, right)
      target = dir.multiplyScalar(30).addScaledVector(up, 14 + real.y * 10).addScaledVector(right, -12).normalize()
    }
    sceneRefs.sunDir.lerp(target, 1 - Math.exp(-dt * 2.5)).normalize()
    // perf: the shadow map only covers a small box around where the camera looks. far away that
    // box is the whole planet; up close it shrinks to a few tiles, so the same map is sharp and cheap
    const d = sceneRefs.camDist
    const half = Math.max(3.5, Math.min(14, (d - R) * 0.55))
    const center = d > 36 ? new THREE.Vector3() : sceneRefs.focus
    l.position.copy(center).addScaledVector(sceneRefs.sunDir, 30)
    l.target.position.copy(center)
    l.target.updateMatrixWorld()
    const sc = l.shadow.camera
    if (Math.abs(sc.right - half) > 0.25) {
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half
      sc.near = 30 - half - 2; sc.far = 30 + half + 2
      sc.updateProjectionMatrix()
    }
    // night: how far past the terminator the place we look at is (only when the real sun is used, i.e. paused)
    const focusN = sceneRefs.focus.clone().normalize()
    const sunAt = focusN.dot(sceneRefs.sunDir)
    const nightTarget = s.playing ? 0 : THREE.MathUtils.smoothstep(-sunAt, -0.08, 0.22)
    sceneRefs.night += (nightTarget - sceneRefs.night) * (1 - Math.exp(-dt * 3))
    const n = sceneRefs.night
    // soft moonlight from high in the night sky (not from the camera), cool and dim
    moonDir.copy(sceneRefs.sunDir).negate().addScaledVector(focusN, 0.9).add(new THREE.Vector3(0, 0.35, 0)).normalize()
    if (moon.current) {
      moon.current.position.copy(moonDir).multiplyScalar(30)
      moon.current.target.position.set(0, 0, 0)
      moon.current.target.updateMatrixWorld()
      moon.current.intensity = 0.2 * n
    }
    // the sky's light and the studio reflections fade at night; that is what made night read as day
    if (amb.current) amb.current.intensity = 0.16 * (1 - 0.7 * n)
    if (hemi.current) hemi.current.intensity = 0.28 * (1 - 0.8 * n)
    scene.environmentIntensity = 1 - 0.82 * n
  })
  return (
    <>
      <ambientLight ref={amb} intensity={0.16} color="#C9CCE0" />
      <hemisphereLight ref={hemi} args={['#E9E4F2', '#E8DCC6', 0.28]} />
      <directionalLight ref={moon} intensity={0} color="#9DB2E8" />
      <directionalLight ref={light} intensity={2.1} color="#FFF4E2" castShadow={high}
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.025}
        shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14} shadow-camera-near={1} shadow-camera-far={70} />
    </>
  )
}

function CameraRig({ destroyed }: { destroyed: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const setZoom = useStore((s) => s.setZoom)
  const zoomOut = useRef(0)
  const introOpen = useStore((s) => s.introOpen)
  useEffect(() => { if (destroyed) zoomOut.current = performance.now() / 1000 }, [destroyed])
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    // dev only: lets the browser console move the camera, eg __hyp.zoom(14)
    if (process.env.NODE_ENV !== 'development') return
    const w = window as unknown as { __hyp?: unknown }
    w.__hyp = {
      zoom: (d: number) => camera.position.setLength(d),
      look: (lat: number, lon: number, d = camera.position.length()) => camera.position.copy(latLonToVec3(lat, lon, d)),
      store: useStore,
      pips: pipRegistry,
      phys: usePhys,
      sound: soundState,
      camera,
      scene,
      gl,
      THREE,
    }
  }, [camera, scene, gl])
  useFrame(({ camera }, dt) => {
    let d = camera.position.length()
    const since = performance.now() / 1000 - zoomOut.current
    if (destroyed && since < 6 && d < 62) { camera.position.multiplyScalar(1 + dt * 0.25); d = camera.position.length() }
    sceneRefs.camDist = d
    if (controls.current) controls.current.rotateSpeed = Math.max(0.06, Math.min(0.55, (d - R) / 45))
    const z = d > ZOOM_FAR ? 'far' : d > ZOOM_CLOSE ? 'mid' : 'close'
    if (useStore.getState().zoom !== z) setZoom(z)
    // tilt toward the horizon when close, so pips read as people not dots
    const tilt = Math.max(0, Math.min(1, (ZOOM_CLOSE + 2 - d) / (ZOOM_CLOSE + 2 - MIN_DIST)))
    if (tilt > 0) camera.rotateX(tilt * 0.42)
    // where the camera looks on the surface
    const ray = new THREE.Ray(camera.position.clone(), camera.getWorldDirection(new THREE.Vector3()))
    const hit = ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), LAND_TOP), new THREE.Vector3())
    sceneRefs.focus.copy(hit ?? camera.position.clone().setLength(LAND_TOP))
  })
  // v3: zooming out past the moon reaches the orrery
  return <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping dampingFactor={0.07} minDistance={MIN_DIST} maxDistance={MAX_DIST + 185} zoomSpeed={0.7} autoRotate={introOpen} autoRotateSpeed={0.35} />
}

// frame events become visual juice; disasters also become physical shockwaves
function JuiceDriver() {
  const { frame, idx, mode } = useCurrentFrame()
  const pushJuice = useStore((s) => s.pushJuice)
  const juice = useStore((s) => s.juice)
  const last = useRef(-1)
  const seen = useRef(0)
  useEffect(() => {
    if (last.current === idx) return
    const first = last.current === -1
    last.current = idx
    if (first || mode !== 'ai') return
    for (const e of frame.newEvents) if (e.kind !== 'law') pushJuice({ kind: e.kind, regionId: e.regionId, severity: e.severity, text: e.text, tick: e.tick })
  }, [idx, frame, mode, pushJuice])
  useEffect(() => {
    for (const j of juice) {
      if (j.id <= seen.current) continue
      seen.current = j.id
      if (!['disaster', 'war', 'injected'].includes(j.kind) || !j.regionId) continue
      const r = frame.regions.find((x) => x.id === j.regionId)
      if (!r) continue
      pipRegistry.shocks.push({ id: j.id, center: latLonToVec3(r.lat, r.lon, LAND_TOP), at: performance.now() / 1000, strength: 1.2 + j.severity * 2.2, radius: 2.4 })
      pipRegistry.shocks = pipRegistry.shocks.filter((s) => performance.now() / 1000 - s.at < 3)
    }
  }, [juice, frame.regions])
  return null
}

// dev only perf switches: ?noao ?nopcss ?nophys
const dbg = (k: string) => process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has(k)

// on high: under 50fps for 2s drops clouds, then pip shadows, then physics for off-screen pips.
// 2s at 58fps or better turns them back on, last one off first. clouds can go at any zoom; the rest only matter close up
function AdaptiveQuality({ high }: { high: boolean }) {
  const t = useRef({ frames: 0, window: 0, low: 0, good: 0, sq: 0 })
  useFrame((_, dt) => {
    const s = useStore.getState()
    const w = t.current
    if (!high) {
      if (s.adaptive !== 0) s.setAdaptive(0)
      w.low = 0; w.good = 0
      return
    }
    w.frames++
    w.window += dt
    w.sq += dt * dt
    if (w.window < 0.25) return
    const fps = w.frames / w.window
    // a browser or display capped at 30hz gives slow but perfectly even frames; real overload is uneven.
    // only step down when frames are both slow and jittery, so a capped tab keeps its clouds
    const mean = w.window / w.frames
    const jitter = Math.sqrt(Math.max(0, w.sq / w.frames - mean * mean)) * 1000
    const capped = jitter < 1.5
    if (fps < 50 && !capped) { w.low += w.window; w.good = 0 } else if (fps >= 58 || capped) { w.good += w.window; w.low = 0 } else { w.low = 0; w.good = 0 }
    w.frames = 0; w.window = 0; w.sq = 0
    // dpr is the first lever (PerformanceMonitor); this only sheds clouds, then pip shadows up close.
    // ragdolls are already limited to the 30 nearest on-screen pips, so level 3 is no longer needed
    const cap = s.zoom === 'close' ? 2 : 1
    if (w.low >= 2 && s.adaptive < cap) { s.setAdaptive((s.adaptive + 1) as 1 | 2); w.low = 0 }
    if (w.good >= 2 && s.adaptive > 0) { s.setAdaptive((s.adaptive - 1) as 0 | 1 | 2); w.good = 0 }
    if (s.adaptive > cap && w.good >= 2) { s.setAdaptive(cap as 1); w.good = 0 }
  })
  return null
}

type N8AORef = { configuration: { transparencyAware: boolean; aoSamples: number; denoiseSamples: number; denoiseRadius: number } }

// n8ao auto-detects transparent materials (atmosphere, clouds, glow) and then re-renders the whole
// scene twice more per frame for them. those surfaces don't need ao, so turn that off: 3 scene renders become 1.
// n8ao only offers full or half resolution, so up close it stays half res and drops to fewer samples instead
function AOTuner({ ao }: { ao: React.RefObject<N8AORef | null> }) {
  const zoom = useStore((s) => s.zoom)
  useEffect(() => {
    const c = ao.current?.configuration
    if (!c) return
    c.transparencyAware = false
    c.aoSamples = zoom === 'close' ? 8 : 16
    c.denoiseSamples = zoom === 'close' ? 4 : 8
    c.denoiseRadius = zoom === 'close' ? 8 : 12
  }, [ao, zoom])
  return null
}

function Effects({ high }: { high: boolean }) {
  const ao = useRef<N8AORef | null>(null)
  if (high && !dbg('noao'))
    return (
      <EffectComposer multisampling={0} key="high">
        <N8AO ref={ao as never} halfRes aoRadius={0.5} distanceFalloff={0.6} intensity={2.4} quality="medium" />
        <AOTuner ao={ao} />
        <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.15} intensity={0.85} />
        <ToneMapping mode={ToneMappingMode.AGX} />
        <SMAA />
        <Vignette offset={0.32} darkness={0.32} />
      </EffectComposer>
    )
  return (
    <EffectComposer multisampling={0} key="fast">
      <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.15} intensity={0.85} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <SMAA />
      <Vignette offset={0.32} darkness={0.32} />
    </EffectComposer>
  )
}

export default function Globe() {
  const { frame, idx, record, mode } = useCurrentFrame()
  const quality = useStore((s) => s.quality)
  const select = useStore((s) => s.select)
  const high = quality === 'high'
  const prev = mode === 'ai' ? record.frames[idx - 1] : undefined
  const spaceport = useMemo(() => spaceportId(record.frames, idx, frame.regions), [record.frames, idx, frame.regions])
  const destroyed = frame.status === 'destroyed'
  const dev = process.env.NODE_ENV === 'development'
  const agents = useStore((s) => s.agents)
  const agent = useMemo(() => agents.find((a) => a.id === (record.agentId ?? record.summary.agentId)), [agents, record])
  const death = useDeathMood(frame)
  const shattered = death.kind === 'collapse' && death.level > 0.5
  const swapping = useStore((s) => s.swapping)
  const overlay = useStore((s) => s.overlay)
  const view = useStore((s) => s.view)
  const cityView = useStore((s) => s.cityView)
  const zoom = useStore((s) => s.zoom)
  const [physicsWanted, setPhysicsWanted] = useState(false)
  if (zoom === 'close' && !physicsWanted) setPhysicsWanted(true)
  // leaving a city: fly back to it on the globe
  const lastCity = useRef<string | null>(null)
  useEffect(() => {
    if (cityView) { lastCity.current = cityView; return }
    const id = lastCity.current
    lastCity.current = null
    const c = id ? frame.cities.find((x) => x.id === id) : undefined
    if (c) useStore.getState().requestShot({ target: 'region', regionId: c.regionId, force: true })
  }, [cityView]) // eslint-disable-line react-hooks/exhaustive-deps
  // perf: device pixel ratio capped at 1.5 on high, 1 on fast. the monitor drops it when fps dips, raises it when fps recovers
  const cap = high ? 1.5 : 1
  const [dpr, setDpr] = useState(cap)
  const [lastCap, setLastCap] = useState(cap)
  if (lastCap !== cap) { setLastCap(cap); setDpr(cap) }
  const sky = death.kind === 'collapse' || death.kind === 'war' ? death.level : 0
  // a dying world goes quiet and low
  useEffect(() => { setDeathMuffle(destroyed ? 1 : death.level * 0.5) }, [destroyed, death.level])

  return (
    // isolate: html labels inside the canvas can never stack above the ui panels
    <div className="absolute inset-0 isolate z-0 touch-none select-none" style={{
      filter: destroyed ? 'grayscale(1) brightness(0.92)' : 'none',
      // switching tabs: a quick zoom out, the world swaps, then back in
      transform: swapping ? 'scale(0.78)' : 'scale(1)', opacity: swapping ? 0 : 1,
      // other views cover the whole middle: hide the globe and its floating labels
      visibility: view === 'globe' ? 'visible' : 'hidden',
      transition: swapping ? 'transform 180ms ease-in, opacity 180ms ease-in, filter 3s ease' : 'transform 320ms cubic-bezier(.2,.8,.2,1), opacity 260ms ease-out, filter 3s ease',
    }}>
      <Canvas
        key={quality}
        shadows={high ? { type: THREE.PCFShadowMap } : false}
        dpr={dpr}
        flat
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
        camera={{ position: [20, 16, 56], fov: 38, near: 0.05, far: 500 }}
        // other views cover the globe: stop rendering it underneath
        frameloop={view === 'globe' ? 'always' : 'never'}
        // only a click on the canvas itself clears the selection; clicks on floating labels bubble here too
        onPointerMissed={(e) => { if ((e.target as HTMLElement | null)?.tagName === 'CANVAS') select(null) }}
      >
        <PerformanceMonitor bounds={() => [50, 58]} flipflops={6} onIncline={() => setDpr((d) => Math.min(cap, d + 0.25))} onDecline={() => setDpr((d) => Math.max(1, d - 0.25))} onFallback={() => setDpr(1)} />
        <WorldClock />
        <AdaptiveQuality high={high} />
        <Sky grey={sky} />
        <KeyLight high={high} />
        {high && !dbg('nopcss') && <SoftShadows size={12} samples={6} focus={0.5} />}
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={2.4} color="#FFF6EA" position={[0, 6, 8]} scale={[12, 7, 1]} />
          <Lightformer form="rect" intensity={1.1} color="#E7E2F1" position={[-9, 2, -4]} rotation-y={Math.PI / 2} scale={[8, 6, 1]} />
          <Lightformer form="ring" intensity={0.9} color="#F4EADB" position={[7, -3, 5]} scale={4} />
          <Lightformer form="rect" intensity={0.6} color={C.bone} position={[0, -9, 0]} rotation-x={Math.PI / 2} scale={[24, 24, 1]} />
        </Environment>
        <Suspense fallback={null}>
          <Prefetch />
          <Later ms={400}><ExplainLayer /></Later>
          {/* v4: visiting a city swaps the planet for its diorama (sky, light, environment and effects stay) */}
          {cityView ? <Suspense fallback={null}><CityView cityId={cityView} frame={frame} agent={agent} /></Suspense> : <>
          <Planet frame={frame} />
          <Later ms={200}><NightLights frame={frame} /></Later>
          <Atmosphere tint={frame.atmosphere?.tint} haze={frame.atmosphere?.haze ?? 0} />
          <Clouds frame={frame} />
          <DisasterFx frame={frame} />
          {shattered ? <CoreShards active /> : <Core frame={frame} prev={prev} idx={idx} />}
          <Moon frame={frame} />
          <Later>
            <Symbols frame={frame} spaceport={spaceport} />
            <Structures frame={frame} agent={agent} />
            <DeadWorld frame={frame} />
            <MovementStreams frame={frame} />
            <RegionModeLabels frame={frame} />
            <EmotionPulse frame={frame} />
          </Later>
          <Later ms={1500}><Orrery frame={frame} /></Later>
          <Later ms={800}>
            <FlightArcs frame={frame} countryOrder={record.frames[0]?.traffic?.countries} />
            <ShippingLanes frame={frame} countryOrder={record.frames[0]?.traffic?.countries} />
          </Later>
          {/* names: 5 countries at far, 5 cities at mid (the old region labels are retired) */}
          <Later ms={250}>
            <CountryNames frame={frame} />
            <CityMarkers frame={frame} />
            <RealCities frame={frame} agent={agent} />
            <InfraLayer frame={frame} agent={agent} />
            <BorderRidges frame={frame} />
            <StateRidges frame={frame} />
            <TrendArrows frame={frame} />
          </Later>
          {overlay === 'real' && <MigrationLines frame={frame} />}
          <Later ms={600}>
            <Pips frame={frame} />
            <CrowdDots frame={frame} />
          </Later>
          <Launches frame={frame} spaceport={spaceport} />
          </>}
        </Suspense>
        {/* rapier (the biggest chunk by far) loads on the first close zoom, and stays once loaded */}
        {high && !dbg('nophys') && !cityView && physicsWanted && (
          <Suspense fallback={null}>
            <PhysicsRoot />
          </Suspense>
        )}
        <JuiceDriver />
        {!cityView && <CameraRig destroyed={destroyed} />}
        {!cityView && <Director />}
        <Effects high={high} />
        {dev && !isPhoneNow() && <Stats className="!left-auto !right-4 !top-auto !bottom-[92px]" />}
      </Canvas>
    </div>
  )
}
