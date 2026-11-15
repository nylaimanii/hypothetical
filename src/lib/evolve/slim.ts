// slim views of a run (types from A's contract): no frames, one stat row per year, one row per decision.
// full frames load lazily from GET /api/runs/[id]/frames?from=&to=
import type { DecisionRow, Frame, RunRecord, SlimRun, YearRow } from '../types'
import { readAgents } from './agents'
import { epitaphOf } from '../notify/epitaph'

// v3 look-and-feel at yearly resolution, so tab thumbnails and graphs work without full frames. each field is
// only present when the sim filled it (hide empty instead of sending blanks)
// plus each region's story and stat trends for the year (cause chains). no citizens and no cause links here:
// those load lazily (frames endpoint, per pip); story.chainIds point into the frame's causes
type FrameRegion = Frame['regions'][number]
export type YearVisuals = {
  regions?: { id: string; visual?: FrameRegion['visual']; emotionMix?: FrameRegion['emotionMix']; story?: FrameRegion['story']; trends?: FrameRegion['trends'] }[]
  flows?: Frame['flows']; space?: Frame['space']; atmosphere?: Frame['atmosphere']
}
export type SlimYearRow = YearRow & YearVisuals

// lean numbers: fractions to 3 decimals (big counts like population stay whole)
function round(x: unknown): unknown {
  if (typeof x === 'number') return Number.isInteger(x) || Math.abs(x) >= 1000 ? x : Math.round(x * 1000) / 1000
  if (Array.isArray(x)) return x.map(round)
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, round(v)]))
  return x
}
// a stable trend says little each year: keep its stat and direction, drop the change and the sentence
type Trends = NonNullable<FrameRegion['trends']>
const leanTrends = (ts: Trends): Trends => ts.map(t => (t.direction === 'stable' ? { stat: t.stat, direction: t.direction } as Trends[number] : t))

function visualsOf(f: Frame): YearVisuals {
  const out: YearVisuals = {}
  const regions = f.regions.filter(r => r.visual || r.emotionMix || r.story || r.trends?.length).map(r => ({
    id: r.id,
    ...(r.visual ? { visual: round(r.visual) as FrameRegion['visual'] } : {}), ...(r.emotionMix ? { emotionMix: round(r.emotionMix) as FrameRegion['emotionMix'] } : {}),
    ...(r.story ? { story: r.story } : {}), ...(r.trends?.length ? { trends: round(leanTrends(r.trends)) as Trends } : {}),
  }))
  if (regions.length) out.regions = regions
  if (f.flows?.length) out.flows = round(f.flows) as Frame['flows']
  if (f.space?.length) out.space = f.space
  if (f.atmosphere) out.atmosphere = round(f.atmosphere) as Frame['atmosphere']
  return out
}

const r3 = (x: number) => Math.round(x * 1000) / 1000

function approvalOf(f: Frame): number {
  const pop = f.regions.reduce((a, r) => a + r.population, 0) || 1
  return f.humanCost?.approval ?? f.regions.reduce((a, r) => a + (r.approval ?? 0) * r.population, 0) / pop
}

export function yearRows(frames: Frame[]): SlimYearRow[] {
  const sorted = [...frames].sort((a, b) => a.tick - b.tick)
  const last = sorted[sorted.length - 1]
  return sorted.filter(f => f.tick % 12 === 0 || f === last).map(f => ({
    tick: f.tick, date: f.date, status: f.status,
    globalPopulation: Math.round(f.globalPopulation ?? f.regions.reduce((a, r) => a + r.population, 0)),
    globalPeriodLifeExpectancy: r3(f.globalPeriodLifeExpectancy ?? 0), frontier: f.frontier ?? 'none', moonProgress: r3(f.moonProgress),
    approval: r3(approvalOf(f)), deaths: f.humanCost?.deaths ?? 0, displaced: f.humanCost?.displaced ?? 0,
    ...visualsOf(f),
  }))
}

// decision rows plus the core's reasoning (what it saw, chose, expected, and what happened), when the sim gives it
export type SlimDecisionRow = DecisionRow & { reasoning?: NonNullable<Frame['decision']>['reasoning'] }

export function decisionRows(frames: Frame[]): SlimDecisionRow[] {
  return frames.filter(f => f.decision).sort((a, b) => a.tick - b.tick).map(f => {
    const d = f.decision!
    return {
      tick: d.tick, date: f.date, religionPolicy: d.religionPolicy, schoolPurpose: d.schoolPolicy.purpose, budget: d.budget,
      lawsEnacted: d.laws.map(l => l.title), citiesFounded: (d.foundCities ?? []).map(c => c.name),
      ...(d.reasoning ? { reasoning: d.reasoning } : {}),
    }
  })
}

export function slimRun(rec: RunRecord): SlimRun {
  const { frames, baseline: _b, snapshots: _s, ...rest } = rec
  const ticks = frames.map(f => f.tick)
  // dead worlds always carry an epitaph (the sim's, or one built from the cause of death)
  const summary = rec.summary.status === 'destroyed' && !rec.summary.epitaph
    ? { ...rec.summary, epitaph: epitaphOf(rec.summary, readAgents().find(a => a.id === rec.agentId)?.name ?? rec.agentId, rec.summary.lessonsLearned?.[0]) }
    : rec.summary
  return {
    ...rest,
    summary,
    firstTick: ticks.length ? Math.min(...ticks) : 0,
    lastTick: ticks.length ? Math.max(...ticks) : 0,
    years: yearRows(frames),
    decisions: decisionRows(frames),
  }
}
