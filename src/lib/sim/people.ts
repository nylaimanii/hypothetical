// how people behave together: protests and panics spread between connected regions, generations carry what they
// lived through at 18-22, misinformation grows and shrinks with trust, censorship and transparency, meaning (work,
// faith, family, a shared mission) keeps people alive, and big events come back on their anniversaries.
// numbers are SOURCED with a link or marked ESTIMATE with the reasoning.
import { A } from './assumptions'
import { link } from './causes'
import { addCrowd } from './behavior'
import { countryPop, countriesOf, type CountryState } from './places'
import { hashString } from './rng'
import { BAND_MID, clamp, event, regionPop, sum, type RegionState, type World } from './state'
import { generationOf } from './generations'
import { ADJ } from './visuals'

const u01 = (w: World, s: string) => (hashString(`${w.seed}:${s}`) % 1000003) / 1000003
const pct = (x: number) => `${Math.round(x * 100)}%`
const strongest = (w: World, rs: RegionState, kinds: string[]) => { let best = { c: 0, lawId: undefined as string | undefined }; for (const l of w.laws) if (!l.vetoed && kinds.includes(l.policyKind)) { const c = rs.lawCompliance[l.id] ?? 0; if (c > best.c) best = { c, lawId: l.id } } return best }
const regionAvg = (w: World, rs: RegionState, f: (c: CountryState) => number, dflt: number) => { const cs = countriesOf(w, rs.r.id); const P = sum(cs.map(countryPop)) || 1; return cs.length ? sum(cs.map(c => f(c) * countryPop(c))) / P : dflt }

export type Memory = { tick: number; regionId: string; text: string; kind: 'tragedy' | 'triumph' | 'repression'; size: number }
export type People = {
  memory: Memory[]
  spreadYear: number; spreadAcc: number
  lastScan: number
}
// per region (on RegionState): cohorts = trust in the core imprinted on each 5-year birth cohort at 18-22
export type RegionPeople = { cohorts: Record<number, { trust: number; formative?: string }>; trust0: number; misinfo: number; misinfo0: number }

export function initPeople(w: World) {
  w.people = { memory: [], spreadYear: 0, spreadAcc: 0, lastScan: -1 }
  for (const rs of w.regions) {
    const cohorts: RegionPeople['cohorts'] = {}
    // 2026 cohorts all start at the region's approval (ESTIMATE: no cohort gap in trust of a brand new government)
    for (let b = 1900; b <= 2030; b += 5) cohorts[b] = { trust: rs.r.approval }
    const internet = regionAvg(w, rs, c => c.daily?.internet ?? 0.6, 0.6)
    // ESTIMATE baseline share believing a major false claim ~15% (Reuters Institute Digital News Report: ~55-60% worry
    // about telling real from fake online), higher with more internet and less trust
    const m0 = clamp(0.08 + 0.12 * internet + 0.1 * (1 - rs.r.approval))
    rs.people = { cohorts, trust0: rs.r.approval, misinfo: m0, misinfo0: m0 }
    rs.peopleMult = 1
  }
  for (const c of w.countries) { c.meaning = meaningOf(c); c.meaning0 = c.meaning; c.despairYear = 0 }
}

// meaning: work, faith, family and community. ESTIMATE weights, work first; Case & Deaton (2015, https://doi.org/10.1073/pnas.1518393112)
// tie the rise of midlife deaths from drugs, alcohol and suicide to the loss of work, family and community
function meaningOf(c: CountryState, awe = 0): number {
  const d = c.daily, p = c.power
  return clamp(0.5 * (1 - c.unemployment - (p?.autoUnemp ?? 0)) + 0.1 * (d?.worshipWeekly ?? 0.3) + 0.1 * (1 - (d?.elderAlone ?? 0.3)) + 0.2 * (c.happiness ?? 0.5) + 0.1 * awe)
}

// ---------- monthly: contagion and memories ----------
export function stepPeopleMonth(w: World) {
  const P = w.people
  if (!P) return
  // remember last month's big events (ESTIMATE: severity >= 0.6 is the kind of thing people mark years later)
  for (const e of w.events) {
    if (e.tick <= P.lastScan || e.tick >= w.tick || e.severity < 0.6 || !e.regionId) continue
    const kind: Memory['kind'] = /succeeded|landed|land on|first|record/.test(e.text) ? 'triumph' : /crackdown|massacre|shot|crushed|revolt|bulldozed/.test(e.text) ? 'repression' : 'tragedy'
    P.memory.push({ tick: e.tick, regionId: e.regionId, text: e.text.replace(/ \[[^\]]+\]$/, ''), kind, size: e.severity })
  }
  P.lastScan = w.tick - 1
  if (P.memory.length > 200) P.memory = P.memory.sort((a, b) => b.size - a.size).slice(0, 150).sort((a, b) => a.tick - b.tick)
  // anniversaries: 1, 5, 10, 25, 50, 100 years on, the region remembers: grief or pride come back, and the anniversary
  // of a crackdown brings people out (Hong Kong's June 4 vigils drew ~180,000 on the 30th anniversary in 2019,
  // https://en.wikipedia.org/wiki/Hong_Kong_Alliance_in_Support_of_Patriotic_Democratic_Movements_of_China). ESTIMATE sizes
  for (const m of P.memory) {
    const years = (w.tick - m.tick) / 12
    if (![1, 5, 10, 25, 50, 100].includes(years)) continue
    const rs = w.regions.find(r => r.r.id === m.regionId)
    if (!rs) continue
    const fade = years >= 25 ? 0.5 : 1
    if (m.kind === 'triumph') rs.prideShock += 0.1 * m.size * fade
    else rs.griefShock += 0.08 * m.size * fade
    const text = `${years} year${years > 1 ? 's' : ''} since ${m.text.slice(0, 120)}: ${m.kind === 'triumph' ? 'celebrations' : m.kind === 'repression' ? 'vigils' : 'a day of mourning'} in ${rs.r.name}`
    event(w, { regionId: rs.r.id, kind: m.kind === 'triumph' ? 'breakthrough' : 'disaster', text, severity: 0.1 })
    // only the round anniversaries become part of the cause record (small ones are events, they cause nothing)
    const k = [10, 25, 50, 100].includes(years) ? link(w, { placeId: rs.r.id, what: text, value: 0.45, because: m.text.slice(0, 120), byWhom: 'people' }) : undefined
    if (m.kind === 'repression') addCrowd(rs, w, { topic: `the anniversary of ${m.text.slice(0, 60)}`, peak: clamp(0.15 * m.size * fade + 0.1 * (1 - rs.r.approval)), outrageMonths: 1, causeId: k?.id })
  }
  // contagion: an outraged crowd spreads to connected neighbors, faster with more internet and when neighbors share
  // the grievance (the 2011 protests went from Tunisia to Egypt in under four weeks, https://en.wikipedia.org/wiki/Arab_Spring).
  // ESTIMATE monthly odds = 0.15 x intensity x internet x similarity
  for (const [a, b] of ADJ) for (const [from, to] of [[a, b], [b, a]]) {
    const src = w.regions.find(r => r.r.id === from)!, dst = w.regions.find(r => r.r.id === to)!
    if (src.seceded || dst.seceded) continue
    for (const cr of src.crowds) {
      if (cr.phase !== 'outraged' || cr.intensity < 0.5 || dst.crowds.some(x => x.topic === cr.topic)) continue
      const net = (regionAvg(w, src, c => c.daily?.internet ?? 0.6, 0.6) + regionAvg(w, dst, c => c.daily?.internet ?? 0.6, 0.6)) / 2
      const similar = clamp(1 - Math.abs(src.r.approval - dst.r.approval) - 0.5 * Math.abs(src.r.unrest - dst.r.unrest) + 0.3 * dst.r.unrest)
      if (u01(w, `spread:${from}:${to}:${cr.topic}:${w.tick}`) < A(w, 'contagion_rate') * cr.intensity * net * similar) {
        const k = link(w, { placeId: to, what: `protests over ${cr.topic} spread from ${src.r.name} to ${dst.r.name}`, value: 0.5, because: `${pct(net)} of people online, a shared grievance`, byWhom: `crowd:${cr.topic}`, causeIds: cr.causeId ? [cr.causeId] : [] })
        addCrowd(dst, w, { topic: cr.topic, peak: clamp(cr.peak * 0.6), outrageMonths: cr.outrageMonths, delay: 1, lawId: cr.lawId, panic: cr.panic, causeId: k.id })
        P.spreadAcc++
      }
    }
  }
}

// ---------- yearly: generations, misinformation, meaning ----------
export function stepPeopleYear(w: World) {
  const P = w.people
  if (!P) return
  P.spreadYear = P.spreadAcc; P.spreadAcc = 0
  const year = 2026 + Math.floor(w.tick / 12)
  for (const rs of w.regions) {
    const rp = rs.people
    if (!rp) continue
    const legit = regionAvg(w, rs, c => c.power?.legit ?? 0.5, 0.5)
    // impressionable years: attitudes are most open to change in late adolescence and early adulthood, then settle
    // (Krosnick & Alwin 1989, https://doi.org/10.1037/0022-3514.57.3.416). ESTIMATE: cohorts aged 18-22 move 35% a
    // year toward current approval and legitimacy, plus a nudge from the biggest event of those years
    const formative = P.memory.filter(m => m.regionId === rs.r.id && year - (2026 + Math.floor(m.tick / 12)) <= 4).sort((a, b) => b.size - a.size)[0]
    const shock = formative ? (formative.kind === 'triumph' ? 0.1 : -0.1) * formative.size : 0
    const b = Math.floor((year - 20) / 5) * 5
    const prev = rp.cohorts[b] ?? { trust: rs.r.approval }
    rp.cohorts[b] = { trust: clamp(prev.trust + (0.5 * rs.r.approval + 0.5 * legit + shock - prev.trust) * 0.35), formative: formative?.text ?? prev.formative }
    // misinformation: grows with internet and distrust and in crises; censorship hides it but pushes it underground
    // and costs trust (Roberts 2018, Censored, https://doi.org/10.23943/9781400890057); transparency and media literacy
    // (Finland tops the European Media Literacy Index) shrink it; state propaganda adds to it
    const internet = regionAvg(w, rs, c => c.daily?.internet ?? 0.6, 0.6)
    const censor = strongest(w, rs, ['assembly_limit']).c, open = strongest(w, rs, ['transparency']).c, literacy = strongest(w, rs, ['media_literacy']).c + (w.schoolPolicy.curriculum.some(x => /media|critical/.test(x)) ? 0.3 : 0)
    const prop = strongest(w, rs, ['propaganda']).c
    const target = clamp(0.08 + 0.12 * internet + 0.1 * (1 - rs.r.approval) + 0.15 * Math.max(0, rs.mood.fear - 0.3) + 0.15 * censor * (1 - legit) + 0.1 * prop - 0.1 * open - 0.1 * Math.min(1, literacy))
    const before = rp.misinfo
    rp.misinfo += (target - rp.misinfo) * 0.4
    if (rp.misinfo - rp.misinfo0 > 0.1 && before - rp.misinfo0 <= 0.1) link(w, { placeId: rs.r.id, what: `false stories took hold in ${rs.r.name}: ${pct(rp.misinfo)} believe at least one big one`, value: 0.5, because: censor > 0.3 ? 'censorship drove rumors underground' : rs.mood.fear > 0.45 ? 'fear' : 'distrust and more people online', byWhom: 'people' })
    // who follows the core: the mix of cohorts (adult bands weighted by population) against 2026
    const trust = cohortTrust(rs, year)
    rs.peopleMult = clamp(1 + 0.3 * (trust - rp.trust0), 0.7, 1.3)
  }
  // meaning and deaths of despair per country: ESTIMATE up to +15 deaths per 100k a year when meaning falls 0.2 below
  // 2026 (the US rise in midlife deaths of despair was of that order, Case & Deaton 2015). a shared mission (space
  // milestones) adds a little awe
  for (const c of w.countries) {
    const rs = w.regions.find(r => r.r.id === c.regionId)!
    c.meaning = meaningOf(c, clamp(rs.aweShock))
    const despair = A(w, 'despair_max') * clamp((c.meaning0 - c.meaning) / 0.2) // per 100k a year
    c.despairYear = despair / 1e5 * countryPop(c)
    w.causeDeaths.despair = (w.causeDeaths.despair ?? 0) + c.despairYear
    const crude = Math.max(c.seed.crudeDeath * 100, 300)
    c.despairMult = 1 + despair / crude
  }
  const worst = [...w.countries].filter(c => countryPop(c) > 5e6).sort((a, b) => b.despairYear / countryPop(b) - a.despairYear / countryPop(a))[0]
  if (worst && worst.despairYear / countryPop(worst) > 1e-4 && w.tick % 60 === 59) link(w, { placeId: worst.id, what: `deaths of despair in ${worst.name} reached ${Math.round(worst.despairYear / countryPop(worst) * 1e5)} per 100k`, value: 0.5, because: `meaning fell from ${worst.meaning0.toFixed(2)} to ${worst.meaning.toFixed(2)}: ${worst.power?.autoUnemp > 0.03 ? 'work lost to machines' : worst.unemployment > worst.seed.unemployment + 0.03 ? 'joblessness' : 'fewer people in faith and family'}`, byWhom: 'people' })
}

function cohortTrust(rs: RegionState, year: number): number {
  const rp = rs.people
  let s = 0, n = 0
  for (let i = 4; i < BAND_MID.length; i++) {
    const birth = year - BAND_MID[i], b = Math.floor(birth / 5) * 5
    const t = rp.cohorts[b]?.trust ?? rp.trust0
    s += t * rs.bands[i]; n += rs.bands[i]
  }
  return n ? s / n : rp.trust0
}

export function peopleLines(w: World): string[] {
  const P = w.people
  if (!P) return []
  const year = 2026 + Math.floor(w.tick / 12)
  const R = w.regions.filter(r => r.people)
  const Pop = sum(R.map(regionPop)) || 1
  const mis = sum(R.map(r => r.people.misinfo * regionPop(r))) / Pop
  const worstM = [...R].sort((a, b) => b.people.misinfo - a.people.misinfo)[0]
  const young = sum(R.map(r => (r.people.cohorts[Math.floor((year - 25) / 5) * 5]?.trust ?? r.people.trust0) * regionPop(r))) / Pop
  const old = sum(R.map(r => (r.people.cohorts[Math.floor((year - 65) / 5) * 5]?.trust ?? r.people.trust0) * regionPop(r))) / Pop
  const CP = sum(w.countries.map(countryPop)) || 1
  const meaning = sum(w.countries.map(c => (c.meaning ?? 0) * countryPop(c))) / CP, meaning0 = sum(w.countries.map(c => (c.meaning0 ?? 0) * countryPop(c))) / CP
  const despair = sum(w.countries.map(c => c.despairYear ?? 0))
  return [
    `people: protests crossed ${P.spreadYear} borders last year; misinformation ${pct(mis)} (worst ${worstM.r.name} ${pct(worstM.people.misinfo)})`,
    `generations: ${generationOf(year - 25)} trust the core ${pct(young)}, ${generationOf(year - 65)} ${pct(old)}; meaning ${meaning.toFixed(2)} (2026 ${meaning0.toFixed(2)}), ${despair > 1e5 ? `${(despair / 1e6).toFixed(2)}M deaths of despair a year` : 'deaths of despair at 2026 levels'}`,
  ]
}
