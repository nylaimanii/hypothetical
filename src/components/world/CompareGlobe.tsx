'use client'
import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import type { RunRecord } from '@/lib/types'
import Planet from './Planet'
import CityLights from './CityLights'
import Core from './Core'
import Moon from './Moon'
import { KeyLight, Sky } from './Globe'
import { MAX_DIST, MIN_DIST } from './lib'
import { frameIndexAt, useStore } from '../state/store'

// a light globe for compare mode: same world rendering, no pips, physics or ao, all on the shared playhead
export default function CompareGlobe({ record, index }: { record: RunRecord; index: number }) {
  const idx = useStore((s) => frameIndexAt(record.frames, s.playhead))
  const setFocus = useStore((s) => s.setCompareFocus)
  const frame = record.frames[idx]
  const prev = record.frames[idx - 1]
  return (
    <div className="absolute inset-0" onPointerDownCapture={() => setFocus(index)} style={{ filter: frame.status === 'destroyed' ? 'grayscale(1) brightness(0.92)' : 'none', transition: 'filter 3s ease' }}>
      <Canvas dpr={[1, 1.5]} flat gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }} camera={{ position: [18, 12, 50], fov: 34, near: 0.1, far: 400 }}>
        <Sky />
        <KeyLight high={false} />
        <Suspense fallback={null}>
          <Planet frame={frame} />
          <CityLights frame={frame} />
          <Core frame={frame} prev={prev} idx={idx} />
          <Moon frame={frame} />
        </Suspense>
        <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.08} minDistance={MIN_DIST + 4} maxDistance={MAX_DIST} />
        <EffectComposer multisampling={0}>
          <ToneMapping mode={ToneMappingMode.AGX} />
          <SMAA />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
