import { connection } from 'next/server'
import { readAgents } from '@/lib/evolve/agents'

// every agent (governor + constitution) with its stats. read-only safe
export async function GET() {
  await connection()
  return Response.json(readAgents())
}
