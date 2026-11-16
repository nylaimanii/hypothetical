import { connection } from 'next/server'
import { readJson, type LeaderboardEntry } from '@/lib/evolve/store'
import { readVersion, versionedPath } from '@/lib/evolve/version'
import { gapFor, readGaps, type ReplayGap } from '@/lib/evolve/gaps'

// GET /api/leaderboard[?version=<sim version>] -> LeaderboardEntry[] (best first). each entry carries its evidence:
// explainGap against the entry ranked below it, and realBaseline (its best world against UN World Population
// Prospects 2024 at the same year). explainGap.method 'replay': the lower world replayed on a shared seed with the
// higher world's decisions swapped in one at a time, the 3 that close the gap most with the share each explains
// (scripts/explain-gaps.ts). 'pattern': until then, the biggest differences in their decisions, said to be untested.
// the current version's board is empty until its first generation ends (a new sim version starts fresh); older
// versions' boards are archived in data/versions/<v>/ and served with ?version=, like /api/hall and /api/steps.
// read-only safe
export async function GET(req: Request) {
  await connection()
  const v = new URL(req.url).searchParams.get('version')
  const lb = readJson<LeaderboardEntry[]>(versionedPath('leaderboard.json', v)) ?? []
  // a replay only explains entries of the version it was replayed on
  const want = v ?? readVersion()?.current, gaps: Record<string, ReplayGap> = {}
  for (const [k, g] of Object.entries(readGaps())) if (!want || !g.simVersion || g.simVersion === want) gaps[k] = g
  return Response.json(lb.map((e, i) => ({ ...e, explainGap: gapFor(lb, i, gaps) })))
}
