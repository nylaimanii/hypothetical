// MOCK evolution feed for mission control previews. the real one is GET /api/evolve/now
import type { EvolveNow, Lesson, RunSummary } from '@/lib/types'
import { mockRuns } from './run'

// a generation is the mock worlds run back to back, one frame per poll
export function makeMockEvolution(startMs = Date.now()) {
  const worlds = mockRuns()
  let w = 0
  let f = 0
  const recent: RunSummary[] = []
  const lessons: Lesson[] = []
  let lost = 37
  const next = (): EvolveNow => {
    const rec = worlds[w]
    const frame = rec.frames[f]
    const now: EvolveNow = {
      generation: 4, agentId: rec.agentId, runId: rec.runId, worldIndex: w + 1, worldsInGen: worlds.length,
      latestFrame: frame, queue: worlds.slice(w + 1).map((r) => r.agentId), recent: [...recent], newLessons: [...lessons],
      stats: {
        worldsLost: lost, lessonsKnown: 6 + lessons.length, bestScore: Math.max(0.52, ...recent.map((r) => r.score)), champion: 'meridian-ii',
        avgMinutesPerWorld: 4.2, estWorldsByMorning: Math.max(0, Math.floor(((startMs + 9 * 3600e3 - Date.now()) / 60000) / 4.2)),
      },
      updatedAt: new Date().toISOString(),
    }
    f++
    if (f >= rec.frames.length) {
      recent.unshift(rec.summary)
      recent.splice(5)
      if (rec.summary.status === 'destroyed') { lost++; lessons.push(...rec.summary.lessonsLearned) }
      f = 0
      w = (w + 1) % worlds.length
    }
    return now
  }
  return { next }
}
