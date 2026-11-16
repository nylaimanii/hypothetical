// tradeoffs: what a world traded for what. lifespan, population, freedom and off-world progress, per frame and at
// the end of a run. freedom is a defined index, 0 (none) to 1, per region and population-weighted for the world:
//   0.9 (no restrictions, no added voice: 2026 policy) - 0.35 x compliance that only force explains (collectivization, birth limits, relocations... enforced by police)
//     - 0.25 x censorship (compliance with assembly limits, press control, internet shutdowns)
//     - 0.20 x limits on movement (lockdowns, forced relocation)
//     - 0.10 x a security budget beyond 2026 (up to 3x)
//     + 0.10 x a voice (referendums, citizens' assemblies), so 1 means no restrictions and a full voice. (before
//     5.10.10 the base was 1, so a voice was clipped away and 19 of 20 worlds read exactly 1)
// the weights are ESTIMATE, in the spirit of Freedom House's civil-liberties categories (expression, assembly,
// movement, rule of law: https://freedomhouse.org/reports/freedom-world/freedom-world-research-methodology)
import { FRONTIERS } from './frontier'
import { moonProgress } from './space'
import { clamp, regionPop, type RegionState, type World } from './state'

const kindC = (w: World, rs: RegionState, kinds: string[]) => Math.max(0, ...w.laws.filter(l => !l.vetoed && kinds.includes(l.policyKind)).map(l => rs.lawCompliance[l.id] ?? 0))
export function regionFreedom(w: World, rs: RegionState): number {
  const sec = clamp(rs.spend.security * 12 / Math.max(regionPop(rs), 1) / Math.max(rs.pc0.security, 1), 0, 4)
  return clamp(0.9 - 0.35 * (rs.forced ?? 0) - 0.25 * kindC(w, rs, ['assembly_limit']) - 0.2 * kindC(w, rs, ['lockdown', 'relocation']) - 0.1 * clamp((sec - 1) / 2) + 0.1 * kindC(w, rs, ['referendum', 'citizens_assembly']))
}
export function worldFreedom(w: World): number {
  const P = w.regions.reduce((a, r) => a + regionPop(r), 0) || 1
  return w.regions.reduce((a, r) => a + regionFreedom(w, r) * regionPop(r), 0) / P
}
// off-world progress, 0..1: the frontier reached (of 7 stages beyond 2026) plus the moon program within its stage
export function offWorldProgress(w: World): number {
  const i = Math.max(0, FRONTIERS.indexOf(w.frontier))
  return clamp((i + (i === 0 ? moonProgress(w.space) : 0)) / (FRONTIERS.length - 1))
}
