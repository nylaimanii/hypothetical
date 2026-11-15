import { connection } from 'next/server'
import type { Step } from '@/lib/types'
import { isReadOnly, SAFE_ID } from '@/lib/evolve/store'
import { freshSteps, readSteps, stepsFor } from '@/lib/evolve/steps'
import { readVersion } from '@/lib/evolve/version'

// GET /api/steps[?runs=a,b,c] -> Step[]: the cross-world recipe. first the steps that show up in the worlds that did
// best for everyone (effect > 0), then the ones that show up in the dead (effect usually < 0). without ?runs it is
// the saved recipe over every real world, recomputed after each generation; with ?runs only those worlds count
export async function GET(req: Request) {
  await connection()
  const runs = (new URL(req.url).searchParams.get('runs') ?? '').split(',').map(s => s.trim()).filter(s => SAFE_ID.test(s))
  // ?version=<sim version> reads an older version's recipe; default is the current version
  const version = new URL(req.url).searchParams.get('version')
  const out = runs.length ? stepsFor(runs) : version && version !== readVersion()?.current ? readSteps(version) : freshSteps(!isReadOnly())
  const steps: Step[] = out ? [...out.helped, ...out.hurt] : []
  return Response.json(steps)
}
