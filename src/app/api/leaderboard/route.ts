import { connection } from 'next/server'
import { readLeaderboard } from '@/lib/evolve/store'

// GET /api/leaderboard -> LeaderboardEntry[] (best first). each entry carries its evidence: explainGap (the 3 decisive
// decisions against the entry ranked below it, and what that cost the other world, all from the records) and
// realBaseline (its best world against UN World Population Prospects 2024 at the same year). read-only safe
export async function GET() {
  await connection()
  return Response.json(readLeaderboard())
}
