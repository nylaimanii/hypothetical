// npx tsx scripts/geo-countries.ts -> data/geo/countries.json
// every real country (world bank list), kept at country level: the sim runs on these, regions are only a
// summary for the governor brief. every field carries SOURCED (with url) or ESTIMATE (with reason).
import fs from 'node:fs'
import path from 'node:path'
import { assignRegion, type RegionId } from '../src/lib/sim/regions'
import { WB, buildNameIndex, getJson, getText, getZipEntry, parseCsvLine, wbIndicator, type Country, type Obs } from './geo-lib'

const wbUrl = (ind: string) => `https://data.worldbank.org/indicator/${ind}`
const owid = (slug: string) => `https://ourworldindata.org/grapher/${slug}.csv?v=1&csvType=full&useColumnShortNames=true`
const OWID_PAGE = (slug: string) => `https://ourworldindata.org/grapher/${slug}`
const PEW_ZIP = 'https://www.pewresearch.org/wp-content/uploads/sites/20/2025/06/Religious-Composition-2010-2020-dataset.zip'
const PEW_PAGE = 'https://www.pewresearch.org/religion/2025/06/09/how-the-global-religious-landscape-changed-from-2010-to-2020/'
const NCD_ZIP = 'https://www.ncdrisc.org/downloads/bmi-height-2020/height/all_countries/NCD_RisC_Lancet_2020_height_child_adolescent_country.zip'
const NCD_PAGE = 'https://www.ncdrisc.org/data-downloads-height.html'

type P = { kind: 'SOURCED' | 'ESTIMATE'; url?: string; note?: string }
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))
const r = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d

async function owidLatest(slug: string, col: string): Promise<Obs> {
  const out: Obs = new Map()
  const lines = (await getText(owid(slug))).split('\n')
  const head = parseCsvLine(lines[0])
  const iC = head.indexOf('code'), iY = head.indexOf('year'), iV = head.indexOf(col)
  for (const l of lines.slice(1)) {
    const f = parseCsvLine(l)
    if (!f[iC] || f[iV] === undefined || f[iV] === '') continue
    const prev = out.get(f[iC])
    if (!prev || Number(prev.date) < Number(f[iY])) out.set(f[iC], { value: Number(f[iV]), date: f[iY] })
  }
  return out
}

async function main() {
  const meta = await getJson(`${WB}/country?format=json&per_page=400`) as [unknown, Array<{ id: string; name: string; region: { id: string }; latitude: string; longitude: string }>]
  const countries: (Country & { lat: number; lon: number })[] = []
  for (const c of meta[1]) {
    if (c.region.id === 'NA') continue
    const reg = assignRegion(c.id, c.region.id)
    if (reg) countries.push({ iso3: c.id, name: c.name, region: reg, lat: Number(c.latitude), lon: Number(c.longitude) })
  }
  const lookup = buildNameIndex(countries)
  const IND = {
    pop: 'SP.POP.TOTL', gdp: 'NY.GDP.MKTP.CD', p65: 'SP.POP.65UP.TO.ZS', elec: 'EG.USE.ELEC.KH.PC', ter: 'SE.TER.ENRR',
    tfr: 'SP.DYN.TFRT.IN', cdr: 'SP.DYN.CDRT.IN', u5: 'SH.DYN.MORT', popF: 'SP.POP.TOTL.FE.IN', popM: 'SP.POP.TOTL.MA.IN',
    agr: 'SL.AGR.EMPL.ZS', ind: 'SL.IND.EMPL.ZS', srv: 'SL.SRV.EMPL.ZS', unemp: 'SL.UEM.TOTL.ZS', urban: 'SP.URB.TOTL.IN.ZS',
    gini: 'SI.POV.GINI', homicide: 'VC.IHR.PSRC.P5', area: 'AG.LND.TOTL.K2', forest: 'AG.LND.FRST.ZS', agland: 'AG.LND.AGRI.ZS',
  } as const
  const wb: Record<string, Obs> = {}
  for (const [k, ind] of Object.entries(IND)) {
    for (let i = 0; i < 4; i++) { try { wb[k] = await wbIndicator(ind); break } catch { await new Promise(res => setTimeout(res, 3000)) } }
    wb[k] ??= new Map()
  }
  wb.pv = await wbIndicator('GOV_WGI_PV.EST', 3)
  wb.rl = await wbIndicator('GOV_WGI_RL.EST', 3)
  const BANDS = ['0004', '0509', '1014', '1519', '2024', '2529', '3034', '3539', '4044', '4549', '5054', '5559', '6064', '6569', '7074', '7579', '80UP']
  const bandF = await Promise.all(BANDS.map(b => wbIndicator(`SP.POP.${b}.FE.5Y`)))
  const bandM = await Promise.all(BANDS.map(b => wbIndicator(`SP.POP.${b}.MA.5Y`)))
  const kcal = await owidLatest('daily-per-capita-caloric-supply', 'daily_calories')
  const happy = await owidLatest('happiness-cantril-ladder', 'cantril_ladder_score')
  const cpi = await owidLatest('ti-corruption-perception-index', 'cpi_score')
  const pm25 = await owidLatest('pm25-air-pollution', 'population_weighted_pm25')

  const faith: Obs = new Map()
  {
    const lines = (await getZipEntry(PEW_ZIP, '(percentages).csv')).replace(/^﻿/, '').split('\n')
    const head = parseCsvLine(lines[0])
    const iC = head.indexOf('Country'), iY = head.indexOf('Year'), iU = head.indexOf('Religiously_unaffiliated'), iL = head.indexOf('Level')
    for (const l of lines.slice(1)) {
      const f = parseCsvLine(l)
      if (f[iL] !== '1' || f[iY] !== '2020') continue
      const iso = lookup(f[iC])
      if (iso) faith.set(iso, { value: 1 - Number(f[iU]) / 100, date: '2020' })
    }
  }
  const hF: Obs = new Map(), hM: Obs = new Map()
  for (const l of (await getZipEntry(NCD_ZIP, 'country.csv')).split('\n').slice(1)) {
    const f = parseCsvLine(l)
    if (f[2] !== '2019' || f[3] !== '19') continue
    const iso = lookup(f[0])
    if (iso) (f[1] === 'Girls' ? hF : hM).set(iso, { value: Number(f[4]), date: '2019' })
  }

  // region means for imputation (population weighted over countries that have the value)
  const regionMean = (k: string, src: Obs) => {
    const acc: Record<string, { s: number; w: number }> = {}
    for (const c of countries) {
      const p = wb.pop.get(c.iso3)?.value ?? 0
      const v = src.get(c.iso3)?.value
      if (!p || v === undefined) continue
      const a = (acc[c.region] ??= { s: 0, w: 0 }); a.s += v * p; a.w += p
    }
    return (reg: RegionId) => (acc[reg] && acc[reg].w ? acc[reg].s / acc[reg].w : NaN)
  }

  const out: unknown[] = []
  const gaps: Record<string, number> = {}
  for (const c of countries) {
    const pop = wb.pop.get(c.iso3)?.value
    if (!pop || pop < 50_000) continue // microstates are folded into their region total only
    const prov: Record<string, P> = {}
    const val = (k: string, src: Obs, url: string): number => {
      const v = src.get(c.iso3)?.value
      if (v !== undefined && Number.isFinite(v)) { prov[k] = { kind: 'SOURCED', url }; return v }
      gaps[k] = (gaps[k] ?? 0) + 1
      prov[k] = { kind: 'ESTIMATE', url, note: 'missing for this country, imputed at the population-weighted mean of its region' }
      return regionMean(k, src)(c.region)
    }
    const gdp = val('gdpUsd', wb.gdp, wbUrl(IND.gdp))
    const gdppc = gdp / pop
    const agr = val('jobAgriculture', wb.agr, wbUrl(IND.agr)), ind = val('jobIndustry', wb.ind, wbUrl(IND.ind)), srv = val('jobServices', wb.srv, wbUrl(IND.srv))
    const urban = val('urban', wb.urban, wbUrl(IND.urban)) / 100
    const faithV = val('faith', faith, PEW_PAGE)
    const pf = wb.popF.get(c.iso3)?.value ?? pop / 2, pm = wb.popM.get(c.iso3)?.value ?? pop / 2
    const bands = BANDS.map((_, b) => {
      const sf = bandF[b].get(c.iso3)?.value, sm = bandM[b].get(c.iso3)?.value
      return sf !== undefined && sm !== undefined ? (sf * pf + sm * pm) / 100 / pop : NaN
    })
    const bandsOk = bands.every(Number.isFinite)
    prov.ageShare = bandsOk ? { kind: 'SOURCED', url: 'https://data.worldbank.org/indicator/SP.POP.0004.FE.5Y' } : { kind: 'ESTIMATE', note: 'age bands missing, region structure used by the sim' }
    // ---- local life (ESTIMATE where no open global dataset exists) ----
    // cars per 1,000: ESTIMATE from income, following the WHO Global Status Report on Road Safety 2023 registration
    // data pattern (~20 per 1,000 at $1k GDP per capita, ~600 at $60k). https://www.who.int/publications/i/item/9789240086517
    const carsPer1000 = Math.round(clamp(20 * Math.pow(gdppc / 1000, 0.85), 5, 800))
    // commute mode share: ESTIMATE from car ownership and urban share (no global census of commute modes exists;
    // shape follows OECD / UN-Habitat city surveys where available)
    const car = clamp(carsPer1000 / 900), transitBase = clamp(0.1 + 0.35 * urban * (1 - car) + (['easia', 'europe'].includes(c.region) ? 0.15 : 0))
    const moto = ['seasia', 'sasia', 'ssa'].includes(c.region) ? clamp(0.25 * (1 - car)) : 0.02
    const walk = clamp(0.5 * (1 - urban) * (1 - car) + 0.1), bike = ['europe', 'easia'].includes(c.region) ? 0.08 : 0.03
    const carShare = clamp(car * 0.9)
    const sum = walk + bike + transitBase + carShare + moto
    const commuteShare = { walk: r(walk / sum, 3), bike: r(bike / sum, 3), transit: r(transitBase / sum, 3), car: r(carShare / sum, 3), motorbike: r(moto / sum, 3) }
    // farm type: ESTIMATE from the share of jobs in farming and income (FAO: smallholders dominate low-income farming)
    const farmType = agr > 40 ? 'smallholder' : gdppc > 30000 ? 'industrial' : ['mideast', 'nafrica', 'rus_ca'].includes(c.region) && (wb.agland.get(c.iso3)?.value ?? 0) > 40 ? 'pastoral' : 'mixed'
    // nightlife 0..1: ESTIMATE from urban share and income, damped where faith shares are very high
    const nightlife = r(clamp(0.6 * urban + 0.3 * clamp(Math.log10(gdppc) - 3) - 0.2 * Math.max(0, faithV - 0.9) * 5), 3)
    out.push({
      id: c.iso3, name: c.name, regionId: c.region, lat: c.lat, lon: c.lon, population: Math.round(pop), gdpUsd: Math.round(gdp),
      share65plus: r(val('share65plus', wb.p65, wbUrl(IND.p65)) / 100), kwhPerCapita: Math.round(val('kwhPerCapita', wb.elec, wbUrl(IND.elec))),
      tertiary: r(val('tertiary', wb.ter, wbUrl(IND.ter)) / 100), faith: r(faithV), kcal: Math.round(val('kcal', kcal, OWID_PAGE('daily-per-capita-caloric-supply'))),
      wgiStability: r(val('wgiStability', wb.pv, 'https://www.worldbank.org/en/publication/worldwide-governance-indicators'), 3),
      wgiRuleOfLaw: r(val('wgiRuleOfLaw', wb.rl, 'https://www.worldbank.org/en/publication/worldwide-governance-indicators'), 3),
      tfr: r(val('tfr', wb.tfr, wbUrl(IND.tfr)), 3), crudeDeath: r(val('crudeDeath', wb.cdr, wbUrl(IND.cdr)), 2), under5: r(val('under5', wb.u5, wbUrl(IND.u5)), 1),
      ageShare: bandsOk ? bands.map(x => r(x, 5)) : null,
      heightF: r(val('heightF', hF, NCD_PAGE), 1), heightM: r(val('heightM', hM, NCD_PAGE), 1),
      unemployment: r(val('unemployment', wb.unemp, wbUrl(IND.unemp)) / 100), urban: r(urban), gini: r(val('gini', wb.gini, wbUrl(IND.gini)) / 100),
      homicidePer100k: r(val('homicidePer100k', wb.homicide, wbUrl(IND.homicide)), 2), happiness: r(val('happiness', happy, OWID_PAGE('happiness-cantril-ladder')), 3),
      cpi: Math.round(val('cpi', cpi, OWID_PAGE('ti-corruption-perception-index'))), pm25: r(val('pm25', pm25, OWID_PAGE('pm25-air-pollution')), 1),
      areaKm2: Math.round(val('areaKm2', wb.area, wbUrl(IND.area))), forestShare: r(val('forestShare', wb.forest, wbUrl(IND.forest)) / 100), farmlandShare: r(val('farmlandShare', wb.agland, wbUrl(IND.agland)) / 100),
      local: {
        commuteShare, jobMix: { agriculture: r(agr / 100), industry: r(ind / 100), services: r(srv / 100) }, carsPer1000, farmType, nightlife,
        provenance: { commuteShare: { kind: 'ESTIMATE', note: 'no global commute census; from car ownership, urban share and region' }, carsPer1000: { kind: 'ESTIMATE', url: 'https://www.who.int/publications/i/item/9789240086517', note: 'income curve fit to WHO road safety registration data' }, jobMix: prov.jobAgriculture, farmType: { kind: 'ESTIMATE', note: 'from farm job share and income' }, nightlife: { kind: 'ESTIMATE', note: 'from urban share, income, faith' } },
      },
      provenance: prov,
    })
  }
  const file = path.join(process.cwd(), 'data', 'geo', 'countries.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), note: 'country level starting world. see data/geo/sources.md', countries: out }))
  console.log(`countries: ${out.length}, imputed field counts: ${JSON.stringify(gaps)}`)
}
main().catch(e => { console.error(e); process.exit(1) })
