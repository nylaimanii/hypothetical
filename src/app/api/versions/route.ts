import { connection } from 'next/server'
import { readVersion } from '@/lib/evolve/version'

// GET /api/versions: the sim version evolution runs now, and the older ones with their date ranges.
// steps, hall and learning take ?version= to read an older version's results
export async function GET() {
  await connection()
  return Response.json(readVersion() ?? { current: null, since: null, history: [] })
}
