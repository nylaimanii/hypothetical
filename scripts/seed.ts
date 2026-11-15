// npm run seed:
//   1. (agent C) creates the data/ folders and writes the starting constitutions to data/seeds.json
//   2. (agent B) builds data/seed.json (12 regions, real 2026 starting world) and data/demographics.json
//      from live public data. pass --constitutions-only to skip the network step.
// every number is aggregated from public country-level data. anything that cannot be sourced is
// marked ESTIMATE with the reasoning next to it.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Provenance, Region } from '../src/lib/types'
import { assignRegion, type RegionId } from '../src/lib/sim/regions'
import { buildNameIndex, getJson, getText, getZipEntry, parseCsvLine, wbIndicator, type Country, type Obs } from './geo-lib'
import { SEEDS, wordCount } from '../src/lib/evolve/seeds'
import { DATA, dirs, writeJson } from '../src/lib/evolve/store'

// ---------- step 1: constitutions (agent C's original seed script, unchanged behavior) ----------
function seedConstitutions() {
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })
  let ok = true
  for (const s of SEEDS) {
    const n = wordCount(s.text)
    if (n >= 250 || /[\u2014\u2013]/.test(s.text)) ok = false
    console.log(`${s.id.padEnd(14)} ${String(n).padStart(3)} words  ${s.name}`)
  }
  writeJson(path.join(DATA, 'seeds.json'), SEEDS)
  if (!ok) { console.error('a seed is 250+ words or has an em-dash'); process.exit(1) }
}

import { WB } from './geo-lib'
const wbUrl = (ind: string) => `https://data.worldbank.org/indicator/${ind}`
const OWID_KCAL = 'https://ourworldindata.org/grapher/daily-per-capita-caloric-supply.csv?v=1&csvType=full&useColumnShortNames=true'
const OWID_KCAL_PAGE = 'https://ourworldindata.org/grapher/daily-per-capita-caloric-supply'
const PEW_ZIP = 'https://www.pewresearch.org/wp-content/uploads/sites/20/2025/06/Religious-Composition-2010-2020-dataset.zip'
const PEW_PAGE = 'https://www.pewresearch.org/religion/2025/06/09/how-the-global-religious-landscape-changed-from-2010-to-2020/'
const NCD_ZIP = 'https://www.ncdrisc.org/downloads/bmi-height-2020/height/all_countries/NCD_RisC_Lancet_2020_height_child_adolescent_country.zip'
const NCD_PAGE = 'https://www.ncdrisc.org/data-downloads-height.html'
const WPP_PAGE = 'https://population.un.org/wpp/'
const WGI_PAGE = 'https://www.worldbank.org/en/publication/worldwide-governance-indicators'


// name, map anchor (rough population centroid, ESTIMATE, display only), color (design choice, no ember tones)
const REGION_META: Record<RegionId, { name: string; lat: number; lon: number; color: string }> = {
  na: { name: 'North America', lat: 40, lon: -96, color: '#3b6ea8' },
  latam: { name: 'Latin America', lat: -10, lon: -60, color: '#2f8f6b' },
  europe: { name: 'Europe', lat: 50, lon: 12, color: '#6a5acd' },
  rus_ca: { name: 'Russia + Central Asia', lat: 55, lon: 70, color: '#5b7f95' },
  mideast: { name: 'Middle East', lat: 30, lon: 45, color: '#b8963e' },
  nafrica: { name: 'North Africa', lat: 27, lon: 15, color: '#8c7a4f' },
  ssa: { name: 'Sub-Saharan Africa', lat: 2, lon: 22, color: '#5e8c31' },
  sasia: { name: 'South Asia', lat: 23, lon: 79, color: '#9b5fa8' },
  easia: { name: 'East Asia', lat: 34, lon: 112, color: '#2a9bb0' },
  seasia: { name: 'Southeast Asia', lat: 8, lon: 108, color: '#3e9e8f' },
  oceania: { name: 'Oceania', lat: -27, lon: 140, color: '#4a6fc4' },
  carib_pac: { name: 'Caribbean + Pacific Islands', lat: 15, lon: -75, color: '#7f8fa6' },
}
const REGION_IDS = Object.keys(REGION_META) as RegionId[]

type Agg = { sum: number; pop: number; covered: number }

async function main() {
  seedConstitutions()
  if (process.argv.includes('--constitutions-only')) return
  const root = process.cwd()
  console.log('fetching world bank country list')
  const meta = await getJson(`${WB}/country?format=json&per_page=400`) as [unknown, Array<{ id: string; name: string; region: { id: string } }>]
  const countries: Country[] = []
  for (const c of meta[1]) {
    if (c.region.id === 'NA') continue // aggregates
    const r = assignRegion(c.id, c.region.id)
    if (r) countries.push({ iso3: c.id, name: c.name, region: r })
  }
  const byIso = new Map(countries.map(c => [c.iso3, c]))
  const lookup = buildNameIndex(countries)

  console.log('fetching indicators')
  const [pop, gdp, p65, elec, ter, pv, rl, tfr, cdr, u5, popF, popM] = await Promise.all([
    wbIndicator('SP.POP.TOTL'), wbIndicator('NY.GDP.MKTP.CD'), wbIndicator('SP.POP.65UP.TO.ZS'),
    wbIndicator('EG.USE.ELEC.KH.PC'), wbIndicator('SE.TER.ENRR'), wbIndicator('GOV_WGI_PV.EST', 3),
    wbIndicator('GOV_WGI_RL.EST', 3), wbIndicator('SP.DYN.TFRT.IN'), wbIndicator('SP.DYN.CDRT.IN'),
    wbIndicator('SH.DYN.MORT'), wbIndicator('SP.POP.TOTL.FE.IN'), wbIndicator('SP.POP.TOTL.MA.IN'),
  ])
  const ind = { pop, gdp, p65, elec, ter, pv, rl, tfr, cdr, u5, popF, popM }
  const BANDS = ['0004', '0509', '1014', '1519', '2024', '2529', '3034', '3539', '4044', '4549', '5054', '5559', '6064', '6569', '7074', '7579', '80UP']
  const bandF: Obs[] = await Promise.all(BANDS.map(b => wbIndicator(`SP.POP.${b}.FE.5Y`)))
  const bandM: Obs[] = await Promise.all(BANDS.map(b => wbIndicator(`SP.POP.${b}.MA.5Y`)))

  console.log('fetching FAO food supply (via Our World in Data)')
  const kcal: Obs = new Map()
  {
    const lines = (await getText(OWID_KCAL)).split('\n').slice(1)
    for (const l of lines) {
      const [, code, year, v] = parseCsvLine(l)
      if (!code || !v) continue
      const prev = kcal.get(code)
      if (!prev || Number(prev.date) < Number(year)) kcal.set(code, { value: Number(v), date: year })
    }
  }

  console.log('fetching Pew religious composition 2020')
  const faithObs: Obs = new Map()
  const pewUnmatched: string[] = []
  {
    const lines = (await getZipEntry(PEW_ZIP, '(percentages).csv')).replace(/^﻿/, '').split('\n')
    const head = parseCsvLine(lines[0])
    const iC = head.indexOf('Country'), iY = head.indexOf('Year'), iU = head.indexOf('Religiously_unaffiliated'), iL = head.indexOf('Level')
    for (const l of lines.slice(1)) {
      const f = parseCsvLine(l)
      if (f[iL] !== '1' || f[iY] !== '2020') continue
      const iso = lookup(f[iC])
      // faith = share affiliated with any religion = 1 - religiously unaffiliated
      if (iso) faithObs.set(iso, { value: 1 - Number(f[iU]) / 100, date: '2020' })
      else pewUnmatched.push(f[iC])
    }
  }

  console.log('fetching NCD-RisC heights')
  const hF: Obs = new Map(), hM: Obs = new Map()
  const childF = new Map<string, number[]>(), childM = new Map<string, number[]>() // ages 5..19
  const ncdUnmatched = new Set<string>()
  {
    const lines = (await getZipEntry(NCD_ZIP, 'country.csv')).split('\n').slice(1)
    for (const l of lines) {
      const f = parseCsvLine(l)
      if (f[2] !== '2019') continue
      const iso = lookup(f[0])
      if (!iso) { ncdUnmatched.add(f[0]); continue }
      const age = Number(f[3]), h = Number(f[4])
      const girl = f[1] === 'Girls'
      const m = girl ? childF : childM
      if (!m.has(iso)) m.set(iso, new Array(15).fill(0))
      m.get(iso)![age - 5] = h
      if (age === 19) (girl ? hF : hM).set(iso, { value: h, date: '2019' })
    }
  }

  // ---------- aggregation ----------
  const popOf = (iso: string) => ind.pop.get(iso)?.value ?? 0
  const agg: Record<RegionId, Record<string, Agg>> = Object.fromEntries(REGION_IDS.map(r => [r, {}])) as Record<RegionId, Record<string, Agg>>
  const add = (r: RegionId, key: string, value: number | undefined, weight: number) => {
    const a = (agg[r][key] ??= { sum: 0, pop: 0, covered: 0 })
    a.pop += weight
    if (value !== undefined && Number.isFinite(value)) { a.sum += value * weight; a.covered += weight }
  }
  const popTotal: Record<RegionId, number> = Object.fromEntries(REGION_IDS.map(r => [r, 0])) as Record<RegionId, number>
  const members: Record<RegionId, string[]> = Object.fromEntries(REGION_IDS.map(r => [r, []])) as unknown as Record<RegionId, string[]>
  const childAgg: Record<RegionId, { f: number[]; m: number[]; w: number }> = Object.fromEntries(REGION_IDS.map(r => [r, { f: new Array(15).fill(0), m: new Array(15).fill(0), w: 0 }])) as Record<RegionId, { f: number[]; m: number[]; w: number }>

  for (const c of countries) {
    const p = popOf(c.iso3)
    if (!p) continue
    const r = c.region
    popTotal[r] += p
    members[r].push(c.iso3)
    const gdp = ind.gdp.get(c.iso3)?.value
    add(r, 'gdppc', gdp !== undefined ? gdp / p : undefined, p)
    add(r, 'p65', ind.p65.get(c.iso3)?.value, p)
    add(r, 'elec', ind.elec.get(c.iso3)?.value, p)
    add(r, 'ter', ind.ter.get(c.iso3)?.value, p)
    add(r, 'kcal', kcal.get(c.iso3)?.value, p)
    add(r, 'faith', faithObs.get(c.iso3)?.value, p)
    add(r, 'pv', ind.pv.get(c.iso3)?.value, p)
    add(r, 'rl', ind.rl.get(c.iso3)?.value, p)
    add(r, 'tfr', ind.tfr.get(c.iso3)?.value, p)
    add(r, 'cdr', ind.cdr.get(c.iso3)?.value, p)
    add(r, 'u5', ind.u5.get(c.iso3)?.value, p)
    // heights weighted by adults of each sex, approximated by population
    add(r, 'hF', hF.get(c.iso3)?.value, ind.popF.get(c.iso3)?.value ?? p / 2)
    add(r, 'hM', hM.get(c.iso3)?.value, ind.popM.get(c.iso3)?.value ?? p / 2)
    const cf = childF.get(c.iso3), cm = childM.get(c.iso3)
    if (cf && cm) {
      for (let i = 0; i < 15; i++) { childAgg[r].f[i] += cf[i] * p; childAgg[r].m[i] += cm[i] * p }
      childAgg[r].w += p
    }
    const pf = ind.popF.get(c.iso3)?.value, pm = ind.popM.get(c.iso3)?.value
    for (let b = 0; b < BANDS.length; b++) {
      const sf = bandF[b].get(c.iso3)?.value, sm = bandM[b].get(c.iso3)?.value
      // absolute people in band = share of sex population * sex population
      if (pf !== undefined && pm !== undefined && sf !== undefined && sm !== undefined) add(r, `band${b}`, (sf * pf + sm * pm) / 100 / p, p)
      else add(r, `band${b}`, undefined, p)
    }
  }

  const mean = (r: RegionId, k: string) => { const a = agg[r][k]; return a && a.covered > 0 ? a.sum / a.covered : NaN }
  const coverage = (r: RegionId, k: string) => { const a = agg[r][k]; return a ? a.covered / a.pop : 0 }
  // SOURCED when the data covers at least 90% of the region's population, else ESTIMATE
  // (missing countries are imputed at the covered population-weighted mean)
  const prov = (r: RegionId, k: string, url: string): Provenance => coverage(r, k) >= 0.9 ? { kind: 'SOURCED', url } : { kind: 'ESTIMATE', url }
  const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))
  const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d

  // the starting snapshot: v2 fields (crowds, approval, life expectancy...) are computed by the sim at tick 0
  const regions: Omit<Region, 'crowds' | 'approval' | 'lifeExpectancy' | 'periodLifeExpectancy' | 'fertility' | 'diseaseBurden' | 'travelHoursToNearest' | 'whys'>[] = []
  const report: string[] = []
  const extras: Record<string, unknown> = {}
  for (const r of REGION_IDS) {
    const m = REGION_META[r]
    const population = Math.round(popTotal[r])
    const gdppc = mean(r, 'gdppc')
    const gdpUsd = gdppc * population
    const elec = mean(r, 'elec')
    const ter = mean(r, 'ter')
    const pv = mean(r, 'pv')
    const rl = mean(r, 'rl')
    const education = clamp(ter / 100)
    const incomeIdx = clamp((Math.log10(gdppc) - 2.5) / 2.5)
    // ESTIMATE: techLevel = 0.4 * education + 0.4 * incomeIdx + 0.2 * min(1, kWh per capita / 15000)
    //   incomeIdx = (log10(gdp per capita) - 2.5) / 2.5 clamped 0..1 ($316 -> 0, $100k -> 1)
    //   15000 kWh/cap is roughly the top-decile national electricity use, used as the "fully electrified" anchor
    const techLevel = clamp(0.4 * education + 0.4 * incomeIdx + 0.2 * clamp(elec / 15000))
    // ESTIMATE: unrest = 0.05 + 0.4 * (0.5 - WGI political stability / 5), stability in -2.5..2.5
    //   most stable (+2.5) -> 0.05, least stable (-2.5) -> 0.45. leaves headroom for sim-driven unrest
    const unrest = clamp(0.05 + 0.4 * (0.5 - pv / 5))
    // ESTIMATE: compliance = 0.5 + 0.14 * WGI rule of law, rule of law in -2.5..2.5 -> 0.15..0.85
    const compliance = clamp(0.5 + 0.14 * rl)
    const provenance: Record<string, Provenance> = {
      id: { kind: 'ESTIMATE' },
      name: { kind: 'ESTIMATE' },
      lat: { kind: 'ESTIMATE' }, // display anchor only
      lon: { kind: 'ESTIMATE' },
      color: { kind: 'ESTIMATE' }, // design choice
      population: prov(r, 'gdppc', wbUrl('SP.POP.TOTL')),
      share65plus: prov(r, 'p65', wbUrl('SP.POP.65UP.TO.ZS')),
      gdpUsd: prov(r, 'gdppc', wbUrl('NY.GDP.MKTP.CD')),
      energyTWh: prov(r, 'elec', wbUrl('EG.USE.ELEC.KH.PC')),
      foodKcalPerCapita: prov(r, 'kcal', OWID_KCAL_PAGE),
      education: prov(r, 'ter', wbUrl('SE.TER.ENRR')),
      faith: prov(r, 'faith', PEW_PAGE),
      unrest: { kind: 'ESTIMATE', url: WGI_PAGE },
      techLevel: { kind: 'ESTIMATE', url: wbUrl('SE.TER.ENRR') },
      compliance: { kind: 'ESTIMATE', url: WGI_PAGE },
    }
    provenance.population = { kind: 'SOURCED', url: wbUrl('SP.POP.TOTL') }
    regions.push({
      id: r, name: m.name, lat: m.lat, lon: m.lon, color: m.color,
      population,
      share65plus: round(mean(r, 'p65') / 100),
      gdpUsd: Math.round(gdpUsd),
      energyTWh: round(elec * population / 1e9, 1),
      foodKcalPerCapita: Math.round(mean(r, 'kcal')),
      education: round(education),
      faith: round(mean(r, 'faith')),
      unrest: round(unrest),
      techLevel: round(techLevel),
      compliance: round(compliance),
      provenance,
    })
    extras[r] = { countries: members[r].sort(), gdpPerCapita: Math.round(gdppc), kwhPerCapita: Math.round(elec), wgiStability: round(pv, 3), wgiRuleOfLaw: round(rl, 3) }
    for (const k of ['gdppc', 'p65', 'elec', 'ter', 'kcal', 'faith', 'pv', 'rl', 'hF', 'hM']) {
      const cv = coverage(r, k)
      if (cv < 0.98) report.push(`${r}.${k} coverage ${(cv * 100).toFixed(1)}%`)
    }
  }

  const seed = {
    generatedAt: new Date().toISOString().slice(0, 10),
    note: 'starting world for tick 0 (2026-11). latest available value per country, population-weighted per region.',
    sources: {
      worldBank: 'https://api.worldbank.org/v2 (SP.POP.TOTL, NY.GDP.MKTP.CD, SP.POP.65UP.TO.ZS, EG.USE.ELEC.KH.PC, SE.TER.ENRR, GOV_WGI_PV.EST, GOV_WGI_RL.EST)',
      fao: `${OWID_KCAL_PAGE} (FAO food balance sheets, kcal/capita/day, via Our World in Data; FAOSTAT API was unreachable)`,
      pew: PEW_PAGE,
    },
    coverageGaps: report,
    regions,
    extras,
  }
  fs.mkdirSync(path.join(root, 'data'), { recursive: true })
  fs.writeFileSync(path.join(root, 'data/seed.json'), JSON.stringify(seed, null, 2) + '\n')

  // ---------- demographics ----------
  const demographics: Record<string, unknown> = {}
  const BAND_LABELS = ['0-4', '5-9', '10-14', '15-19', '20-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65-69', '70-74', '75-79', '80+']
  for (const r of REGION_IDS) {
    const shares = BANDS.map((_, b) => mean(r, `band${b}`))
    const tot = shares.reduce((a, b) => a + b, 0)
    const ca = childAgg[r]
    const est = ESTIMATES[r]
    const skin = normalize(est.skin)
    demographics[r] = {
      skinTone: { weights: skin.map(x => round(x)), provenance: { kind: 'ESTIMATE' }, reasoning: est.skinWhy },
      hairType: { weights: hairStyleWeights(est.texture), provenance: { kind: 'ESTIMATE' }, reasoning: `texture mix straight/wavy/coily = ${est.texture.join('/')}. ${est.hairWhy} styles derived from texture in scripts/seed.ts hairStyleWeights, every style kept nonzero.` },
      hairColor: { weights: hairColorWeights(est.color), provenance: { kind: 'ESTIMATE' }, reasoning: `${est.colorWhy} gray and white are not in the base mix, they come from age in sim/citizens.ts.` },
      heightCm: {
        female: round(mean(r, 'hF'), 1), male: round(mean(r, 'hM'), 1),
        provenance: prov(r, 'hF', NCD_PAGE),
        note: 'NCD-RisC 2020 release, mean height at age 19 in 2019, population-weighted',
        sd: { female: 6.5, male: 7.0, provenance: { kind: 'ESTIMATE' }, reasoning: 'within-population adult height sd is about 6 to 7.5 cm in most national surveys; one value used for all regions' },
      },
      childHeightCm: {
        ages: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
        female: ca.f.map(x => round(x / ca.w, 1)),
        male: ca.m.map(x => round(x / ca.w, 1)),
        provenance: { kind: 'SOURCED', url: NCD_PAGE },
      },
      ageStructure: {
        bands: BAND_LABELS,
        share: shares.map(s => round(s / tot, 5)),
        provenance: { kind: coverage(r, 'band0') >= 0.9 ? 'SOURCED' : 'ESTIMATE', url: 'https://data.worldbank.org/indicator/SP.POP.0004.FE.5Y' },
        note: `UN World Population Prospects estimates as published by the World Bank (5-year bands by sex). ${WPP_PAGE}`,
      },
      vitalRates: {
        tfr: round(mean(r, 'tfr'), 3), crudeDeathPer1000: round(mean(r, 'cdr'), 2), under5MortalityPer1000: round(mean(r, 'u5'), 1),
        provenance: { tfr: prov(r, 'tfr', wbUrl('SP.DYN.TFRT.IN')), crudeDeathPer1000: prov(r, 'cdr', wbUrl('SP.DYN.CDRT.IN')), under5MortalityPer1000: prov(r, 'u5', wbUrl('SH.DYN.MORT')) },
      },
    }
  }
  fs.writeFileSync(path.join(root, 'data/demographics.json'), JSON.stringify({
    generatedAt: seed.generatedAt,
    note: 'appearance weights are ESTIMATE (no global dataset exists at this granularity). heights and age structure are SOURCED. every region gives every skin tone a nonzero weight.',
    monkScale: 'https://skintone.google/',
    regions: demographics,
  }, null, 2) + '\n')

  console.log('pew unmatched:', pewUnmatched.filter(n => !/^All /.test(n)).join(', ') || 'none')
  console.log('ncd unmatched:', [...ncdUnmatched].join(', ') || 'none')
  const missingPop = countries.filter(c => !popOf(c.iso3)).map(c => c.iso3)
  console.log('countries without population (dropped):', missingPop.join(', ') || 'none')
  console.log('coverage gaps:', report.join('; ') || 'none')
  for (const r of regions) console.log(r.id.padEnd(10), (r.population / 1e6).toFixed(0).padStart(5) + 'M', ('$' + (r.gdpUsd / 1e12).toFixed(2) + 'T').padStart(8), String(r.energyTWh).padStart(8) + 'TWh', String(r.foodKcalPerCapita).padStart(5) + 'kcal', 'edu', r.education.toFixed(2), 'faith', r.faith.toFixed(2), 'unrest', r.unrest.toFixed(2), 'tech', r.techLevel.toFixed(2), 'comp', r.compliance.toFixed(2))
  void byIso
}

function normalize(w: number[]): number[] {
  const s = w.reduce((a, b) => a + b, 0)
  return w.map(x => x / s)
}

// ESTIMATE: style mix from hair texture. each texture spreads across the styles it is commonly worn in,
// plus a floor so every style appears everywhere. sex adjustments (bald/buzz mostly male, long styles
// more female) are applied at sampling time in sim/citizens.ts.
function hairStyleWeights([straight, wavy, coily]: [number, number, number]): Record<string, number> {
  const w: Record<string, number> = {
    bald: 0.04, buzz: 0.05 + 0.06 * coily,
    short_straight: 0.30 * straight, long_straight: 0.30 * straight,
    short_wavy: 0.30 * wavy, long_wavy: 0.28 * wavy,
    short_coily: 0.25 * coily, afro: 0.15 * coily, locs: 0.10 * coily, braids: 0.18 * coily,
    bun: 0.08 * (straight + wavy) + 0.06 * coily, ponytail: 0.10 * (straight + wavy) + 0.02 * coily,
  }
  for (const k of Object.keys(w)) w[k] = Math.max(w[k], 0.01)
  const s = Object.values(w).reduce((a, b) => a + b, 0)
  for (const k of Object.keys(w)) w[k] = Math.round((w[k] / s) * 1e4) / 1e4
  return w
}

function hairColorWeights([black, darkBrown, brown, blonde, red]: number[]): Record<string, number> {
  const w: Record<string, number> = { black, dark_brown: darkBrown, brown, blonde, red }
  const s = Object.values(w).reduce((a, b) => a + b, 0)
  for (const k of Object.keys(w)) w[k] = Math.round((w[k] / s) * 1e4) / 1e4
  return w
}

// ESTIMATE tables. no global dataset reports Monk skin tone or hair distributions by region, so these are
// judgment calls: constitutive skin tone tracks ancestral UV exposure by latitude (Jablonski & Chaplin 2000,
// https://doi.org/10.1006/jhev.2000.0403) blended with each region's known migration history. every tone is
// nonzero in every region and no region is concentrated on a single tone.
const ESTIMATES: Record<RegionId, { skin: number[]; skinWhy: string; texture: [number, number, number]; hairWhy: string; color: number[]; colorWhy: string }> = {
  na: { skin: [8, 16, 18, 14, 12, 10, 8, 6, 5, 3], skinWhy: 'US and Canada: majority European ancestry plus large Latino, African American, Asian and Indigenous populations, so a broad spread centered on the lighter half.', texture: [0.45, 0.35, 0.20], hairWhy: 'mixed ancestry, roughly an eighth African descent.', color: [25, 30, 22, 18, 5], colorWhy: 'brown shades dominant, blonde from European ancestry.' },
  latam: { skin: [3, 7, 12, 16, 18, 16, 12, 8, 5, 3], skinWhy: 'mestizo majority with European, Indigenous and Afro-Latin populations (Brazil, Colombia), so centered on mid tones with wide tails.', texture: [0.45, 0.40, 0.15], hairWhy: 'straight to wavy majority, coily common in Brazil and coastal regions.', color: [45, 35, 13, 5, 2], colorWhy: 'mostly black and dark brown.' },
  europe: { skin: [14, 24, 22, 15, 9, 6, 4, 3, 2, 1], skinWhy: 'high-latitude ancestry concentrates the lighter tones; Mediterranean populations plus migrant communities from Africa, the Middle East and South Asia widen it.', texture: [0.45, 0.50, 0.05], hairWhy: 'straight and wavy dominant.', color: [10, 32, 30, 22, 6], colorWhy: 'widest natural hair color range of any region, blonde and red mostly northern.' },
  rus_ca: { skin: [12, 22, 22, 17, 12, 7, 4, 2, 1, 1], skinWhy: 'Russia skews light; Caucasus and Central Asian populations sit in the light-to-mid range.', texture: [0.55, 0.40, 0.05], hairWhy: 'straight common in Central Asia, wavy in the Caucasus.', color: [25, 35, 23, 14, 3], colorWhy: 'dark brown common, blonde in northern Russia.' },
  mideast: { skin: [2, 6, 12, 18, 22, 18, 11, 6, 3, 2], skinWhy: 'mostly light-to-mid olive tones, darker in Yemen and the Gulf coast, plus large South Asian and African migrant workforces in the Gulf.', texture: [0.30, 0.60, 0.10], hairWhy: 'wavy dominant.', color: [55, 32, 10, 2, 1], colorWhy: 'black and dark brown dominant.' },
  nafrica: { skin: [1, 4, 9, 15, 20, 20, 14, 9, 5, 3], skinWhy: 'Mediterranean coast mid tones darkening southward into Sudan.', texture: [0.25, 0.55, 0.20], hairWhy: 'wavy dominant, coily common in Sudan and southern Egypt.', color: [60, 30, 8, 1.5, 0.5], colorWhy: 'black and dark brown dominant, rare lighter shades in Berber populations.' },
  ssa: { skin: [1, 1, 2, 3, 5, 9, 15, 22, 24, 18], skinWhy: 'equatorial UV ancestry centers on the darker tones; Horn of Africa and southern Africa add mid tones, small European, Indian and mixed-ancestry populations in the south and east keep lighter tones present.', texture: [0.03, 0.07, 0.90], hairWhy: 'coily dominant.', color: [88, 10, 1.5, 0.3, 0.2], colorWhy: 'black dominant.' },
  sasia: { skin: [1, 2, 5, 10, 16, 21, 20, 14, 8, 3], skinWhy: 'wide range from lighter northern populations to darker southern ones, centered on mid-to-dark tones.', texture: [0.45, 0.48, 0.07], hairWhy: 'straight and wavy dominant.', color: [75, 22, 2.5, 0.3, 0.2], colorWhy: 'black dominant.' },
  easia: { skin: [6, 16, 26, 24, 14, 7, 3, 2, 1, 1], skinWhy: 'light-to-mid tones dominate, darker in southern China, small minorities across the range.', texture: [0.88, 0.10, 0.02], hairWhy: 'straight dominant.', color: [85, 13, 1.5, 0.3, 0.2], colorWhy: 'black dominant.' },
  seasia: { skin: [2, 5, 12, 19, 22, 19, 11, 6, 3, 1], skinWhy: 'mid tones dominate, lighter in urban Chinese-descent communities, darker in eastern Indonesia and among Negrito and Melanesian-descent groups.', texture: [0.65, 0.30, 0.05], hairWhy: 'straight dominant, wavy common.', color: [80, 17, 2.5, 0.3, 0.2], colorWhy: 'black dominant.' },
  oceania: { skin: [12, 20, 18, 14, 11, 9, 7, 4, 3, 2], skinWhy: 'Australia and New Zealand: European majority, large Asian communities, Aboriginal, Torres Strait Islander and Maori populations.', texture: [0.45, 0.45, 0.10], hairWhy: 'straight and wavy dominant.', color: [15, 30, 28, 21, 6], colorWhy: 'similar to northwest European mix plus Asian and Pacific black and dark brown.' },
  carib_pac: { skin: [2, 3, 5, 8, 11, 14, 16, 17, 14, 10], skinWhy: 'Caribbean populations are mostly African and mixed ancestry; Papua New Guinea and Melanesia dark, Polynesia mid tones; European and South Asian descendants present.', texture: [0.15, 0.25, 0.60], hairWhy: 'coily dominant in the Caribbean and Melanesia, wavy and straight in Polynesia.', color: [65, 25, 7, 2, 1], colorWhy: 'black dominant.' },
}

main().catch(e => { console.error(e); process.exit(1) })
