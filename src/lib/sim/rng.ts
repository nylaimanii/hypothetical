// seeded rng only. mulberry32, plus independent named streams so that one subsystem drawing more or
// fewer numbers (because of different policy) never shifts the draws of another. the events stream
// is policy-independent, so the ai world and its no-ai twin face the same disasters.

// an rng is a function with its 32-bit state exposed as .s, so a world can be snapshotted and resumed exactly
export type Rng = (() => number) & { s: number }

export function mulberry32(seed: number): Rng {
  const f = (() => {
    f.s = (f.s + 0x6d2b79f5) | 0
    let t = Math.imul(f.s ^ (f.s >>> 15), 1 | f.s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }) as Rng
  f.s = seed >>> 0
  return f
}

// restore an rng from a saved state (the state is the value after the last draw)
export function rngFromState(state: number): Rng {
  const f = mulberry32(0)
  f.s = state
  return f
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function stream(seed: number, name: string): Rng {
  return mulberry32((seed ^ hashString(name)) >>> 0)
}

export function normal(rng: () => number): number {
  // box-muller
  const u = Math.max(rng(), 1e-12)
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function pickWeighted<T extends string | number>(rng: () => number, weights: Record<string, number> | number[], keys?: T[]): T {
  const entries: [T, number][] = Array.isArray(weights)
    ? weights.map((w, i) => [(keys ? keys[i] : i) as T, w])
    : Object.entries(weights).map(([k, w]) => [k as T, w])
  const total = entries.reduce((a, [, w]) => a + Math.max(0, w), 0)
  let x = rng() * total
  for (const [k, w] of entries) {
    x -= Math.max(0, w)
    if (x <= 0) return k
  }
  return entries[entries.length - 1][0]
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length]
}
