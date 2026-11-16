import { connection } from 'next/server'
import { isReadOnly } from '@/lib/evolve/store'

// GET /api/capabilities -> what this deployment can do. the deployed site (vercel) has no runner and no llm, so
// everything that starts or changes a world is off there; the ui hides those controls instead of showing a button
// that 503s. locally (the runner's machine) everything is on.
export async function GET() {
  await connection()
  const local = !isReadOnly()
  return Response.json({
    readOnly: !local,
    // start a new world from the browser (POST /api/live/start)
    playLive: local,
    // petitions and what-ifs on a world (POST /api/petition, /api/whatif)
    petitions: local,
    whatIf: local,
    // branch a world from a tick, override a live world, ask the core (all need the runner or the llm)
    branch: local,
    override: local,
    ask: local,
    // the evolution progress feed (GET /api/evolve/now) and /status
    evolveNow: local,
  })
}
