// helpers shared by scripts/live.ts and the live api routes
import path from 'node:path'
import type { Frame, RunRecord, RunSummary } from '../types'
import { dirs, placeholderSummary } from './store'
import { populationOf } from './facts'

export const liveFile = (runId: string) => path.join(dirs.live, `${runId}.json`)
export const injectDir = (runId: string) => path.join(dirs.inject, runId)
// marks a background run that has been started but not finished yet
export const pendingFile = (runId: string) => path.join(dirs.live, `${runId}.pending`)

export function liveRecord(runId: string, seed: number, constitution: string, frames: Frame[], summary?: RunSummary, agentId = 'unassigned'): RunRecord {
  const last = frames[frames.length - 1]
  return {
    runId, generation: 0, seed, constitution, frames, baseline: [], live: !summary, agentId: summary?.agentId ?? agentId, snapshots: [],
    summary: summary ?? placeholderSummary({
      runId, generation: 0, status: last?.status ?? 'alive', endDate: last?.date ?? '2026-11', ticks: last?.tick ?? 0,
      constitution, peakPopulation: Math.max(0, ...frames.map(f => populationOf(f))),
      moonStage: last?.moonStage ?? 'none', agentId,
    }),
  }
}
