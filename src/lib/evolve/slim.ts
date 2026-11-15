// slim views of a run (types from A's contract): no frames, one stat row per year, one row per decision.
// full frames load lazily from GET /api/runs/[id]/frames?from=&to=
import type { DecisionRow, Frame, RunRecord, SlimRun, YearRow } from '../types'

const r3 = (x: number) => Math.round(x * 1000) / 1000

function approvalOf(f: Frame): number {
  const pop = f.regions.reduce((a, r) => a + r.population, 0) || 1
  return f.humanCost?.approval ?? f.regions.reduce((a, r) => a + (r.approval ?? 0) * r.population, 0) / pop
}

export function yearRows(frames: Frame[]): YearRow[] {
  const sorted = [...frames].sort((a, b) => a.tick - b.tick)
  const last = sorted[sorted.length - 1]
  return sorted.filter(f => f.tick % 12 === 0 || f === last).map(f => ({
    tick: f.tick, date: f.date, status: f.status,
    globalPopulation: Math.round(f.globalPopulation ?? f.regions.reduce((a, r) => a + r.population, 0)),
    globalPeriodLifeExpectancy: r3(f.globalPeriodLifeExpectancy ?? 0), frontier: f.frontier ?? 'none', moonProgress: r3(f.moonProgress),
    approval: r3(approvalOf(f)), deaths: f.humanCost?.deaths ?? 0, displaced: f.humanCost?.displaced ?? 0,
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
  return {
    ...rest,
    firstTick: ticks.length ? Math.min(...ticks) : 0,
    lastTick: ticks.length ? Math.max(...ticks) : 0,
    years: yearRows(frames),
    decisions: decisionRows(frames),
  }
}
