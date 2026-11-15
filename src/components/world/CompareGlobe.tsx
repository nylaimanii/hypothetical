'use client'
import type { RunRecord } from '@/lib/types'
import WorldGlobe from './WorldGlobe'
import { frameIndexAt, useStore } from '../state/store'

// compare mode: one world on the shared playhead; pointer down focuses it for dossiers
export default function CompareGlobe({ record, index }: { record: RunRecord; index: number }) {
  const idx = useStore((s) => frameIndexAt(record.frames, s.playhead))
  const setFocus = useStore((s) => s.setCompareFocus)
  return (
    <div className="absolute inset-0" onPointerDownCapture={() => setFocus(index)}>
      <WorldGlobe frame={record.frames[idx]} prev={record.frames[idx - 1]} pulseKey={idx} />
    </div>
  )
}
