import { connection } from 'next/server'
import { readHall } from '@/lib/evolve/hall'

// hall of history entries, in the order they happened. read-only safe
// ?version=<sim version> reads an older version's hall; default is the current version
export async function GET(req: Request) {
  await connection()
  return Response.json(readHall(new URL(req.url).searchParams.get('version')).entries)
}
