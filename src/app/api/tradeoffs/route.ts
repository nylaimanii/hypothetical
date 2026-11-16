import { connection } from 'next/server'
import { tradeoffRows } from '@/lib/evolve/tradeoffs'

// GET /api/tradeoffs -> [{ runId, agentId, seed, generation, simVersion, status, score, tradeoffs | null }] for every
// finished world, newest sim version first. tradeoffs is b's summary.tradeoffs (lifespan, population, freedom,
// freedomAverage, offWorld, frontier), null for worlds from sims before 5.10.1. a frontier should be drawn within
// one sim version: versions are different models. read-only safe (the deploy ships data/runs/tradeoffs.json)
export async function GET() {
  await connection()
  return Response.json(tradeoffRows())
}
