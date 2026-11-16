// what a decision means in THIS world, right now: the part of the world a person facing it would actually know.
// built only from the world's recording (the governor's budget, school and religion policy, the laws in force, the
// region's numbers against what they were at her birth), so the same person facing the same question in two worlds
// is told two different things whenever the worlds really differ. the llm sees this; the consequences of each option
// already depend on the same numbers (milestones.ts), so the brief is the honest version of what the choice costs.
import type { Law } from '../types'
import type { WorldEnv } from './env'
import type { MilestoneKind } from './types'
import { yearOf } from './facts'

// which laws a person deciding this would know about (title, text or policy kind)
const LAW_TOPIC: Partial<Record<MilestoneKind, RegExp>> = {
  schooling: /school|educat|universit|tuition|literacy|teacher/i, path: /school|educat|universit|tuition|apprentic|train|job|wage/i,
  first_job: /job|wage|work|employ|labou?r|factory|tax/i, career: /job|wage|work|employ|labou?r|tax|retrain/i, job_loss: /job|wage|work|employ|unemploy|welfare|retrain/i,
  money: /tax|wage|bank|saving|housing|income|welfare/i, move: /migra|visa|border|housing|relocat|city/i, late_life: /pension|elder|care|housing/i,
  partner: /marri|family|partner/i, children: /child|family|birth|parent|matern|school/i, health: /health|clinic|hospital|vaccin|screen|care/i,
  illness: /health|clinic|hospital|care|insur/i, pandemic: /health|vaccin|quarant|lockdown|disease|mask/i, famine: /food|ration|grain|famine|aid/i,
  protest: /protest|assembl|curfew|police|speech|emergency/i, faith: /relig|faith|church|mosque|temple|worship/i, retirement: /pension|retire|elder/i,
  parents: /elder|care|pension/i, help_others: /volunt|charit|communit|civic/i, habits: /tobacco|smok|alcohol|drink|sport/i,
}
const BUDGET_TOPIC: Partial<Record<MilestoneKind, [keyof import('../types').Budget, string][]>> = {
  schooling: [['education', 'schools']], path: [['education', 'schools and universities'], ['research', 'research']],
  health: [['welfare', 'health and welfare']], illness: [['welfare', 'health and welfare']], pandemic: [['welfare', 'health and welfare'], ['research', 'research']],
  famine: [['food', 'food']], job_loss: [['welfare', 'welfare']], protest: [['security', 'police and security']], retirement: [['welfare', 'pensions and welfare']],
  children: [['welfare', 'family support'], ['education', 'schools']], first_job: [['research', 'research']], career: [['research', 'research']],
}
const pct = (x: number) => `${Math.round(x * 100)}%`
const vs = (now: number, then: number, unit = '') => (Math.abs(now - then) / Math.max(1e-6, Math.abs(then)) < 0.05 ? `${unit}about the same as in 2026` : `${now > then ? 'up' : 'down'} from ${then.toFixed(then < 10 ? 1 : 0)}${unit} in 2026`)

export function worldBrief(W: WorldEnv, tick: number, regionId: string, kind: MilestoneKind): string {
  const f = W.frameAt(tick), f0 = W.frameAt(0)
  const e = W.month(tick, regionId), e0 = W.month(0, regionId)
  const lines: string[] = []
  // the region's numbers, graded and against 2026 (so a world that made things worse reads that way)
  lines.push(`life expectancy here ${e.lifeExpectancy.toFixed(0)} (${vs(e.lifeExpectancy, e0.lifeExpectancy)}); food ${pct(e.food)} of what people need; food prices ${e.prices.toFixed(1)}x normal; average income $${Math.round(e.gdpPerHead).toLocaleString('en-US')} a year (${Math.abs(e.gdpPerHead - e0.gdpPerHead) / e0.gdpPerHead < 0.05 ? 'about the same as in 2026' : `${e.gdpPerHead > e0.gdpPerHead ? 'up' : 'down'} from $${Math.round(e0.gdpPerHead).toLocaleString('en-US')} in 2026`}); unrest ${e.unrest > 0.6 ? 'very high' : e.unrest > 0.45 ? 'high' : e.unrest > 0.25 ? 'some' : 'low'}; schooling ${pct(e.education)}.`)
  // what the government does about this kind of decision
  for (const [k, w] of BUDGET_TOPIC[kind] ?? []) {
    const now = f.budget?.[k], then = f0.budget?.[k]
    if (typeof now === 'number' && typeof then === 'number') lines.push(`the government spends ${pct(now)} of its budget on ${w}${Math.abs(now - then) >= 0.02 ? ` (it was ${pct(then)} in 2026)` : ''}.`)
  }
  if ((kind === 'schooling' || kind === 'path' || kind === 'children') && f.schoolPolicy) lines.push(`school is required for ${f.schoolPolicy.yearsRequired} years${f.schoolPolicy.purpose ? `; the school plan: ${f.schoolPolicy.purpose.toLowerCase().replace(/\.$/, '')}` : ''}.`)
  if (kind === 'faith' && f.religionPolicy) lines.push(`religion: ${f.religionPolicy === 'free' ? 'free' : f.religionPolicy === 'state_neutral' ? 'the state stays out of it' : f.religionPolicy === 'state_faith' ? 'there is a state faith' : 'the state discourages it'}.`)
  // the laws in force that touch this decision, newest first
  const topic = LAW_TOPIC[kind]
  const laws = (f.laws ?? []).filter((l: Law) => !l.vetoed && l.enactedTick <= tick && topic && topic.test(`${l.title} ${l.text} ${l.policyKind}`)).sort((a, b) => b.enactedTick - a.enactedTick).slice(0, 3)
  for (const l of laws) lines.push(`law since ${yearOf(l.enactedTick)}: ${l.title}${l.compliance < 0.5 ? ' (often ignored)' : ''}.`)
  return lines.join('\n')
}
