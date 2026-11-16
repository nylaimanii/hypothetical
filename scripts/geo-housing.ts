// housing starting point per country -> data/geo/housing.json. usage: npx tsx scripts/geo-housing.ts
// sourced: UN-Habitat slum share (via World Bank), UNHCR refugees / IDPs / asylum seekers 2024, IDMC disaster displacement.
// estimated (no open global dataset): household size, renter share, camp residents. every field carries provenance.
import fs from 'node:fs'
import path from 'node:path'
import { getJson, wbIndicator } from './geo-lib'

type Prov = { kind: 'SOURCED' | 'ESTIMATE'; url?: string; note?: string }
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const r = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d
const SLUM = 'EN.POP.SLUM.UR.ZS', DISP = 'VC.IDP.NWDS'
const UNHCR = 'https://api.unhcr.org/population/v1/population/?year=2024&coa_all=true&limit=400'

async function main() {
  const countries = (JSON.parse(fs.readFileSync('data/geo/countries.json', 'utf8')) as { countries: { id: string; name: string; population: number; gdpUsd: number; urban: number; tfr: number; regionId: string }[] }).countries
  const slum = await wbIndicator(SLUM)
  const disp = await wbIndicator(DISP)
  const un = (await getJson(UNHCR)) as { items: { coa_iso: string; refugees: number | string; idps: number | string; asylum_seekers: number | string }[] }
  const unhcr = new Map(un.items.map(x => [x.coa_iso, { refugees: Number(x.refugees) || 0, idps: Number(x.idps) || 0, asylum: Number(x.asylum_seekers) || 0 }]))
  // fill missing slum shares with a log-income fit over the sourced countries (least squares, slum% ~ a + b log10 gdp/capita)
  const pts = countries.filter(c => slum.has(c.id)).map(c => [Math.log10(c.gdpUsd / c.population), slum.get(c.id)!.value] as const)
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length
  const b = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0), a0 = my - b * mx
  const out = countries.map(c => {
    const prov: Record<string, Prov> = {}
    const gdppc = c.gdpUsd / c.population
    const s = slum.get(c.id)
    const slumShare = s ? s.value / 100 : clamp((a0 + b * Math.log10(gdppc)) / 100)
    prov.slumUrbanShare = s ? { kind: 'SOURCED', url: `https://data.worldbank.org/indicator/${SLUM}`, note: `UN-Habitat SDG 11.1.1, ${s.date}` } : { kind: 'ESTIMATE', note: `missing; log-income fit over ${pts.length} sourced countries (slum% = ${r(a0, 1)} ${b < 0 ? '-' : '+'} ${r(Math.abs(b), 1)} log10 gdp/capita)` }
    const u = unhcr.get(c.id) ?? { refugees: 0, idps: 0, asylum: 0 }
    for (const k of ['refugees', 'idps', 'asylumSeekers']) prov[k] = unhcr.has(c.id) ? { kind: 'SOURCED', url: 'https://www.unhcr.org/refugee-statistics/', note: 'UNHCR population statistics, end 2024, by country of asylum' } : { kind: 'ESTIMATE', note: 'not in the UNHCR table, taken as 0' }
    const d = disp.get(c.id)
    prov.disasterDisplacedYear = d ? { kind: 'SOURCED', url: `https://data.worldbank.org/indicator/${DISP}`, note: `IDMC new disaster displacements, ${d.date}` } : { kind: 'ESTIMATE', note: 'missing, taken as 0' }
    // ~22% of refugees live in planned or managed camps (UNHCR Global Trends); IDP camp share ESTIMATE 25% (IDMC: most live with hosts or rent)
    const campResidents = 0.22 * u.refugees + 0.25 * u.idps
    prov.campResidents = { kind: 'ESTIMATE', url: 'https://www.unhcr.org/global-trends', note: '22% of refugees (UNHCR) + 25% of IDPs (ESTIMATE) in camps' }
    // household size ESTIMATE from fertility and rurality (UN DESA household database pattern: japan ~2.2, us ~2.5, nigeria ~4.9)
    const householdSize = clamp(1.3 + 0.7 * c.tfr + 1.0 * (1 - c.urban), 1.8, 7)
    prov.householdSize = { kind: 'ESTIMATE', url: 'https://www.un.org/development/desa/pd/data/household-size-and-composition', note: '1.3 + 0.7 tfr + (1 - urban share)' }
    // renter share of households ESTIMATE: renting is mostly urban (UN-Habitat, Rental Housing 2003: about a third of urban households rent)
    const renterShare = clamp(0.08 + 0.4 * c.urban * (gdppc > 30000 ? 1.1 : 0.9), 0.05, 0.6)
    prov.renterShare = { kind: 'ESTIMATE', url: 'https://unhabitat.org/rental-housing-the-neglected-option-for-developing-countries', note: '0.08 + ~0.4 x urban share' }
    return { id: c.id, slumUrbanShare: r(slumShare, 4), refugees: u.refugees, idps: u.idps, asylumSeekers: u.asylum, disasterDisplacedYear: d?.value ?? 0, campResidents: Math.round(campResidents), householdSize: r(householdSize, 2), renterShare: r(renterShare, 3), provenance: prov }
  })
  const file = path.join('data', 'geo', 'housing.json')
  fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), note: 'housing starting point per country, see data/geo/sources.md', slumFit: { a: r(a0, 3), b: r(b, 3), n: pts.length, note: 'urban slum % = a + b log10(gdp per capita), least squares over sourced countries' }, countries: out }))
  const tot = (k: 'refugees' | 'idps' | 'campResidents') => out.reduce((a, x) => a + x[k], 0)
  console.log(`housing: ${out.length} countries, slum sourced ${pts.length}, refugees ${(tot('refugees') / 1e6).toFixed(1)}M, idps ${(tot('idps') / 1e6).toFixed(1)}M, camps ${(tot('campResidents') / 1e6).toFixed(1)}M, ${(fs.statSync(file).size / 1e3).toFixed(0)} KB`)
}
main().catch(e => { console.error(e); process.exit(1) })
