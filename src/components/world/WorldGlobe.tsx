'use client'
import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import type { Frame } from '@/lib/types'
import Planet from './Planet'
import CityLights from './CityLights'
import Core from './Core'
import Moon from './Moon'
import { KeyLight, Sky } from './Globe'
import { MAX_DIST, MIN_DIST } from './lib'

// a light globe for any single frame: no pips, physics or ao. used by compare mode and mission control
export default function WorldGlobe({ frame, prev, pulseKey, gray = false, autoRotate = false, distance = 50 }: { frame: Frame; prev?: Frame; pulseKey: number; gray?: boolean; autoRotate?: boolean; distance?: number }) {
  const dead = gray || frame.status === 'destroyed'
  return (
    <div className="absolute inset-0" style={{ filter: dead ? 'grayscale(1) brightness(0.92)' : 'none', transition: 'filter 1.6s ease' }}>
      <Canvas dpr={[1, 1.5]} flat gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }} camera={{ position: [18 * distance / 50, 12 * distance / 50, distance], fov: 34, near: 0.1, far: 400 }}>
        <Sky />
        <KeyLight high={false} />
        <Suspense fallback={null}>
          <Planet frame={frame} />
          <CityLights frame={frame} />
          <Core frame={frame} prev={prev} idx={pulseKey} />
          <Moon frame={frame} />
        </Suspense>
        <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.08} minDistance={MIN_DIST + 4} maxDistance={MAX_DIST} autoRotate={autoRotate} autoRotateSpeed={0.4} />
        <EffectComposer multisampling={0}>
          <ToneMapping mode={ToneMappingMode.AGX} />
          <SMAA />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
