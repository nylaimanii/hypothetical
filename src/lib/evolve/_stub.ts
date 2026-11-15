// TEMPORARY stand-ins for B's runWorld (src/lib/sim/run.ts) and askCore (src/lib/agent/ask.ts),
// matching the CLAUDE.md signatures. not a real simulation: numbers are toy values so evolve,
// notify and the api can be exercised end to end. swap to real imports in ./core.ts.
import fs from 'node:fs'
import path from 'node:path'
import type {
  BaselineFrame, Budget, Citizen, Decision, Frame, Law, MoonStage, Override, Region, RunOptions,
  RunRecord, RunSummary, WorldEvent, WorldStatus,
} from '../types'

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))
const dateOf = (tick: number) => {
  const m = 10 + tick
  return `${2026 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`
}
const STAGES: MoonStage[] = ['none', 'orbital', 'heavy_lift', 'life_support', 'lander', 'crewed_landing']
const est = { kind: 'ESTIMATE' as const }

function initialRegions(): Region[] {
  const base: [string, string, number, number, string, number][] = [
    ['north', 'Northern Belt', 52, 10, '#6b7f99', 1.9e9],
    ['south', 'Southern Reach', -15, 25, '#a08a5b', 2.1e9],
    ['east', 'Eastern Rim', 30, 110, '#7a9b76', 2.4e9],
    ['west', 'Western Shore', 25, -90, '#9b7a8f', 1.7e9],
  ]
  return base.map(([id, name, lat, lon, color, population]) => ({
    id, name, lat, lon, color, population, share65plus: 0.1, gdpUsd: population * 13000,
    energyTWh: population / 4e5, foodKcalPerCapita: 2800, education: 0.6, faith: 0.6, unrest: 0.2,
    techLevel: 0.4, compliance: 0.7, provenance: { population: est, gdpUsd: est },
  }))
}

function budgetFrom(constitution: string): Budget {
  const c = constitution.toLowerCase()
  const w = (k: string, b: number) => b + (c.split(k).length - 1) * 0.6
  const raw = {
    food: w('food', 2), energy: w('energy', 1.5), education: w('school', 1.2), space: w('moon', 0.6) + w('space', 0),
    security: w('security', 0.8), welfare: w('welfare', 1), research: w('research', 1),
  }
  const sum = Object.values(raw).reduce((a, b) => a + b, 0)
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / sum])) as Budget
}

function readOverrides(dir: string | undefined): Override[] {
  if (!dir || !fs.existsSync(dir)) return []
  const out: Override[] = []
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const p = path.join(dir, f)
    try { out.push(JSON.parse(fs.readFileSync(p, 'utf8'))) } catch {}
    fs.renameSync(p, p + '.consumed')
  }
  return out
}

export async function runWorld(opts: RunOptions): Promise<RunSummary> {
  const rng = mulberry32(opts.seed ^ hash(opts.constitution))
  const brng = mulberry32(opts.seed)
  let budget = budgetFrom(opts.constitution)
  const regions = initialRegions()
  const bRegions = initialRegions()
  const laws: Law[] = []
  const frames: Frame[] = []
  const baseline: BaselineFrame[] = []
  const events: WorldEvent[] = []
  const citizens: Citizen[] = regions.map((r, i) => ({
    id: `c${i}`, regionId: r.id, name: ['Ama', 'Teo', 'Rin', 'Sol'][i], age: 30 + i * 7, sex: i % 2 ? 'male' : 'female',
    skinTone: 2 + i * 2, hair: 'short_wavy', hairColor: 'dark_brown', heightCm: 165 + i * 3, build: 'average',
    personalitySeed: i, job: 'engineer', belief: 'secular', mood: 0.5, thought: 'watching the sky',
  }))
  let progress = 0, bProgress = 0, status: WorldStatus = 'alive', bStatus: WorldStatus = 'alive'
  let bEnd = 0, peak = 0, tick = 0, causeOfDeath: string | undefined
  const frameEvery = opts.frameEvery ?? 12

  for (tick = 0; tick <= 600; tick++) {
    const newEvents: WorldEvent[] = []
    let decision: Decision | undefined
    for (const o of readOverrides(opts.overrideDir)) {
      if (o.kind === 'force_budget' && o.budget) budget = { ...budget, ...o.budget }
      if (o.kind === 'veto_law' && o.lawId) { const l = laws.find(l => l.id === o.lawId); if (l) l.vetoed = true }
      const r = regions.find(r => r.id === o.regionId) ?? regions[0]
      if (o.kind === 'inject_event') r.unrest = clamp(r.unrest + (o.severity ?? 0.5) * 0.3)
      newEvents.push({ tick, regionId: o.regionId, kind: 'override', text: `user override ${o.kind} (${o.id})`, severity: o.severity ?? 0.5 })
    }
    if (tick % 12 === 0 && tick > 0) {
      const law: Law = {
        id: `law-${tick}`, title: `Year ${tick / 12} act`, text: 'Stub law text.', layer: 'government',
        enactedTick: tick, support: rng(), compliance: rng(),
      }
      laws.push(law)
      decision = {
        tick, laws: [law], repeal: [], migrations: [], budget, religionPolicy: 'free',
        schoolPolicy: { purpose: 'stub', curriculum: ['math'], yearsRequired: 10 }, rationale: 'stub rationale',
        respondedToOverrides: [],
      }
    }
    for (const r of regions) {
      r.foodKcalPerCapita = clamp(r.foodKcalPerCapita + (budget.food - 0.2) * 40 + (rng() - 0.5) * 120, 1200, 3600)
      r.unrest = clamp(r.unrest + (r.foodKcalPerCapita < 2000 ? 0.02 : -0.004) + (0.12 - budget.welfare) * 0.03 + (rng() - 0.5) * 0.02)
      r.techLevel = clamp(r.techLevel + budget.research * 0.004)
      r.population *= 1 + (r.foodKcalPerCapita - 2100) / 4e6
      if (rng() < 0.006) newEvents.push({ tick, regionId: r.id, kind: rng() < 0.5 ? 'famine' : 'revolt', text: `crisis in ${r.name}`, severity: 0.4 + rng() * 0.6 })
    }
    progress = clamp(progress + budget.space * 0.006 * (0.5 + regions[0].techLevel))
    const pop = regions.reduce((a, r) => a + r.population, 0)
    peak = Math.max(peak, pop)
    const meanUnrest = regions.reduce((a, r) => a + r.unrest, 0) / regions.length
    if (meanUnrest > 0.85) { status = 'destroyed'; causeOfDeath = 'global revolt after sustained food shortfalls' }
    else if (progress >= 1) { status = 'moon'; newEvents.push({ tick, kind: 'launch', text: 'crewed landing succeeds', severity: 1 }) }
    else if (tick >= 600) status = 'stagnated'

    if (bStatus === 'alive') {
      bProgress = clamp(bProgress + 0.0012)
      for (const r of bRegions) r.unrest = clamp(r.unrest + (brng() - 0.48) * 0.02)
      if (bRegions.some(r => r.unrest > 0.95)) bStatus = 'destroyed'
      else if (bProgress >= 1) bStatus = 'moon'
      else if (tick >= 600) bStatus = 'stagnated'
      if (bStatus !== 'alive') bEnd = tick
    }
    baseline.push({ tick, regions: bRegions.map(({ id, population, foodKcalPerCapita, unrest, techLevel, education }) => ({ id, population, foodKcalPerCapita, unrest, techLevel, education })), moonProgress: bProgress, status: bStatus })

    events.push(...newEvents)
    const frame: Frame = {
      tick, date: dateOf(tick), regions: structuredClone(regions), citizens, laws: structuredClone(laws), budget,
      religionPolicy: 'free', schoolPolicy: { purpose: 'stub', curriculum: ['math'], yearsRequired: 10 },
      moonStage: STAGES[Math.min(5, Math.floor(progress * 5.0001))], moonProgress: progress, status, newEvents, decision,
    }
    opts.onFrame?.(frame)
    if (tick % frameEvery === 0 || status !== 'alive') frames.push(frame)
    if (opts.live) await new Promise(r => setTimeout(r, opts.live!.msPerTick))
    if (status !== 'alive') break
  }
  if (bStatus === 'alive') bEnd = tick

  const summary: RunSummary = {
    runId: opts.runId, generation: opts.generation, status, endDate: dateOf(tick), ticks: tick,
    score: Math.round((progress * 100 + tick / 6 + (status === 'moon' ? 100 : 0) - (status === 'destroyed' ? 20 : 0)) * 10) / 10,
    causeOfDeath, constitution: opts.constitution, peakPopulation: Math.round(peak),
    moonStage: frames[frames.length - 1].moonStage,
    topEvents: [...events].sort((a, b) => b.severity - a.severity).slice(0, 5),
    baselineStatus: bStatus, baselineEndDate: dateOf(bEnd),
  }
  const record: RunRecord = { runId: opts.runId, generation: opts.generation, seed: opts.seed, constitution: opts.constitution, frames, baseline, summary }
  const dir = path.join(process.cwd(), 'data', 'runs')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${opts.runId}.json`), JSON.stringify(record))
  return summary
}

export async function askCore(record: RunRecord, question: string): Promise<string> {
  const s = record.summary
  return `(stub answer) world ${s.runId} ended ${s.status} in ${s.endDate} with score ${s.score}. you asked: "${question}". the real governor answer arrives when B ships askCore.`
}
