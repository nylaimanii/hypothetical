// assumptions: every tunable rule of the sim lives in data/assumptions.json with a plain-words name, value, unit,
// source and range. a world carries its own set (w.assumptions), the sim reads them through A(w, id), and runWorld
// takes overrides, so anyone can change an assumption and rerun the same seed. pure: no sim state imports.
import data from '../../../data/assumptions.json'

export type Assumption = { id: string; label: string; value: number; unit: string; source: string; min: number; max: number; file: string }
export const ASSUMPTIONS: Assumption[] = (data as unknown as { assumptions: Assumption[] }).assumptions
const BY_ID = new Map(ASSUMPTIONS.map(a => [a.id, a]))
export const DEFAULTS: Record<string, number> = Object.fromEntries(ASSUMPTIONS.map(a => [a.id, a.value]))

export type Clamped = { id: string; asked: number; used: number; min: number; max: number }
// validate overrides: unknown ids and non-numbers throw (with a message for people); values outside the range are
// clamped to it and reported, never silently changed
export function assumptionsFor(overrides: Record<string, number> = {}): { values: Record<string, number>; overridden: Record<string, number>; clamped: Clamped[] } {
  const values = { ...DEFAULTS }, overridden: Record<string, number> = {}, clamped: Clamped[] = []
  for (const [id, v] of Object.entries(overrides)) {
    const a = BY_ID.get(id)
    if (!a) throw new Error(`unknown assumption "${id}" (see GET /api/assumptions for the list)`)
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`assumption "${id}" needs a number, got ${JSON.stringify(v)}`)
    const used = Math.min(a.max, Math.max(a.min, v))
    if (used !== v) clamped.push({ id, asked: v, used, min: a.min, max: a.max })
    values[id] = used
    overridden[id] = used
  }
  return { values, overridden, clamped }
}

// read one assumption for a world (falls back to the default for worlds made before assumptions existed)
export function A(w: { assumptions?: Record<string, number> }, id: string): number {
  const v = w.assumptions?.[id] ?? DEFAULTS[id]
  if (v === undefined) throw new Error(`assumption "${id}" is not in data/assumptions.json`)
  return v
}
