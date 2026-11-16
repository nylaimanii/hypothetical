// her day and her world at any moment, as pure state: where she is and what she is doing (L), and what the world
// around her says (W). no react, no rendering: /live drives it from its clock, and the qa script
// (scripts/life-qa.ts) steps it in node to check every body on screen against the ragdoll rules
import * as THREE from 'three'
import { buildLayout, type Layout } from '@/components/world/city/layout'
import type { LifeRecord, Workplace } from '@/lib/life/types'
import type { PlaceInfo } from '@/lib/life/place'
import type { LiveState } from './ChosenPerson'
import type { WorldNow } from './Scene'
import { ageAt, householdAt, kinAliveAt, moodAt, snapAt, tickOf } from './day'
import { hash01, planDay, schedule, whereIn, withOccasion, type DayPlan, type Where } from './plan'
import { occasionsOf, occasionOn, type Occasion } from '@/lib/life/occasions'
import { seatFor } from './population'
import { buildFabric, fabricSolids, type Solid } from './fabric'
import { cityStyle } from './style'

export type Speed = 'day' | 'year' | 'decade'
// ESTIMATE: a minibus ride costs about $0.25 in most of the cities here; ~44 rides a month
export const BUS_FARE_MONTH = 11

export function layoutFor(r: LifeRecord, cityId: string): Layout {
  const workplaces = [...new Set(r.snaps.map(s => s.workplace).filter(w => w !== 'none'))] as Workplace[]
  const religious = r.snaps.some(s => s.behavior.includes('prays'))
  return buildLayout(cityId, workplaces.length ? workplaces : ['shop'], 12, religious, true)
}

export function newLive(): LiveState {
  return { seat: null, cradle: new THREE.Vector3(), cradleAt: -1, cradleHeading: 0, frame: null, carrier: null, dead: false, pos: new THREE.Vector3(), heading: 0, walking: false, act: 'sleep', pose: 'stand', mood: {}, fatigue: 0, age: 0, heat: 0, flinch: null, gaze: null, hug: 0, head: new THREE.Vector3(0, 1.5, 0), forward: new THREE.Vector3(0, 0, 1) }
}
export function newWorld(record: LifeRecord): WorldNow {
  return { notice: null, kin: [], tick: 0, day: 0, hour: 9, speed: 'day', cityId: record.birthplace.cityId, home: record.snaps[0]?.home ?? 'family_home', indoors: true, lotId: -1, hunger: false, food: 1, protest: false, disaster: 0, law: null, rain: 0, tempC: 20, heat: 0, dead: false, family: [], arrivedAgoH: -1, busX: null, density: 0.5, kinPos: new Map(), workLotId: -1, homeLotId: -1, occasion: null }
}

export class LifeWorld {
  readonly L: LiveState
  readonly W: WorldNow
  readonly religious: boolean
  readonly occasions: Occasion[]
  private layouts = new Map<string, Layout>()
  private plans = new Map<string, DayPlan>()
  private solids = new Map<string, Solid[]>()
  solidsOf(cityId: string): Solid[] {
    let s = this.solids.get(cityId)
    if (!s) { const c = (this.record.places.find(p => p.cityId === cityId) ?? this.record.birthplace).countryId; s = fabricSolids(buildFabric(this.layoutOf(cityId), cityStyle(c), cityId)); this.solids.set(cityId, s) }
    return s
  }
  private month: { tick: number; v: ReturnType<LifeWorld['computeMonth']> } | null = null
  lastPos = new THREE.Vector3()
  plan: DayPlan | null = null

  constructor(readonly record: LifeRecord, readonly places: PlaceInfo[], L?: LiveState, W?: WorldNow) {
    this.L = L ?? newLive()
    this.W = W ?? newWorld(record)
    this.religious = record.snaps.some(s => s.behavior.includes('prays'))
    this.occasions = occasionsOf(record)
  }
  // the occasion on this day, if she is in its city (a move that month plays the day where she is)
  occasionOn(day: number): Occasion | null {
    const o = occasionOn(this.occasions, day)
    return o && o.cityId === snapAt(this.record, tickOf(Math.floor(day) + 0.001)).cityId ? o : null
  }
  layoutOf(cityId: string): Layout { let l = this.layouts.get(cityId); if (!l) { l = layoutFor(this.record, cityId); this.layouts.set(cityId, l) } return l }
  placeOf(cityId: string): PlaceInfo | undefined { return this.places.find(p => p.cityId === cityId) ?? this.places[0] }

  // a day is planned from how her life stood at the start of that day, so a month turning over mid-afternoon never
  // rewrites the day under her feet (no teleports)
  planFor(day: number): DayPlan {
    const record = this.record
    const tick = tickOf(Math.floor(day) + 0.001)
    const snap = snapAt(record, tick)
    const occ = this.occasionOn(day)
    const key = `${snap.cityId}:${Math.floor(day)}:${snap.activity}:${snap.workplace}:${occ ? occ.kind + occ.about : ''}`
    let p = this.plans.get(key)
    if (!p) {
      const layout = this.layoutOf(snap.cityId)
      const kids = householdAt(record, tick).some(f => f.relation === 'child' && f.age < 14)
      const d = Math.floor(day)
      const weekend = d % 7 >= 5
      const night = snap.workplace === 'clinic' && hash01(Math.floor(d / 7) + record.seed) < 0.25 // ESTIMATE: one week in four on nights for clinic staff
      const canBus = snap.income >= BUS_FARE_MONTH / 0.08 && hash01(d * 3 + record.seed) < 0.8 // takes the bus if fares are under ~8% of income
      // weekends she visits her mother and siblings when she no longer lives with them
      const visit = weekend && tick >= 240 && kinAliveAt(record, tick).some(k => k.relation === 'mother' || k.relation === 'father' || k.relation === 'sibling')
      const defs = schedule(snap.activity, { kids, weekend, religious: this.religious, night, visit, age: tick / 12 })
      // (an infant's day stays with whoever holds her: the occasion moves the holder, and she goes along)
      p = planDay(layout, layout.homes[0], occ ? withOccasion(defs, occ) : defs, snap.workplace, 0, canBus)
      this.plans.set(key, p)
      if (this.plans.size > 60) this.plans.delete(this.plans.keys().next().value!)
    }
    return p
  }

  // facts that only change once a month, computed once per month instead of every frame (no per-frame garbage)
  private computeMonth(tick: number) {
    const record = this.record
    let lastLossTick: number | null = null
    for (const e of record.events) if (e.tick <= tick && e.kind === 'family' && / died/.test(e.text)) lastLossTick = e.tick
    let env = record.env[0]
    for (const e of record.env) if (e.tick <= tick) env = e
    // the newest law by now, as the public notice board shows it (the world's own law record)
    const law = [...record.laws].filter(l => l.tick <= tick).sort((a, b) => b.tick - a.tick)[0]
    return { lastLossTick, env, evs: record.events.filter(e => e.tick === tick || e.tick === tick - 1), family: householdAt(record, tick), kin: kinAliveAt(record, tick), notice: law ? law.title.toLowerCase() : null }
  }
  monthFacts(tick: number) {
    if (this.month?.tick !== tick) this.month = { tick, v: this.computeMonth(tick) }
    return this.month.v
  }

  // everything the clock means for her and her world at `days` (hour already chosen by the caller for montages)
  tick(days: number, hour: number, speed: Speed, end: number): Where {
    const { record, L, W } = this
    const tick = tickOf(days)
    const snap = snapAt(record, tick)
    // the day's place (city, home, work) comes from the start of the day, like the plan, so nothing jumps mid-day
    const daySnap = snapAt(record, tickOf(Math.floor(days) + 0.001))
    const plan = this.planFor(days)
    this.plan = plan
    const where = whereIn(plan, hour)
    // validate her position: never let the camera chase garbage
    if (!Number.isFinite(where.pos.x) || !Number.isFinite(where.pos.z)) {
      console.error('[life] invalid position from the day plan, keeping her last spot', { tick, hour, stop: where.stop.at })
      where.pos = { x: this.lastPos.x, z: this.lastPos.z }
    }
    this.lastPos.set(where.pos.x, 0, where.pos.z)
    L.pos.set(where.pos.x, where.onBus ? 0.35 : 0, where.pos.z)
    const dh = Math.atan2(Math.sin(where.heading - L.heading), Math.cos(where.heading - L.heading))
    L.heading += dh * (where.moving ? 0.25 : 0.08)
    L.walking = where.moving && !where.onBus
    L.pose = where.pose
    L.act = where.stop.act
    L.seat = where.moving || where.pose !== 'sit' ? null : seatFor(where.stop, L.act === 'pray' ? 'pray' : L.act === 'work' ? 'type' : 'sit')
    L.age = ageAt(days)
    L.mood = moodAt(record, days)
    const M = this.monthFacts(tick)
    const sinceLoss = M.lastLossTick !== null ? tick - M.lastLossTick : 999
    L.fatigue = Math.min(1, (snap.activity === 'grieving' ? 0.5 : 0) + Math.max(0, 0.6 - snap.health) * 1.4 + (sinceLoss < 36 ? 0.45 * (1 - sinceLoss / 36) : 0) + (hour > 21.5 || hour < 5 ? 0.25 : 0))
    // weather from the real monthly climate (worldclim normals via B's geo layer): rain days and temperature
    const pl = this.placeOf(daySnap.cityId)
    const month = (tick + 10) % 12
    const d = Math.floor(days)
    const wetDays = Math.min(25, (pl?.precMm[month] ?? 60) / 8) // ESTIMATE: ~8 mm per rainy day (same rule as B's weatherAt)
    W.rain = hash01(d + record.seed * 7) < wetDays / 30 ? 0.75 : 0
    const tavg = pl?.tavgC[month] ?? 22
    W.tempC = tavg + (hash01(d * 5 + 1) - 0.5) * 5 + 4 * Math.sin(((hour - 9) / 24) * Math.PI * 2) // ESTIMATE daily noise + day/night swing
    W.heat = Math.max(0, Math.min(1, (W.tempC - 28) / 8))
    L.heat = W.heat
    // the world reaching in
    const env = M.env
    const evs = M.evs
    const layout = this.layoutOf(daySnap.cityId)
    W.tick = tick; W.day = d; W.hour = hour; W.speed = speed; W.cityId = daySnap.cityId; W.home = daySnap.home; W.indoors = where.indoors; W.lotId = where.stop.lot.id
    // crossing a threshold: on the short walk between a door and a spot inside, she is inside that building
    if (where.moving && !where.onBus) {
      const ids = [where.stop.lot.id, where.from?.lot.id]
      for (const s of this.solidsOf(daySnap.cityId)) if ((s.kind === 'wall' || s.kind === 'special') && ids.includes(s.id) && s.box.containsPoint(new THREE.Vector3(L.pos.x, 0.3, L.pos.z))) { W.indoors = true; W.lotId = s.id; break }
    }
    W.hunger = !!snap.hunger; W.food = env?.food ?? 1
    W.protest = evs.some(e => /protest/.test(e.text))
    W.disaster = evs.some(e => e.worldKind === 'disaster' || e.worldKind === 'war') ? 1 : env?.damage === 'disaster' || env?.damage === 'war' ? env.damageLevel : 0
    W.law = evs.find(e => e.worldKind === 'law')?.text.replace(/^on the news screen: /, '') ?? null
    W.dead = days >= end
    L.dead = W.dead
    W.family = M.family
    W.kin = M.kin
    W.notice = M.notice
    W.occasion = this.occasionOn(days)
    // a baby is never alone: her mother holds her (or her father, or the oldest sibling), and sleeps beside her at night
    if (L.age < 1.5) {
      const carrier = M.kin.find(k => k.relation === 'mother') ?? M.kin.find(k => k.relation === 'father') ?? [...M.kin].filter(k => k.relation === 'sibling' && k.age >= 12).sort((a, b) => b.age - a.age)[0]
      L.carrier = carrier?.id ?? null
      L.pose = where.stop.act === 'sleep' ? 'lie' : 'held'
    } else L.carrier = null
    // a conversation is filmed from the side, both people in frame
    L.frame = where.stop.act === 'chat' && !where.moving ? 'conversation' : L.pose === 'held' ? 'held' : null
    W.arrivedAgoH = where.stop.at === 'home' && !where.moving ? where.arrivedAgoH : -1
    W.busX = where.busX
    W.homeLotId = layout.homes[0].id
    W.workLotId = plan.stops.find(s => s.at === 'work')?.lot.id ?? -1
    // real density: ghsl people per km2 at her cell, 0..1 (25k/km2 is a packed city center)
    W.density = Math.max(0.15, Math.min(1, (pl?.popPerKm2 ?? 8000) / 25000))
    // who she looks at: whoever she is eating or sitting with at home
    const atHome = where.stop.at === 'home' && !where.moving && where.stop.act !== 'sleep'
    if (atHome && W.family.length) {
      const f = W.family.find(x => x.relation === 'child') ?? W.family[0]
      const p = W.kinPos.get(f.id)
      L.gaze = p ? (L.gaze ?? new THREE.Vector3()).copy(p).setY(p.y + 1.1) : null
    } else L.gaze = null
    const hugNow = atHome && where.arrivedAgoH >= 0 && where.arrivedAgoH < 0.25 ? 1 : 0
    L.hug += (hugNow - L.hug) * 0.1
    return where
  }
}
