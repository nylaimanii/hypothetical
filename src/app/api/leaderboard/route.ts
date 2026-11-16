import { connection } from 'next/server'
import { readLeaderboard } from '@/lib/evolve/store'
import { gapFor, readGaps } from '@/lib/evolve/gaps'

// GET /api/leaderboard -> LeaderboardEntry[] (best first). each entry carries its evidence: explainGap against the
// entry ranked below it, and realBaseline (its best world against UN World Population Prospects 2024 at the same
// year). explainGap.method 'replay': the lower world replayed on a shared seed with the higher world's decisions
// swapped in one at a time, the 3 that close the gap most with the share each explains (scripts/explain-gaps.ts).
// 'pattern': until then, the biggest differences in their decisions, said to be untested. read-only safe
export async function GET() {
  await connection()
  const lb = readLeaderboard(), gaps = readGaps()
  return Response.json(lb.map((e, i) => ({ ...e, explainGap: gapFor(lb, i, gaps) })))
}
