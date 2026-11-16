// real projected reality: UN World Population Prospects 2024, medium variant, 2026-2100, per country and world
// (population, life expectancy at birth, births, deaths), via Our World in Data's grapher exports
// (https://ourworldindata.org/grapher/population-with-un-projections and the matching births/deaths and life
// expectancy charts; UN source https://population.un.org/wpp/). -> data/geo/wpp.json
// usage: npx tsx scripts/geo-wpp.ts (downloads into data/geo/raw/wpp, gitignored, if missing)
import fs from 'node:fs'
import path from 'node:path'
import { getText, parseCsvLine } from './geo-lib'

const RAW = path.join('data', 'geo', 'raw', 'wpp')
const CHARTS: Record<string, string> = {
  pop: 'population-with-un-projections', vital: 'births-and-deaths-projected-to-2100', le: 'life-expectancy-at-birth-including-the-un-projections',
}
const Y0 = 2026, Y1 = 2100

async function csv(name: string): Promise<Record<string, string>[]> {
  const f = path.join(RAW, `${name}.csv`)
  if (!fs.existsSync(f)) { fs.mkdirSync(RAW, { recursive: true }); fs.writeFileSync(f, await getText(`https://ourworldindata.org/grapher/${name}.csv?v=1&csvType=full&useColumnShortNames=true`)) }
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
  const head = parseCsvLine(lines[0])
  return lines.slice(1).map(l => { const v = parseCsvLine(l); return Object.fromEntries(head.map((h, i) => [h, v[i]])) })
}
// the medium projection where it exists, else the estimate (for years up to 2023)
const pick = (r: Record<string, string>, metric: string) => {
  const proj = Object.keys(r).find(k => k.startsWith(metric) && k.includes('medium')), est = Object.keys(r).find(k => k.startsWith(metric) && k.includes('estimates'))
  const v = (proj && r[proj]) || (est && r[est])
  return v ? Number(v) : undefined
}

async function main() {
  const out: Record<string, { pop: number[]; le: number[]; births: number[]; deaths: number[] }> = {}
  const put = (code: string, key: 'pop' | 'le' | 'births' | 'deaths', year: number, v: number | undefined) => {
    if (v === undefined || year < Y0 || year > Y1) return
    const c = (out[code] ??= { pop: [], le: [], births: [], deaths: [] })
    c[key][year - Y0] = key === 'le' ? Math.round(v * 100) / 100 : Math.round(v)
  }
  for (const r of await csv(CHARTS.pop)) put(r.entity === 'World' ? 'WORLD' : r.code, 'pop', Number(r.year), pick(r, 'population'))
  for (const r of await csv(CHARTS.vital)) { const c = r.entity === 'World' ? 'WORLD' : r.code; put(c, 'births', Number(r.year), pick(r, 'births')); put(c, 'deaths', Number(r.year), pick(r, 'deaths')) }
  for (const r of await csv(CHARTS.le)) put(r.entity === 'World' ? 'WORLD' : r.code, 'le', Number(r.year), pick(r, 'life_expectancy'))
  // countries only (iso3 codes) plus the world
  const keep = Object.fromEntries(Object.entries(out).filter(([k, v]) => (k === 'WORLD' || /^[A-Z]{3}$/.test(k)) && v.pop.length))
  const file = path.join('data', 'geo', 'wpp.json')
  fs.writeFileSync(file, JSON.stringify({ source: 'UN World Population Prospects 2024, medium variant, via Our World in Data', url: 'https://population.un.org/wpp/', years: [Y0, Y1], note: 'arrays are indexed by year - 2026; pop, births, deaths in people; le in years', series: keep }))
  console.log(`wpp: ${Object.keys(keep).length} series (${Object.keys(keep).length - 1} countries + world), ${(fs.statSync(file).size / 1e3).toFixed(0)} KB; world 2050 pop ${(keep.WORLD.pop[24] / 1e9).toFixed(2)}B, le ${keep.WORLD.le[24]}`)
}
main().catch(e => { console.error(e); process.exit(1) })
