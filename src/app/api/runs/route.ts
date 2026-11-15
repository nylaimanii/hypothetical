import { connection } from 'next/server'
import type { RunSummary } from '@/lib/types'
import { isReadOnly, listShowcase, readLeaderboard } from '@/lib/evolve/store'

// leaderboard best worlds first, then showcase moon worlds not already listed
export async function GET() {
  await connection()
  if (isReadOnly()) return Response.json(listShowcase())
  const out: RunSummary[] = readLeaderboard().map(e => e.best)
  for (const s of listShowcase()) if (!out.some(o => o.runId === s.runId)) out.push(s)
  return Response.json(out)
}
