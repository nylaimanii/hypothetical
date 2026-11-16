// how a world ends, and how it is scored.
//
// destroyed when any of:
//   - world population is down 40% or more from its peak
//   - 3 or more regions have been in revolt for 24 straight months
//   - global food supply has been under the survival threshold (1,800 kcal) for 12 straight months
//   - a war reaches severity 1
// goal_achieved (ends early): frontier mars_self_sustaining reached AND global period life expectancy >= 200
//   AND global population not declining over the last 10 years (120 ticks)
// complete: reached the horizon, tick 1200 (2126-11), without the goal.
//
// score = mission progress only, 0..1 (human cost is never in the score; it is reported next to it):
//   0.40 x frontier: share of the 7 milestones achieved (moon_landing .. outer_system)
//   0.30 x period life expectancy progress from 2026 (~73) to 200, using the best value reached
//   0.15 x population trend over the last 10 years (1 if not declining, falling to 0 at a 10% decline)
//   0.15 x share of requirement nodes completed
//   goal_achieved scores 1.
import { worldFreedom } from './tradeoffs'
import { A } from './assumptions'
import { MAX_TICKS, SURVIVAL_KCAL } from './constants'
import { FRONTIERS, has } from './frontier'
import { clamp, popWeighted, worldPop, type World } from './state'

export const START_PLE = 73

export function wellbeing(w: World): number {
  return popWeighted(w, r => 0.4 * clamp((r.r.foodKcalPerCapita - A(w, 'survival_kcal')) / 700) + 0.4 * (1 - r.r.unrest) + 0.2 * r.energyRatio)
}

export function globalPLE(w: World): number {
  return popWeighted(w, r => r.periodLE)
}

export function popTrend(w: World): number {
  // popHistory holds one entry per 12 ticks
  const h = w.popHistory
  const now = worldPop(w)
  const then = h.length > 10 ? h[h.length - 11] : h[0]
  return then > 0 ? now / then - 1 : 0
}

export function checkEnd(w: World) {
  const pop = worldPop(w)
  w.peakPop = Math.max(w.peakPop, pop)
  w.peakPLE = Math.max(w.peakPLE, globalPLE(w))
  if (w.tick % 12 === 0) w.popHistory.push(pop)
  w.wellbeingSum += wellbeing(w)
  w.freedomSum = (w.freedomSum ?? 0) + worldFreedom(w)
  w.wellbeingN++
  const food = popWeighted(w, r => r.r.foodKcalPerCapita)
  w.globalFoodMonthsUnder = food < A(w, 'survival_kcal') ? w.globalFoodMonthsUnder + 1 : 0
  const revolts = w.regions.filter(r => r.inRevolt)
  w.revoltStreak = revolts.length >= 3 ? w.revoltStreak + 1 : 0

  if (pop <= 0.6 * w.peakPop) {
    w.status = 'destroyed'
    w.causeOfDeath = `Famine, disease and collapse cut the world population ${Math.round((1 - pop / w.peakPop) * 100)}% below its peak.`
  } else if (w.revoltStreak >= 24) {
    w.status = 'destroyed'
    w.causeOfDeath = `${revolts.map(r => r.r.name).join(', ')} stayed in open revolt for two years and the world government fell apart.`
  } else if (w.globalFoodMonthsUnder >= 12) {
    w.status = 'destroyed'
    w.causeOfDeath = `The world food supply stayed below ${A(w, 'survival_kcal')} kcal per person for a full year and civilization starved.`
  } else if (w.warTension >= 1) {
    w.status = 'destroyed'
    w.causeOfDeath = 'Crackdowns on breakaway regions escalated into open war that the world government could not survive.'
  } else if (has(w, 'mars_self_sustaining') && globalPLE(w) >= 200 && w.popHistory.length > 10 && popTrend(w) >= 0) {
    w.status = 'goal_achieved'
  } else if (w.tick >= MAX_TICKS) {
    w.status = 'complete'
  }
}

export function score(w: World): number {
  if (w.status === 'goal_achieved') return 1
  const frontier = w.frontierState.achieved.length / (FRONTIERS.length - 1)
  const ple = clamp((Math.max(w.peakPLE, globalPLE(w)) - START_PLE) / (200 - START_PLE))
  const trend = clamp(1 + popTrend(w) * 10)
  const reqs = w.requirements.filter(r => r.progress >= 1).length / Math.max(1, w.requirements.length)
  return Math.round((0.4 * frontier + 0.3 * ple + 0.15 * trend + 0.15 * reqs) * 1e4) / 1e4
}
