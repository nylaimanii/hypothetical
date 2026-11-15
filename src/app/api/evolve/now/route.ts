import { connection } from 'next/server'
import { readNow, readNowFile } from '@/lib/evolve/now'
import { isReadOnly } from '@/lib/evolve/store'

// what evolution is doing right now (mission control). an idle runner is not an error: 200 with
// { running: false, lastHeartbeat } (lastHeartbeat null when evolution never ran here)
export async function GET() {
  await connection()
  const now = isReadOnly() ? null : readNow()
  if (!now) {
    const last = isReadOnly() ? null : readNowFile()
    return Response.json({ running: false, lastHeartbeat: last?.lastHeartbeat ?? last?.updatedAt ?? null })
  }
  return Response.json({ ...now, running: true })
}
