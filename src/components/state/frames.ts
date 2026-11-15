'use client'
import type { DecisionRow, Frame, FramesResponse, RunRecord, SlimRun, YearRow } from '@/lib/types'
import { mockRuns } from '@/lib/mock/run'
import { normalizeFrame } from './normalize'
import { useStore, type SlimMeta } from './store'

// frames are fetched around the scrubber: about 5 years either side
export const WINDOW = 60
const ranges = new Map<string, [number, number][]>()
const inflight = new Map<string, Promise<void>>()

// dev only: ?lazymock serves mock worlds through the lazy path so it can be exercised without a runner
let lazyFlag: boolean | null = null
export const lazyMock = () => {
  if (lazyFlag === null && typeof window !== 'undefined') lazyFlag = process.env.NODE_ENV === 'development' && new URLSearchParams(window.location.search).has('lazymock')
  return !!lazyFlag
}

// yearly stat rows and decision rows from a full record (mock, live, or older apis)
export function slimFromRecord(rec: RunRecord): SlimMeta {
  const years: YearRow[] = []
  for (const f of rec.frames) {
    if (years.length && f.tick - years[years.length - 1].tick < 12 && f !== rec.frames[rec.frames.length - 1]) continue
    years.push({ tick: f.tick, date: f.date, globalPopulation: f.globalPopulation, globalPeriodLifeExpectancy: f.globalPeriodLifeExpectancy, frontier: f.frontier, moonProgress: f.moonProgress, approval: f.humanCost.approval, deaths: f.humanCost.deaths, displaced: f.humanCost.displaced, status: f.status })
  }
  const decisions: DecisionRow[] = rec.frames.filter((f) => f.decision).map((f) => ({
    tick: f.tick, date: f.date, religionPolicy: f.decision!.religionPolicy, schoolPurpose: f.decision!.schoolPolicy.purpose, budget: f.decision!.budget,
    lawsEnacted: f.decision!.laws.map((l) => l.title), citiesFounded: f.decision!.foundCities.map((c) => c.name),
  }))
  return { firstTick: rec.frames[0]?.tick ?? 0, lastTick: rec.frames.at(-1)?.tick ?? 0, years, decisions, lazy: false }
}

// a record with no frames yet; frames arrive through ensureWindow
export function shellFromSlim(s: SlimRun): RunRecord {
  const { firstTick, lastTick, years, decisions, ...rest } = s
  void firstTick; void lastTick; void years; void decisions
  return { ...rest, frames: [], baseline: [], snapshots: [] }
}
export function metaFromSlim(s: SlimRun): SlimMeta {
  return { firstTick: s.firstTick, lastTick: s.lastTick, years: s.years ?? [], decisions: s.decisions ?? [], lazy: true }
}
// dev path: present a full mock record as if it came from the slim api
export function slimFromMock(rec: RunRecord): SlimRun {
  const m = slimFromRecord(rec)
  const { frames, baseline, snapshots, ...rest } = rec
  void frames; void baseline; void snapshots
  return { ...rest, firstTick: m.firstTick, lastTick: m.lastTick, years: m.years, decisions: m.decisions }
}

async function fetchFrames(runId: string, from: number, to: number): Promise<Frame[]> {
  if (lazyMock()) {
    const rec = mockRuns().find((r) => r.runId === runId)
    await new Promise((r) => setTimeout(r, 250))
    return rec ? rec.frames.filter((f) => f.tick >= from && f.tick <= to) : []
  }
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/frames?from=${from}&to=${to}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(String(res.status))
  const body = (await res.json()) as FramesResponse
  return (body.frames ?? []).map(normalizeFrame)
}

function covered(runId: string, from: number, to: number) {
  return (ranges.get(runId) ?? []).some(([a, b]) => a <= from && b >= to)
}
function addRange(runId: string, from: number, to: number) {
  const list = [...(ranges.get(runId) ?? []), [from, to] as [number, number]].sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const r of list) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  ranges.set(runId, merged)
}
// the part of [from, to] not loaded yet
function missing(runId: string, from: number, to: number): [number, number][] {
  const out: [number, number][] = []
  let cur = from
  for (const [a, b] of ranges.get(runId) ?? []) {
    if (b < cur) continue
    if (a > to) break
    if (a > cur) out.push([cur, Math.min(to, a - 1)])
    cur = Math.max(cur, b + 1)
  }
  if (cur <= to) out.push([cur, to])
  return out
}

export function resetFrames(runId: string) { ranges.delete(runId) }

// the first window of a lazy run, fetched before the world is shown so frames are never empty
export async function loadInitial(runId: string, meta: SlimMeta, center: number): Promise<Frame[]> {
  ranges.delete(runId)
  const from = Math.max(meta.firstTick, Math.floor(center - WINDOW))
  const to = Math.min(meta.lastTick, Math.ceil(center + WINDOW))
  const frames = await fetchFrames(runId, from, to)
  if (frames.length) addRange(runId, from, to)
  return frames
}

// load whatever is missing within ±WINDOW of center, merging into every view that shows this run
export async function ensureWindow(runId: string, center: number) {
  const meta = useStore.getState().slim[runId]
  if (!meta?.lazy) return
  const from = Math.max(meta.firstTick, Math.floor(center - WINDOW))
  const to = Math.min(meta.lastTick, Math.ceil(center + WINDOW))
  if (from > to || covered(runId, from, to)) return
  const jobs = missing(runId, from, to).map(([a, b]) => {
    const key = `${runId}:${a}-${b}`
    if (inflight.has(key)) return inflight.get(key)!
    const p = fetchFrames(runId, a, b)
      .then((frames) => { addRange(runId, a, b); useStore.getState().mergeFrames(runId, frames) })
      .catch(() => { /* the next scrub retries */ })
      .finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  })
  await Promise.all(jobs)
}

// is the scrubber close to the edge of what is loaded
export function needsWindow(runId: string, center: number) {
  const meta = useStore.getState().slim[runId]
  if (!meta?.lazy) return false
  const from = Math.max(meta.firstTick, Math.floor(center - WINDOW * 0.6))
  const to = Math.min(meta.lastTick, Math.ceil(center + WINDOW * 0.6))
  return !covered(runId, from, to)
}
