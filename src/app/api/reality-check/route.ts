import { connection } from 'next/server'
import { readRealityCheck } from '@/lib/evolve/reality'

// GET /api/reality-check: the latest monthly comparison of the no-ai twin against real published data,
// with any ESTIMATE parameters flagged for tuning. 200 with null before the first check. read-only safe
export async function GET() {
  await connection()
  return Response.json(readRealityCheck())
}
