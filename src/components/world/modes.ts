// v3 overlay modes: one color per region for each mode, plus a legend in plain words.
// shared by the planet (tile colors) and the ui (legend). ember only where something is dangerous.
import type { Country, Emotion, Frame, Mood, PlaceStats, Region } from '@/lib/types'
import type { Overlay } from '../state/store'

export const EMOTION_HEX: Record<Emotion, string> = {
  joy: '#F2C94C', fear: '#7E6BB0', anger: '#F29E38', hope: '#7FC7A4', grief: '#5B6F8A',
  pride: '#C7A44A', envy: '#8DBF5A', boredom: '#B8B2A6', awe: '#6FB7E0', distrust: '#8A6B5A',
}
// same validated palette as the graphs view, so a color means one source everywhere
export const ENERGY_HEX = { solar: '#eda100', wind: '#1baf7a', nuclear: '#e87ba4', fossil: '#6250d6', hydro: '#2a78d6' } as const
export type EnergyKey = keyof typeof ENERGY_HEX
const COLOR_WORD: Record<Emotion, string> = {
  joy: 'yellow', fear: 'violet', anger: 'orange', hope: 'mint', grief: 'slate blue', pride: 'gold', envy: 'green', boredom: 'grey', awe: 'sky blue', distrust: 'brown',
}

export function dominantOf(m: Mood | undefined): { emotion: Emotion; level: number } | null {
  if (!m) return null
  let best: Emotion = 'joy', v = -1
  for (const k of Object.keys(m) as Emotion[]) if (m[k] > v) { v = m[k]; best = k }
  return { emotion: best, level: v }
}

export function regionMood(f: Frame, r: Region): Mood | undefined {
  if (r.emotionMix) return r.emotionMix
  const here = f.citizens.filter((c) => c.regionId === r.id)
  if (!here.length) return undefined
  const m = {} as Mood
  for (const c of here) for (const k of Object.keys(c.mood) as Emotion[]) m[k] = (m[k] ?? 0) + c.mood[k] / here.length
  return m
}

export function topEnergy(r: Region): { key: EnergyKey; share: number } | null {
  const mix = r.visual?.energyMix
  if (!mix) return null
  const key = (Object.keys(mix) as EnergyKey[]).reduce((a, b) => (mix[b] > mix[a] ? b : a))
  return { key, share: mix[key] }
}

// mix the energy colors by share, so a mostly-solar region reads yellow and a mixed one reads in between
export function energyColor(r: Region): string | null {
  const mix = r.visual?.energyMix
  if (!mix) return null
  let R = 0, G = 0, B = 0
  for (const k of Object.keys(mix) as EnergyKey[]) {
    const h = parseInt(ENERGY_HEX[k].slice(1), 16)
    R += ((h >> 16) & 255) * mix[k]; G += ((h >> 8) & 255) * mix[k]; B += (h & 255) * mix[k]
  }
  return `#${[R, G, B].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

// damage heatmap: pale bone, through ash, to ember for the worst
export function damageColor(level: number): string {
  if (level < 0.05) return '#E9E2D2'
  if (level < 0.5) { const t = level / 0.5; return mixHex('#E9E2D2', '#7D746B', t) }
  return mixHex('#7D746B', '#E4572E', (level - 0.5) / 0.5)
}

// population: light to deep ink by people per region
export function populationColor(pop: number, max: number): string {
  return mixHex('#E8E1D3', '#2D3A44', Math.sqrt(pop / Math.max(1, max)))
}

export function mixHex(a: string, b: string, t: number) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16)
  const c = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t)
  return `#${[c(16), c(8), c(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

// the color a region's land takes in a mode; null means "leave the real look"
export function regionModeColor(mode: Overlay, f: Frame, r: Region): string | null {
  switch (mode) {
    case 'emotion': { const d = dominantOf(regionMood(f, r)); return d ? EMOTION_HEX[d.emotion] : null }
    case 'population': return populationColor(r.population, Math.max(...f.regions.map((x) => x.population)))
    case 'energy': return energyColor(r)
    case 'happiness': case 'economy': case 'livability': case 'trend': return statColor(mode, regionPlaceStats(r))
    case 'damage': return damageColor(r.visual?.damage.level ?? (r.unrest > 0.6 ? r.unrest - 0.4 : 0))
    default: return null
  }
}

export type LegendItem = { color: string; text: string }

// every overlay explains itself in words, built from what is actually on the globe now
export function legendFor(mode: Overlay, f: Frame): { line: string; items: LegendItem[] } {
  if (isStatMode(mode)) return statLegend(mode, f)
  if (mode === 'emotion') {
    const counts = new Map<Emotion, Region[]>()
    for (const r of f.regions) { const d = dominantOf(regionMood(f, r)); if (d) counts.set(d.emotion, [...(counts.get(d.emotion) ?? []), r]) }
    const items = [...counts].sort((a, b) => b[1].length - a[1].length).map(([e, rs]) => {
      const topic = rs.flatMap((r) => r.crowds).sort((a, b) => b.intensity - a.intensity)[0]?.topic
      return { color: EMOTION_HEX[e], text: `${COLOR_WORD[e]} = ${e}${topic ? `, mostly over ${topic}` : ''} (${rs.map((r) => r.name).slice(0, 3).join(', ')}${rs.length > 3 ? '…' : ''})` }
    })
    return { line: 'each region takes the color of what most of its people feel. the pulse is how strongly.', items }
  }
  if (mode === 'population') {
    const top = [...f.regions].sort((a, b) => b.population - a.population)[0]
    return { line: 'taller, darker land holds more people. the number over each region is its population.', items: top ? [{ color: populationColor(1, 1), text: `darkest: ${top.name}` }] : [] }
  }
  if (mode === 'movement') {
    const flows = f.flows ?? []
    return {
      line: flows.length ? 'each stream is people moving this month. thicker carries more. dark slow streams are forced moves.' : 'nobody is moving between regions this month.',
      items: flows.length ? [{ color: '#2D3A44', text: 'chosen move' }, { color: '#1D1B19', text: 'forced move, ordered by the core' }] : [],
    }
  }
  if (mode === 'energy') {
    return {
      line: 'land takes the color of where its power comes from, blended by share.',
      items: (Object.keys(ENERGY_HEX) as EnergyKey[]).map((k) => {
        const n = f.regions.filter((r) => topEnergy(r)?.key === k).length
        return { color: ENERGY_HEX[k], text: n ? `${k}, main source in ${n} region${n === 1 ? '' : 's'}` : k }
      }),
    }
  }
  if (mode === 'damage') {
    const worst = [...f.regions].sort((a, b) => (b.visual?.damage.level ?? 0) - (a.visual?.damage.level ?? 0))[0]
    const lvl = worst?.visual?.damage.level ?? 0
    return {
      line: lvl > 0.05 ? `how broken each region is. worst: ${worst.name}, ${worst.visual?.damage.kind}.` : 'how broken each region is. nothing is broken right now.',
      items: [{ color: damageColor(0), text: 'intact' }, { color: damageColor(0.45), text: 'damaged' }, { color: damageColor(1), text: 'ruined' }],
    }
  }
  return { line: 'the world as it looks: its power, its rail, its towns, its air.', items: [] }
}

export const fmtPeople = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)))

// ---- v4: place stats. countries color their own tiles; tiles of countries the sim doesn't track yet
// fall back to their region's numbers ----
export const STAT_MODES = ['happiness', 'economy', 'livability', 'trend'] as const
export type StatMode = (typeof STAT_MODES)[number]
export const isStatMode = (m: Overlay): m is StatMode => (STAT_MODES as readonly string[]).includes(m)
export const TREND_HEX = { rising: '#5E8C4A', stable: '#B9B2A5', declining: '#E4572E' } as const
const STAT_LOW = '#EFE6D4', STAT_HIGH: Record<'happiness' | 'economy' | 'livability', string> = { happiness: '#C98A1E', economy: '#2F6F8F', livability: '#3E7A4E' }

export function statColor(mode: StatMode, st: PlaceStats): string {
  if (mode === 'trend') return TREND_HEX[st.trend]
  return mixHex(STAT_LOW, STAT_HIGH[mode], Math.max(0, Math.min(1, st[mode])))
}

// a region's numbers in PlaceStats shape, for land no tracked country covers
export function regionPlaceStats(r: Region, prev?: Region): PlaceStats {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const one = (x: Region) => {
    const gdpPc = x.gdpUsd / Math.max(1, x.population)
    const economy = clamp(Math.log10(Math.max(500, gdpPc)) / 5 - 0.35 - (x.visual?.damage.level ?? 0) * 0.4)
    const food = clamp((x.foodKcalPerCapita - 1700) / 1500), safety = clamp(1 - x.unrest * 1.1), health = x.periodLifeExpectancy > 0 ? clamp((x.periodLifeExpectancy - 50) / 40) : 0.5 /* not computed yet (old records' first frame) */
    const air = clamp(1 - (x.visual?.pollution ?? 0.3)), happiness = clamp(x.approval * 0.6 + safety * 0.2 + food * 0.2)
    return { happiness, economy, livability: clamp((happiness + economy + safety + health + air + food) / 6), food, safety, health, air, jobs: clamp(economy * 0.8 + 0.15 - x.unrest * 0.3) }
  }
  const a = one(r), b = prev ? one(prev) : null
  const d = b ? a.happiness + a.economy - b.happiness - b.economy : 0
  return {
    population: r.population, happiness: a.happiness, economy: a.economy, livability: a.livability, trend: d > 0.03 ? 'rising' : d < -0.03 ? 'declining' : 'stable',
    foodSecurity: a.food, safety: a.safety, health: a.health, jobs: a.jobs, housingCost: 2 + a.economy * 6, airQuality: a.air,
  }
}

export function statLegend(mode: StatMode, f: Frame): { line: string; items: LegendItem[] } {
  const cs: Country[] = f.countries ?? []
  if (mode === 'trend') {
    const n = (t: PlaceStats['trend']) => cs.filter((c) => c.stats.trend === t).length
    return {
      line: 'is life getting better here? compared with a year ago, on happiness and the economy together.',
      items: [{ color: TREND_HEX.rising, text: `▲ rising${n('rising') ? `, ${n('rising')} countries` : ''}` }, { color: TREND_HEX.stable, text: 'steady' }, { color: TREND_HEX.declining, text: `▼ declining${n('declining') ? `, ${n('declining')} countries` : ''}` }],
    }
  }
  const best = [...cs].sort((a, b) => b.stats[mode] - a.stats[mode])[0]
  const worst = [...cs].sort((a, b) => a.stats[mode] - b.stats[mode])[0]
  const what = mode === 'happiness' ? 'how happy people are' : mode === 'economy' ? 'how well people earn and get by' : 'a great place to live: food, safety, health, clean air, work and happiness together'
  return {
    line: `${what}. deeper color is better.`,
    items: [
      ...(best ? [{ color: STAT_HIGH[mode], text: `best: ${best.name} (${Math.round(best.stats[mode] * 100)})` }] : []),
      ...(worst && worst !== best ? [{ color: STAT_LOW, text: `lowest: ${worst.name} (${Math.round(worst.stats[mode] * 100)})` }] : []),
    ],
  }
}
