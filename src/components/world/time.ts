import * as THREE from 'three'
import { latLonToVec3 } from './lib'

// tick 0 = 2026-11-01 00:00 utc. fractional ticks interpolate through the month, so the clock runs smoothly
export function tickToDate(tick: number) {
  const m = Math.floor(tick)
  const start = Date.UTC(2026, 10 + m, 1)
  const next = Date.UTC(2026, 11 + m, 1)
  return new Date(start + (next - start) * (tick - m))
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')

// "tue mar 14 2031" and "09:42" (utc)
export function formatDay(d: Date) {
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`
}
export const formatTime = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`

// subsolar point: declination from day of year, longitude from utc time (equation of time ignored, under 17 minutes)
export function sunDirection(d: Date, out = new THREE.Vector3()) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0)
  const doy = (d.getTime() - start) / 86400000
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10))
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600
  const lon = -15 * (hours - 12)
  return latLonToVec3(decl, lon, 1, out)
}
