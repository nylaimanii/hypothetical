// generation names by birth year. pure (no sim state), so the ui can import it through replay-pure.ts.
// Pew Research Center definitions up to Gen Z (https://www.pewresearch.org/short-reads/2019/01/17/where-millennials-end-and-generation-z-begins/),
// McCrindle's Gen Alpha (2010s-2024) and Gen Beta (2025-2039); later generations carry on the greek letters every 15 years
const GENS: [number, string][] = [
  [1927, 'Greatest'], [1945, 'Silent'], [1964, 'Boomers'], [1980, 'Gen X'], [1996, 'Millennials'], [2012, 'Gen Z'], [2024, 'Gen Alpha'], [2039, 'Gen Beta'],
]
const LATER = ['Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa']
export function generationOf(birthYear: number): string {
  for (const [end, name] of GENS) if (birthYear <= end) return name
  return `Gen ${LATER[Math.min(LATER.length - 1, Math.floor((birthYear - 2040) / 15))]}`
}
