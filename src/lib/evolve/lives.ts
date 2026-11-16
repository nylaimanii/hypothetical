// D's chosen lives, as evolve's messages see them (read-only; D owns src/lib/life and data/lives).
// the morning digest and the generation telegram get a short lives section: the most interesting life that ended.
// /lives groups the people being lived right now by continent.
import fs from 'node:fs'
import path from 'node:path'
import { findLife, listWorlds, livesFile, readIndex, readNow } from '../life/store'
import { endOfLifeLine } from '../life/telegram'
import type { LifeRecord } from '../life/types'
import { readAgents } from './agents'
import { readRunIndex } from './store'

// the sim's 12 regions on 6 continents (the caribbean counts as north america, the pacific islands as oceania
// would split the region, so carib_pac goes with the americas it trades with)
const CONTINENT: Record<string, string> = {
  na: 'north america', carib_pac: 'north america', latam: 'south america', europe: 'europe', rus_ca: 'asia', mideast: 'asia',
  sasia: 'asia', easia: 'asia', seasia: 'asia', nafrica: 'africa', ssa: 'africa', oceania: 'oceania',
}
export const continentOf = (regionId: string | undefined) => (regionId && CONTINENT[regionId]) || 'elsewhere'

const lower = (s: string) => s.replace(/^./, c => c.toLowerCase())
const noEmoji = (s: string) => s.replace(/\p{Extended_Pictographic}️?/gu, '').replace(/\s+$/gm, '').trim()

// the agent that governed a life's world, by name
function worldAgent(worldId: string): string | null {
  const run = readRunIndex().find(r => r.runId === worldId)
  if (!run) return null
  return readAgents().find(a => a.id === run.agentId)?.name ?? run.agentId
}

// lives that ended since `since` (ms), newest record per life. the end time is when the record was last written
export function endedLivesSince(since: number): LifeRecord[] {
  const out: LifeRecord[] = []
  for (const w of listWorlds()) for (const s of readIndex(w)) {
    if (s.deathTick === null || s.score === null) continue
    let at = 0
    try { at = fs.statSync(livesFile(w, `${s.lifeId}.json`)).mtimeMs } catch { continue }
    if (at < since) continue
    const r = findLife(s.lifeId)
    if (r?.score) out.push(r)
  }
  return out
}

// what makes a finished life worth the 2 lines: lessons visibly changing how long it lasted (the no-lessons twin),
// then a long life, then a full one. a death in childhood is never the "interesting" pick
function interest(r: LifeRecord): number {
  const age = r.deathAge ?? 0
  if (age < 16) return -1
  const gap = r.twin ? Math.abs(age - r.twin.deathAge) : 0
  const fuller = r.twin ? Math.abs(r.score!.total - r.twin.score.total) * 10 : 0
  return gap + fuller + (age >= 90 ? 3 : 0)
}

// the lives section: at most 2 lines, D's own end-of-life words without the link, plus whose world it was
export function livesSection(since: number): string[] {
  const ended = endedLivesSince(since)
  if (!ended.length) return []
  const best = [...ended].sort((a, b) => interest(b) - interest(a))[0]
  const lines = noEmoji(endOfLifeLine(best)).split('\n').filter(l => !/life score .* · /.test(l)).slice(0, 2)
  const agent = worldAgent(best.worldId)
  const more = ended.length > 1 ? ` (${ended.length} lives ended)` : ''
  if (agent && lines[0]) lines[0] = `lives${more}: ${lower(lines[0])} that was in ${agent}'s world.`
  else if (lines[0]) lines[0] = `lives${more}: ${lower(lines[0])}`
  return lines.slice(0, 2)
}

// city name -> sim region, from B's baked geo layer (data/geo/cities.json, read-only)
let cityRegions: Map<string, string> | null = null
function cityRegion(city: string): string | undefined {
  if (!cityRegions) {
    cityRegions = new Map()
    try {
      const geo = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'geo', 'cities.json'), 'utf8')) as { cities: { name: string; regionId: string; pop: number }[] }
      // the biggest city wins a shared name
      for (const c of [...geo.cities].sort((a, b) => a.pop - b.pop)) cityRegions.set(c.name.toLowerCase(), c.regionId)
    } catch { /* no geo yet */ }
  }
  return cityRegions.get(city.toLowerCase())
}

// everyone being lived right now, by continent: "africa: amara 34 lagos (meridian), ..."
export function livingByContinent(): { continent: string; people: { name: string; age: number; city: string; agent: string | null }[] }[] {
  const groups = new Map<string, { name: string; age: number; city: string; agent: string | null }[]>()
  for (const e of readNow()) {
    // the record is written when a life ends; mid-life, the city's region comes from B's geo table
    const r = findLife(e.lifeId)
    const region = r?.places[r.places.length - 1]?.regionId ?? cityRegion(e.city)
    const c = continentOf(region)
    const worldId = r?.worldId ?? e.lifeId.replace(/-life-\d+$/, '')
    groups.set(c, [...(groups.get(c) ?? []), { name: e.name, age: Math.floor(e.age), city: e.city, agent: worldAgent(worldId) }])
  }
  const order = ['africa', 'asia', 'europe', 'north america', 'south america', 'oceania', 'elsewhere']
  return [...groups].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([continent, people]) => ({ continent, people }))
}
