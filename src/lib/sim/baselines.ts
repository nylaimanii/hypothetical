// real projected reality: UN World Population Prospects 2024 (medium variant) per country and for the world, 2026-2100.
// pure (a json import, no sim state): compare any world with what the UN projects for the same year.
// energy projections (IEA WEO) are not openly licensed per country, so they are not baked here.
import wpp from '../../../data/geo/wpp.json'

type Series = { pop: number[]; le: number[]; births: number[]; deaths: number[] }
const W = wpp as unknown as { years: [number, number]; series: Record<string, Series> }
// the UN projection for a year (2026-2100) and a country iso3 code ('WORLD' for the world); undefined outside the range
export function wppAt(year: number, code = 'WORLD'): { population?: number; lifeExpectancy?: number; births?: number; deaths?: number } | undefined {
  const s = W.series[code]
  const i = Math.round(year) - W.years[0]
  if (!s || i < 0 || year > W.years[1]) return undefined
  return { population: s.pop[i], lifeExpectancy: s.le[i], births: s.births[i], deaths: s.deaths[i] }
}
export const WPP_SOURCE = 'UN World Population Prospects 2024, medium variant (https://population.un.org/wpp/), via Our World in Data'
