// reality check: does the no-ai twin (2026 policies frozen) track the real world as new data comes out?
// compares the twin's yearly numbers against published data (world bank, which mirrors the un population
// estimates; faostat food supply via our world in data) for every year from 2026 that has real data, and, until
// such data exists, checks the starting point against the latest published year. when the twin drifts past a
// threshold it flags the ESTIMATE parameters in B's src/lib/sim/constants.ts that drive that stat.
// runs monthly from the evolve watchdog and on demand (npm run reality-check). writes data/reality-check.json.
// the twin only carries population and food per region, so life expectancy, gdp and energy are listed as not
// comparable rather than guessed.
import fs from 'node:fs'
import path from 'node:path'
import type { BaselineFrame, RunRecord } from '../types'
import { dirs, readJson, readRunIndex, writeJson } from './store'
import { codeRoot } from './version'
import { populationOf } from './facts'

const file = () => path.join(process.cwd(), 'data', 'reality-check.json')
const START_YEAR = 2026

type Source = { name: string; url: string }
export type RealityRow = {
  stat: 'population' | 'foodKcalPerCapita'
  year: number; kind: 'start' | 'trajectory'
  twin: number; real: number; drift: number // (twin - real) / real
  flagged: boolean; source: Source
}
export type ParamFlag = { name: string; value: string; note: string; stat: RealityRow['stat'] }
export type RealityCheck = {
  checkedAt: string; twinFrom: string | null
  latestRealYear: Partial<Record<RealityRow['stat'], number>>
  rows: RealityRow[]
  flags: ParamFlag[]
  notComparable: string[]
  errors: string[]
}

const THRESHOLD: Record<RealityRow['stat'], number> = { population: 0.01, foodKcalPerCapita: 0.03 }
// which tunable constants drive each stat (matched against names and their ESTIMATE notes)
const DRIVERS: Record<RealityRow['stat'], RegExp> = {
  population: /TFR|FERTIL|GOMPERTZ|MORTAL|BIRTH|DEATH|LIFE/i,
  foodKcalPerCapita: /YIELD|KCAL|FOOD|FARM|CROP|SURVIVAL/i,
}

const WB = (indicator: string) => `https://api.worldbank.org/v2/country/WLD/indicator/${indicator}?format=json&date=2015:2035&per_page=100`
const OWID_KCAL = 'https://ourworldindata.org/grapher/daily-per-capita-caloric-supply.csv?v=1&csvType=filtered&useColumnShortNames=true&country=~OWID_WRL'

// the world bank api is slow at times: one minute per try, two tries
async function getJson(url: string): Promise<unknown> {
  let last: unknown
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { 'user-agent': 'hypothetical reality-check' } })
      if (!r.ok) throw new Error(`${r.status} from ${url}`)
      return await r.json()
    } catch (e) { last = e }
  }
  throw last
}

async function worldBank(indicator: string): Promise<Map<number, number>> {
  const j = (await getJson(WB(indicator))) as [unknown, { date: string; value: number | null }[] | null]
  return new Map((j[1] ?? []).filter(x => x.value !== null).map(x => [Number(x.date), x.value as number]))
}

async function owidKcal(): Promise<Map<number, number>> {
  const r = await fetch(OWID_KCAL, { signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`${r.status} from our world in data`)
  const [head, ...lines] = (await r.text()).trim().split('\n')
  const cols = head.split(',')
  const yi = cols.indexOf('year'), vi = cols.findIndex(c => /calor|kcal/i.test(c))
  const out = new Map<number, number>()
  for (const l of lines) {
    const c = l.split(',')
    if (c[0] === 'World' && vi >= 0) out.set(Number(c[yi]), Number(c[vi]))
  }
  return out
}

// the newest record with a full twin (the twin ignores the ai, so any run will do): evolve's runs first,
// then any record in data/runs
function latestTwin(): { runId: string; baseline: BaselineFrame[] } | null {
  const indexed = [...readRunIndex()].reverse().map(r => r.runId)
  let files: string[] = []
  try {
    files = fs.readdirSync(dirs.runs).filter(f => /\.json$/.test(f) && !/^(index|features)\.json$|\.lives\.json$/.test(f))
      .sort((a, b) => fs.statSync(path.join(dirs.runs, b)).mtimeMs - fs.statSync(path.join(dirs.runs, a)).mtimeMs).map(f => f.replace(/\.json$/, ''))
  } catch {}
  for (const id of [...indexed, ...files.filter(f => !indexed.includes(f))]) {
    const rec = readJson<RunRecord>(path.join(dirs.runs, `${id}.json`))
    if (rec?.baseline?.length && rec.baseline[rec.baseline.length - 1].tick >= 120) return { runId: rec.runId, baseline: rec.baseline }
  }
  return null
}

// twin value for a calendar year: the frame nearest mid-year (tick 0 = 2026-11)
function twinAt(baseline: BaselineFrame[], year: number) {
  const target = (year - START_YEAR) * 12 - 4
  const f = [...baseline].sort((a, b) => Math.abs(a.tick - Math.max(0, target)) - Math.abs(b.tick - Math.max(0, target)))[0]
  if (!f) return null
  const pop = populationOf(f)
  const kcal = pop ? f.regions.reduce((a, r) => a + r.foodKcalPerCapita * r.population, 0) / pop : 0
  return { population: pop, foodKcalPerCapita: kcal, tick: f.tick }
}

function estimateParams(): { name: string; value: string; note: string }[] {
  const p = path.join(codeRoot(), 'src', 'lib', 'sim', 'constants.ts')
  if (!fs.existsSync(p)) return []
  const lines = fs.readFileSync(p, 'utf8').split('\n')
  const out: { name: string; value: string; note: string }[] = []
  lines.forEach((l, i) => {
    const m = /export const (\w+)\s*(?::[^=]+)?=\s*([^/\n]+)/.exec(l)
    if (!m) return
    const notes = lines.slice(Math.max(0, i - 3), i + 1).join(' ')
    if (/ESTIMATE/.test(notes)) out.push({ name: m[1], value: m[2].trim(), note: (notes.match(/ESTIMATE[^]*$/)?.[0] ?? '').replace(/\/\/\s*/g, '').replace(/export const.*$/, '').trim().slice(0, 200) })
  })
  return out
}

export async function runRealityCheck(): Promise<RealityCheck> {
  const errors: string[] = []
  const twin = latestTwin()
  const real: Partial<Record<RealityRow['stat'], { data: Map<number, number>; source: Source }>> = {}
  try { real.population = { data: await worldBank('SP.POP.TOTL'), source: { name: 'World Bank, population, total (UN WPP based)', url: 'https://data.worldbank.org/indicator/SP.POP.TOTL' } } } catch (e) { errors.push(`population: ${(e as Error).message}`) }
  try { real.foodKcalPerCapita = { data: await owidKcal(), source: { name: 'FAOSTAT food balances via Our World in Data', url: 'https://ourworldindata.org/grapher/daily-per-capita-caloric-supply' } } } catch (e) { errors.push(`food supply: ${(e as Error).message}`) }

  const rows: RealityRow[] = []
  const latestRealYear: RealityCheck['latestRealYear'] = {}
  if (!twin) errors.push('no run with a twin yet')
  for (const stat of ['population', 'foodKcalPerCapita'] as const) {
    const src = real[stat]
    if (!src || !twin) continue
    const years = [...src.data.keys()].sort((a, b) => a - b)
    latestRealYear[stat] = years[years.length - 1]
    const after = years.filter(y => y >= START_YEAR)
    // trajectory years once real data from the sim period exists; until then, check the starting point
    const check = after.length ? after.map(y => ({ y, kind: 'trajectory' as const })) : years.length ? [{ y: years[years.length - 1], kind: 'start' as const }] : []
    for (const { y, kind } of check) {
      const t = twinAt(twin.baseline, kind === 'start' ? START_YEAR : y)
      const r = src.data.get(y)
      if (!t || !r) continue
      const drift = (t[stat] - r) / r
      rows.push({ stat, year: y, kind, twin: Math.round(t[stat]), real: Math.round(r), drift: Math.round(drift * 10000) / 10000, flagged: Math.abs(drift) > THRESHOLD[stat], source: src.source })
    }
  }
  const params = estimateParams()
  const flagged = new Set(rows.filter(r => r.flagged).map(r => r.stat))
  const flags: ParamFlag[] = [...flagged].flatMap(stat => params.filter(p => DRIVERS[stat].test(`${p.name} ${p.note}`)).map(p => ({ ...p, stat })))
  const out: RealityCheck = {
    checkedAt: new Date().toISOString(), twinFrom: twin?.runId ?? null, latestRealYear, rows, flags,
    notComparable: ['life expectancy, gdp and energy: the twin only records population and food per region'],
    errors,
  }
  writeJson(file(), out)
  return out
}

export function readRealityCheck(): RealityCheck | null {
  return readJson<RealityCheck>(file())
}

// monthly: due when there is no check yet or the last one is 30+ days old
export function realityCheckDue(now = Date.now()): boolean {
  const last = readRealityCheck()
  return !last || now - Date.parse(last.checkedAt) >= 30 * 864e5
}
