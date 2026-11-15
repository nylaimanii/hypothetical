'use client'
import { useMemo } from 'react'
import { create } from 'zustand'
import type { BaselineFrame, Frame, Override, RunRecord, RunSummary, WorldEvent, Layer } from '@/lib/types'
import { mockRuns, stageFor } from '@/lib/mock/run'

export type Selection =
  | { kind: 'pip'; id: string }
  | { kind: 'region'; id: string }
  | { kind: 'layer'; regionId: string; layer: Layer }
  | { kind: 'law'; id: string }
  | { kind: 'core' }
  | { kind: 'moon' }
  | null

export type Zoom = 'far' | 'mid' | 'close'
export type Quality = 'high' | 'fast'
export type Source = 'mock' | 'api' | 'live'
// a visual effect trigger, from frame events or local injections
export type Juice = { id: number; kind: WorldEvent['kind']; regionId?: string; severity: number; text: string; at: number }
export type SentOverride = Override & { tick: number; responded?: boolean; local?: boolean }

type State = {
  record: RunRecord
  source: Source
  runs: RunSummary[]
  runsSource: 'mock' | 'api'
  playhead: number // in ticks, float
  playing: boolean
  speed: 1 | 4 | 16
  mode: 'ai' | 'baseline'
  zoom: Zoom
  quality: Quality
  // close zoom fallback on high: 0 all on, 1 no pip shadows, 2 also no physics for off-screen pips
  adaptive: 0 | 1 | 2
  selection: Selection
  drawerOpen: boolean
  liveRunId: string | null
  runnerOffline: boolean
  overrides: SentOverride[]
  juice: Juice[]
  notice: string | null
  setRecord: (r: RunRecord, source: Source) => void
  replaceRecord: (r: RunRecord) => void
  setRuns: (runs: RunSummary[], src: 'mock' | 'api') => void
  setPlayhead: (t: number) => void
  setPlaying: (p: boolean) => void
  setSpeed: (s: 1 | 4 | 16) => void
  setMode: (m: 'ai' | 'baseline') => void
  setZoom: (z: Zoom) => void
  setQuality: (q: Quality) => void
  setAdaptive: (a: 0 | 1 | 2) => void
  select: (s: Selection) => void
  setDrawer: (o: boolean) => void
  setLive: (id: string | null) => void
  setRunnerOffline: (v: boolean) => void
  addOverride: (o: SentOverride) => void
  markResponded: (ids: string[]) => void
  pushJuice: (j: Omit<Juice, 'id' | 'at'>) => void
  setNotice: (n: string | null) => void
}

let juiceId = 1
export const TICKS_PER_SECOND = 3

export const useStore = create<State>((set) => ({
  record: mockRuns()[0],
  source: 'mock',
  runs: mockRuns().map((r) => r.summary),
  runsSource: 'mock',
  playhead: 0,
  playing: false,
  speed: 1,
  mode: 'ai',
  zoom: 'far',
  quality: 'high',
  adaptive: 0,
  selection: null,
  drawerOpen: false,
  liveRunId: null,
  runnerOffline: false,
  overrides: [],
  juice: [],
  notice: null,
  setRecord: (record, source) => set((s) => ({ record, source, playhead: source === 'live' ? (record.frames.at(-1)?.tick ?? 0) : 0, selection: null, overrides: s.record.runId === record.runId ? s.overrides : [] })),
  replaceRecord: (record) => set({ record }),
  setRuns: (runs, runsSource) => set({ runs, runsSource }),
  setPlayhead: (playhead) => set({ playhead }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setMode: (mode) => set({ mode }),
  setZoom: (zoom) => set({ zoom }),
  setQuality: (quality) => set({ quality, adaptive: 0 }),
  setAdaptive: (adaptive) => set({ adaptive }),
  select: (selection) => set({ selection }),
  setDrawer: (drawerOpen) => set({ drawerOpen }),
  setLive: (liveRunId) => set({ liveRunId }),
  setRunnerOffline: (runnerOffline) => set({ runnerOffline }),
  addOverride: (o) => set((s) => ({ overrides: [...s.overrides, o] })),
  markResponded: (ids) => set((s) => ({ overrides: s.overrides.map((o) => (ids.includes(o.id) ? { ...o, responded: true } : o)) })),
  pushJuice: (j) => set((s) => ({ juice: [...s.juice.filter((x) => performance.now() - x.at < 12000), { ...j, id: juiceId++, at: performance.now() }] })),
  setNotice: (notice) => set({ notice }),
}))

export function frameIndexAt(frames: Frame[], tick: number) {
  let lo = 0
  for (let i = 0; i < frames.length; i++) if (frames[i].tick <= tick + 1e-6) lo = i
  return lo
}

// the no-ai twin rendered as a Frame: 2026 policies frozen, baseline stats merged in
export function baselineAsFrame(rec: RunRecord, idx: number): Frame {
  const f0 = rec.frames[0]
  const f = rec.frames[idx]
  const b: BaselineFrame | undefined = [...rec.baseline].reverse().find((x) => x.tick <= f.tick) ?? rec.baseline[0]
  const regions = f0.regions.map((r) => {
    const br = b?.regions.find((x) => x.id === r.id)
    return br ? { ...r, ...br } : r
  })
  const citizens = f0.citizens.map((c) => {
    const reg = regions.find((r) => r.id === c.regionId)
    return reg ? { ...c, mood: Math.max(0, Math.min(1, 0.85 - reg.unrest * 0.9 + ((c.personalitySeed % 100) / 100 - 0.5) * 0.3)) } : c
  })
  const progress = b?.moonProgress ?? 0
  return { ...f0, tick: f.tick, date: f.date, regions, citizens, moonProgress: progress, moonStage: stageFor(progress), status: b?.status ?? 'alive', newEvents: [], decision: undefined }
}

export function useCurrentFrame() {
  const record = useStore((s) => s.record)
  const mode = useStore((s) => s.mode)
  const idx = useStore((s) => frameIndexAt(s.record.frames, s.playhead))
  const frame = useMemo(() => (mode === 'baseline' ? baselineAsFrame(record, idx) : record.frames[idx]), [record, idx, mode])
  return { frame, idx, record, mode }
}
