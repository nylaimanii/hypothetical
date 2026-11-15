// a dead world's epitaph: B's summary.epitaph when the sim writes one, otherwise one built from the cause of
// death and the lesson the world left behind. plain words, no llm call.
import type { Epitaph, Lesson, RunSummary } from '../types'
import { categoryOf } from '../evolve/lessons'

const KIND: Record<string, Epitaph['causeKind']> = { food: 'famine', revolt: 'revolt', war: 'war', disease: 'disaster', energy: 'collapse', population: 'collapse' }

export function epitaphOf(s: RunSummary, agentName: string, lesson?: Lesson | null): Epitaph {
  if (s.epitaph?.line) return s.epitaph
  const endYear = s.endDate.slice(0, 4)
  const causeKind = KIND[categoryOf(s.causeOfDeath ?? '') ?? ''] ?? 'collapse'
  const why = lesson?.mistake ? `it ${lesson.mistake.replace(/\.$/, '')}.` : s.causeOfDeath ? s.causeOfDeath.replace(/^./, c => c.toLowerCase()) : 'it did not last.'
  return { line: `here lies ${agentName}'s world, 2026 to ${endYear}. ${why}`, causeKind }
}
