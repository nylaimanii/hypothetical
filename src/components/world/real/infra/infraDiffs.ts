'use client'
// the sim's infrastructure changes (B's InfraDiff, carried on frames as `infra`), collected up to the playhead
import { useMemo } from 'react'
import type { Frame } from '@/lib/types'
import type { InfraDiff } from '@/lib/types-v5'
import { useStore } from '../../../state/store'

export function useInfraDiffs(): { diffs: InfraDiff[]; tick: number } {
  const record = useStore((s) => s.record)
  // recomputed once a month of playhead; diffs themselves land once a year
  const tick = useStore((s) => Math.floor(s.playhead))
  return useMemo(() => {
    const diffs: InfraDiff[] = []
    for (const f of record.frames as (Frame & { infra?: InfraDiff[] })[]) {
      if (f.tick > tick) break
      if (Array.isArray(f.infra)) diffs.push(...f.infra)
    }
    return { diffs, tick }
  }, [record, tick])
}
