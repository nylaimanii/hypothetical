'use server'
// D's one-life site: which lives exist for a world (data/lives/<worldId>/index.json, written by D), and where to watch them
import fs from 'node:fs/promises'
import path from 'node:path'

export type LifeLink = { lifeId: string; name: string; city: string; lat: number; lon: number; status: string }
export type Lives = { site: string; lives: LifeLink[] }

const SAFE = /^[a-z0-9][a-z0-9-]{0,80}$/i

export async function livesOf(worldId: string): Promise<Lives> {
  const site = (process.env.LIFE_SITE_URL || 'http://localhost:3002').replace(/\/+$/, '')
  if (!SAFE.test(worldId)) return { site, lives: [] }
  try {
    const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), 'data', 'lives', worldId, 'index.json'), 'utf8')) as unknown
    if (!Array.isArray(raw)) return { site, lives: [] }
    const lives = raw.flatMap((l: { lifeId?: unknown; name?: unknown; status?: unknown; birthplace?: { city?: unknown; lat?: unknown; lon?: unknown } }) =>
      typeof l?.lifeId === 'string' && typeof l?.name === 'string' && typeof l.birthplace?.lat === 'number' && typeof l.birthplace?.lon === 'number'
        ? [{ lifeId: l.lifeId, name: l.name, city: String(l.birthplace.city ?? ''), lat: l.birthplace.lat, lon: l.birthplace.lon, status: String(l.status ?? '') }]
        : [])
    return { site, lives }
  } catch {
    return { site, lives: [] }
  }
}
