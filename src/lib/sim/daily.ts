// daily systems per country, yearly: hunger, air and water deaths, school, brain drain, water, waste, money (poverty,
// gini), safety, internet, worship, leisure, family, nature. each starts from sourced 2026 values (data/geo/daily.json)
// and moves with the sim; every rule says where its numbers come from. what each system does to people (deaths,
// unrest, skills) is applied relative to 2026, because the starting death and growth rates already contain it.
import dailyJson from '../../../data/geo/daily.json'
import { link, recentLink } from './causes'
import { countryPop, countriesOf, addToRegion, syncRegion, type CountryState } from './places'
import { NBANDS, clamp, incomeIdx, regionPop, sum, type RegionState, type World } from './state'
import type { LawEffects } from './society'

export type Faith = 'christian' | 'muslim' | 'hindu' | 'buddhist' | 'jewish' | 'other' | 'unaffiliated'
type DailySeed = {
  id: string; undernourished: number; doctorsPer1000: number; primaryEnroll: number; eduSpendGdp: number; remittancesGdp: number
  safeWater: number; waterStress: number; poverty: number; internet: number; protectedLand: number; airDeathsPer100k: number; washDeathsPer100k: number
  faiths: Record<Faith, number>; weekend: number[]
}
export const DAILY = new Map((dailyJson as unknown as { countries: DailySeed[] }).countries.map(d => [d.id, d]))

export type Daily = {
  // hunger: FAO prevalence of undernourishment, lognormal intake (cv 0.25); kcalScale reconciles OWID supply with FAO's
  // sourced rate (supply includes waste and differs by source), fitted so the formula gives the 2026 value
  hungerCv: number; kcalScale: number; undernourished: number; pou0: number; calibrated?: boolean
  pm25: number; airRate: number; air0: number // WHO air pollution death rate per 100k
  safeWater: number; washRate: number; wash0: number; waterStress: number
  enroll: number; doctors: number
  skilledLeftYear: number; diaspora: number; remitGdp: number
  wasteKgDay: number; wasteCollected: number
  gini: number; povScale: number; poverty: number; pov0: number
  homicide: number
  internet: number
  worshipWeekly: number; workHoursWeek: number; elderAlone: number
  protectedLand: number; forestShare: number; wildlife: number // wildlife: living planet style index, 2026 = 1
  mortMult: number
  base: { gdppc: number; unemp: number; unrest: number; fossil: number; forestRegion: number; security: number }
}

// FAO: share below the minimum dietary energy requirement (~1,800 kcal) for a lognormal intake with mean kcal and spread cv
const MDER = 1800
const erf = (x: number) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y }
const ncdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2))
const nInv = (p: number) => { let lo = -8, hi = 8; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (ncdf(m) < p) lo = m; else hi = m } return (lo + hi) / 2 }
const pouOf = (kcal: number, cv: number) => { const s = Math.sqrt(Math.log(1 + cv * cv)), mu = Math.log(Math.max(kcal, 1)) - s * s / 2; return ncdf((Math.log(MDER) - mu) / s) }
// poverty: share under $2.15/day for lognormal income with sigma from the gini (sigma = sqrt2 x invPhi((G + 1) / 2))
const povOf = (meanDay: number, gini: number) => { const s = Math.SQRT2 * nInv((clamp(gini, 0.15, 0.75) + 1) / 2), mu = Math.log(Math.max(meanDay, 0.01)) - s * s / 2; return ncdf((Math.log(2.15) - mu) / s) }
const solve = (f: (x: number) => number, target: number, lo: number, hi: number) => { for (let i = 0; i < 50; i++) { const m = Math.sqrt(lo * hi); if (f(m) < target) hi = m; else lo = m } return Math.sqrt(lo * hi) }
// WHO concave exposure-response (GEMM-like): death rate ~ pm^0.6 between countries
const airScale = (pm: number, pm0: number) => Math.pow(Math.max(pm, 1) / Math.max(pm0, 1), 0.6)
const fossilOf = (w: World, c: CountryState) => { const m = w.countryMix[c.id] as Record<string, number> | undefined; if (!m) return 0.6; const t = sum(Object.values(m)) || 1; return (m.fossil ?? 0) / t }
// What a Waste 2.0 (World Bank 2018, https://datatopics.worldbank.org/what-a-waste/): ~0.36 kg/person/day in
// low-income countries, ~1.56 in high-income (683 Mt for 1.2B people); collection 39% low income, 96% high income
const wasteKg = (gdppc: number) => clamp(0.36 * Math.pow(Math.max(gdppc, 300) / 800, 0.33), 0.15, 3)

export function initDaily(w: World, c: CountryState, rs: RegionState): Daily {
  const d = DAILY.get(c.id)
  // the sim's own starting numbers (country gdp is rescaled to its region's sourced total)
  const pop = countryPop(c), gdppc = c.gdpUsd / Math.max(pop, 1), inc = incomeIdx(gdppc)
  const pou0 = clamp(d?.undernourished ?? 0.08, 0.025, 0.7) // FAO reports "<2.5%" as 2.5
  const hungerCv = 0.25
  const kcalScale = solve(k => pouOf(c.seed.kcal * k, hungerCv), pou0, 0.3, 3)
  const gini = c.seed.gini || 0.38
  // scale between gdp per capita and household consumption, fitted so the formula reproduces the sourced poverty rate;
  // where the rate is not sourced, consumption ~60% of gdp per capita (World Bank national accounts, ESTIMATE)
  const sourcedPov = (d as unknown as { provenance?: Record<string, { kind: string }> })?.provenance?.poverty?.kind === 'SOURCED'
  const povScale = sourcedPov ? solve(k => povOf(gdppc * k / 365, gini), clamp(d!.poverty, 0.002, 0.9), 0.02, 5) : 0.6
  const pov0 = povOf(gdppc * povScale / 365, gini)
  const internet = d?.internet ?? 0.6
  return {
    hungerCv, kcalScale, undernourished: pou0, pou0,
    pm25: c.seed.pm25, airRate: d?.airDeathsPer100k ?? 60, air0: d?.airDeathsPer100k ?? 60,
    safeWater: d?.safeWater ?? 0.7, washRate: d?.washDeathsPer100k ?? 10, wash0: d?.washDeathsPer100k ?? 10, waterStress: d?.waterStress ?? 0.3,
    enroll: d?.primaryEnroll ?? 0.9, doctors: d?.doctorsPer1000 ?? 1.5,
    skilledLeftYear: 0, diaspora: 1, remitGdp: d?.remittancesGdp ?? 0.02,
    wasteKgDay: wasteKg(gdppc), wasteCollected: clamp(0.39 + 0.57 * inc),
    gini, povScale, poverty: pov0, pov0, homicide: c.seed.homicidePer100k,
    internet,
    // weekly attendance ESTIMATE ~ 0.6 x faith share (Pew: weekly attendance tracks religiosity; ~5% in nordic countries, ~70%+ in nigeria)
    worshipWeekly: clamp(0.65 * c.seed.faith * c.seed.faith + 0.03),
    // ILO: ~45-48 hours a week in low-income countries, ~33-37 in rich ones (https://ilostat.ilo.org/topics/working-time/)
    workHoursWeek: clamp(48 - 13 * inc, 30, 50),
    // ESTIMATE 65+ living alone or only with a spouse: ~10% where incomes are low, ~60% in rich countries (UN DESA Living Arrangements of Older Persons 2020)
    elderAlone: clamp(0.08 + 0.55 * inc * c.seed.urban),
    protectedLand: d?.protectedLand ?? 0.15, forestShare: c.seed.forestShare, wildlife: 1,
    mortMult: 1,
    base: { gdppc, unemp: c.seed.unemployment, unrest: c.unrest, fossil: fossilOf(w, c), forestRegion: rs.forest || 0.3, security: rs.pc0.security },
  }
}

const strongest = (w: World, rs: RegionState, kind: string) => { let best = { c: 0, lawId: undefined as string | undefined }; for (const l of w.laws) if (!l.vetoed && l.policyKind === kind) { const c = rs.lawCompliance[l.id] ?? 0; if (c > best.c) best = { c, lawId: l.id } } return best }
const pct = (x: number) => `${Math.round(x * 100)}%`
const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`

// yearly (tick % 12 === 11)
export function stepDaily(w: World, fx: Record<string, LawEffects>) {
  // where skilled emigrants go: the richest region by income per head (brain drain flows up the income ladder)
  const rich = [...w.regions].filter(r => !r.seceded && regionPop(r) > 0).sort((a, b) => b.r.gdpUsd / regionPop(b) - a.r.gdpUsd / regionPop(a))
  for (const rs of w.regions) {
    const cs = countriesOf(w, rs.r.id)
    const e = fx[rs.r.id]
    const conserve = strongest(w, rs, 'conservation')
    for (const c of cs) {
      const d = c.daily, pop = countryPop(c)
      if (!d || pop <= 0) continue
      const gdppc = c.gdpUsd / pop, inc = incomeIdx(gdppc), grow = gdppc / d.base.gdppc
      // hunger. calibrate once against the sim's first-year food supply (it settles from the sourced seed in month one)
      if (!d.calibrated) { d.kcalScale = solve(k => pouOf(c.kcal * k, d.hungerCv), d.pou0, 0.3, 3); d.calibrated = true }
      const pou = pouOf(c.kcal * d.kcalScale, d.hungerCv)
      if (pou - d.undernourished > 0.03) { const why = recentLink(w, rs.r.id, k => /drought|harvest|food|famine|blight|kcal/.test(k.what), 24); link(w, { placeId: c.id, what: `hunger in ${c.name} rose to ${pct(pou)} of people`, value: (pou - d.undernourished) * 5, because: why ? why.what : `food supply at ${Math.round(c.kcal)} kcal a day`, byWhom: 'market', stat: 'foodSecurity', causeIds: why ? [why.id] : [] }) }
      d.undernourished = pou
      // air: PM2.5 follows the fossil share of power and industry (ESTIMATE elasticity 0.7) plus open waste burning
      const fossil = fossilOf(w, c)
      const pmTarget = c.seed.pm25 * (0.4 + 0.6 * Math.pow(Math.max(fossil, 0.01) / Math.max(d.base.fossil, 0.01), 0.7) * Math.pow(grow, 0.15)) + 3 * (1 - d.wasteCollected) * (d.wasteKgDay - wasteKg(d.base.gdppc))
      const pm = clamp(d.pm25 + (pmTarget - d.pm25) * 0.3, 0.5, 200)
      const air = d.air0 * airScale(pm, c.seed.pm25)
      if (Math.abs(air - d.airRate) / Math.max(d.airRate, 1) > 0.1) link(w, { placeId: c.id, what: `air pollution deaths in ${c.name} ${air > d.airRate ? 'rose' : 'fell'} to ${Math.round(air)} per 100k`, value: Math.abs(air - d.airRate) / Math.max(d.airRate, 1), because: `PM2.5 ${pm.toFixed(0)} ug/m3, fossil share of power ${pct(fossil)}`, byWhom: 'market', stat: 'airQuality' })
      d.pm25 = pm; d.airRate = air
      // water: access rises with income (JMP: coverage tracks GDP per capita) and falls in droughts and unrest;
      // unsafe water deaths scale with the share still without safe water (WHO WASH mortality)
      const waterTarget = clamp(d.safeWater + 0.02 * Math.max(0, Math.log(grow)) * 10 * (1 - d.safeWater) - 0.03 * c.damage - 0.02 * Math.max(0, c.unrest - 0.5))
      d.safeWater += (waterTarget - d.safeWater) * 0.5
      d.waterStress = clamp(DAILY.get(c.id)?.waterStress ?? 0.3) * (pop / c.seed.population) * (1 + 0.1 * Math.max(0, w.climate.anomalyC - 1.3))
      d.washRate = d.wash0 * (1 - d.safeWater) / Math.max(1 - (DAILY.get(c.id)?.safeWater ?? 0.7), 0.02)
      // school: primary enrollment moves toward a target set by education spending and years required (ESTIMATE)
      const eduPush = clamp(rs.spend.education * 12 / Math.max(regionPop(rs), 1) / Math.max(rs.pc0.education, 1), 0.3, 3)
      const enrollTarget = clamp((DAILY.get(c.id)?.primaryEnroll ?? 0.9) + 0.3 * (inc - incomeIdx(d.base.gdppc)) + 0.1 * Math.log(eduPush) + 0.02 * Math.max(0, w.schoolPolicy.yearsRequired - 10) - 0.15 * c.damage, 0.2, 0.995)
      d.enroll += (enrollTarget - d.enroll) * 0.2
      d.doctors = (DAILY.get(c.id)?.doctorsPer1000 ?? 1.5) * Math.pow(grow, 0.5) * (1 + 0.5 * (e?.health ?? 0)) * (1 - 0.3 * clamp(d.diaspora - 1))
      // brain drain: skilled emigration rates are highest in small poor countries (Docquier, Lowell & Marfouk 2009,
      // https://doi.org/10.1111/j.1728-4457.2009.00277.x : guyana, haiti 80%+, nigeria ~11%, india ~4%, rich <1%).
      // ESTIMATE yearly outflow = stock rate / 30-year career, pulled by the income gap and internet access
      const top = rich[0]
      const gap = top && top !== rs ? clamp(Math.log((top.r.gdpUsd / regionPop(top)) / Math.max(gdppc, 1)) / 3) : 0
      const rate = clamp(0.9 / (1 + Math.pow(pop / 1e6, 0.45)) * (1 - inc) + 0.03 * (1 - inc), 0, 0.9) * gap * (0.6 + 0.4 * d.internet)
      const skilled = pop * 0.6 * c.seed.tertiary * 0.5 // working-age adults with tertiary education (ESTIMATE)
      const left = skilled * rate / 30
      d.skilledLeftYear = left
      if (left > 100 && top && top !== rs) {
        const take = new Array(NBANDS).fill(0)
        take[5] = Math.min(left * 0.5, c.bands[5] * 0.05); take[6] = Math.min(left * 0.5, c.bands[6] * 0.05) // ages 25-34
        c.bands[5] -= take[5]; c.bands[6] -= take[6]
        syncRegion(w, rs)
        addToRegion(w, top, take)
        w.skilledMigrants += take[5] + take[6]
        d.diaspora += left / Math.max(skilled, 1)
        if (left > 50000) link(w, { placeId: c.id, what: `${fmt(left)} doctors, engineers and teachers left ${c.name} for ${top.r.name}`, value: clamp(Math.max(left / 1e5, left / Math.max(skilled, 1) * 200)), because: `incomes ${Math.round((top.r.gdpUsd / regionPop(top)) / Math.max(gdppc, 1))}x higher there`, byWhom: 'people' })
      }
      // remittances grow with the diaspora (World Bank: ~$660B a year to low and middle income countries)
      d.remitGdp = clamp((DAILY.get(c.id)?.remittancesGdp ?? 0.02) * d.diaspora, 0, 0.5)
      // waste
      d.wasteKgDay = wasteKg(gdppc)
      d.wasteCollected = clamp(d.wasteCollected + 0.02 * (clamp(0.39 + 0.57 * inc) - d.wasteCollected) * 5 - 0.05 * c.damage)
      // money: gini drifts down with redistributive laws (Nordic transfers cut market gini ~0.15: OECD IDD) and up
      // slowly with growth in rich economies (skill-biased technology, ESTIMATE +0.001/yr)
      const giniTarget = clamp((c.seed.gini || 0.38) - 0.12 * (e?.redistributive ?? 0) + 0.001 * (w.tick / 12) * inc, 0.2, 0.7)
      d.gini += (giniTarget - d.gini) * 0.1
      // a basic income lifts the floor: at full compliance and funding ~60% of the extremely poor cross the line
      // (GiveDirectly's kenya UBI study: large gains in consumption and assets, https://www.givedirectly.org/ubi-study/)
      const ubiC = strongest(w, rs, 'basic_income').c
      const pov = povOf(gdppc * d.povScale / 365, d.gini) * (1 - 0.6 * ubiC)
      const povWhy = pov > d.poverty ? recentLink(w, rs.r.id, k => /recession|gdp|disaster|unemploy|strike|revolt/.test(k.what), 24) : undefined
      if (Math.abs(pov - d.poverty) > 0.02) link(w, { causeIds: povWhy ? [povWhy.id] : [], placeId: c.id, what: `extreme poverty in ${c.name} ${pov > d.poverty ? 'rose' : 'fell'} to ${pct(pov)}`, value: Math.abs(pov - d.poverty) * 10, because: `income per head ${grow >= 1 ? '+' : ''}${Math.round((grow - 1) * 100)}% since 2026, gini ${d.gini.toFixed(2)}`, byWhom: 'market', stat: 'economy' })
      d.poverty = pov
      // safety: homicide rises with unemployment and inequality (Fajnzylber, Lederman & Loayza 2002: gini elasticity
      // ~1.5, https://doi.org/10.1086/338347) and unrest, falls a little with police spending (ESTIMATE elasticity -0.2)
      const sec = clamp(rs.spend.security * 12 / Math.max(regionPop(rs), 1) / Math.max(d.base.security, 1), 0.3, 4)
      const hom = c.seed.homicidePer100k * Math.pow(Math.max(c.unemployment, 0.01) / Math.max(d.base.unemp, 0.01), 0.5) * Math.pow(d.gini / (c.seed.gini || 0.38), 1.5) * (1 + 2 * Math.max(0, c.unrest - d.base.unrest)) * Math.pow(sec, -0.2)
      const homWhy = recentLink(w, rs.r.id, k => /unemploy|protest|riot|evicted|poverty|revolt/.test(k.what), 36)
      if (hom > d.homicide * 1.25 && hom > 5) link(w, { causeIds: homWhy ? [homWhy.id] : [], placeId: c.id, what: `murders in ${c.name} rose to ${hom.toFixed(0)} per 100k`, value: clamp(hom / d.homicide - 1), because: c.unemployment > d.base.unemp + 0.02 ? `${pct(c.unemployment)} unemployment` : c.unrest > d.base.unrest + 0.1 ? 'unrest' : 'wider inequality', byWhom: 'people', stat: 'safety' })
      d.homicide = hom
      // internet: logistic diffusion (ITU 2024: ~27% online in low income, ~93% in high income, growing ~5 points a
      // year in africa on cheap phones) toward a ceiling of ~75% even in the poorest places, ~98% in the richest
      const netCeil = clamp(0.75 + 0.23 * inc)
      d.internet = clamp(d.internet + 0.15 * d.internet * (1 - d.internet / Math.max(netCeil, d.internet)) - 0.1 * (c.unrest > 0.7 ? 1 : 0))
      // worship: secularization ~0.5 points a year where incomes rise (Pew), faster with religion bans
      d.worshipWeekly = clamp(d.worshipWeekly * (1 - 0.005 * Math.max(0, Math.log(grow)) * 10) * (w.religionPolicy === 'discouraged' ? 0.97 : 1))
      // leisure: hours worked fall as incomes rise (OECD: ~-0.3%/yr over the 20th century)
      d.workHoursWeek = clamp(48 - 13 * inc, 30, 50)
      // family: elders living alone rise with income and cities
      d.elderAlone = clamp(0.08 + 0.55 * inc * c.seed.urban)
      // nature: forests follow the region's forest; wildlife falls (WWF Living Planet Report 2024: -73% since
      // 1970, ~2.7%/yr; ESTIMATE ~1.2%/yr ahead as the steepest losses slow) less where land is protected and forests regrow; protected land grows with conservation laws (30x30)
      d.forestShare = clamp(c.seed.forestShare * (rs.forest || d.base.forestRegion) / Math.max(d.base.forestRegion, 0.01))
      d.protectedLand = clamp(d.protectedLand + 0.03 * conserve.c * Math.max(0, 0.3 - d.protectedLand) * 3)
      const prevW = d.wildlife
      d.wildlife = clamp(d.wildlife * (1 - 0.012 + 0.04 * d.protectedLand + 0.5 * (d.forestShare - c.seed.forestShare)) * (1 - 0.003 * Math.max(0, w.climate.anomalyC - 1.3) * 10), 0.01, 2)
      if (conserve.lawId && d.wildlife > prevW && d.protectedLand > (DAILY.get(c.id)?.protectedLand ?? 0.15) + 0.05 && w.tick % 60 === 59) link(w, { placeId: c.id, what: `wildlife in ${c.name} recovering, ${pct(d.protectedLand)} of land protected`, value: 0.45, because: 'conservation law', byWhom: 'core', lawId: conserve.lawId })
      // what this does to deaths, relative to 2026 (crude death rate per 100k = crudeDeath x 100)
      const crude = Math.max(c.seed.crudeDeath * 100, 300)
      d.mortMult = clamp(1 + ((d.airRate - d.air0) + (d.washRate - d.wash0)) / crude, 0.7, 1.5)
      // deaths by cause, excess over the 2026 rates (negative when things improve)
      w.causeDeaths.air += (d.airRate - d.air0) / 1e5 * pop
      w.causeDeaths.water += (d.washRate - d.wash0) / 1e5 * pop
    }
  }
}

// brief: a few short lines, never per-country dumps
export function dailyLines(w: World): string[] {
  const cs = w.countries.filter(c => c.daily)
  if (!cs.length) return []
  const P = sum(cs.map(countryPop)) || 1
  const avg = (f: (c: CountryState) => number) => sum(cs.map(c => f(c) * countryPop(c))) / P
  const worst = (f: (c: CountryState) => number) => [...cs].filter(c => countryPop(c) > 5e6).sort((a, b) => f(b) - f(a))[0]
  const hung = worst(c => c.daily.undernourished), air = worst(c => c.daily.airRate)
  const drain = sum(cs.map(c => c.daily.skilledLeftYear))
  return [
    `hunger ${pct(avg(c => c.daily.undernourished))} (worst ${hung.name} ${pct(hung.daily.undernourished)}); extreme poverty ${pct(avg(c => c.daily.poverty))}, gini ${avg(c => c.daily.gini).toFixed(2)}`,
    `air deaths ${Math.round(avg(c => c.daily.airRate))}/100k (worst ${air.name}), safe water ${pct(avg(c => c.daily.safeWater))}, waste collected ${pct(avg(c => c.daily.wasteCollected))}`,
    `school enrollment ${pct(avg(c => c.daily.enroll))}, internet ${pct(avg(c => c.daily.internet))}, ${fmt(drain)} skilled emigrants last year, murders ${avg(c => c.daily.homicide).toFixed(1)}/100k`,
    `nature: wildlife index ${avg(c => c.daily.wildlife).toFixed(2)} of 2026, protected land ${pct(avg(c => c.daily.protectedLand))}`,
  ]
}

// a pip's faith: stable per pip, from the country's Pew 2020 mix (only for pips who believe)
export function faithOf(countryId: string | undefined, belief: string | undefined, u: number): Faith {
  if (belief === 'secular') return 'unaffiliated'
  const mix = DAILY.get(countryId ?? '')?.faiths ?? { christian: 0.3, muslim: 0.25, hindu: 0.15, buddhist: 0.07, jewish: 0.002, other: 0.1, unaffiliated: 0 }
  const ent = Object.entries(mix).filter(([k]) => k !== 'unaffiliated') as [Faith, number][]
  const tot = sum(ent.map(([, v]) => v)) || 1
  let x = u * tot
  for (const [k, v] of ent) { x -= v; if (x <= 0) return k }
  return ent[0]?.[0] ?? 'other'
}
export { weekendOf } from './calendar'
