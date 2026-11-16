import { connection } from 'next/server'
import { isReadOnly } from '@/lib/evolve/store'
import { readPlaybook, writePlaybook } from '@/lib/evolve/playbook'

// GET /api/playbook -> Playbook: what the worlds have learned, in plain words. every lesson carries its evidence:
// how many same-seed a/b tests support it and how many contradict it, the confidence that follows (it moves up or
// down each generation), what was measured ("testedAs"), and the world pairs behind it. a lesson the sim can't
// measure yet has confidence null, never a made-up number. rewritten after every generation; read-only safe
export async function GET() {
  await connection()
  const pb = readPlaybook() ?? (isReadOnly() ? null : writePlaybook(null))
  return Response.json(pb ?? { computedAt: null, generation: null, worlds: 0, pairs: 0, lessons: [] })
}
