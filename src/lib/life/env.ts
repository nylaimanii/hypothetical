// the world a chosen person lives inside: a read-only view over a finished world's recording.
// recordings hold one frame a year (region level) plus every event with its exact tick, so the month-level
// environment is: that year's region stats + the events of that month. when B ships a per-tick city query
// (see the report: envAt(record, cityId, tick)), cityStats() switches to it and this file is the only change.
import type { Frame, Law, Region, RunRecord, WorldEvent } from '../types'
import type { EnvYear } from './types'

export type MonthEnv = {
  tick: number; year: number; month: number // month 0 = january
  region: Region
  food: number // 0..1 kcal per head / 2500
  prices: number // food price index, 1 = normal. rises fast as food runs short
  economy: number // region gdp per head / 2026 world mean gdp per head
  gdpPerHead: number // usd per year
  unrest: number; health: number; lifeExpectancy: number; education: number; faith: number
  damage: EnvYear['damage']; damageLevel: number
  events: WorldEvent[] // this month, in their region or global
  newLaws: Law[]
  status: Frame['status']; frontier: string
  ended: boolean // past the end of the recording: the last frame is held
}

const KCAL_FULL = 2500 // ESTIMATE: comfortable daily energy supply per head (fao uses ~2,300-2,500 as adequate)

export class WorldEnv {
  readonly record: RunRecord
  readonly frames: Frame[]
  readonly lastTick: number
  readonly worldMeanGdp: number
  private eventsByTick = new Map<number, WorldEvent[]>()
  private lawsByTick = new Map<number, Law[]>()
  private leFallback = new Map<string, number>()

  constructor(record: RunRecord) {
    this.record = record
    this.frames = [...record.frames].sort((a, b) => a.tick - b.tick)
    // tick-0 frames carry zeros for the fields the sim only fills from year one (life expectancy, disease burden,
    // fertility). borrow them from the next frame so the first months are not a world without disease
    if (this.frames.length > 1) {
      const next = new Map(this.frames[1].regions.map(r => [r.id, r]))
      this.frames[0] = { ...this.frames[0], regions: this.frames[0].regions.map(r => {
        const n = next.get(r.id)
        if (!n) return r
        return { ...r, diseaseBurden: r.diseaseBurden || n.diseaseBurden, fertility: r.fertility || n.fertility, lifeExpectancy: r.lifeExpectancy || n.lifeExpectancy, periodLifeExpectancy: r.periodLifeExpectancy || n.periodLifeExpectancy }
      }) }
    }
    this.lastTick = this.frames[this.frames.length - 1]?.tick ?? 0
    const f0 = this.frames[0]
    const pop = f0.regions.reduce((a, r) => a + r.population, 0)
    this.worldMeanGdp = f0.regions.reduce((a, r) => a + r.gdpUsd, 0) / Math.max(1, pop)
    const seenLaw = new Set<string>()
    for (const f of this.frames) {
      for (const e of f.newEvents) {
        const l = this.eventsByTick.get(e.tick) ?? []
        l.push(e)
        this.eventsByTick.set(e.tick, l)
      }
      for (const law of f.laws) {
        if (seenLaw.has(law.id)) continue
        seenLaw.add(law.id)
        const l = this.lawsByTick.get(law.enactedTick) ?? []
        l.push(law)
        this.lawsByTick.set(law.enactedTick, l)
      }
    }
    // tick-0 frames carry zero life expectancy (the sim fills it from the first year on): use the first real value
    for (const f of this.frames) for (const r of f.regions) if (!this.leFallback.has(r.id) && r.periodLifeExpectancy > 0) this.leFallback.set(r.id, r.periodLifeExpectancy)
  }

  get id() { return this.record.runId }
  get seed() { return this.record.seed }

  frameAt(tick: number): Frame {
    let lo = 0, hi = this.frames.length - 1
    if (tick <= this.frames[0].tick) return this.frames[0]
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.frames[mid].tick <= tick) lo = mid
      else hi = mid - 1
    }
    return this.frames[lo]
  }

  regionAt(tick: number, regionId: string): Region {
    const f = this.frameAt(tick)
    return f.regions.find(r => r.id === regionId) ?? f.regions[0]
  }

  month(tick: number, regionId: string): MonthEnv {
    const f = this.frameAt(tick)
    const r = f.regions.find(x => x.id === regionId) ?? f.regions[0]
    const food = Math.min(1, r.foodKcalPerCapita / KCAL_FULL)
    // ESTIMATE: price index ~ 1/food^2 below full supply (food demand is inelastic, so prices spike when supply
    // falls; cf. fao food price index during 2007-08 and 2022 shocks https://www.fao.org/worldfoodsituation/)
    const prices = Math.min(6, 1 / Math.max(0.35, food) ** 2)
    const le = r.periodLifeExpectancy > 0 ? r.periodLifeExpectancy : this.leFallback.get(r.id) ?? 72
    const ended = tick > this.lastTick
    const events = ended ? [] : (this.eventsByTick.get(tick) ?? []).filter(e => !e.regionId || e.regionId === r.id)
    return {
      tick, year: 2026 + Math.floor((tick + 10) / 12), month: (tick + 10) % 12,
      region: r, food, prices,
      gdpPerHead: r.gdpUsd / Math.max(1, r.population), economy: r.gdpUsd / Math.max(1, r.population) / this.worldMeanGdp,
      unrest: r.unrest, health: 1 - r.diseaseBurden, lifeExpectancy: le, education: r.education, faith: r.faith,
      damage: r.visual?.damage?.kind ?? (r.foodKcalPerCapita < 1900 ? 'famine' : 'none'),
      damageLevel: r.visual?.damage?.level ?? (r.foodKcalPerCapita < 1900 ? Math.min(1, (1900 - r.foodKcalPerCapita) / 900) : 0),
      events,
      newLaws: ended ? [] : this.lawsByTick.get(tick) ?? [],
      status: f.status, frontier: f.frontier ?? 'none', ended,
    }
  }

  envYear(tick: number, regionId: string): EnvYear {
    const m = this.month(tick, regionId)
    return {
      tick, regionId, food: round(m.food), prices: round(m.prices), unrest: round(m.unrest), economy: round(m.economy), health: round(m.health),
      lifeExpectancy: Math.round(m.lifeExpectancy * 10) / 10, damage: m.damage, damageLevel: round(m.damageLevel), status: m.status, frontier: m.frontier,
    }
  }

  allLaws(): Law[] {
    return [...this.lawsByTick.values()].flat().sort((a, b) => a.enactedTick - b.enactedTick)
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000

// "local disaster in East Asia, 149k dead" -> 149000
export function deadInEvent(text: string): number {
  const m = /([\d.]+)\s*(k|m|million|thousand)?\s+(?:dead|died|deaths)/i.exec(text)
  if (!m) return 0
  const n = Number(m[1])
  const u = (m[2] ?? '').toLowerCase()
  return n * (u === 'k' || u === 'thousand' ? 1e3 : u === 'm' || u === 'million' ? 1e6 : 1)
}
