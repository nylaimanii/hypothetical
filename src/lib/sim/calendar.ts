// real holidays for any year 2026-2126, computed (no lookup tables to run out): fixed civil dates, Easter (Gregorian
// and Orthodox computus), Islamic holidays (tabular hijri calendar, can be a day off the moon-sighted date), Lunar
// New Year, Diwali, Vesak and Holi from mean lunar phases with Meeus' main periodic terms (Astronomical Algorithms
// ch. 49, error well under a day), Passover by Gauss' formula, plus national days of the most populous countries.
// pure functions: nothing here changes sim state.
import { DAILY } from './daily'

export type Holiday = { month: number; day: number; name: string; kind: 'civil' | 'christian' | 'muslim' | 'hindu' | 'buddhist' | 'jewish' | 'lunar' | 'national' }
const ymd = (d: Date) => ({ month: d.getUTCMonth() + 1, day: d.getUTCDate() })
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000)

// Easter, Gregorian (anonymous computus) and Julian (Meeus) shifted to the Gregorian calendar
function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1
  return utc(y, month, day)
}
function orthodoxEaster(y: number): Date {
  const a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7
  const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1
  const julianToGreg = Math.floor(y / 100) - Math.floor(y / 400) - 2 // 13 days in 1900-2099, 14 from 2100
  return addDays(utc(y, month, day), julianToGreg)
}
// tabular islamic calendar: julian day of (year, month, day) hijri
const hijriJd = (y: number, m: number, d: number) => d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + 1948439.5 - 1
const jdDate = (jd: number) => new Date((jd - 2440587.5) * 86400000)
function islamic(y: number): Holiday[] {
  const out: Holiday[] = []
  for (let hy = Math.floor((y - 622) * 33 / 32) - 1; hy <= Math.floor((y - 622) * 33 / 32) + 2; hy++) {
    for (const [m, d, name] of [[1, 1, 'Islamic New Year'], [9, 1, 'start of Ramadan'], [10, 1, 'Eid al-Fitr'], [12, 10, 'Eid al-Adha']] as const) {
      const dt = jdDate(hijriJd(hy, m, d) + 0.5)
      if (dt.getUTCFullYear() === y) out.push({ ...ymd(dt), name, kind: 'muslim' })
    }
  }
  return out
}
// moon phases (Meeus ch. 49): phase 0 new, 0.5 full. returns the julian ephemeris day of lunation k + phase
function moonPhase(k: number): number {
  const T = k / 1236.85
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T
  const rad = Math.PI / 180
  const M = (2.5534 + 29.1053567 * k) * rad, Mp = (201.5643 + 385.81693528 * k) * rad, F = (160.7108 + 390.67050284 * k) * rad, E = 1 - 0.002516 * T
  const full = Math.abs((k % 1 + 1) % 1 - 0.5) < 0.01
  jde += full
    ? -0.40614 * Math.sin(Mp) + 0.17302 * E * Math.sin(M) + 0.01614 * Math.sin(2 * Mp) + 0.01043 * Math.sin(2 * F) + 0.00734 * E * Math.sin(Mp - M) - 0.00515 * E * Math.sin(Mp + M)
    : -0.4072 * Math.sin(Mp) + 0.17241 * E * Math.sin(M) + 0.01608 * Math.sin(2 * Mp) + 0.01039 * Math.sin(2 * F) + 0.00739 * E * Math.sin(Mp - M) - 0.00514 * E * Math.sin(Mp + M)
  return jde
}
// new or full moons (local date at a utc offset in hours) between two dates
function phasesBetween(a: Date, b: Date, phase: 0 | 0.5, tz: number): Date[] {
  const out: Date[] = []
  const k0 = Math.floor((a.getUTCFullYear() + a.getUTCMonth() / 12 - 2000) * 12.3685) - 2
  for (let k = k0; k < k0 + 20; k++) {
    const d = jdDate(moonPhase(k + phase) + tz / 24)
    const day = utc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    if (day >= a && day <= b) out.push(day)
  }
  return out
}
function lunar(y: number): Holiday[] {
  const out: Holiday[] = []
  // Lunar New Year: second new moon after the december solstice, china time (usually 21 jan - 20 feb)
  const nm = phasesBetween(utc(y - 1, 12, 21), utc(y, 3, 1), 0, 8)
  if (nm[1]) out.push({ ...ymd(nm[1]), name: 'Lunar New Year', kind: 'lunar' })
  // Diwali (Lakshmi Puja): the evening when the amavasya tithi of Kartika is in force at sunset. the tithi runs about
  // 23.6 hours up to the new moon, so it is the day of (new moon - 18:00 IST) in india time
  for (let k = Math.floor((y - 2000) * 12.3685) + 7; k < Math.floor((y - 2000) * 12.3685) + 13; k++) {
    const ist = jdDate(moonPhase(k) + 5.5 / 24 - 18 / 24)
    const d = utc(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate())
    if (d >= utc(y, 10, 16) && d <= utc(y, 11, 14)) { out.push({ ...ymd(d), name: 'Diwali', kind: 'hindu' }); break }
  }
  // Holi: the day of the Phalguna full moon, 25 feb - 25 mar, india time (Holika Dahan is the evening before)
  const ho = phasesBetween(utc(y, 2, 25), utc(y, 3, 25), 0.5, 5.5)
  if (ho[0]) out.push({ ...ymd(ho[0]), name: 'Holi', kind: 'hindu' })
  // Vesak: first full moon of may (theravada), sri lanka time
  const vs = phasesBetween(utc(y, 4, 30), utc(y, 5, 31), 0.5, 5.5)
  if (vs[0]) out.push({ ...ymd(vs[0]), name: 'Vesak', kind: 'buddhist' })
  return out
}
// Passover (15 Nisan) by Gauss' formula; Rosh Hashanah of the next jewish year is 163 days later, Yom Kippur 10 days after that
function passover(y: number): Date {
  const a = (12 * y + 12) % 19, b = y % 4
  const m = 20.0955877 + 1.5542418 * a + 0.25 * b - 0.003177794 * y
  let M = Math.floor(m), md = m - M
  const c = (M + 3 * y + 5 * b + 1) % 7
  if (c === 2 || c === 4 || c === 6) M += 1
  else if (c === 1 && a > 6 && md >= 1367 / 2160) M += 2
  else if (c === 0 && a > 11 && md >= 23269 / 25920) M += 1
  const julianToGreg = Math.floor(y / 100) - Math.floor(y / 400) - 2
  return addDays(utc(y, 3, 1), M - 1 + julianToGreg)
}
function jewish(y: number): Holiday[] {
  const p = passover(y), rh = addDays(p, 163)
  return [{ ...ymd(p), name: 'Passover', kind: 'jewish' }, { ...ymd(rh), name: 'Rosh Hashanah', kind: 'jewish' }, { ...ymd(addDays(rh, 9)), name: 'Yom Kippur', kind: 'jewish' }]
}
// national days of the most populous countries and their best-known civic holidays (Wikipedia, "Public holidays in <country>")
const NATIONAL: Record<string, [number, number, string][]> = {
  USA: [[7, 4, 'Independence Day']], CHN: [[10, 1, 'National Day']], IND: [[1, 26, 'Republic Day'], [8, 15, 'Independence Day']], IDN: [[8, 17, 'Independence Day']],
  PAK: [[8, 14, 'Independence Day']], NGA: [[10, 1, 'Independence Day']], BRA: [[9, 7, 'Independence Day']], BGD: [[3, 26, 'Independence Day']], RUS: [[6, 12, 'Russia Day']],
  MEX: [[9, 16, 'Independence Day']], JPN: [[2, 11, 'National Foundation Day']], ETH: [[9, 11, 'Enkutatash']], PHL: [[6, 12, 'Independence Day']], EGY: [[7, 23, 'Revolution Day']],
  VNM: [[9, 2, 'National Day']], COD: [[6, 30, 'Independence Day']], TUR: [[10, 29, 'Republic Day']], IRN: [[3, 21, 'Nowruz']], DEU: [[10, 3, 'German Unity Day']],
  THA: [[4, 13, 'Songkran']], GBR: [[12, 26, 'Boxing Day']], FRA: [[7, 14, 'Bastille Day']], ZAF: [[4, 27, 'Freedom Day']], TZA: [[12, 9, 'Independence Day']],
  KEN: [[12, 12, 'Jamhuri Day']], KOR: [[8, 15, 'Liberation Day']], COL: [[7, 20, 'Independence Day']], ARG: [[5, 25, 'May Revolution']], CAN: [[7, 1, 'Canada Day']], AUS: [[1, 26, 'Australia Day']],
}
const ORTHODOX = new Set(['RUS', 'UKR', 'GRC', 'SRB', 'ROU', 'BGR', 'GEO', 'BLR', 'MDA', 'MKD', 'MNE', 'CYP', 'ETH', 'ARM'])
const LUNAR_NY = new Set(['CHN', 'TWN', 'HKG', 'MAC', 'SGP', 'KOR', 'PRK', 'VNM', 'MYS', 'IDN', 'MNG', 'BRN', 'PHL'])

const cache = new Map<string, Holiday[]>()
// holidays a country keeps in a year: its national days, the holidays of every faith that is at least ~10% of the
// country (Pew 2020), New Year and Labour Day nearly everywhere, Thanksgiving in the US
export function holidaysOf(countryId: string, y: number): Holiday[] {
  const key = `${countryId}:${y}`
  const hit = cache.get(key)
  if (hit) return hit
  const f = DAILY.get(countryId)?.faiths ?? { christian: 0.3, muslim: 0.25, hindu: 0.1, buddhist: 0.05, jewish: 0, other: 0.1, unaffiliated: 0.2 }
  const out: Holiday[] = [{ month: 1, day: 1, name: "New Year's Day", kind: 'civil' }]
  if (!['USA', 'CAN', 'JPN', 'AUS', 'NZL', 'ISR', 'SAU', 'ARE', 'QAT', 'KWT', 'BHR', 'OMN', 'GBR'].includes(countryId)) out.push({ month: 5, day: 1, name: 'Labour Day', kind: 'civil' })
  if (f.christian >= 0.1) {
    const e = ORTHODOX.has(countryId) ? orthodoxEaster(y) : easter(y)
    out.push({ ...ymd(addDays(e, -2)), name: 'Good Friday', kind: 'christian' }, { ...ymd(e), name: 'Easter', kind: 'christian' })
    out.push(ORTHODOX.has(countryId) ? { month: 1, day: 7, name: 'Orthodox Christmas', kind: 'christian' } : { month: 12, day: 25, name: 'Christmas', kind: 'christian' })
  }
  if (f.muslim >= 0.1) out.push(...islamic(y))
  if (f.hindu >= 0.1) out.push(...lunar(y).filter(h => h.kind === 'hindu'))
  if (f.buddhist >= 0.1) out.push(...lunar(y).filter(h => h.kind === 'buddhist'))
  if (f.jewish >= 0.1) out.push(...jewish(y))
  if (LUNAR_NY.has(countryId)) out.push(...lunar(y).filter(h => h.kind === 'lunar'))
  if (countryId === 'USA') { const nov1 = utc(y, 11, 1).getUTCDay(); out.push({ month: 11, day: 1 + ((4 - nov1 + 7) % 7) + 21, name: 'Thanksgiving', kind: 'national' }) }
  for (const [m, d, name] of NATIONAL[countryId] ?? []) out.push({ month: m, day: d, name, kind: 'national' })
  out.sort((a, b) => a.month - b.month || a.day - b.day)
  if (cache.size > 5000) cache.clear()
  cache.set(key, out)
  return out
}
// the date a frame's typical day stands for: the 15th of the tick's month (same day the weather uses)
export function frameDate(tick: number, day = 15): Date { return utc(2026 + Math.floor((10 + tick) / 12), ((10 + tick) % 12) + 1, day) }
export function holidayOn(countryId: string | undefined, date: Date): Holiday | undefined {
  if (!countryId) return undefined
  return holidaysOf(countryId, date.getUTCFullYear()).find(h => h.month === date.getUTCMonth() + 1 && h.day === date.getUTCDate())
}
