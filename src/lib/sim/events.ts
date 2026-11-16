// seeded base-rate shocks. the events stream draws a fixed count of numbers every tick, whatever the
// policy, so the ai world and its no-ai twin face the same disasters on the same dates.
// rates are rough ESTIMATEs anchored to the cited references.
import type { WorldEvent } from '../types'
import { clamp, event, regionPop, type RegionState, type World } from './state'
import { fmt } from './physics'
import { killInRegion, pickCountry } from './places'
import { damageCity } from './world-layer'

// EM-DAT records ~350 to 400 disasters a year worldwide (https://www.emdat.be/). ESTIMATE: a disaster big
// enough to dent a whole region's output hits each region about once every 3 years.
const DISASTER_P_YEAR = 0.35
// ESTIMATE: region-scale drought about once every 16 years per region (UN GAR special report on drought 2021,
// https://www.undrr.org/publication/gar-special-report-drought-2021)
const DROUGHT_P_YEAR = 0.06
// Marani et al. 2021 PNAS put the yearly probability of a COVID-scale pandemic near 2%
// (https://doi.org/10.1073/pnas.2105482118). ESTIMATE: 2.5% for any pandemic with global reach.
const PANDEMIC_P_YEAR = 0.025

const perMonth = (pYear: number) => 1 - Math.pow(1 - pYear, 1 / 12)

export function stepEvents(w: World) {
  const rng = w.rng.events
  for (const rs of w.regions) {
    const a = rng(), as = rng(), b = rng(), bs = rng(), cu = rng()
    if (a < perMonth(DISASTER_P_YEAR)) {
      const sev = 0.1 + 0.6 * as * as
      const c = pickCountry(w, rs, cu)
      applyEvent(w, rs, 'disaster', sev, `${sevWord(sev)} disaster in ${c ? c.name : rs.r.name}`, false, c?.id)
    }
    if (b < perMonth(DROUGHT_P_YEAR)) {
      const sev = 0.2 + 0.6 * bs
      const c = pickCountry(w, rs, (cu * 7.31) % 1)
      applyEvent(w, rs, 'famine', sev, `drought across ${c ? c.name : rs.r.name} cuts harvests`, false, c?.id)
    }
  }
  const p = rng(), ps = rng(), po = rng()
  if (p < perMonth(PANDEMIC_P_YEAR)) {
    const sev = 0.15 + 0.85 * ps * ps * ps
    const origin = w.regions[Math.floor(po * w.regions.length) % w.regions.length]
    startPandemic(w, origin, sev)
  }
}

function sevWord(s: number) { return s > 0.5 ? 'major' : s > 0.25 ? 'serious' : 'local' }

export function startPandemic(w: World, origin: RegionState, sev: number, injected = false) {
  event(w, { regionId: origin.r.id, kind: 'pandemic', text: `${injected ? 'injected: ' : ''}a new pandemic emerges in ${origin.r.name}`, severity: sev })
  const researchShare = w.budget.research
  for (const rs of w.regions) {
    const local = rs === origin ? 1 : 0.6 + 0.4 * ((rs.r.population % 97) / 97) // deterministic per-region spread
    // ESTIMATE: excess mortality per year = 1% x severity^1.5 (sev 1 ~ 1918, about 1.5% of people over 18 months;
    // sev 0.3 ~ covid, about 0.15%/yr). welfare and research blunt it up to 40%.
    // misinformation above 2026 weakens distancing and vaccination (people.ts)
    const mitigation = (1 - 0.25 * clamp(rs.spend.welfare * 12 / Math.max(regionPop(rs), 1) / 4000) - 0.15 * clamp(researchShare / 0.15)) * (1 + (rs.people ? Math.max(0, rs.people.misinfo - rs.people.misinfo0) : 0))
    rs.pandemicMort = Math.max(rs.pandemicMort * (w.tick < rs.pandemicUntil ? 1 : 0), 0.01 * Math.pow(sev * local, 1.5) * mitigation)
    rs.pandemicUntil = w.tick + 18
    rs.shock += 0.1 * sev * local
    rs.r.gdpUsd *= 1 - 0.04 * sev * local
  }
}

// applies a shock of `kind` to a region. used by base-rate events and by user-injected events.
export function applyEvent(w: World, rs: RegionState, kind: WorldEvent['kind'], sev: number, text: string, injected = false, countryId?: string): WorldEvent | undefined {
  sev = clamp(sev)
  const label = injected ? `injected: ${text}` : text
  switch (kind) {
    case 'disaster': {
      const dead = killInRegion(w, rs, 0.0005 * sev, countryId)
      w.vital.disasters += dead
      if (countryId) damageCity(w, countryId, 0.5 * sev, text)
      rs.r.gdpUsd *= 1 - 0.03 * sev
      rs.capacityTWh *= 1 - 0.05 * sev
      rs.shock += 0.1 * sev
      return event(w, { regionId: rs.r.id, kind: injected ? 'injected' : 'disaster', text: `${label}, ${fmt(dead)} dead`, severity: sev })
    }
    case 'famine': {
      // a drought in one country cuts that country's harvest; the region loses that country's share of its farmland
      const hit = countryId ? w.countries.find(k => k.id === countryId) : undefined
      const farm = (k: { seed: { farmlandShare: number; areaKm2: number } }) => k.seed.farmlandShare * k.seed.areaKm2
      const share = hit ? farm(hit) / Math.max(w.countries.filter(k => k.regionId === rs.r.id).reduce((a, k) => a + farm(k), 0), 1) : 1
      if (hit) { hit.droughtSev = Math.max(hit.droughtSev * (w.tick < hit.droughtUntil ? 1 : 0), 0.3 * sev); hit.droughtUntil = w.tick + 12 }
      rs.droughtSev = Math.max(rs.droughtSev * (w.tick < rs.droughtUntil ? 1 : 0), 0.3 * sev * share)
      rs.droughtUntil = w.tick + 12
      rs.shock += 0.05 * sev
      return event(w, { regionId: rs.r.id, kind: injected ? 'injected' : 'disaster', text: label, severity: sev })
    }
    case 'pandemic':
      startPandemic(w, rs, sev, injected)
      return undefined
    case 'revolt':
      rs.shock += 0.3 * sev
      rs.revoltPressure += Math.round(6 * sev)
      return event(w, { regionId: rs.r.id, kind: injected ? 'injected' : 'revolt', text: label, severity: sev })
    case 'war': {
      w.warTension += 0.4 * sev
      w.vital.disasters += killInRegion(w, rs, 0.002 * sev, countryId)
      rs.r.gdpUsd *= 1 - 0.05 * sev
      rs.shock += 0.2 * sev
      return event(w, { regionId: rs.r.id, kind: injected ? 'injected' : 'war', text: label, severity: sev })
    }
    case 'breakthrough':
      rs.r.techLevel = clamp(rs.r.techLevel + 0.02 * sev)
      return event(w, { regionId: rs.r.id, kind: injected ? 'injected' : 'breakthrough', text: label, severity: sev })
    default:
      rs.shock += 0.1 * sev
      return event(w, { regionId: rs.r.id, kind: injected ? 'injected' : kind, text: label, severity: sev })
  }
}
