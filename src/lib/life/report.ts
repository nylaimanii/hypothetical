// plain-text reports of lives, for scripts and the terminal
import fs from 'node:fs'
import path from 'node:path'
import type { LifeRecord } from './types'

// C's evolve owns telegram getUpdates while it runs (data/evolve-now.json with a live pid)
export function evolveRunning(): boolean {
  try {
    const now = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'evolve-now.json'), 'utf8')) as { pid?: number; running?: boolean }
    if (now.running === false || !now.pid) return false
    process.kill(now.pid, 0)
    return true
  } catch { return false }
}

import { yearOf as yr } from './facts'

export function describeLife(r: LifeRecord, seconds?: number): string {
  const s = r.score!
  const t = r.twin!
  const self = r.milestones.filter(m => m.decider === 'self')
  const applied = r.milestones.filter(m => m.lessonApplied)
  const L: string[] = []
  L.push('')
  L.push(`life #${r.lifeNo} · ${r.epitaph}`)
  L.push(`  born: ${r.family.story}. temperament o${pct(r.temperament.openness)} c${pct(r.temperament.conscientiousness)} e${pct(r.temperament.extraversion)} a${pct(r.temperament.agreeableness)} n${pct(r.temperament.neuroticism)}`)
  if (r.childhood) L.push(`  childhood: ${r.childhood.hungerMonths} hungry months, ${r.childhood.displaced ? 'lost a home, ' : ''}${r.childhood.lostParent ? 'lost a parent, ' : ''}stable home ${r.childhood.stableHome}, ${r.childhood.schoolYearsBy16} years of school by 16, trust ${r.childhood.trust}`)
  L.push(`  died ${yr(r.deathTick!)} at ${r.deathAge}: ${r.deathCause}`)
  L.push(`  life score ${s.total.toFixed(3)}  (healthy years ${s.healthyYears.toFixed(2)} [${s.healthyYearsLived}y], relationships ${s.relationships.toFixed(2)}, contribution ${s.contribution.toFixed(2)}, meaning ${s.meaning.toFixed(2)}, wellbeing ${s.wellbeing.toFixed(2)}${s.harm ? `, harm ${s.harm}` : ''})`)
  L.push(`  twin (same birth + luck, usual choices, no lessons): ${t.score.total.toFixed(3)}, died at ${t.deathAge} (${t.deathCause}). choices worth ${(s.total - t.score.total >= 0 ? '+' : '')}${(s.total - t.score.total).toFixed(3)}`)
  L.push(`  ${r.milestones.length} milestones (${self.length} their own, ${r.milestones.length - self.length} by parents), ${applied.length} shaped by a lesson. llm ${r.usage.llmCalls} calls, ${r.usage.tokens} tokens, ${r.usage.ruleFallbacks} rule fallbacks${seconds ? `, ${Math.round(seconds)}s` : ''}`)
  for (const m of r.milestones) L.push(`    ${m.caption}${m.decidedBy === 'rule' && m.decider === 'self' ? '  [rule]' : ''}`)
  const big = r.events.filter(e => e.kind !== 'milestone' && e.severity >= 0.5)
  if (big.length) {
    L.push('  what happened to them:')
    for (const e of big.slice(0, 18)) L.push(`    ${yr(e.tick)} · ${e.text}`)
    if (big.length > 18) L.push(`    ... ${big.length - 18} more`)
  }
  const j = r.journal.filter(x => x.byLlm).slice(0, 4)
  if (j.length) { L.push('  journal:'); for (const x of j) L.push(`    ${x.year} (${x.age}): "${x.text}"`) }
  if (r.lessonsLeft.length) { L.push('  lessons left:'); for (const l of r.lessonsLeft) L.push(`    [${l.kind}; ${l.tags.join(', ')}] ${l.rule}  (chose: ${l.choice} -> ${l.ledTo})`) }
  else L.push('  lessons left: none (too young to have made choices of their own)')
  return L.join('\n')
}
const pct = (x: number) => Math.round(x * 100)
