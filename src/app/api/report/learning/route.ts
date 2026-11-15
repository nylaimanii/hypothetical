import { connection } from 'next/server'
import { learningReport } from '@/lib/evolve/report'

// GET /api/report/learning: the cross-world story. every world in order, how it ended, the lesson it added, and
// whether later worlds avoided that mistake. read-only safe (reads whatever data is committed)
export async function GET() {
  await connection()
  return Response.json(learningReport())
}
