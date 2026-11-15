import { connection } from 'next/server'
import { readLearning } from '@/lib/evolve/lessons'

// one row per generation: { generation, bestScore, lessonsKnown, repeatMistakeRate, ... }. read-only safe
// ?version=<sim version> reads an older version's curve; default is the current version
export async function GET(req: Request) {
  await connection()
  return Response.json(readLearning(new URL(req.url).searchParams.get('version')).rows)
}
