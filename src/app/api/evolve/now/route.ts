import { connection } from 'next/server'
import { readNow } from '@/lib/evolve/now'
import { isReadOnly } from '@/lib/evolve/store'

// what evolution is doing right now (mission control). 404 when no evolution is running
export async function GET() {
  await connection()
  const now = isReadOnly() ? null : readNow()
  if (!now) return Response.json({ error: 'no evolution running' }, { status: 404 })
  return Response.json(now)
}
