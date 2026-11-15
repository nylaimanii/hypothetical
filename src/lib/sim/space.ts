// the moon program: orbital -> heavy_lift -> life_support -> lander -> crewed_landing.
// each stage needs (1) global techLevel at its gate, (2) cumulative stage spending in real dollars,
// (3) a minimum development time, (4) a rocket equation check against the real lunar delta-v budget,
// then (5) a seeded test flight that can fail.
//
// the world government starts its own program at 'none': national programs are not inherited, so it
// has to fund and fly its own vehicles. costs are modeled on Apollo and Artemis:
//   Apollo total ~$257B in 2020 dollars (Saturn V ~$50B, LM ~$27B, CSM ~$40B)
//     https://www.planetary.org/space-policy/cost-of-apollo
//   Artemis ~$93B through FY2025, NASA OIG IG-22-003 https://oig.nasa.gov/docs/IG-22-003.pdf
//   values below are in 2026 dollars (~1.2x 2020).
import type { MoonStage } from '../types'
import { clamp, event, popWeighted, type World } from './state'
import { onLaunchFailure } from './visuals'

export const STAGES: MoonStage[] = ['none', 'orbital', 'heavy_lift', 'life_support', 'lander', 'crewed_landing']

type StageSpec = { stage: MoonStage; costUsd: number; minMonths: number; techGate: number; dvKms: number; payloadFrac: number; nStages: number; failBase: number; label: string }

// delta-v (km/s): Earth to LEO ~9.4 incl. gravity and drag losses, TLI ~3.15, lunar orbit insertion ~0.9,
// descent ~2.0, ascent ~1.9, trans-earth injection ~0.9. https://en.wikipedia.org/wiki/Delta-v_budget#Earth%E2%80%93Moon_space
// failBase: ESTIMATE, maiden flights of new orbital rockets fail roughly 30% of the time historically;
// crewed landing base 8% from Apollo (1 aborted landing in 7 attempts, no in-flight deaths).
export const STAGE_SPECS: StageSpec[] = [
  { stage: 'orbital', costUsd: 25e9, minMonths: 12, techGate: 0.40, dvKms: 9.4, payloadFrac: 0.03, nStages: 2, failBase: 0.3, label: 'orbital launcher' },
  { stage: 'heavy_lift', costUsd: 60e9, minMonths: 36, techGate: 0.48, dvKms: 9.4 + 3.15, payloadFrac: 0.015, nStages: 3, failBase: 0.3, label: 'heavy lift rocket' },
  { stage: 'life_support', costUsd: 50e9, minMonths: 24, techGate: 0.53, dvKms: 9.4 + 3.15 + 0.9 + 0.9, payloadFrac: 0.004, nStages: 4, failBase: 0.15, label: 'crew capsule and life support' },
  { stage: 'lander', costUsd: 35e9, minMonths: 30, techGate: 0.57, dvKms: 2.0 + 1.9, payloadFrac: 0.15, nStages: 2, failBase: 0.25, label: 'lunar lander' },
  { stage: 'crewed_landing', costUsd: 100e9, minMonths: 12, techGate: 0.61, dvKms: 9.4 + 3.15 + 0.9 + 2.0 + 1.9 + 0.9, payloadFrac: 0.002, nStages: 5, failBase: 0.08, label: 'crewed landing' },
]

// ESTIMATE: a program cannot usefully absorb more than ~$150B/yr (about 3x Apollo's peak in 2026 dollars);
// spending above that is wasted
export const SPACE_ABSORB_USD_YEAR = 150e9
const G0 = 9.80665

export type SpaceState = { stage: MoonStage; stageSpend: number; stageMonths: number; cooldownUntil: number; totalSpend: number; attempts: number; failures: number }

export function initSpace(): SpaceState {
  return { stage: 'none', stageSpend: 0, stageMonths: 0, cooldownUntil: 0, totalSpend: 0, attempts: 0, failures: 0 }
}

// ESTIMATE: engine and structure improve with tech. vacuum Isp from kerolox ~311 s toward hydrolox ~450 s
// (RL-10), structural fraction from 0.12 toward 0.06.
export function vehicle(tech: number) {
  return { isp: 300 + 150 * clamp(tech), eps: 0.12 - 0.06 * clamp(tech) }
}

// Tsiolkovsky: n equal stages, per-stage payload fraction pi = lambda^(1/n),
// mass ratio R = 1 / (eps (1 - pi) + pi), dv = n Isp g0 ln R
export function achievableDv(tech: number, payloadFrac: number, n: number): number {
  const { isp, eps } = vehicle(tech)
  const pi = Math.pow(payloadFrac, 1 / n)
  const R = 1 / (eps * (1 - pi) + pi)
  return n * isp * G0 * Math.log(R) / 1000
}

export function nextSpec(s: SpaceState): StageSpec | undefined {
  const i = STAGES.indexOf(s.stage)
  return STAGE_SPECS[i] // STAGE_SPECS[i] is the stage after STAGES[i]
}

export function moonProgress(s: SpaceState): number {
  const done = STAGES.indexOf(s.stage)
  const spec = nextSpec(s)
  if (!spec) return 1
  const frac = Math.min(s.stageSpend / spec.costUsd, s.stageMonths / spec.minMonths, 1)
  return clamp((done + 0.9 * frac) / 5)
}

export function globalTech(w: World): number {
  return popWeighted(w, r => (r.seceded ? 0 : r.r.techLevel))
}

// one month of the program. returns true if the crewed landing just succeeded.
export function stepSpace(w: World, spaceUsd: number, researchUsd: number): boolean {
  const s = w.space
  const spec = nextSpec(s)
  if (!spec) return false
  const usable = Math.min(spaceUsd, SPACE_ABSORB_USD_YEAR / 12)
  s.stageSpend += usable
  s.totalSpend += usable
  if (usable > 0) s.stageMonths++
  if (w.tick < s.cooldownUntil) return false
  const tech = globalTech(w)
  const ready = s.stageSpend >= spec.costUsd && s.stageMonths >= spec.minMonths && tech >= spec.techGate
  if (!ready) return false
  // physics check: the vehicle this tech can build must close the delta-v budget
  const dv = achievableDv(tech, spec.payloadFrac, spec.nStages)
  if (dv < spec.dvKms) {
    s.cooldownUntil = w.tick + 12
    event(w, { kind: 'launch', text: `${spec.label} design review failed: vehicle reaches ${dv.toFixed(1)} of ${spec.dvKms.toFixed(1)} km/s needed`, severity: 0.2 })
    return false
  }
  // test flight. ESTIMATE: failure odds fall with research (up to half) and rise when tech barely clears the gate
  const researchFactor = clamp(researchUsd * 12 / 1e12 / 5)
  const pFail = clamp(spec.failBase * (1 - 0.5 * researchFactor) * (1 + 3 * Math.max(0, spec.techGate + 0.08 - tech)), 0.01, 0.9)
  s.attempts++
  if (w.rng.space() < pFail) {
    s.failures++
    if (spec.stage === 'crewed_landing') {
      const crew = 4
      w.crewDeaths += crew
      s.stageSpend *= 0.7
      s.cooldownUntil = w.tick + 24
      for (const r of w.regions) r.shock += 0.15
      event(w, { kind: 'launch', text: `crewed lunar landing failed, all ${crew} crew killed`, severity: 0.9 })
      onLaunchFailure(w, 'moon', 'lost lunar lander')
    } else {
      s.stageSpend *= 0.8
      s.cooldownUntil = w.tick + 6
      event(w, { kind: 'launch', text: `${spec.label} test flight failed`, severity: 0.4 })
    }
    return false
  }
  s.stage = spec.stage
  s.stageSpend = 0
  s.stageMonths = 0
  if (spec.stage === 'crewed_landing') {
    event(w, { kind: 'launch', text: 'crewed landing on the moon succeeded, the crew is home safe [moon stage: crewed_landing]', severity: 1 })
    return true
  }
  event(w, { kind: 'launch', text: `${spec.label} flight test succeeded [moon stage: ${spec.stage}]`, severity: 0.5 })
  return false
}
