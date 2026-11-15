// history-book headlines for significant events (significance >= 0.6). templates only, no llm calls.
import type { WorldEvent } from '../types'

export const HEADLINE_MIN = 0.6

const pickBy = (seed: number, arr: string[]) => arr[Math.abs(seed) % arr.length]

export function headlineFor(e: WorldEvent, regionName: string | undefined, year: number): string {
  // markers like [frontier: x] are for machines, not headlines
  e = { ...e, text: e.text.replace(/ \[[a-z ]+: [^\]]+\]$/, '') }
  const t = e.text.toLowerCase()
  const where = regionName ? regionName.toLowerCase() : 'world'
  const h = e.tick * 31 + e.text.length
  const big = e.severity >= 0.8 ? 'great ' : ''
  switch (e.kind) {
    case 'famine': return pickBy(h, [`the ${big}${where} famine of ${year}`, `the hungry year of ${year}`, `the ${big}grain crisis of ${year}`])
    case 'pandemic': return pickBy(h, [`the ${year} pandemic`, `the ${big}plague year of ${year}`, `the ${where} fever of ${year}`])
    case 'war': return /coup/.test(t) ? `the officers' revolt of ${year}` : pickBy(h, [`the war of secession, ${year}`, `the ${where} war of ${year}`])
    case 'revolt':
      if (/seceded/.test(t)) return `the ${where} secession of ${year}`
      if (/moral panic/.test(t)) return `the ${where} panic of ${year}`
      if (/strike/.test(t)) return `the general strike of ${year}`
      if (/approval collapses/.test(t)) return `the ${where} awakening of ${year}`
      return `the ${where} uprising of ${year}`
    case 'disaster':
      if (/panic buying/.test(t)) return `the great ${where} panic of ${year}`
      if (/drought/.test(t)) return `the ${big}${where} drought of ${year}`
      if (/collapses/.test(t)) return `the crash of ${year}`
      return `the ${where} catastrophe of ${year}`
    case 'launch':
      if (/fail/.test(t)) return /crew|killed/.test(t) ? `the ${year} launch disaster` : `the failed launch of ${year}`
      if (/moon/.test(t)) return `the return to the moon, ${year}`
      if (/mars/.test(t)) return /lands|land on/.test(t) ? `the mars landing of ${year}` : `the long voyage of ${year}`
      return `the launch of ${year}`
    case 'breakthrough':
      if (t.startsWith('breakthrough: ')) return `the ${e.text.slice('breakthrough: '.length).toLowerCase()} breakthrough of ${year}`
      if (/walk on the moon/.test(t)) return `the return to the moon, ${year}`
      if (/lunar base/.test(t)) return `the first lunar base, ${year}`
      if (/lands on mars/.test(t)) return `the first mars landing, ${year}`
      if (/no longer needs earth/.test(t)) return `the independence of mars, ${year}`
      if (/settlement passes/.test(t)) return `the mars settlement, ${year}`
      if (/asteroid reaches orbit/.test(t)) return `the first asteroid ore, ${year}`
      if (/jupiter/.test(t)) return `the outer outpost, ${year}`
      if (/eradicated/.test(t)) return `the end of ${t.split(' is eradicated')[0]}, ${year}`
      if (/chartered/.test(t)) return `the founding of ${e.text.split(' chartered')[0].toLowerCase()}, ${year}`
      return `the breakthrough of ${year}`
    case 'migration': return `the ${where} exodus of ${year}`
    case 'law': return `the ${e.text.replace(/^(enacted|repealed): /, '').replace(/ \(.*\)$/, '').toLowerCase()} of ${year}`
    case 'override': return `the hand from outside, ${year}`
    case 'injected': return `the ${where} shock of ${year}`
    default: return `the events of ${year}`
  }
}
