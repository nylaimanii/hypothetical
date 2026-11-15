import type { Citizen, Frame, Region, RunRecord, WorldEvent } from '@/lib/types'
import { moodFrom } from '@/lib/mock/mood'

// records from older runners can miss v2 fields. fill safe defaults so the ui never crashes on them;
// missing data stays visibly empty instead of inventing numbers
export function normalizeRecord(rec: RunRecord): RunRecord {
  const frames = (rec.frames ?? []).map((f) => normalizeFrame(f))
  return {
    ...rec,
    frames,
    baseline: rec.baseline ?? [],
    agentId: rec.agentId ?? rec.summary?.agentId ?? 'unknown',
    snapshots: rec.snapshots ?? [],
    summary: { ...rec.summary, agentId: rec.summary?.agentId ?? rec.agentId ?? 'unknown', frontier: rec.summary?.frontier ?? 'none', humanCost: rec.summary?.humanCost ?? { deaths: 0, famineDeaths: 0, unrestDeaths: 0, displaced: 0, approval: 0 }, lessonsLearned: rec.summary?.lessonsLearned ?? [], diseasesEradicated: rec.summary?.diseasesEradicated ?? [] },
  }
}

function normalizeFrame(f: Frame): Frame {
  const regions: Region[] = (f.regions ?? []).map((r) => ({ ...r, crowds: r.crowds ?? [], whys: r.whys ?? [], approval: r.approval ?? 0, lifeExpectancy: r.lifeExpectancy ?? 0, periodLifeExpectancy: r.periodLifeExpectancy ?? 0, fertility: r.fertility ?? 0, diseaseBurden: r.diseaseBurden ?? 0, travelHoursToNearest: r.travelHoursToNearest ?? 0, provenance: r.provenance ?? {} }))
  const pop = regions.reduce((a, r) => a + (r.population ?? 0), 0)
  const citizens: Citizen[] = (f.citizens ?? []).map((c) => {
    const legacyMood = typeof (c as unknown as { mood: unknown }).mood === 'number' ? (c as unknown as { mood: number }).mood : null
    return {
      ...c,
      mood: legacyMood !== null ? moodFrom(legacyMood) : c.mood ?? moodFrom(0.5),
      archetype: c.archetype ?? 'quiet_worker', behavior: c.behavior ?? 'working', lifeEvents: c.lifeEvents ?? [], opinionOfCore: c.opinionOfCore ?? 0,
      family: c.family ?? { kids: 0 }, group: c.group ?? { ageBand: c.age < 14 ? 'kid' : c.age > 66 ? 'elder' : c.age < 30 ? 'young' : 'adult', jobSector: 'general', belief: c.belief, incomeBand: 'mid', regionId: c.regionId },
    }
  })
  const newEvents: WorldEvent[] = (f.newEvents ?? []).map((e) => ({ ...e, significance: e.significance ?? e.severity ?? 0 }))
  return {
    ...f, regions, citizens, newEvents,
    laws: (f.laws ?? []).map((l) => ({ ...l, policyKind: l.policyKind ?? l.layer, precedentIds: l.precedentIds ?? [], lovedBy: l.lovedBy ?? [], hatedBy: l.hatedBy ?? [] })),
    decision: f.decision ? { ...f.decision, foundCities: f.decision.foundCities ?? [], charterCompanies: f.decision.charterCompanies ?? [], researchFocus: f.decision.researchFocus ?? [], publicStatement: f.decision.publicStatement ?? '', lessonsApplied: f.decision.lessonsApplied ?? [] } : undefined,
    requirements: f.requirements ?? [], cities: f.cities ?? [], companies: f.companies ?? [], factions: f.factions ?? [], frontier: f.frontier ?? 'none',
    humanCost: f.humanCost ?? { deaths: 0, famineDeaths: 0, unrestDeaths: 0, displaced: 0, approval: 0 },
    globalPopulation: f.globalPopulation ?? pop,
    globalPeriodLifeExpectancy: f.globalPeriodLifeExpectancy ?? (pop ? regions.reduce((a, r) => a + r.periodLifeExpectancy * r.population, 0) / pop : 0),
    lessonsKnown: f.lessonsKnown ?? 0,
  }
}
