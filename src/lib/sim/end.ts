// how a world ends, and how it is scored.
//
// destroyed when any of:
//   - world population is down 40% or more from its peak
//   - 3 or more regions have been in revolt for 24 straight months
//   - global food supply has been under the survival threshold (1,800 kcal) for 12 straight months
//   - a war reaches severity 1
// moon: crewed landing succeeded. stagnated: tick 600 (2076-11) reached without either.
//
// score:
//   moon:      1000 + (600 - tick at landing), so landing earlier scores more (max 1600)
//   otherwise: moonProgress * 500 + months survived + average wellbeing * 100
//   wellbeing per month (0..1, population-weighted) = 0.4 * food (0 at 1,800 kcal, 1 at 2,500+)
//     + 0.4 * (1 - unrest) + 0.2 * energy demand met
import { MAX_TICKS, SURVIVAL_KCAL } from './constants'
import { clamp, popWeighted, worldPop, type World } from './state'
import { moonProgress } from './space'

export function wellbeing(w: World): number {
  return popWeighted(w, r => 0.4 * clamp((r.r.foodKcalPerCapita - SURVIVAL_KCAL) / 700) + 0.4 * (1 - r.r.unrest) + 0.2 * r.energyRatio)
}

// updates streak counters and status. call once per tick after the step.
export function checkEnd(w: World, landed: boolean) {
  const pop = worldPop(w)
  w.peakPop = Math.max(w.peakPop, pop)
  w.wellbeingSum += wellbeing(w)
  w.wellbeingN++
  const food = popWeighted(w, r => r.r.foodKcalPerCapita)
  w.globalFoodMonthsUnder = food < SURVIVAL_KCAL ? w.globalFoodMonthsUnder + 1 : 0
  const revolts = w.regions.filter(r => r.inRevolt)
  w.revoltStreak = revolts.length >= 3 ? w.revoltStreak + 1 : 0

  if (landed) { w.status = 'moon'; return }
  if (pop <= 0.6 * w.peakPop) {
    w.status = 'destroyed'
    w.causeOfDeath = `Famine, disease and collapse cut the world population ${Math.round((1 - pop / w.peakPop) * 100)}% below its peak.`
  } else if (w.revoltStreak >= 24) {
    w.status = 'destroyed'
    w.causeOfDeath = `${revolts.map(r => r.r.name).join(', ')} stayed in open revolt for two years and the world government fell apart.`
  } else if (w.globalFoodMonthsUnder >= 12) {
    w.status = 'destroyed'
    w.causeOfDeath = `The world food supply stayed below ${SURVIVAL_KCAL} kcal per person for a full year and civilization starved.`
  } else if (w.warTension >= 1) {
    w.status = 'destroyed'
    w.causeOfDeath = 'Crackdowns on breakaway regions escalated into open war that the world government could not survive.'
  } else if (w.tick >= MAX_TICKS) {
    w.status = 'stagnated'
  }
}

export function score(w: World): number {
  if (w.status === 'moon') return 1000 + Math.max(0, MAX_TICKS - w.tick)
  const avgWell = w.wellbeingN ? w.wellbeingSum / w.wellbeingN : 0
  return Math.round(moonProgress(w.space) * 500 + w.tick + avgWell * 100)
}
