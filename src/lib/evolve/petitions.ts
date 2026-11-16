// petitions: a citizen (the user) writes to the core at a moment of a world, and the core answers.
// stored in data/petitions/<runId>.json, oldest first.
//
// STUB until B ships respondToPetition: the answer comes from askCore on the world as it stood at that tick (the
// core only sees its own past, never the rest of the run), and the petition has no effect on the world yet
// (effect: null, simulated: false). when B's export lands, respond() is the only thing that changes.
import path from 'node:path'
import type { RunRecord } from '../types'
import { askCore } from './core'
import { readJson, writeJson } from './store'

export type Petition = {
  id: string; runId: string; tick: number; date: string; text: string; at: string
  status: 'pending' | 'answered' | 'failed'
  response?: string
  // what the petition changed in the world. null until the sim supports petitions
  effect: string | null
  simulated: boolean
  error?: string
}

const file = (runId: string) => path.join(process.cwd(), 'data', 'petitions', `${runId}.json`)
const dateOf = (tick: number) => { const m = 10 + tick; return `${2026 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}` }

export const readPetitions = (runId: string): Petition[] => readJson<Petition[]>(file(runId)) ?? []

function save(p: Petition) {
  const list = readPetitions(p.runId).filter(x => x.id !== p.id)
  writeJson(file(p.runId), [...list, p].sort((a, b) => a.at.localeCompare(b.at)))
}

export function newPetition(runId: string, tick: number, text: string): Petition {
  const p: Petition = { id: `pet-${Date.now().toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`, runId, tick, date: dateOf(tick), text, at: new Date().toISOString(), status: 'pending', effect: null, simulated: false }
  save(p)
  return p
}

// the world up to the petition's tick: frames, decisions and events after it are cut so the answer cannot use them
export function recordAt(rec: RunRecord, tick: number): RunRecord {
  return { ...rec, frames: rec.frames.filter(f => f.tick <= tick), baseline: (rec.baseline ?? []).filter(b => b.tick <= tick), snapshots: [] }
}

async function respond(rec: RunRecord, p: Petition): Promise<{ response: string; effect: string | null; simulated: boolean }> {
  const q = `It is ${p.date}. A citizen sends you this petition: "${p.text}"\nAnswer them directly as the governing core in 2 to 4 sentences: whether you will act on it, what you would do, and why, given the state of the world right now.`
  return { response: await askCore(recordAt(rec, p.tick), q), effect: null, simulated: false }
}

export async function answerPetition(rec: RunRecord, p: Petition): Promise<Petition> {
  try {
    const r = await respond(rec, p)
    const done: Petition = { ...p, status: 'answered', ...r }
    save(done)
    return done
  } catch (e) {
    const failed: Petition = { ...p, status: 'failed', error: (e as Error).message }
    save(failed)
    return failed
  }
}
