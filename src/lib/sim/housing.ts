// housing, per country, yearly. households need homes: owned, rented, social (public), informal (slums, UN-Habitat
// definition) or a camp (displaced people). builders respond to prices, the core can build, upzone, cap rents, upgrade
// or clear slums, title land and tax empty homes, each with real precedents (precedents.ts). shortages push prices
// and rents up; rent burden and joblessness drive evictions; slums and camps cost lives; expensive housing costs births.
// starting point: data/geo/housing.json (UN-Habitat slum shares, UNHCR refugees and IDPs, ESTIMATE household size,
// tenure). everything not sourced is marked ESTIMATE with its reasoning.
import housingJson from '../../../data/geo/housing.json'
import type { HomeKind } from '../types-v5'
import { link, recentLink } from './causes'
import { addCrowd } from './behavior'
import { CITY_SEEDS, countryPop, countriesOf, housingMultiple, type CountryState } from './places'
import { clamp, incomeIdx, sum, type RegionState, type World } from './state'

type HousingSeed = { id: string; slumUrbanShare: number; refugees: number; idps: number; campResidents: number; householdSize: number; renterShare: number }
const SEEDS = new Map((housingJson as unknown as { countries: HousingSeed[] }).countries.map(h => [h.id, h]))
// sourced cross-country fit: urban slum share falls as incomes rise (see scripts/geo-housing.ts)
const FIT = (housingJson as unknown as { slumFit?: { a: number; b: number } }).slumFit ?? { a: 100, b: -22 }
const slumFit = (gdppc: number) => clamp((FIT.a + FIT.b * Math.log10(Math.max(gdppc, 100))) / 100)

export type Housing = {
  hhSize: number
  owned: number; rented: number; social: number; informal: number // households
  camp: number // people
  priceIdx: number; price0: number // house price to household income
  rentBurden: number; burden0: number // rent / income of renters
  pipeline: { done: number; units: number; kind: 'private' | 'social' }[]
  coverage: number // share of new households the formal market housed in 2026 (1 - urban slum share x urban share)
  hh0: number; hhPrev?: number
  slumOffset: number // the country's 2026 urban slum share minus the income fit (kept: places differ)
  evictedYear: number; builtYear: number; socialYear: number; upgradedYear: number; clearedYear: number
  informal0: number; camp0: number; unemp0: number; lastDamage: number
  mortMult: number; tfrMult: number; unrest: number
  gentrified: Record<string, number> // city id -> tick of its last gentrification story
  priceLink?: { id: string; tick: number } // the last price move, cause of what follows
}

// ESTIMATE social housing share of households: ~5% worldwide; much higher where public housing is the norm
// (Singapore HDB ~78%: https://www.hdb.gov.sg ; Hong Kong ~45% public rental + subsidized sale; Netherlands, Austria ~20-30%)
const SOCIAL0: Record<string, number> = { SGP: 0.78, HKG: 0.45, NLD: 0.3, AUT: 0.24, DNK: 0.21, GBR: 0.17, FRA: 0.14, SWE: 0.17, FIN: 0.11, CHN: 0.1 }

export function initHousing(c: CountryState): Housing {
  const s = SEEDS.get(c.id)
  const pop = countryPop(c)
  const hhSize = s?.householdSize ?? 3.5
  const H = pop / hhSize
  const informal = H * c.seed.urban * (s?.slumUrbanShare ?? 0.2)
  const social = (H - informal) * (SOCIAL0[c.id] ?? (c.regionId === 'europe' ? 0.1 : 0.04))
  const rented = (H - informal - social) * (s?.renterShare ?? 0.3)
  const camp = (s?.campResidents ?? 0) * pop / Math.max(c.seed.population, 1)
  const dens = c.seed.population / Math.max(c.seed.areaKm2, 1)
  const price0 = housingMultiple(c.seed.urban, dens, 0)
  // ESTIMATE renters spend ~30% of income on rent (the usual "cost burdened" line), a little more where prices are high
  const burden0 = clamp(0.25 + 0.01 * (price0 - 5), 0.2, 0.4)
  const H0 = H, coverage = clamp(1 - c.seed.urban * (s?.slumUrbanShare ?? 0.2))
  return {
    slumOffset: (s?.slumUrbanShare ?? 0.2) - slumFit(c.seed.gdpUsd / Math.max(c.seed.population, 1)),
    hhSize, owned: H - informal - social - rented, rented, social, informal, camp, priceIdx: price0, price0, rentBurden: burden0, burden0, coverage, hh0: H0,
    // steady state: replacement building already under way (~0.4% of stock a year, finishing over the next 18 months)
    pipeline: [{ done: 11, units: 0.004 * (H - informal) * 2 / 3, kind: 'private' }, { done: 17, units: 0.004 * (H - informal) * 2 / 3, kind: 'private' }],
    evictedYear: 0, builtYear: 0, socialYear: 0, upgradedYear: 0, clearedYear: 0, informal0: informal, camp0: camp, unemp0: c.seed.unemployment, lastDamage: 0,
    mortMult: 1, tfrMult: 1, unrest: 0, gentrified: {},
  }
}

// strongest compliance with an active law of this kind in the region
function kindC(w: World, rs: RegionState, kind: string): { c: number; lawId?: string } {
  let best = { c: 0, lawId: undefined as string | undefined }
  for (const l of w.laws) if (!l.vetoed && l.policyKind === kind) { const c = rs.lawCompliance[l.id] ?? 0; if (c > best.c) best = { c, lawId: l.id } }
  return best
}
const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`
const pct = (x: number) => `${Math.round(x * 100)}%`

// yearly, after demography. returns nothing; state lives on each country
export function stepHousing(w: World) {
  for (const rs of w.regions) {
    const cs = countriesOf(w, rs.r.id)
    if (!cs.length) continue
    const social = kindC(w, rs, 'social_housing'), rent = kindC(w, rs, 'rent_control'), upzone = kindC(w, rs, 'upzoning')
    const upgrade = kindC(w, rs, 'slum_upgrading'), clear = kindC(w, rs, 'slum_clearance'), title = kindC(w, rs, 'land_titling'), vacancy = kindC(w, rs, 'vacancy_tax')
    const rGdp = Math.max(sum(cs.map(c => c.gdpUsd)), 1)
    for (const c of cs) {
      const h = c.housing
      const pop = countryPop(c)
      if (pop <= 0) continue
      const gdppc = c.gdpUsd / pop
      const H = pop / h.hhSize
      const formal = h.owned + h.rented + h.social
      const hhIncome = gdppc * 0.55 * h.hhSize // labor share ~0.55 (ILO)
      // ESTIMATE build cost per home ~ 60% of the price (the rest is land), price = price-to-income x household income
      const unitCost = Math.max(5000, 0.6 * h.priceIdx * hhIncome)
      // ---- displacement from disasters this year: at most ~15% of the urban population at full damage (Haiti 2010:
      // ~1.5M of 10M, https://en.wikipedia.org/wiki/2010_Haiti_earthquake ; Pakistan floods 2022: ~8M of 230M)
      const dmg = Math.max(0, c.damage - h.lastDamage)
      h.lastDamage = c.damage * 0.7
      const displaced = pop * c.seed.urban * dmg * 0.15
      if (displaced > 1000) {
        // their homes: ~60% destroyed (the formal stock shrinks, so rents rise, as in New Orleans after Katrina:
        // https://www.huduser.gov/portal/periodicals/em/fall06/highlight1.html); a quarter go to camps, a quarter
        // rebuild informally, the rest double up with family until rebuilt (ESTIMATE shares)
        const lost = Math.min(0.6 * displaced / h.hhSize, 0.5 * (h.owned + h.rented))
        const ownS = h.owned / Math.max(h.owned + h.rented, 1)
        h.owned -= lost * ownS; h.rented -= lost * (1 - ownS)
        h.camp += 0.25 * displaced
        h.informal += 0.25 * displaced / h.hhSize
        const hit = recentLink(w, rs.r.id, k => k.byWhom === 'nature' && k.what.includes(c.name), 12)
        link(w, { placeId: c.id, what: `${fmt(displaced)} lost their homes in ${c.name}, ${fmt(0.25 * displaced)} into camps`, value: clamp(displaced / pop * 60), because: hit ? hit.what : 'disaster damage to homes', byWhom: 'nature', causeIds: hit ? [hit.id] : [] })
      }
      // ---- completions from the pipeline
      let done = 0, doneSocial = 0
      h.pipeline = h.pipeline.filter(p => { if (p.done <= w.tick) { if (p.kind === 'social') doneSocial += p.units; else done += p.units; return false } return true })
      // ---- private starts: ~1% of stock a year (US completions ~1.4M on ~145M homes), more when prices are high and
      // upzoning lets builders respond (Auckland 2016: consents roughly doubled in upzoned areas,
      // https://doi.org/10.1016/j.jue.2023.103550), fewer under rent caps (San Francisco: -15% rental supply,
      // Diamond, McQuade & Qian 2019, https://doi.org/10.1257/aer.20181289) and in unrest. ESTIMATE elasticity 2
      const priceSignal = Math.max(0, h.priceIdx / h.price0 - 1)
      const elastic = 2 * (1 + upzone.c) / (1 + 2 * c.seed.urban * (1 - upzone.c))
      const growth = Math.max(-0.05, (c.gdpUsd - (c.housingGdpPrev || c.gdpUsd)) / Math.max(c.housingGdpPrev || c.gdpUsd, 1))
      c.housingGdpPrev = c.gdpUsd
      // builders replace what is lost and house new households at the 2026 formal share; high prices add more
      const newHH = H - (h.hhPrev ?? H)
      h.hhPrev = H
      const vacancy0 = Math.max(0, -((H - formal - h.informal) / H))
      const starts = (formal * 0.004 * clamp(1 - 10 * vacancy0) + Math.max(0, newHH) * h.coverage * (1 + Math.max(0, growth)) + formal * 0.01 * elastic * priceSignal) * clamp(1 - c.unrest) * (1 - 0.15 * rent.c)
      h.pipeline.push({ done: w.tick + 18, units: starts, kind: 'private' }) // ~18 months start to completion (US Census Survey of Construction)
      // ---- public building: the social housing law spends up to ~10% of this country's share of welfare on homes,
      // capped at 2% of households a year (Singapore HDB built ~54,000 homes in its first 5 years, ~10%+ of stock:
      // https://www.hdb.gov.sg/about-us/history). 24 months to complete
      if (social.c > 0) {
        const welfareUsd = rs.spend.welfare * 12 * c.gdpUsd / rGdp
        const units = Math.min(0.02 * H, social.c * 0.1 * welfareUsd / unitCost)
        if (units > 0) h.pipeline.push({ done: w.tick + 24, units, kind: 'social' })
      }
      // ---- the stock changes: completions, ~0.4%/yr demolished or abandoned (ESTIMATE, US ~0.3-0.5%)
      // empty homes beyond ~5% are abandoned or torn down at ~10% a year (East Germany's Stadtumbau Ost demolished
      // ~300,000 empty flats from 2002: https://de.wikipedia.org/wiki/Stadtumbau_Ost)
      const loss = formal * 0.004 + Math.max(0, formal + h.informal - H - 0.05 * H) * 0.1
      const ownShare = h.owned / Math.max(h.owned + h.rented, 1)
      h.owned += done * ownShare - loss * ownShare
      h.rented += done * (1 - ownShare) - loss * (1 - ownShare)
      h.social += doneSocial
      h.builtYear = done + doneSocial; h.socialYear = doneSocial
      if (doneSocial > 1000) link(w, { placeId: c.id, what: `${fmt(doneSocial)} public homes completed in ${c.name}`, value: clamp(doneSocial / H * 30), because: 'social housing law', byWhom: 'core', lawId: social.lawId })
      // social homes go to the worst housed first: slum and camp families move in
      const fromInformal = Math.min(h.informal, doneSocial * 0.6), fromCamp = Math.min(h.camp, doneSocial * 0.4 * h.hhSize)
      h.informal -= fromInformal; h.camp -= fromCamp
      // ---- slums: upgrading (Indonesia's Kampung Improvement Program reached ~5M people over 20 years) and land titles
      // (Peru COFOPRI 1996: ~1.2M titles in 4 years, https://doi.org/10.1162/qjec.2007.122.4.1561) turn informal homes formal
      const upgraded = h.informal * (0.05 * upgrade.c + 0.03 * title.c)
      h.informal -= upgraded; h.owned += upgraded; h.upgradedYear = upgraded
      if (upgraded > 1000) link(w, { placeId: c.id, what: `${fmt(upgraded * h.hhSize)} slum residents in ${c.name} got water, sewers or a title deed`, value: clamp(upgraded / H * 30), because: upgrade.c >= title.c ? 'slum upgrading law' : 'land titling law', byWhom: 'core', lawId: upgrade.c >= title.c ? upgrade.lawId : title.lawId })
      // clearance: Zimbabwe's Operation Murambatsvina (2005) destroyed homes or livelihoods of ~700,000 people in weeks
      // (UN Tibaijuka report, https://www.un.org/News/dh/infocus/zimbabwe/zimbabwe_rpt.pdf). most rebuild informally elsewhere
      const cleared = h.informal * 0.1 * clear.c
      h.clearedYear = cleared
      if (cleared > 0) {
        h.informal -= cleared * 0.3 // a third leave the slum count: to camps, relatives or the street
        h.camp += cleared * 0.2 * h.hhSize
        if (cleared * h.hhSize > 50000) {
          const k = link(w, { placeId: c.id, what: `${fmt(cleared * h.hhSize)} people in ${c.name} had their homes bulldozed`, value: clamp(cleared / H * 20), because: 'slum clearance law', byWhom: 'core', lawId: clear.lawId })
          addCrowd(rs, w, { topic: 'slum clearances', peak: clamp(cleared * h.hhSize / Math.max(rs.r.population, 1) * 40), outrageMonths: 6, lawId: clear.lawId, causeId: k.id })
        }
      }
      // ---- camps empty slowly: protracted displacement averages years (UNHCR); ~12%/yr leave (ESTIMATE)
      // as incomes rise, informal neighborhoods formalize (titles, services, rebuilding) toward the income fit,
      // ~10% of the excess a year (ESTIMATE pace; slum shares fell ~1 point a year in fast-growing asia, UN-Habitat)
      const urbanHH = H * c.seed.urban
      const targetInf = clamp(slumFit(gdppc) + h.slumOffset) * urbanHH
      if (h.informal > targetInf) { const f = (h.informal - targetInf) * 0.1; h.informal -= f; h.owned += f }
      const leave = h.camp * 0.12
      h.camp -= leave
      h.informal += leave * 0.4 / h.hhSize
      // ---- households without a home: shortages first double up, then build informally where incomes are low
      const homes = h.owned + h.rented + h.social + h.informal
      const short = H - homes
      if (short > 0) h.informal += short * c.seed.urban * (1 - incomeIdx(gdppc)) * 0.5
      const homes2 = h.owned + h.rented + h.social + h.informal
      const shortage = (H - homes2) / H // >0: doubled up, <0: empty homes
      // vacancy tax: Vancouver's empty homes tax (2017) cut vacant homes ~25-35% in its first years
      // (https://vancouver.ca/home-property-development/empty-homes-tax.aspx): frees ~1% of stock at full compliance
      const eff = shortage - 0.01 * vacancy.c
      // ---- prices: ESTIMATE price-to-income moves ~8x the shortage swing (a 5 point swing ~ +50%), toward it 30% a year
      const p0 = (h as Housing & { short0?: number }).short0 ??= eff
      const target = clamp(h.price0 * Math.exp(8 * (eff - p0)), 1.5, 30)
      const before = h.priceIdx
      h.priceIdx += (target - h.priceIdx) * 0.3
      // rents follow prices less than one for one; caps hold them down (Berlin's Mietendeckel 2020 cut capped rents
      // but listings halved: https://www.diw.de/de/diw_01.c.812524.de/publikationen/wochenberichte/2021_09_1/)
      h.rentBurden = clamp(h.burden0 * Math.pow(h.priceIdx / h.price0, 0.7) * (1 - 0.3 * rent.c), 0.08, 0.8)
      const why = recentLink(w, c.id, k => /lost their homes|public homes|bulldozed|title deed/.test(k.what), 36)
      if (Math.abs(h.priceIdx / before - 1) > 0.08) h.priceLink = { tick: w.tick, id: link(w, { placeId: c.id, what: `home prices in ${c.name} ${h.priceIdx > before ? 'rose' : 'fell'} to ${h.priceIdx.toFixed(1)}x a year's household income`, value: Math.abs(h.priceIdx / before - 1), because: why && /lost their homes/.test(why.what) && eff > p0 ? 'homes destroyed, more households than homes' : eff > p0 ? 'more households than homes' : 'more homes than households', byWhom: 'market', stat: 'housingCost', causeIds: why ? [why.id] : [] }).id }
      const priceCause = h.priceLink && w.tick - h.priceLink.tick < 120 ? [h.priceLink.id] : []
      // ---- evictions: ~2.3% of US renter households a year before 2020 (Eviction Lab, https://evictionlab.org), rising
      // with rent burden and job losses, halved by rent protection. ESTIMATE elsewhere at half the formal rate
      const rate = clamp(0.023 * Math.pow(h.rentBurden / h.burden0, 2) * (1 + 5 * Math.max(0, c.unemployment - h.unemp0)) * (1 - 0.5 * rent.c) * (gdppc > 15000 ? 1 : 0.5), 0, 0.2)
      const evicted = h.rented * rate
      h.evictedYear = evicted
      // most evicted families rent again, ~10% end up informal or on the street (ESTIMATE)
      const toInformal = evicted * 0.1 * (1 - incomeIdx(gdppc))
      h.rented -= toInformal; h.informal += toInformal
      if (evicted > 0.03 * h.rented && evicted > 20000) {
        const k = link(w, { placeId: c.id, what: `${fmt(evicted)} households evicted in ${c.name}`, value: clamp(rate * 10), because: `rents at ${pct(h.rentBurden)} of renters' income${c.unemployment > h.unemp0 + 0.02 ? ` and ${pct(c.unemployment)} unemployment` : ''}`, byWhom: 'market', causeIds: priceCause })
        if (rate > 0.05) addCrowd(rs, w, { topic: 'evictions', peak: clamp(rate * 3), outrageMonths: 4, causeId: k.id })
      }
      // ---- gentrification: in growing cities of a country whose prices are well above 2026, low-income families get
      // pushed out of the centre. one story per city per 10 years
      if (h.priceIdx > h.price0 * 1.25) {
        w.realCities.forEach((rc, i) => {
          const seed = CITY_SEEDS[i]
          if (seed.countryId !== c.id || rc.pop < seed.pop * 1.1 || w.tick - (h.gentrified[seed.id] ?? -999) < 120) return
          h.gentrified[seed.id] = w.tick
          link(w, { placeId: c.id, what: `rising rents pushed low-income families out of central ${seed.name}`, value: 0.45, because: `${seed.name} grew ${pct(rc.pop / seed.pop - 1)} while ${c.name}'s prices reached ${h.priceIdx.toFixed(1)}x income`, byWhom: 'market', causeIds: priceCause })
        })
      }
      // ---- what housing does to people, relative to 2026 (the starting death and birth rates already include it):
      // slum life ~+25% mortality (UN-Habitat State of the World's Cities: worse water, sanitation, crowding; ESTIMATE size),
      // camps ~+80% (Sphere standards: emergency crude mortality often 2x baseline; ESTIMATE for protracted camps)
      // change in the share of people in slums and camps (not head counts: a growing country keeps its 2026 share)
      const slumPop = h.informal / H - h.informal0 / h.hh0, campPop = h.camp / pop - h.camp0 / (h.hh0 * h.hhSize)
      h.mortMult = clamp(1 + 0.25 * slumPop + 0.8 * campPop, 0.8, 1.5)
      // expensive housing costs births: +10% house prices -> renters' births -1.3% (Dettling & Kearney 2014,
      // https://doi.org/10.1016/j.jpubeco.2013.09.009)
      const renters = h.rented / Math.max(H, 1)
      // (owners gained in that study; we keep only the renter effect, the conservative reading)
      h.tfrMult = clamp(1 - 0.13 * Math.log(h.priceIdx / h.price0) * renters, 0.8, 1.1)
      // rent burden above 2026 and evictions feed unrest (ESTIMATE)
      h.unrest = clamp(0.3 * Math.max(0, h.rentBurden - h.burden0) + 0.5 * Math.max(0, rate - 0.03), 0, 0.2)
    }
  }
}

// one brief line: worst affordability, slum share change, camps, evictions
export function housingLine(w: World): string {
  if (!w.countries.length || !w.countries[0].housing) return ''
  let slum = 0, slum0 = 0, urbanHH = 0, camp = 0, ev = 0, built = 0
  for (const c of w.countries) {
    const h = c.housing
    slum += h.informal * h.hhSize; slum0 += h.informal0 * h.hhSize; urbanHH += countryPop(c) * c.seed.urban; camp += h.camp; ev += h.evictedYear; built += h.builtYear
  }
  const worst = [...w.countries].filter(c => countryPop(c) > 5e6).sort((a, b) => b.housing.priceIdx / b.housing.price0 - a.housing.priceIdx / a.housing.price0)[0]
  return `housing: slums ${pct(slum / Math.max(urbanHH, 1))} of city dwellers (${slum >= slum0 ? '+' : ''}${fmt(slum - slum0)} since 2026), camps ${fmt(camp)}, ${fmt(ev)} evictions and ${fmt(built)} homes built last year${worst ? `, priciest rise ${worst.name} ${worst.housing.priceIdx.toFixed(1)}x income` : ''}`
}

// a pip's home: stable per pip, drawn from the country's tenure mix by income band; evictions move renters
export function homeOf(c: CountryState | undefined, band: 'low' | 'mid' | 'high', u: number): HomeKind {
  if (!c) return 'rented'
  const h = c.housing, H = h.owned + h.rented + h.social + h.informal + h.camp / h.hhSize
  // the poorest third holds nearly all informal and camp homes, the richest owns most (ESTIMATE)
  const w8: Record<HomeKind, number> = band === 'low'
    ? { informal: 3 * h.informal, camp: 3 * h.camp / h.hhSize, social: 2 * h.social, rented: h.rented, owned: 0.4 * h.owned, family: 0.08 * H }
    : band === 'high' ? { informal: 0, camp: 0, social: 0.2 * h.social, rented: 0.6 * h.rented, owned: 2 * h.owned, family: 0.01 * H }
    : { informal: 0.2 * h.informal, camp: 0.1 * h.camp / h.hhSize, social: h.social, rented: h.rented, owned: h.owned, family: 0.04 * H }
  const tot = sum(Object.values(w8))
  let x = u * tot
  for (const [k, v] of Object.entries(w8)) { x -= v; if (x <= 0) return k as HomeKind }
  return 'owned'
}
