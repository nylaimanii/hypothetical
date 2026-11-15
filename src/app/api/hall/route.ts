import { connection } from 'next/server'
import { readHall } from '@/lib/evolve/hall'

// hall of history entries, in the order they happened. read-only safe
export async function GET() {
  await connection()
  return Response.json(readHall().entries)
}
