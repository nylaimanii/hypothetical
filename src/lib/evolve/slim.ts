// slim views of a run (types from A's contract): no frames, one stat row per year, one row per decision.
// full frames load lazily from GET /api/runs/[id]/frames?from=&to=
import type { DecisionRow, Frame, RunRecord, SlimRun, YearRow } from '../types'
import { readAgents } from './agents'
import { epitaphOf } from '../notify/epitaph'

// v3 look-and-feel at yearly resolution, so tab thumbnails and graphs work without full frames. each field is
// only present when the sim filled it (hide empty instead of sending blanks)
export type YearVisuals = {
  regions?: { id: string; visual?: Frame['regions'][number]['visual']; emotionMix?: Frame['regions'][number]['emotionMix'] }[]
  flows?: Frame['flows']; space?: Frame['space']; atmosphere?: Frame['atmosphere']
}
export type SlimYearRow = YearRow & YearVisuals

function visualsOf(f: Frame): YearVisuals {
  const out: YearVisuals = {}
  const regions = f.regions.filter(r => r.visual || r.emotionMix).map(r => ({ id: r.id, ...(r.visual ? { visual: r.visual } : {}), ...(r.emotionMix ? { emotionMix: r.emotionMix } : {}) }))
  if (regions.length) out.regions = regions
  if (f.flows?.length) out.flows = f.flows
  if (f.space?.length) out.space = f.space
  if (f.atmosphere) out.atmosphere = f.atmosphere
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

export function decisionRows(frames: Frame[]): DecisionRow[] {
  return frames.filter(f => f.decision).sort((a, b) => a.tick - b.tick).map(f => {
    const d = f.decision!
    return {
      tick: d.tick, date: f.date, religionPolicy: d.religionPolicy, schoolPurpose: d.schoolPolicy.purpose, budget: d.budget,
      lawsEnacted: d.laws.map(l => l.title), citiesFounded: (d.foundCities ?? []).map(c => c.name),
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
