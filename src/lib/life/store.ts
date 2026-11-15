// data/lives/ layout (agent D):
//   data/lives/<worldId>/<lifeId>.json   one LifeRecord
//   data/lives/<worldId>/index.json      LifeSummary[] for the home page
//   data/lives/lessons.json              the life lessons ledger
//   data/lives/now.json                  lives running right now (for /lives)
//   data/lives/telegram.json             mute / quiet state
// the data root resolves from LIFE_DATA_DIR, else <repo>/data/lives (the life site runs with cwd = life/)
import fs from 'node:fs'
import path from 'node:path'
import type { LifeRecord, LifeSummary } from './types'

export function livesRoot(): string {
  if (process.env.LIFE_DATA_DIR) return process.env.LIFE_DATA_DIR
  const here = process.cwd()
  const repo = path.basename(here) === 'life' && fs.existsSync(path.join(here, '..', 'data')) ? path.join(here, '..') : here
  return path.join(repo, 'data', 'lives')
}
export const livesFile = (...parts: string[]) => path.join(livesRoot(), ...parts)

export function readJsonSafe<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T } catch { return null }
}
export function writeJsonAtomic(file: string, value: unknown, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, pretty ? JSON.stringify(value, null, 1) : JSON.stringify(value))
  fs.renameSync(tmp, file)
}

const SAFE = /^[A-Za-z0-9_-]{1,120}$/

export function writeLife(r: LifeRecord) {
  writeJsonAtomic(livesFile(r.worldId, `${r.lifeId}.json`), r)
  const idx = readIndex(r.worldId).filter(x => x.lifeId !== r.lifeId)
  idx.push(summarize(r))
  idx.sort((a, b) => a.lifeNo - b.lifeNo)
  writeJsonAtomic(livesFile(r.worldId, 'index.json'), idx, true)
}

export function readLife(worldId: string, lifeId: string): LifeRecord | null {
  if (!SAFE.test(worldId) || !SAFE.test(lifeId)) return null
  return readJsonSafe<LifeRecord>(livesFile(worldId, `${lifeId}.json`))
}
export const readIndex = (worldId: string): LifeSummary[] => (SAFE.test(worldId) ? readJsonSafe<LifeSummary[]>(livesFile(worldId, 'index.json')) : null) ?? []

export function listWorlds(): string[] {
  try {
    return fs.readdirSync(livesRoot(), { withFileTypes: true }).filter(d => d.isDirectory() && fs.existsSync(path.join(livesRoot(), d.name, 'index.json'))).map(d => d.name).sort()
  } catch { return [] }
}

export function findLife(lifeId: string): LifeRecord | null {
  for (const w of listWorlds()) if (lifeId.startsWith(`${w}-life-`)) return readLife(w, lifeId)
  return null
}

export function summarize(r: LifeRecord): LifeSummary {
  const last = r.snaps[r.snaps.length - 1]
  return {
    lifeId: r.lifeId, worldId: r.worldId, lifeNo: r.lifeNo, name: r.name, sex: r.sex, look: r.look, birthplace: r.birthplace,
    deathTick: r.deathTick, deathAge: r.deathAge, deathCause: r.deathCause, epitaph: r.epitaph, status: r.status,
    score: r.score?.total ?? null, twinScore: r.twin?.score.total ?? null,
    parts: r.score ? { healthyYears: r.score.healthyYears, relationships: r.score.relationships, contribution: r.score.contribution, meaning: r.score.meaning, wellbeing: r.score.wellbeing } : null,
    lastCity: r.places[r.places.length - 1]?.city ?? r.birthplace.city, job: last?.job ?? null, kids: r.kin.filter(k => k.relation === 'child').length,
    lessonsLeft: r.lessonsLeft.map(l => l.rule), createdAt: r.createdAt,
  }
}

// lives running now, for the telegram /lives command
export type NowEntry = { lifeId: string; name: string; age: number; city: string; tick: number; pid: number; updatedAt: string; job: string | null; partner: boolean; kids: number; savings: number; income: number; health: number; mood: string }
export function readNow(): NowEntry[] {
  const all = readJsonSafe<NowEntry[]>(livesFile('now.json')) ?? []
  return all.filter(e => { try { process.kill(e.pid, 0); return true } catch { return false } })
}
export function writeNow(e: NowEntry | null, lifeId: string) {
  const rest = readNow().filter(x => x.lifeId !== lifeId)
  writeJsonAtomic(livesFile('now.json'), e ? [...rest, e] : rest)
}
