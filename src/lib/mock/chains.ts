// MOCK: cause chains, stories and the core's reasoning for the mock worlds, in B's shapes (src/lib/sim/causes.ts),
// so the ui can show "drought -> prices -> protests -> law -> result" before a real run exists.
// built only from the mock's own events, laws and stats; every number is the mock's ESTIMATE.
import type { CauseLink, ChainTrend, Decision, Frame, Reasoning, Region, RunRecord, Story } from '@/lib/types'

const yearOf = (tick: number) => 2026 + Math.floor((tick + 10) / 12)
const ppl = (x: number) => (x >= 1e9 ? `${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${Math.round(x / 1e3)}k` : `${Math.round(x)}`)
const pct = (x: number) => `${Math.round(x * 100)}%`

const STATS: { stat: keyof Region; label: string; fmt: (x: number) => string; good: 1 | -1; min: number }[] = [
  { stat: 'foodKcalPerCapita', label: 'food', fmt: (x) => `${Math.round(x)} kcal a day`, good: 1, min: 40 },
  { stat: 'unrest', label: 'unrest', fmt: pct, good: -1, min: 0.04 },
  { stat: 'approval', label: 'approval of the core', fmt: pct, good: 1, min: 0.03 },
  { stat: 'periodLifeExpectancy', label: 'life expectancy', fmt: (x) => `${x.toFixed(1)} years`, good: 1, min: 0.4 },
]

// what kind of thing people do about each kind of event, in plain words
const RESPONSE: Partial<Record<string, string>> = {
  famine: 'people queued for grain and marched on the depots', disaster: 'families fled to higher ground', war: 'the border towns emptied',
  pandemic: 'clinics filled and markets shut', revolt: 'the streets filled', migration: 'new arrivals crowded the cities',
}

export function applyChains(rec: RunRecord): RunRecord {
  const links = new Map<string, CauseLink>()
  let n = 0
  const add = (l: Omit<CauseLink, 'id' | 'nextIds'>) => {
    const id = `c${++n}`
    const link: CauseLink = { ...l, id, nextIds: [] }
    for (const p of l.causeIds) links.get(p)?.nextIds.push(id)
    links.set(id, link)
    return link
  }
  // the last link in each place, to chain the next thing to
  const lastIn = new Map<string, CauseLink>()
  const byFrame: CauseLink[][] = []
  const stories: Map<string, Story>[] = []
  const trends: Map<string, ChainTrend[]>[] = []
  let prevYear: Frame | null = null

  rec.frames.forEach((f, fi) => {
    const made: CauseLink[] = []
    for (const e of f.newEvents) {
      const place = e.regionId ?? 'world'
      const region = f.regions.find((r) => r.id === e.regionId)
      if (e.kind === 'law') {
        // the core answers the loudest thing it saw lately
        const prior = [...lastIn.values()].filter((l) => l.byWhom !== 'core' && f.tick - l.tick <= 24).sort((a, b) => b.value - a.value)[0]
        made.push(add({ tick: f.tick, placeId: place, what: e.text, value: e.severity, because: prior ? `the core answered ${prior.what.toLowerCase()}` : 'the core acted on its plan', byWhom: 'core', causeIds: prior ? [prior.id] : [] }))
      } else {
        const by = e.kind === 'famine' || e.kind === 'disaster' || e.kind === 'pandemic' ? 'nature' : e.kind === 'revolt' ? 'people' : e.kind === 'launch' || e.kind === 'breakthrough' ? 'core' : 'people'
        const prior = lastIn.get(place)
        const cause = prior && f.tick - prior.tick <= 24 ? prior : undefined
        const l = add({ tick: f.tick, placeId: place, what: e.text, value: e.severity, because: cause ? cause.what.toLowerCase() : by === 'nature' ? 'the weather turned' : 'pressure that had been building', byWhom: by, causeIds: cause ? [cause.id] : [] })
        made.push(l)
        lastIn.set(place, l)
        const resp = RESPONSE[e.kind]
        if (resp && region) {
          const r2 = add({ tick: f.tick, placeId: place, what: resp, value: Math.round(region.population * e.severity * 0.02), because: e.text.toLowerCase(), byWhom: `crowd:${region.id}`, causeIds: [l.id] })
          made.push(r2)
          lastIn.set(place, r2)
        }
      }
    }
    // once a year: what each region's numbers did, chained to that year's links there, then the story
    if (f.tick % 12 === 0 && fi > 0) {
      const yStories = new Map<string, Story>(), yTrends = new Map<string, ChainTrend[]>()
      for (const r of f.regions) {
        const p = prevYear?.regions.find((x) => x.id === r.id)
        if (!p) continue
        const tr: ChainTrend[] = []
        const chainsHere: CauseLink[][] = []
        for (const s of STATS) {
          const a = p[s.stat] as number, b = r[s.stat] as number, d = b - a
          if (Math.abs(d) < s.min) { tr.push({ stat: String(s.stat), direction: 'stable', change: d, text: `${s.label} steady at ${s.fmt(b)}` }); continue }
          const better = d * s.good > 0
          const cause = lastIn.get(r.id)
          const l = add({ tick: f.tick, placeId: r.id, what: `${s.label} ${d > 0 ? 'rose' : 'fell'} from ${s.fmt(a)} to ${s.fmt(b)}`, value: d, because: cause && f.tick - cause.tick <= 18 ? cause.what.toLowerCase() : better ? 'steady services' : 'slow strain', byWhom: 'observer', stat: String(s.stat), causeIds: cause && f.tick - cause.tick <= 18 ? [cause.id] : [] })
          made.push(l)
          tr.push({ stat: String(s.stat), direction: better ? 'rising' : 'declining', change: d, text: `${s.label} ${d > 0 ? 'up' : 'down'} to ${s.fmt(b)} because of ${l.because}` })
          // walk back for the chain behind it
          const chain: CauseLink[] = [l]
          let c = l
          while (c.causeIds[0] && chain.length < 5) { const pr = links.get(c.causeIds[0]); if (!pr) break; chain.unshift(pr); c = pr }
          if (chain.length > 1) chainsHere.push(chain)
        }
        yTrends.set(r.id, tr)
        const best = chainsHere.sort((a, b) => b.length - a.length).slice(0, 2)
        if (best.length) {
          yStories.set(r.id, {
            year: yearOf(f.tick) - 1,
            sentences: best.map((ch) => {
              // one line: where it started and where it ended up; the steps between live in the chain on tap
              const first = ch[0], last = ch[ch.length - 1]
              const start = first.what.toLowerCase().split(':')[0]
              return `in ${yearOf(first.tick)}, ${start}${last !== first ? `, so ${last.what.toLowerCase()}` : ''}.`
            }),
            chainIds: best.map((ch) => ch.map((x) => x.id)),
          })
        }
      }
      stories[fi] = yStories
      trends[fi] = yTrends
      prevYear = f
    } else if (fi === 0) prevYear = f
    byFrame[fi] = made
  })

  // carry each year's story through the frames of that year
  let curS = new Map<string, Story>(), curT = new Map<string, ChainTrend[]>()
  const vitals = (f: Frame) => ({ pop: f.globalPopulation, le: f.globalPeriodLifeExpectancy, approval: f.humanCost.approval, unrest: f.regions.reduce((a, r) => a + r.unrest * r.population, 0) / Math.max(1, f.regions.reduce((a, r) => a + r.population, 0)) })
  const frames = rec.frames.map((f, fi) => {
    if (stories[fi]) { curS = stories[fi]; curT = trends[fi] }
    const decision = f.decision ? { ...f.decision, reasoning: reasoningFor(rec, fi, f.decision, vitals) } : undefined
    return {
      ...f, decision, causes: byFrame[fi],
      regions: f.regions.map((r) => ({ ...r, story: curS.get(r.id) ?? null, trends: curT.get(r.id) ?? [] })),
    }
  })
  return { ...rec, frames }
}

// what the core saw -> what it chose -> what it expected -> (two years later) what happened
function reasoningFor(rec: RunRecord, fi: number, d: Decision, vitals: (f: Frame) => { pop: number; le: number; approval: number; unrest: number }): Reasoning {
  const f = rec.frames[fi]
  const hot = [...f.regions].sort((a, b) => b.unrest - a.unrest)[0]
  const hungry = [...f.regions].sort((a, b) => a.foodKcalPerCapita - b.foodKcalPerCapita)[0]
  const saw = [
    hot ? `unrest at ${pct(hot.unrest)} in ${hot.name}` : '',
    hungry ? `${hungry.name} eating ${Math.round(hungry.foodKcalPerCapita)} kcal a day` : '',
    ...f.newEvents.filter((e) => e.kind !== 'law').slice(0, 1).map((e) => e.text.toLowerCase()),
  ].filter(Boolean)
  const chose = [
    ...d.laws.map((l) => `the law "${l.title}"`),
    ...d.migrations.map((m) => `moving ${ppl(m.people)} from ${m.from} to ${m.to}`),
    ...(d.foundCities ?? []).map((c) => `founding ${c.name}`),
  ]
  const later = rec.frames.find((x) => x.tick >= f.tick + 24)
  let outcome: string | undefined
  if (later) {
    const a = vitals(f), b = vitals(later)
    outcome = `two years on: approval ${pct(a.approval)} to ${pct(b.approval)}, unrest ${pct(a.unrest)} to ${pct(b.unrest)}, life expectancy ${a.le.toFixed(1)} to ${b.le.toFixed(1)}`
  }
  return { saw: saw.length ? saw : ['a quiet year'], chose: chose.length ? chose : ['to keep the current policy'], expected: d.rationale, outcome }
}
