// cause chains: every meaningful change is a CauseLink that says what changed (with the number), because of
// what (with its number), and who did it. links point back to their causes and forward to what they led to, so
// a chain can be walked: drought -> food prices -> protests -> law -> result. stories and trends are written
// from the chains by template, with real names, dates and numbers. no llm calls.
import type { WorldEvent } from '../types'
import { START_MONTH, START_YEAR } from './constants'
import { clamp, regionPop, type RegionState, type World } from './state'

export type ByWhom = 'core' | 'nature' | 'people' | 'market' | 'observer' | `faction:${string}` | `crowd:${string}`
export type CauseLink = {
  id: string; tick: number; placeId: string
  what: string; value: number
  because: string
  byWhom: ByWhom
  lawId?: string; eventId?: string
  causeIds: string[]; nextIds: string[]
  stat?: string // set on yearly stat-change links
}
export type Trend = { stat: string; direction: 'rising' | 'declining' | 'stable'; change: number; text: string }
export type Story = { year: number; sentences: string[]; chainIds: string[][] }
export type CauseInput = { because?: string; byWhom?: ByWhom; causeIds?: string[]; lawId?: string; value?: number }

export const yearOf = (tick: number) => START_YEAR + Math.floor((START_MONTH - 1 + tick) / 12)
const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`
export const ppl = (x: number) => (x >= 1e9 ? `${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${Math.round(x / 1e3)}k` : `${Math.round(x)}`)

export function link(w: World, l: Omit<CauseLink, 'id' | 'tick' | 'nextIds' | 'causeIds'> & { causeIds?: string[] }): CauseLink {
  const c: CauseLink = { id: `k${w.causeSeq++}`, tick: w.tick, nextIds: [], ...l, causeIds: (l.causeIds ?? []).filter(Boolean) }
  for (const pid of c.causeIds) {
    const p = w.causes.find(x => x.id === pid)
    if (p && !p.nextIds.includes(c.id)) p.nextIds.push(c.id)
  }
  w.causes.push(c)
  return c
}

// latest link in a place matching a test, within the last n ticks
export function recentLink(w: World, placeId: string | undefined, test: (c: CauseLink) => boolean, within = 24): CauseLink | undefined {
  for (let i = w.causes.length - 1; i >= 0; i--) {
    const c = w.causes[i]
    if (w.tick - c.tick > within) break
    if ((!placeId || c.placeId === placeId || c.placeId === 'world') && test(c)) return c
  }
  return undefined
}

// default cause for an event when the call site gave none
function defaultCause(w: World, e: WorldEvent): CauseInput {
  const t = e.text.toLowerCase()
  switch (e.kind) {
    case 'disaster':
      if (/panic buying/.test(t)) return { byWhom: 'people', because: 'fear outran supply', causeIds: idOf(recentLink(w, e.regionId, c => /price|harvest|shortage|pandemic/.test(c.what))) }
      if (/collapses/.test(t)) return { byWhom: 'market', because: 'the company ran out of money in a weak economy' }
      return { byWhom: 'nature', because: 'a natural hazard at the real-world base rate (EM-DAT)' }
    case 'pandemic': return { byWhom: 'nature', because: 'a new pathogen, at the real-world rate of about 2.5% a year (Marani et al. 2021)' }
    case 'famine': return { byWhom: 'nature', because: `food supply fell under the 1,800 kcal survival line`, causeIds: idOf(recentLink(w, e.regionId, c => /drought|harvest|food prices/.test(c.what))) }
    case 'launch': return { byWhom: 'core', because: /fail/.test(t) ? 'a test flight failure roll, odds set by research and tech margin' : 'the program met its money, time and tech gates' }
    case 'breakthrough': return { byWhom: 'core', because: 'research spending finished the requirement' }
    case 'revolt': return { byWhom: 'people', because: 'unrest stayed above 0.65 for six months', causeIds: idOf(recentLink(w, e.regionId, c => /unrest|protest|law/.test(c.what))) }
    case 'war': return { byWhom: 'core', because: 'crackdowns on revolting regions raised war tension', causeIds: idOf(recentLink(w, e.regionId, c => /revolt|secession/.test(c.what))) }
    case 'migration': return { byWhom: 'core', because: 'a relocation order or a new city' }
    case 'override': case 'injected': return { byWhom: 'observer', because: 'the human observer stepped in' }
    default: return { byWhom: 'core', because: 'a decision by the core' }
  }
}
const idOf = (c?: CauseLink) => (c ? [c.id] : [])

// called from state.event for significant events: every event above the noise floor becomes a link
export function onEvent(w: World, e: WorldEvent, cause?: CauseInput): CauseLink | undefined {
  if (e.severity < 0.15 && !cause) return undefined
  if (e.kind === 'law' && !cause) return undefined
  const d = { ...defaultCause(w, e), ...(cause ?? {}) }
  const l = link(w, {
    placeId: e.regionId ?? 'world', what: e.text.replace(/ \[[a-z ]+: [^\]]+\]$/, ''), value: d.value ?? e.severity,
    because: d.because ?? '', byWhom: d.byWhom ?? 'core', lawId: d.lawId, eventId: (e as WorldEvent & { id?: string }).id, causeIds: d.causeIds,
  })
  return l
}

// ---------- yearly stat changes with their real top driver ----------
type StatDef = { stat: string; label: string; get: (rs: RegionState) => number; fmt: (x: number) => string; rel: boolean; minChange: number }
export const STATS: StatDef[] = [
  { stat: 'unrest', label: 'unrest', get: rs => rs.r.unrest, fmt: x => x.toFixed(2), rel: false, minChange: 0.02 },
  { stat: 'foodKcalPerCapita', label: 'food supply', get: rs => rs.r.foodKcalPerCapita, fmt: x => `${Math.round(x)} kcal`, rel: true, minChange: 0.02 },
  // food price index (1 = 2026). ESTIMATE: prices scale with scarcity, (2026 supply / supply now)^1.5, plus hoarding
  { stat: 'foodPrice', label: 'food prices', get: rs => rs.priceIdx, fmt: x => `${Math.round(x * 100)}`, rel: true, minChange: 0.05 },
  { stat: 'population', label: 'population', get: rs => regionPop(rs), fmt: ppl, rel: true, minChange: 0.02 },
  { stat: 'gdpUsd', label: 'the economy', get: rs => rs.r.gdpUsd, fmt: x => `$${(x / 1e12).toFixed(2)}T`, rel: true, minChange: 0.02 },
  { stat: 'approval', label: 'approval of the core', get: rs => rs.r.approval, fmt: x => `${Math.round(x * 100)}%`, rel: false, minChange: 0.02 },
  { stat: 'periodLifeExpectancy', label: 'life expectancy', get: rs => rs.periodLE, fmt: x => `${x.toFixed(1)} yrs`, rel: true, minChange: 0.005 },
]

// who is behind each why-driver label, and which earlier links it can point back to
function driverMeta(label: string): { byWhom: ByWhom; match: RegExp } {
  if (/hunger|harvest|yield|hoarding/.test(label)) return { byWhom: 'nature', match: /drought|harvest|food|famine|panic buying/ }
  if (/crowd outrage|outrage/.test(label)) return { byWhom: 'people', match: /protest|outrage|crowd/ }
  if (/unpopular laws|law/.test(label)) return { byWhom: 'core', match: /law|enacted/ }
  if (/policing|welfare|religion|school|family|pool|budget|medicine/.test(label)) return { byWhom: 'core', match: /law|enacted|budget/ }
  if (/recession|strikes|growth/.test(label)) return { byWhom: 'market', match: /strike|collapse|recession|economy/ }
  if (/shocks|deaths|pandemic/.test(label)) return { byWhom: 'nature', match: /disaster|pandemic|drought|war|launch/ }
  if (/power|demand met/.test(label)) return { byWhom: 'core', match: /power|grid|energy/ }
  // births, deaths, mood, ordinary growth: no earlier event explains them on its own, so no back link
  return { byWhom: 'people', match: /^$/ }
}

const PLAIN: Record<string, string> = {
  'world food pool (given)': 'the world food pool took part of its surplus', 'world food pool (received)': 'food shipped in from the world pool',
  'harvest and yields': 'the harvest', 'settling back': 'tempers cooling', 'people saying what is safe to say': 'people saying what is safe to say in public',
  'baseline growth': 'ordinary growth', 'mood': 'the public mood',
}
const plain = (label: string) => PLAIN[label] ?? label

export function stepYear(w: World) {
  const year = yearOf(w.tick - 1)
  for (const rs of w.regions) {
    const prev = rs.yearStart
    const trends: Trend[] = []
    for (const s of STATS) {
      const now = s.get(rs)
      const before = prev[s.stat] ?? now
      const change = s.rel ? (before ? now / before - 1 : 0) : now - before
      // price drivers are the food drivers with the sign flipped (less food, higher prices)
      const accRaw = s.stat === 'foodPrice' ? Object.fromEntries(Object.entries(rs.yearAcc.foodKcalPerCapita ?? {}).map(([k, v]) => [k, -v])) : (rs.yearAcc[s.stat] ?? {})
      const acc = Object.entries(accRaw).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      // the cause of a move is the biggest driver pushing the same way (a reverting force never explains a rise)
      const top = acc.find(x => Math.sign(x[1]) === Math.sign(change)) ?? acc[0]
      const moved = Math.abs(change) >= s.minChange
      if (moved && top) {
        const dir = change > 0 ? 'rose' : 'fell'
        const meta = driverMeta(top[0])
        // what set it off: an earlier link this year, never last year's change of the same stat; food prices
        // chain to this year's food supply only when supply moved the opposite way
        const prior = s.stat === 'foodPrice'
          ? recentLink(w, rs.r.id, c => c.placeId === rs.r.id && c.stat === 'foodKcalPerCapita' && c.tick === w.tick && Math.sign(c.value) === -Math.sign(change), 0)
            ?? recentLink(w, rs.r.id, c => c.placeId === rs.r.id && !c.stat && /drought|harvest|panic|famine/.test(c.what.toLowerCase()), 12)
          : recentLink(w, rs.r.id, c => c.placeId === rs.r.id && c.stat !== s.stat && (!c.stat || c.tick === w.tick) && meta.match.test(c.what.toLowerCase()), 12)
        const what = `${s.label} in ${rs.r.name} ${dir} from ${s.fmt(before)} to ${s.fmt(now)} (${s.rel ? pct(change) : `${change >= 0 ? '+' : ''}${change.toFixed(2)}`})`
        const share = acc.reduce((a, x) => a + Math.abs(x[1]), 0)
        const sharePct = Math.round(Math.abs(top[1]) / Math.max(share, 1e-12) * 100)
        const because = `${plain(top[0])}${sharePct >= 15 ? ` (${sharePct}% of the movement)` : ''}${prior ? `, after ${prior.what}` : ''}`
        link(w, { placeId: rs.r.id, what, value: change, because, byWhom: meta.byWhom, causeIds: idOf(prior), stat: s.stat })
        trends.push({ stat: s.stat, direction: change > 0 ? 'rising' : 'declining', change, text: `${s.label} ${change > 0 ? 'rising' : 'falling'} ${s.rel ? pct(change) : `${change >= 0 ? '+' : ''}${change.toFixed(2)}`}: mostly ${plain(top[0])}${prior ? ` after ${prior.what}` : ''}` })
      } else {
        // stable: say what is holding it steady (the two biggest drivers pulling opposite ways)
        const up = acc.filter(x => x[1] > 0)[0], down = acc.filter(x => x[1] < 0)[0]
        const hold = up && down ? `${plain(up[0])} (${fmtD(up[1], s)}) is offsetting ${plain(down[0])} (${fmtD(down[1], s)})` : up ? `only ${plain(up[0])} is moving it, and only a little` : down ? `only ${plain(down[0])} is moving it, and only a little` : 'nothing pushed it this year'
        trends.push({ stat: s.stat, direction: 'stable', change, text: `${s.label} steady at ${s.fmt(now)}: ${hold}` })
      }
      prev[s.stat] = now
    }
    rs.trends = trends
    rs.story = { year, ...storyFor(w, rs, year) }
    rs.yearAcc = {}
  }
  // keep ten years of links in the live state (frames keep the rest)
  const cut = w.tick - 120
  if (w.causes.length && w.causes[0].tick < cut) w.causes = w.causes.filter(c => c.tick >= cut)
}

function fmtD(v: number, s: StatDef): string {
  if (s.stat === 'population') return `${v >= 0 ? '+' : '-'}${ppl(Math.abs(v))}`
  if (s.stat === 'gdpUsd') return `${v >= 0 ? '+' : '-'}$${(Math.abs(v) / 1e9).toFixed(0)}B`
  if (s.stat === 'foodKcalPerCapita' || s.stat === 'foodPrice') return `${v >= 0 ? '+' : ''}${Math.round(v)}${s.stat === 'foodPrice' ? '' : ' kcal'}`
  return `${v >= 0 ? '+' : ''}${v.toFixed(3)}`
}

// ---------- stories ----------
function chainBack(w: World, c: CauseLink, depth = 0): CauseLink[] {
  if (depth > 5 || !c.causeIds.length) return [c]
  const p = w.causes.find(x => x.id === c.causeIds[0])
  return p ? [...chainBack(w, p, depth + 1), c] : [c]
}
function chainForward(w: World, c: CauseLink, depth = 0): CauseLink[] {
  if (depth > 4 || !c.nextIds.length) return [c]
  const n = w.causes.filter(x => c.nextIds.includes(x.id)).sort((a, b) => b.tick - a.tick || Math.abs(b.value) - Math.abs(a.value))[0]
  return n ? [c, ...chainForward(w, n, depth + 1)] : [c]
}

function sentence(chain: CauseLink[]): string {
  const [first, ...rest] = chain
  let s = `${first.what}${first.because ? ` (${first.because.split(', after ')[0]})` : ''}`
  for (const c of rest) {
    if (c.byWhom === 'core' && c.lawId) s += `; the core answered with ${c.what} (law ${c.lawId})`
    else s += `, so ${c.what}`
  }
  return s.charAt(0).toUpperCase() + s.slice(1) + '.'
}

export function storyFor(w: World, rs: RegionState, year: number): { sentences: string[]; chainIds: string[][] } {
  void year
  // the story year is the 12 months that just ended
  const mine = w.causes.filter(c => c.tick >= w.tick - 12 && c.tick < w.tick && (c.placeId === rs.r.id || (c.placeId === 'world' && !!c.lawId)))
  // chains that end this year in this place, longest and biggest first
  const leaves = mine.filter(c => !c.nextIds.some(n => mine.some(m => m.id === n)))
  const chains = leaves.map(l => chainBack(w, l)).map(ch => {
    // extend with any core answer that followed the last link
    const tail = chainForward(w, ch[ch.length - 1]).slice(1)
    return [...ch, ...tail]
  })
  const score = (ch: CauseLink[]) => ch.length * 2 + ch.reduce((a, c) => a + clamp(Math.abs(c.value) * 5), 0)
  const seen = new Set<string>()
  const picked = chains.sort((a, b) => score(b) - score(a)).filter(ch => {
    const k = ch[0].id
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, 3)
  return { sentences: picked.map(sentence), chainIds: picked.map(ch => ch.map(c => c.id)) }
}

export function linksSince(w: World, tick: number): CauseLink[] {
  return w.causes.filter(c => c.tick >= tick).map(c => ({ ...c, causeIds: [...c.causeIds], nextIds: [...c.nextIds] }))
}
