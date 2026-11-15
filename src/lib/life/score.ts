// the life score. five parts, each 0..1, weighted:
//
//   healthy years   0.25  sum over months of physical health (quality-adjusted life years, the who/gbd idea of
//                         healthy life expectancy, https://www.who.int/data/gho/indicator-metadata-registry/imr-details/66)
//                         divided by 100 years, capped at 1
//   relationships   0.25  mean relationship depth over the whole life (partner, kids, friends, family, community
//                         as bonds, not counts). the largest weight with health because the harvard study of adult
//                         development found warm relationships the strongest predictor of a good, long life
//                         (https://www.adultdevelopmentstudy.org/)
//   contribution    0.20  help given to others (helping work, caregiving, raising kids, volunteering, mentoring,
//                         money sent home) minus TWICE the harm done to others, saturating: 1 - exp(-net / 600).
//                         harm can push it to 0, never below. cruelty and exploitation are never rewarded: a
//                         harmful option that pays well raises money, and money is not in the score
//   meaning         0.15  mean sense of purpose over adult months (helping work, faith, kids, mentoring,
//                         community); purpose predicts longevity (alimujiang et al. 2019,
//                         https://doi.org/10.1001/jamanetworkopen.2019.4270)
//   wellbeing       0.15  mean monthly valence (how good the month felt) over the whole life
//
// wealth, fame and status are not in the score at all. a baby who dies at one scores near zero: that is not a
// judgement of the baby, it is the cost of where and when they were born, and it is shown, never skipped.
import type { Person } from './person'
import type { LifeScore } from './types'

export const WEIGHTS = { healthyYears: 0.25, relationships: 0.25, contribution: 0.2, meaning: 0.15, wellbeing: 0.15 } as const

export function scoreLife(p: Person): LifeScore {
  const months = Math.max(1, p.months)
  const healthyYearsLived = p.healthyMonths / 12
  const healthyYears = Math.min(1, healthyYearsLived / 100)
  // relationships and wellbeing: averaged over the life, but a life that ends in childhood only counts the months it
  // had, scaled by how much of a life it got (a 2 year life cannot score high relationships)
  const span = Math.min(1, months / (60 * 12))
  const relationships = (p.relSum / months) * (0.3 + 0.7 * span)
  const wellbeing = (p.valenceSum / months) * (0.3 + 0.7 * span)
  const net = Math.max(0, p.help - 2 * p.harm)
  const contribution = 1 - Math.exp(-net / 600)
  const meaning = p.adultMonths ? p.meaningSum / p.adultMonths : 0
  const parts = { healthyYears, relationships, contribution, meaning, wellbeing }
  const total = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((a, k) => a + WEIGHTS[k] * parts[k], 0)
  const r = (x: number) => Math.round(x * 10000) / 10000
  return { healthyYears: r(healthyYears), relationships: r(relationships), contribution: r(contribution), meaning: r(meaning), wellbeing: r(wellbeing), total: r(total), harm: Math.round(p.harm), healthyYearsLived: Math.round(healthyYearsLived * 10) / 10 }
}
