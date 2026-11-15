// the frontier track after the first crewed moon landing. every milestone needs finished requirement
// nodes, real money from the space budget, and for mars a launch window, a closing delta-v budget,
// a crew dose under the limit and a landing that can fail.
import type { City, Frontier } from '../types'
import { DOSE_LIMIT_SV, HOHMANN_MONTHS, MARS_DV, isMarsWindow, lifeSupportClosure, missionDoseSv, reqDone, reqProgress } from './requirements'
import { SPACE_ABSORB_USD_YEAR, achievableDv, globalTech } from './space'
import { clamp, event, type World } from './state'
import { onFrontier, onLaunchFailure } from './visuals'

export const FRONTIERS: Frontier[] = ['none', 'moon_landing', 'moon_base', 'mars_crewed', 'mars_settlement', 'mars_self_sustaining', 'asteroid_mining', 'outer_system']
export const frontierIndex = (f: Frontier) => FRONTIERS.indexOf(f)

export type FrontierState = { achieved: Frontier[]; fund: number; mission?: { kind: 'mars_crewed' | 'colonists'; arriveTick: number; people: number }; marsPop: number; moonPop: number; nextColonyWindow: number }

export function initFrontier(): FrontierState {
  return { achieved: [], fund: 0, marsPop: 0, moonPop: 0, nextColonyWindow: 0 }
}

export const has = (w: World, f: Frontier) => w.frontierState.achieved.includes(f)

function achieve(w: World, f: Frontier, text: string) {
  if (has(w, f)) return
  w.frontierState.achieved.push(f)
  if (frontierIndex(f) > frontierIndex(w.frontier)) w.frontier = f
  // the event carries the exact tick the milestone happened (w.tick, the month it was reached) and a
  // parseable marker, so history can be built from events rather than from coarse frame ticks
  event(w, { kind: 'breakthrough', text: `${text} [frontier: ${f}]`, severity: 1 })
  onFrontier(w, f)
  for (const r of w.regions) { r.prideShock += 0.25; r.aweShock += 0.35 }
}

function offWorldCity(w: World, name: string, where: 'moon' | 'mars', pop: number, reason: string): City {
  const c: City = { id: `city-${where}-${w.cities.length}`, name, regionId: w.regions[0].r.id, lat: 0, lon: 0, foundedTick: w.tick, population: pop, reason, offWorld: where }
  w.cities.push(c)
  return c
}

// ESTIMATE: cost to land one settler on Mars, $20M falling toward $2M with reusable lift and refueling.
// the often quoted aspiration is ~$500k per person (https://en.wikipedia.org/wiki/SpaceX_Mars_colonization_program).
const costPerSettler = (w: World) => Math.max(2e6, 20e6 * (1 - 0.6 * reqProgress(w, 'super_heavy_lift') * reqProgress(w, 'orbital_refueling') - 0.3 * reqProgress(w, 'nuclear_thermal')))

export function frontierAbsorbCap(w: World, launchStrength: number): number {
  return SPACE_ABSORB_USD_YEAR * (1 + 1.5 * reqProgress(w, 'super_heavy_lift') + reqProgress(w, 'orbital_refueling') + launchStrength)
}

export function stepFrontier(w: World, spaceUsd: number, researchUsd: number, launchStrength: number) {
  const fs = w.frontierState
  if (w.space.stage === 'crewed_landing' && !has(w, 'moon_landing')) achieve(w, 'moon_landing', 'humans walk on the moon again')
  if (!has(w, 'moon_landing')) return
  fs.fund += Math.min(spaceUsd, frontierAbsorbCap(w, launchStrength) / 12)
  const tech = globalTech(w)
  const researchFactor = clamp(researchUsd * 12 / 5e12)

  // moon base
  if (!has(w, 'moon_base') && reqDone(w, 'lunar_isru') && reqDone(w, 'lunar_habitat') && fs.fund >= 80e9) {
    fs.fund -= 80e9
    fs.moonPop = 12
    offWorldCity(w, 'first light base', 'moon', 12, 'polar crater ice for water, oxygen and fuel')
    achieve(w, 'moon_base', 'a permanent crew of 12 moves into the first lunar base')
  }
  if (fs.moonPop > 0) fs.moonPop = Math.min(fs.moonPop * (1 + 0.1 / 12) + 0.2, 2000 * reqProgress(w, 'lunar_habitat'))

  // arrivals
  if (fs.mission && w.tick >= fs.mission.arriveTick) {
    const m = fs.mission
    fs.mission = undefined
    // landing: ESTIMATE base 15% loss for the first crew, 5% for later convoys, halved by research and EDL maturity
    const pFail = (m.kind === 'mars_crewed' ? 0.15 : 0.05) * (1 - 0.5 * researchFactor) * (1.5 - 0.5 * reqProgress(w, 'mars_edl'))
    if (w.rng.space() < pFail) {
      w.crewDeaths += m.people
      w.humanCost.deaths += m.people
      for (const r of w.regions) { r.shock += 0.08; r.griefShock += 0.3 }
      event(w, { kind: 'launch', text: `mars landing failed, all ${m.people} aboard killed`, severity: 0.9 })
      onLaunchFailure(w, 'mars', 'lost mars lander')
    } else if (m.kind === 'mars_crewed') {
      fs.marsPop = m.people
      offWorldCity(w, 'jezero station', 'mars', m.people, 'flat delta floor, ancient water, easy landing ellipse')
      achieve(w, 'mars_crewed', `first crew of ${m.people} lands on mars`)
    } else {
      fs.marsPop += m.people
      event(w, { kind: 'launch', text: `${m.people} settlers land on mars`, severity: 0.4 })
    }
  }

  // first crewed mars mission: only at a transfer window, only if physics closes
  if (!has(w, 'mars_crewed') && !fs.mission && has(w, 'moon_landing') && isMarsWindow(w.tick)) {
    const ready = ['super_heavy_lift', 'orbital_refueling', 'deep_space_life_support', 'mars_edl', 'mars_ascent', 'mars_isru_propellant', 'space_medicine'].every(id => reqDone(w, id))
    if (ready && fs.fund >= 150e9) {
      const dose = missionDoseSv(w)
      const closure = lifeSupportClosure(w)
      // Tsiolkovsky: refueled in LEO, single stage to the surface; ascent and return on ISRU propellant
      const dvOut = achievableDv(tech, 0.25, 1)
      const dvBack = achievableDv(tech, 0.1, 1)
      if (dose > DOSE_LIMIT_SV) event(w, { kind: 'launch', text: `mars mission scrubbed: crew dose ${dose.toFixed(2)} Sv is over the ${DOSE_LIMIT_SV} Sv limit`, severity: 0.2 })
      else if (closure < 0.95) event(w, { kind: 'launch', text: `mars mission scrubbed: life support closure ${(closure * 100).toFixed(1)}% is too low`, severity: 0.2 })
      else if (dvOut < MARS_DV.departure || dvBack < MARS_DV.ascentReturn) event(w, { kind: 'launch', text: `mars mission scrubbed: vehicle delta-v ${dvOut.toFixed(1)}/${dvBack.toFixed(1)} km/s falls short`, severity: 0.2 })
      else {
        fs.fund -= 150e9
        const pLaunchFail = 0.05 * (1 - 0.5 * researchFactor)
        if (w.rng.space() < pLaunchFail) {
          w.crewDeaths += 6
          w.humanCost.deaths += 6
          for (const r of w.regions) { r.shock += 0.1; r.griefShock += 0.3 }
          event(w, { kind: 'launch', text: 'mars ship launch failed, crew of 6 killed', severity: 0.9 })
          onLaunchFailure(w, 'earth_orbit', 'lost mars ship')
        } else {
          fs.mission = { kind: 'mars_crewed', arriveTick: w.tick + HOHMANN_MONTHS, people: 6 }
          event(w, { kind: 'launch', text: 'crew of 6 departs for mars, arrival in about 9 months', severity: 0.6 })
        }
      }
    }
  }

  // settlement convoys every window once the base exists
  if (has(w, 'mars_crewed') && !fs.mission && isMarsWindow(w.tick) && reqDone(w, 'mars_habitats') && reqDone(w, 'mars_food') && reqDone(w, 'mars_power')) {
    const cpp = costPerSettler(w)
    // ESTIMATE convoy size: tens of people per window at first, up to ~1,000 with a mature refueled fleet
    const people = Math.floor(Math.min(fs.fund * 0.6 / cpp, 30 + 1000 * reqProgress(w, 'orbital_refueling') * reqProgress(w, 'mars_manufacturing')))
    if (people >= 10) {
      fs.fund -= people * cpp
      fs.mission = { kind: 'colonists', arriveTick: w.tick + HOHMANN_MONTHS, people }
      event(w, { kind: 'launch', text: `${people} settlers depart for mars`, severity: 0.4 })
    }
  }
  if (fs.marsPop > 0) {
    // ESTIMATE: 1%/yr deaths, births 1.5%/yr only once low-gravity pregnancy is solved
    const births = reqDone(w, 'mars_reproduction') ? 0.015 : 0
    fs.marsPop = Math.max(0, fs.marsPop * (1 + (births - 0.01) / 12))
    if (!has(w, 'mars_settlement') && fs.marsPop >= 50) achieve(w, 'mars_settlement', `mars settlement passes ${Math.round(fs.marsPop)} people`)
    // ESTIMATE minimum viable population 1,000 (published estimates range ~100 to several thousand)
    if (!has(w, 'mars_self_sustaining') && has(w, 'mars_settlement') && fs.marsPop >= 1000 && reqDone(w, 'mars_self_sustaining_node')) achieve(w, 'mars_self_sustaining', 'mars no longer needs earth to survive')
  }
  for (const c of w.cities) {
    if (c.offWorld === 'mars') c.population = Math.round(fs.marsPop)
    if (c.offWorld === 'moon') c.population = Math.round(fs.moonPop)
  }
  if (!has(w, 'asteroid_mining') && reqDone(w, 'asteroid_mining_node') && fs.fund >= 50e9) { fs.fund -= 50e9; achieve(w, 'asteroid_mining', 'the first ore from an asteroid reaches orbit') }
  if (!has(w, 'outer_system') && reqDone(w, 'outer_habitats') && fs.fund >= 200e9) { fs.fund -= 200e9; achieve(w, 'outer_system', 'a crewed outpost opens among the moons of jupiter') }
}
