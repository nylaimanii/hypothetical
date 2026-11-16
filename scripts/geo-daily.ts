// daily-life starting point per country -> data/geo/daily.json, plus real launch sites -> data/geo/launch-sites.json.
// usage: npx tsx scripts/geo-daily.ts
// sourced: World Bank WDI (hunger, doctors, school, remittances, water, poverty, internet, protected land, WHO air
// pollution and unsafe-water death rates, education spending), Pew 2020 religion shares. missing values are imputed
// at the population-weighted mean of the country's region and marked ESTIMATE.
import fs from 'node:fs'
import path from 'node:path'
import { getZipEntry, parseCsvLine, wbIndicator, type Obs } from './geo-lib'

type Prov = { kind: 'SOURCED' | 'ESTIMATE'; url?: string; note?: string }
const r = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d
const PEW_ZIP = 'https://www.pewresearch.org/wp-content/uploads/sites/20/2025/06/Religious-Composition-2010-2020-dataset.zip'
const IND = {
  undernourished: ['SN.ITK.DEFC.ZS', 100], doctorsPer1000: ['SH.MED.PHYS.ZS', 1], primaryEnroll: ['SE.PRM.NENR', 100], eduSpendGdp: ['SE.XPD.TOTL.GD.ZS', 100],
  remittancesGdp: ['BX.TRF.PWKR.DT.GD.ZS', 100], safeWater: ['SH.H2O.SMDW.ZS', 100], waterStress: ['ER.H2O.FWST.ZS', 100], poverty: ['SI.POV.DDAY', 100],
  internet: ['IT.NET.USER.ZS', 100], protectedLand: ['ER.LND.PTLD.ZS', 100], airDeathsPer100k: ['SH.STA.AIRP.P5', 1], washDeathsPer100k: ['SH.STA.WASH.P5', 1],
} as const
// workweek: Friday-Saturday weekends across much of the muslim world and Israel, Friday only in Iran, Saturday only
// in Nepal, Saturday-Sunday elsewhere (https://en.wikipedia.org/wiki/Workweek_and_weekend). 0 = Sunday
const FRI_SAT = new Set(['SAU', 'BHR', 'KWT', 'OMN', 'QAT', 'YEM', 'EGY', 'IRQ', 'JOR', 'LBY', 'SDN', 'SYR', 'DZA', 'BGD', 'MDV', 'ISR', 'PSE', 'AFG'])
const weekendOf = (id: string) => FRI_SAT.has(id) ? [5, 6] : id === 'IRN' ? [5] : id === 'NPL' ? [6] : [6, 0]

// active orbital launch sites (https://en.wikipedia.org/wiki/List_of_rocket_launch_sites), coordinates of the main pads
const LAUNCH_SITES = [
  { id: 'cape_canaveral', name: 'Cape Canaveral / Kennedy', countryId: 'USA', lat: 28.49, lon: -80.58 },
  { id: 'vandenberg', name: 'Vandenberg', countryId: 'USA', lat: 34.63, lon: -120.61 },
  { id: 'starbase', name: 'Starbase, Boca Chica', countryId: 'USA', lat: 25.99, lon: -97.15 },
  { id: 'wallops', name: 'Wallops', countryId: 'USA', lat: 37.83, lon: -75.49 },
  { id: 'baikonur', name: 'Baikonur', countryId: 'KAZ', lat: 45.96, lon: 63.31 },
  { id: 'plesetsk', name: 'Plesetsk', countryId: 'RUS', lat: 62.93, lon: 40.58 },
  { id: 'vostochny', name: 'Vostochny', countryId: 'RUS', lat: 51.88, lon: 128.33 },
  { id: 'jiuquan', name: 'Jiuquan', countryId: 'CHN', lat: 40.96, lon: 100.29 },
  { id: 'xichang', name: 'Xichang', countryId: 'CHN', lat: 28.25, lon: 102.03 },
  { id: 'taiyuan', name: 'Taiyuan', countryId: 'CHN', lat: 38.85, lon: 111.61 },
  { id: 'wenchang', name: 'Wenchang', countryId: 'CHN', lat: 19.61, lon: 110.95 },
  { id: 'kourou', name: 'Guiana Space Centre, Kourou', countryId: 'FRA', lat: 5.24, lon: -52.77 },
  { id: 'sriharikota', name: 'Satish Dhawan, Sriharikota', countryId: 'IND', lat: 13.72, lon: 80.23 },
  { id: 'tanegashima', name: 'Tanegashima', countryId: 'JPN', lat: 30.4, lon: 130.97 },
  { id: 'naro', name: 'Naro', countryId: 'KOR', lat: 34.43, lon: 127.54 },
  { id: 'mahia', name: 'Mahia (Rocket Lab LC-1)', countryId: 'NZL', lat: -39.26, lon: 177.86 },
  { id: 'palmachim', name: 'Palmachim', countryId: 'ISR', lat: 31.88, lon: 34.68 },
  { id: 'semnan', name: 'Semnan (Imam Khomeini)', countryId: 'IRN', lat: 35.23, lon: 53.92 },
  { id: 'sohae', name: 'Sohae', countryId: 'PRK', lat: 39.66, lon: 124.71 },
  { id: 'andoya', name: 'Andoya', countryId: 'NOR', lat: 69.29, lon: 16.02 },
  { id: 'saxavord', name: 'SaxaVord', countryId: 'GBR', lat: 60.82, lon: -0.77 },
  { id: 'alcantara', name: 'Alcantara', countryId: 'BRA', lat: -2.37, lon: -44.4 },
]

async function main() {
  const countries = (JSON.parse(fs.readFileSync('data/geo/countries.json', 'utf8')) as { countries: { id: string; name: string; population: number; regionId: string }[] }).countries
  const wb: Record<string, Obs> = {}
  for (const [k, [ind]] of Object.entries(IND)) {
    for (let i = 0; i < 4; i++) { try { wb[k] = await wbIndicator(ind); break } catch { await new Promise(res => setTimeout(res, 3000)) } }
    wb[k] ??= new Map()
  }
  // pew 2020 religion shares
  const faith = new Map<string, Record<string, number>>()
  {
    const lines = (await getZipEntry(PEW_ZIP, '(percentages).csv')).replace(/^﻿/, '').split('\n')
    const head = parseCsvLine(lines[0])
    const col = (n: string) => head.indexOf(n)
    const names = new Map(countries.map(c => [c.name.toLowerCase(), c.id]))
    for (const l of lines.slice(1)) {
      const f = parseCsvLine(l)
      if (f[col('Level')] !== '1' || f[col('Year')] !== '2020') continue
      const id = names.get(f[col('Country')].toLowerCase()) ?? countries.find(c => c.name.toLowerCase().startsWith(f[col('Country')].toLowerCase().slice(0, 6)))?.id
      if (!id) continue
      const g = (n: string) => r(Number(f[col(n)]) / 100, 3)
      faith.set(id, { christian: g('Christians'), muslim: g('Muslims'), unaffiliated: g('Religiously_unaffiliated'), buddhist: g('Buddhists'), hindu: g('Hindus'), jewish: g('Jews'), other: g('Other_religions') })
    }
  }
  const regionMean = (k: string) => (reg: string) => {
    let s = 0, p = 0
    for (const c of countries) { const v = wb[k].get(c.id)?.value; if (c.regionId === reg && v !== undefined && Number.isFinite(v)) { s += v * c.population; p += c.population } }
    return p ? s / p : 0
  }
  const gaps: Record<string, number> = {}
  const out = countries.map(c => {
    const prov: Record<string, Prov> = {}
    const row: Record<string, unknown> = { id: c.id }
    for (const [k, [ind, div]] of Object.entries(IND)) {
      const v = wb[k].get(c.id)
      const url = `https://data.worldbank.org/indicator/${ind}`
      if (v && Number.isFinite(v.value)) { row[k] = r(v.value / div); prov[k] = { kind: 'SOURCED', url, note: v.date } }
      else { row[k] = r(regionMean(k)(c.regionId) / div); prov[k] = { kind: 'ESTIMATE', url, note: 'missing, region population-weighted mean' }; gaps[k] = (gaps[k] ?? 0) + 1 }
    }
    const fa = faith.get(c.id)
    row.faiths = fa ?? { christian: 0.3, muslim: 0.25, unaffiliated: 0.2, buddhist: 0.05, hindu: 0.1, jewish: 0, other: 0.1 }
    prov.faiths = fa ? { kind: 'SOURCED', url: 'https://www.pewresearch.org/religion/2025/06/09/how-the-global-religious-landscape-changed-from-2010-to-2020/', note: 'Pew 2020' } : { kind: 'ESTIMATE', note: 'not in the Pew table, world mix' }
    if (!fa) gaps.faiths = (gaps.faiths ?? 0) + 1
    row.weekend = weekendOf(c.id)
    prov.weekend = { kind: 'SOURCED', url: 'https://en.wikipedia.org/wiki/Workweek_and_weekend' }
    row.provenance = prov
    return row
  })
  fs.writeFileSync(path.join('data', 'geo', 'daily.json'), JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), note: 'daily-life starting point per country, see data/geo/sources.md', countries: out }))
  fs.writeFileSync(path.join('data', 'geo', 'launch-sites.json'), JSON.stringify({ source: 'https://en.wikipedia.org/wiki/List_of_rocket_launch_sites', sites: LAUNCH_SITES }))
  console.log(`daily: ${out.length} countries, imputed ${JSON.stringify(gaps)}, ${(fs.statSync('data/geo/daily.json').size / 1e3).toFixed(0)} KB; ${LAUNCH_SITES.length} launch sites`)
}
main().catch(e => { console.error(e); process.exit(1) })
