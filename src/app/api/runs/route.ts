import { connection } from 'next/server'
import type { RunSummary } from '@/lib/types'
import { isReadOnly, listShowcase, readLeaderboard } from '@/lib/evolve/store'
import { readEvidence } from '@/lib/evolve/evidence'

// leaderboard best worlds first, then showcase moon worlds not already listed. every score comes with realBaseline:
// the world against UN World Population Prospects 2024 at the same year (null when it can't be compared)
export async function GET() {
  await connection()
  const out: RunSummary[] = isReadOnly() ? [] : readLeaderboard().map(e => e.best)
  for (const s of listShowcase()) if (!out.some(o => o.runId === s.runId)) out.push(s)
  const ev = readEvidence()
  return Response.json(out.map(s => ({ ...s, realBaseline: ev[s.runId]?.realBaseline ?? null })))
}
