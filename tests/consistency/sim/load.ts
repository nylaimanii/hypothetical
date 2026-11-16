// the world records the sim checks read: HYP_CONSISTENCY_RUNS (comma list of run ids) or the newest 3 in data/runs
import fs from 'node:fs'
import path from 'node:path'
import type { RunRecord } from '../../../src/lib/types'

const RUNS = () => path.join(process.cwd(), 'data', 'runs')
export function worldIds(): string[] {
  const env = (process.env.HYP_CONSISTENCY_RUNS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (env.length) return env
  if (!fs.existsSync(RUNS())) return []
  // a world record has its lazy companions next to it (index.json, features.json and the like are not worlds)
  return fs.readdirSync(RUNS()).filter(f => /^[^.]+\.json$/.test(f) && ['lives.json', 'places.json', 'places.bin.gz'].some(x => fs.existsSync(path.join(RUNS(), f.replace(/\.json$/, `.${x}`))))).map(f => ({ id: f.replace(/\.json$/, ''), t: fs.statSync(path.join(RUNS(), f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 3).map(x => x.id)
}
export function loadWorld(id: string): RunRecord | undefined {
  const f = path.join(RUNS(), `${id}.json`)
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) as RunRecord : undefined
}
export function loadLives(id: string): { lives: Record<string, { name: string; events: { tick: number; text: string }[]; death?: { tick: number; ageAtDeath: number; cause: string }; birthTick?: number }> } | undefined {
  const f = path.join(RUNS(), `${id}.lives.json`)
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined
}
