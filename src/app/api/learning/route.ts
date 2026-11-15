import { connection } from 'next/server'
import { readLearning } from '@/lib/evolve/lessons'

// one row per generation: { generation, bestScore, lessonsKnown, repeatMistakeRate, ... }. read-only safe
export async function GET() {
  await connection()
  return Response.json(readLearning().rows)
}
