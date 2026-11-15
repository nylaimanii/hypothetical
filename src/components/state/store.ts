'use client'
import { useMemo } from 'react'
import { create } from 'zustand'
import type { Agent, BaselineFrame, DecisionRow, Divergence, Frame, Override, RunRecord, RunSummary, WorldEvent, Layer, YearRow } from '@/lib/types'
import { mockRuns, stageFor } from '@/lib/mock/run'
import { moodFrom } from '@/lib/mock/mood'
import { normalizeRecord } from './normalize'

export type Selection =
  | { kind: 'pip'; id: string }
  | { kind: 'region'; id: string }
  | { kind: 'layer'; regionId: string; layer: Layer }
  | { kind: 'law'; id: string }
  | { kind: 'core' }
  | { kind: 'moon' }
  | { kind: 'city'; id: string }
  | { kind: 'company'; id: string }
  | { kind: 'requirement'; id: string }
  | { kind: 'faction'; id: string }
  | { kind: 'event'; tick: number; index: number }
  | { kind: 'agent'; id: string }
  | { kind: 'country'; id: string }
  | { kind: 'admin'; id: string }
  | { kind: 'sea'; ocean: number; chokepoint?: string }
  | null

export type Zoom = 'far' | 'mid' | 'close'
export type Quality = 'high' | 'fast'
export type Source = 'mock' | 'api' | 'live'
// a visual effect trigger, from frame events or local injections
export type Juice = { id: number; kind: WorldEvent['kind']; regionId?: string; severity: number; text: string; at: number }
// a camera shot: a region or the core, asked for by the director, the feed, or the user
export type ShotRequest = { id: number; target: 'region' | 'core'; regionId?: string; force?: boolean }
export type Caption = { id: number; parts: { t: string; mono?: boolean }[]; danger?: boolean }
// what is known about a run without its frames. lazy runs load frames around the scrubber
export type SlimMeta = { firstTick: number; lastTick: number; years: YearRow[]; decisions: DecisionRow[]; lazy: boolean }
// v3: every open world is a tab; each world has these views and the globe has these overlay modes
export type View = 'globe' | 'daily' | 'graphs' | 'people' | 'steps'
// v4 adds the place stats: happiness, economy, livability ("great place to live") and trend
export type Overlay = 'real' | 'happiness' | 'economy' | 'livability' | 'trend' | 'emotion' | 'population' | 'movement' | 'energy' | 'damage'
export type Tip = { title: string; text: string; x: number; y: number }
// minimal shell: one panel at a time. sheets are the panels that live in the side menu's world
export type Sheet = 'worlds' | 'chronicle' | 'live' | 'layers' | 'epitaph' | null
export type Panel = 'offworld' | 'longevity' | 'agents' | 'hall' | null
export type Compare = { agentIds: string[]; records: RunRecord[]; divergences: Divergence[] }
// a highlight reel: the top events by significance, played back to back
export type Reel = { stops: { tick: number; regionId?: string; kind: WorldEvent['kind'] }[]; i: number; returnTo: number; wasPlaying: boolean }
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
  // fallback on high: 0 all on, 1 no clouds, 2 also no pip shadows, 3 also no physics for off-screen pips
  adaptive: 0 | 1 | 2 | 3
  selection: Selection
  drawerOpen: boolean
  liveRunId: string | null
  runnerOffline: boolean
  overrides: SentOverride[]
  juice: Juice[]
  notice: string | null
  director: boolean
  directorPausedUntil: number // performance.now() ms
  directorPaused: boolean
  shot: ShotRequest | null
  caption: Caption | null
  soundOn: boolean
  volume: number
  introOpen: boolean
  showTwin: boolean // advanced setting: the no-ai twin is hidden by default
  advancedOpen: boolean
  panel: Panel
  agents: Agent[]
  agentsSource: 'mock' | 'api'
  compare: Compare | null
  compareFocus: number | null
  reel: Reel | null
  slim: Record<string, SlimMeta>
  globeOnly: boolean
  loading: string | null // what is loading, shown as a pill
  daily: { open: boolean; year: number | null; peek: number | null }
  shortcutsOpen: boolean
  tabs: string[] // run ids, in tab order
  tabRecords: Record<string, RunRecord> // every open world's record, so views can compare them
  view: View
  overlay: Overlay
  explain: boolean
  tip: Tip | null
  swapping: boolean // the quick zoom out / in between tabs
  // v4: the time of day (utc hours). turns while paused unless pinned; follows the playhead while playing
  hour: number
  hourPinned: boolean
  setHour: (h: number, pin?: boolean) => void
  // v4: the city diorama being visited, or null for the globe
  cityView: string | null
  setCityView: (id: string | null) => void
  menu: boolean
  sheet: Sheet
  report: boolean // the selection's full report instead of its slim card
  setMenu: (open: boolean) => void
  setSheet: (s: Sheet) => void
  setReport: (on: boolean) => void
  closeAll: () => void
  setTabs: (tabs: string[]) => void
  setTabRecord: (r: RunRecord) => void
  setView: (v: View) => void
  setOverlay: (o: Overlay) => void
  setExplain: (on: boolean) => void
  setTip: (t: Tip | null) => void
  setSwapping: (on: boolean) => void
  setRecord: (r: RunRecord, source: Source) => void
  replaceRecord: (r: RunRecord) => void
  setRuns: (runs: RunSummary[], src: 'mock' | 'api') => void
  setPlayhead: (t: number) => void
  setPlaying: (p: boolean) => void
  setSpeed: (s: 1 | 4 | 16) => void
  setMode: (m: 'ai' | 'baseline') => void
  setZoom: (z: Zoom) => void
  setQuality: (q: Quality) => void
  setAdaptive: (a: 0 | 1 | 2 | 3) => void
  select: (s: Selection) => void
  setDrawer: (o: boolean) => void
  setLive: (id: string | null) => void
  setRunnerOffline: (v: boolean) => void
  addOverride: (o: SentOverride) => void
  markResponded: (ids: string[]) => void
  pushJuice: (j: Omit<Juice, 'id' | 'at'>) => void
  setNotice: (n: string | null) => void
  setDirector: (on: boolean) => void
  pauseDirector: (ms: number) => void
  requestShot: (s: Omit<ShotRequest, 'id'>) => void
  setCaption: (c: Omit<Caption, 'id'> | null) => void
  setSound: (on: boolean) => void
  setVolume: (v: number) => void
  setIntro: (open: boolean) => void
  setShowTwin: (on: boolean) => void
  setAdvanced: (open: boolean) => void
  setPanel: (p: Panel) => void
  setAgents: (a: Agent[], src: 'mock' | 'api') => void
  setCompare: (c: Compare | null) => void
  setCompareFocus: (i: number | null) => void
  setReel: (r: Reel | null) => void
  setSlim: (runId: string, meta: SlimMeta) => void
  setGlobeOnly: (on: boolean) => void
  setLoading: (what: string | null) => void
  setDaily: (d: Partial<{ open: boolean; year: number | null; peek: number | null }>) => void
  setShortcuts: (open: boolean) => void
  mergeFrames: (runId: string, frames: Frame[]) => void
}

// everything that can be open, closed: opening anything spreads this first
function closed(s: State): Partial<State> {
  return { selection: null, report: false, panel: null, drawerOpen: false, advancedOpen: false, shortcutsOpen: false, menu: false, sheet: null, daily: { ...s.daily, open: false, peek: null } }
}

let juiceId = 1
let shotId = 1
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
  director: true,
  directorPausedUntil: 0,
  directorPaused: false,
  shot: null,
  caption: null,
  soundOn: false,
  volume: 0.6,
  introOpen: false,
  showTwin: false,
  advancedOpen: false,
  panel: null,
  agents: [],
  agentsSource: 'mock',
  compare: null,
  compareFocus: null,
  reel: null,
  slim: {},
  globeOnly: false,
  loading: null,
  daily: { open: false, year: null, peek: null },
  shortcutsOpen: false,
  tabs: [],
  tabRecords: {},
  view: 'globe',
  overlay: 'real',
  explain: true,
  tip: null,
  swapping: false,
  hour: 9,
  hourPinned: false,
  setHour: (h, pin) => set((s) => ({ hour: ((h % 24) + 24) % 24, hourPinned: pin ?? s.hourPinned })),
  cityView: null,
  setCityView: (cityView) => set((s) => ({ ...closed(s), cityView })),
  menu: false,
  sheet: null,
  report: false,
  setMenu: (menu) => set((s) => (menu ? { ...closed(s), menu } : { menu })),
  setSheet: (sheet) => set((s) => (sheet ? { ...closed(s), sheet } : { sheet })),
  setReport: (report) => set((s) => (report ? { ...closed(s), selection: s.selection, report } : { report })),
  closeAll: () => set((s) => closed(s)),
  setTabs: (tabs) => set({ tabs }),
  setTabRecord: (r) => set((s) => ({ tabRecords: { ...s.tabRecords, [r.runId]: r } })),
  setView: (view) => set((s) => ({ ...closed(s), view })),
  setOverlay: (overlay) => set({ overlay }),
  setExplain: (explain) => set({ explain }),
  setTip: (tip) => set({ tip }),
  setSwapping: (swapping) => set({ swapping }),
  setRecord: (raw, source) => set((s) => { const record = source === 'mock' ? raw : normalizeRecord(raw); return { record, tabRecords: { ...s.tabRecords, [record.runId]: record }, tabs: s.tabs.includes(record.runId) ? s.tabs : [...s.tabs, record.runId], source, playhead: source === 'live' ? (record.frames.at(-1)?.tick ?? 0) : 0, selection: null, overrides: s.record.runId === record.runId ? s.overrides : [] } }),
  replaceRecord: (record) => set((s) => ({ record: s.source === 'mock' ? record : normalizeRecord(record) })),
  setRuns: (runs, runsSource) => set({ runs, runsSource }),
  setPlayhead: (playhead) => set({ playhead }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setMode: (mode) => set({ mode }),
  setZoom: (zoom) => set({ zoom }),
  setQuality: (quality) => { try { localStorage.setItem('hyp.quality', quality) } catch { /* private mode */ } set({ quality, adaptive: 0 }) },
  setAdaptive: (adaptive) => set({ adaptive }),
  select: (selection) => set((s) => (selection ? { ...closed(s), selection } : { selection: null, report: false })),
  setDrawer: (drawerOpen) => set((s) => (drawerOpen ? { ...closed(s), drawerOpen } : { drawerOpen })),
  setLive: (liveRunId) => set({ liveRunId }),
  setRunnerOffline: (runnerOffline) => set({ runnerOffline }),
  addOverride: (o) => set((s) => ({ overrides: [...s.overrides, o] })),
  markResponded: (ids) => set((s) => ({ overrides: s.overrides.map((o) => (ids.includes(o.id) ? { ...o, responded: true } : o)) })),
  pushJuice: (j) => set((s) => ({ juice: [...s.juice.filter((x) => performance.now() - x.at < 12000), { ...j, id: juiceId++, at: performance.now() }] })),
  setNotice: (notice) => set({ notice }),
  setDirector: (director) => set({ director, directorPausedUntil: 0, directorPaused: false }),
  pauseDirector: (ms) => {
    const until = performance.now() + ms
    set({ directorPausedUntil: until, directorPaused: true })
    setTimeout(() => { if (useStore.getState().directorPausedUntil === until) set({ directorPaused: false }) }, ms + 20)
  },
  requestShot: (s) => set({ shot: { ...s, id: shotId++ } }),
  setCaption: (c) => set({ caption: c ? { ...c, id: shotId++ } : null }),
  setSound: (soundOn) => set({ soundOn }),
  setVolume: (volume) => set({ volume }),
  setIntro: (introOpen) => set({ introOpen }),
  setShowTwin: (showTwin) => set((s) => ({ showTwin, mode: showTwin ? s.mode : 'ai' })),
  setAdvanced: (advancedOpen) => set((s) => (advancedOpen ? { ...closed(s), advancedOpen } : { advancedOpen })),
  setPanel: (panel) => set((s) => (panel ? { ...closed(s), panel } : { panel })),
  setAgents: (agents, agentsSource) => set({ agents, agentsSource }),
  setCompare: (compare) => set({ compare, compareFocus: null, selection: null, panel: null }),
  setCompareFocus: (compareFocus) => set({ compareFocus }),
  setReel: (reel) => set({ reel }),
  setGlobeOnly: (globeOnly) => set({ globeOnly }),
  setLoading: (loading) => set({ loading }),
  setDaily: (d) => set((s) => (d.open ? { ...closed(s), daily: { ...s.daily, ...d } } : { daily: { ...s.daily, ...d } })),
  setShortcuts: (shortcutsOpen) => set((s) => (shortcutsOpen ? { ...closed(s), shortcutsOpen } : { shortcutsOpen })),
  setSlim: (runId, meta) => set((s) => ({ slim: { ...s.slim, [runId]: meta } })),
  mergeFrames: (runId, frames) => set((s) => {
    if (!frames.length) return {}
    const merge = (rec: RunRecord): RunRecord => {
      const byTick = new Map(rec.frames.map((f) => [f.tick, f]))
      for (const f of frames) byTick.set(f.tick, f)
      return { ...rec, frames: [...byTick.values()].sort((a, b) => a.tick - b.tick) }
    }
    const out: Partial<State> = {}
    if (s.record.runId === runId) out.record = merge(s.record)
    if (s.tabRecords[runId]) out.tabRecords = { ...s.tabRecords, [runId]: merge(s.tabRecords[runId]) }
    if (s.compare?.records.some((r) => r.runId === runId)) out.compare = { ...s.compare, records: s.compare.records.map((r) => (r.runId === runId ? merge(r) : r)) }
    return out
  }),
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
    return reg ? { ...c, mood: moodFrom(Math.max(0, Math.min(1, 0.85 - reg.unrest * 0.9 + ((c.personalitySeed % 100) / 100 - 0.5) * 0.3))) } : c
  })
  const progress = b?.moonProgress ?? 0
  return { ...f0, tick: f.tick, date: f.date, regions, citizens, moonProgress: progress, moonStage: stageFor(progress), status: b?.status ?? 'alive', newEvents: [], decision: undefined }
}

// in compare mode the focused globe's world drives dossiers and panels
export function useCurrentFrame() {
  const record = useStore((s) => (s.compare && s.compareFocus !== null ? s.compare.records[s.compareFocus] ?? s.record : s.compare ? s.compare.records[0] ?? s.record : s.record))
  const mode = useStore((s) => (s.compare ? 'ai' : s.mode))
  const idx = useStore((s) => frameIndexAt(record.frames, s.playhead))
  const frame = useMemo(() => (mode === 'baseline' ? baselineAsFrame(record, idx) : record.frames[idx]), [record, idx, mode])
  return { frame, idx, record, mode }
}
