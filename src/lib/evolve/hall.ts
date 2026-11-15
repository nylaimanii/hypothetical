// the hall of history (data/hall.json): firsts, records, catastrophes and milestones across every world ever run.
// each entry links a runId and the tick it happened at. records only re-enter the hall when beaten by a clear margin.
import path from 'node:path'
import type { Frame, Frontier, HallEntry, RunRecord } from '../types'
import { FRONTIER_ORDER } from './agents'
import { readJson, writeJson } from './store'
import { versionedPath } from './version'

type HallFile = { entries: HallEntry[]; records: Record<string, { value: number; runId: string }> }
const hallFile = (v?: string | null) => versionedPath('hall.json', v)

export function readHall(v?: string | null): HallFile {
  const raw = readJson<HallFile | HallEntry[]>(hallFile(v))
  if (Array.isArray(raw)) return { entries: raw, records: {} }
  return raw ?? { entries: [], records: {} }
}

const yearOf = (tick: number) => 2026 + Math.floor((tick + 10) / 12)
const pop = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${(n / 1e6).toFixed(0)}M`
const FRONTIER_TITLES: Partial<Record<Frontier, string>> = {
  moon_landing: 'first moon landing ever',
  moon_base: 'first moon base ever',
  mars_crewed: 'first crew on mars ever',
  mars_settlement: 'first mars settlement ever',
  mars_self_sustaining: 'first self-sustaining mars civilization ever',
  asteroid_mining: 'first asteroid mine ever',
  outer_system: 'first reach into the outer system ever',
}

function firstTick(frames: Frame[], pred: (f: Frame) => boolean): number | null {
  return frames.find(pred)?.tick ?? null
}

// frames are saved every 12 ticks, but each carries every event since the previous frame with its exact tick.
// a frontier is dated by the first major launch or breakthrough in the frame where it first appears.
function frontierTick(frames: Frame[], f: Frontier): number | null {
  const i = frames.findIndex(fr => fr.frontier === f)
  if (i < 0) return null
  const ev = frames[i].newEvents
    .filter(e => (e.kind === 'launch' || e.kind === 'breakthrough') && (e.significance ?? e.severity) >= 0.8 && !/fail/i.test(e.text))
    .sort((a, b) => a.tick - b.tick)[0]
  return ev?.tick ?? frames[i].tick
}

// scans one finished world and returns the hall entries it earned (already saved to data/hall.json)
export function checkHall(record: RunRecord, agentName: string, simVersion?: string): HallEntry[] {
  const hall = readHall()
  const s = record.summary
  const frames = [...record.frames].sort((a, b) => a.tick - b.tick)
  const added: HallEntry[] = []
  const has = (key: string) => hall.entries.some(e => e.id.startsWith(`${key}:`))
  const add = (key: string, kind: HallEntry['kind'], title: string, tick: number, text: string) => {
    const e: HallEntry & { simVersion?: string } = { id: `${key}:${record.runId}`, title, runId: record.runId, agentId: s.agentId, tick, kind, text, ...(simVersion ? { simVersion } : {}) }
    hall.entries.push(e)
    added.push(e)
  }
  // a record enters the hall when there is none yet, or it beats the old one by the margin
  const record_ = (key: string, value: number, better: (v: number, old: number) => boolean, title: string, tick: number, text: string, kind: HallEntry['kind'] = 'record') => {
    const old = hall.records[key]
    if (old && !better(value, old.value)) return
    hall.records[key] = { value, runId: record.runId }
    add(key, kind, title, tick, text)
  }

  // firsts: every frontier stage, the first mars city, the first eradicated disease, lifespans of 150 and 200
  // only frontiers the world actually reached: the stages are not a strict ladder (a world can go from a mars
  // settlement straight to asteroid mining without a self-sustaining mars)
  for (const f of FRONTIER_ORDER.slice(1)) {
    const key = `first-${f}`
    if (has(key)) continue
    const t = frontierTick(frames, f)
    if (t !== null) add(key, 'first', FRONTIER_TITLES[f]!, t, `${agentName} got there in ${yearOf(t)}.`)
  }
  const last = frames[frames.length - 1]
  const marsCity = last?.cities.filter(c => c.offWorld === 'mars').sort((a, b) => a.foundedTick - b.foundedTick)[0]
  if (marsCity && !has('first-mars-city')) add('first-mars-city', 'first', 'first mars city ever', marsCity.foundedTick, `${agentName} founded ${marsCity.name} on mars in ${yearOf(marsCity.foundedTick)}.`)
  if (s.diseasesEradicated?.length && !has('first-eradication')) {
    const ev = frames.flatMap(f => f.newEvents).find(e => /eradicat/i.test(e.text))
    const t = ev?.tick ?? s.ticks
    add('first-eradication', 'first', 'first disease eradicated', t, `${agentName} eradicated ${s.diseasesEradicated[0]} by ${yearOf(t)}.`)
  }
  for (const years of [150, 200]) {
    const key = `first-le-${years}`
    if (has(key)) continue
    const t = firstTick(frames, f => f.globalPeriodLifeExpectancy >= years)
    if (t !== null) add(key, 'first', `first ${years} year life expectancy`, t, `${agentName} pushed period life expectancy past ${years} years in ${yearOf(t)}.`)
  }

  // records
  const peak = frames.reduce<Frame | null>((m, f) => (!m || f.globalPopulation > m.globalPopulation ? f : m), null)
  if (peak) record_('record-population', peak.globalPopulation, (v, o) => v > o * 1.02, 'highest population', peak.tick, `${agentName} reached ${pop(peak.globalPopulation)} people in ${yearOf(peak.tick)}.`)
  const longest = frames.reduce<Frame | null>((m, f) => (!m || f.globalPeriodLifeExpectancy > m.globalPeriodLifeExpectancy ? f : m), null)
  if (longest && longest.globalPeriodLifeExpectancy > 0) record_('record-lifespan', longest.globalPeriodLifeExpectancy, (v, o) => v >= o + 1, 'longest lifespan', longest.tick, `${agentName} reached a period life expectancy of ${longest.globalPeriodLifeExpectancy.toFixed(1)} years in ${yearOf(longest.tick)}.`)
  const moonAt = frontierTick(frames, 'moon_landing')
  if (moonAt !== null) record_('record-fastest-moon', -moonAt, (v, o) => v >= o + 12, 'fastest moon landing', moonAt, `${agentName} landed on the moon in ${yearOf(moonAt)}, ${Math.round(moonAt / 12)} years in.`)

  // catastrophes: the deepest fall from a running peak, and the deadliest famine
  let runPeak = 0, worst = 0, worstTick = 0
  for (const f of frames) {
    runPeak = Math.max(runPeak, f.globalPopulation)
    const drop = runPeak ? 1 - f.globalPopulation / runPeak : 0
    if (drop > worst) { worst = drop; worstTick = f.tick }
  }
  if (worst >= 0.1) record_('catastrophe-collapse', worst, (v, o) => v > o * 1.05, 'biggest collapse', worstTick, `${agentName}'s world lost ${Math.round(worst * 100)}% of its people by ${yearOf(worstTick)}.`, 'catastrophe')
  const famine = s.humanCost?.famineDeaths ?? 0
  if (famine > 0) {
    const ev = frames.flatMap(f => f.newEvents).filter(e => e.kind === 'famine').sort((a, b) => b.severity - a.severity)[0]
    record_('catastrophe-famine', famine, (v, o) => v > o * 1.05, 'deadliest famine', ev?.tick ?? s.ticks, `${pop(famine)} people starved under ${agentName}${ev ? `, worst in ${yearOf(ev.tick)}` : ''}.`, 'catastrophe')
  }

  // milestones
  if (s.status === 'complete' && !has('milestone-horizon')) add('milestone-horizon', 'milestone', 'first world to reach 2126', s.ticks, `${agentName} kept a world alive for a full century.`)
  if (s.status === 'goal_achieved' && !has('milestone-goal')) add('milestone-goal', 'milestone', 'the mission, achieved', s.ticks, `${agentName}: a self-sustaining mars civilization, 200 year lifespans, and a population that holds, by ${yearOf(s.ticks)}.`)

  if (added.length) writeJson(hallFile(), hall)
  return added
}

export const hallYear = yearOf
