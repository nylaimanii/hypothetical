// agent names: mutations count up ("halcyon ii", "halcyon iii"), crossovers join roots ("meridian × kestrel").
// ids are url-safe slugs of the name.

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
export function roman(n: number): string {
  let out = ''
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v }
  return out
}

// "halcyon iii" -> "halcyon"
export const rootName = (name: string) => name.replace(/ [ivxlcdm]+$/, '')
// "meridian × kestrel ii" -> "meridian"
const firstRoot = (name: string) => rootName(name).split(' × ')[0]

export function slug(name: string): string {
  return name.toLowerCase().replace(/ × /g, '-x-').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 70)
}

function nextFree(base: string, taken: Set<string>, startAt: number): string {
  if (startAt <= 1 && !taken.has(base)) return base
  for (let k = Math.max(2, startAt); ; k++) {
    const n = `${base} ${roman(k)}`
    if (!taken.has(n)) return n
  }
}

export function mutationName(parent: string, taken: Set<string>): string {
  return nextFree(rootName(parent), taken, 2)
}

export function crossoverName(a: string, b: string, taken: Set<string>): string {
  return nextFree(`${firstRoot(a)} × ${firstRoot(b)}`, taken, 1)
}
