// pdf reports styled like the site: bone page, ink text, Fraunces headings, JetBrains Mono numbers,
// ember only for deaths. empty sections are left out instead of printing blanks.
import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import type { CrowdState, RunRecord, RunSummary, WorldEvent } from '../types'
import { isWin, type GenerationFile, type LeaderboardEntry } from '../evolve/store'
import type { LearningRow } from '../evolve/lessons'
import { familyTree, readAgents } from '../evolve/agents'

const C = { bone: '#EFE9DD', ink: '#1C1A17', muted: '#6B655B', rule: '#CFC6B4', ember: '#C2410C' }
const FONTS = path.join(process.cwd(), 'fonts')
const M = 56

type Doc = PDFKit.PDFDocument

function makeDoc(title: string): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({ size: 'A4', margin: M, info: { Title: title, Author: 'hypothetical' } })
  const chunks: Buffer[] = []
  doc.on('data', c => chunks.push(c))
  const done = new Promise<Buffer>(res => doc.on('end', () => res(Buffer.concat(chunks))))
  const font = (name: string, file: string, fallback: string) => {
    const p = path.join(FONTS, file)
    if (fs.existsSync(p)) doc.registerFont(name, p)
    else doc.registerFont(name, fallback)
  }
  font('display', 'Fraunces72pt-SemiBold.ttf', 'Times-Bold')
  font('serif', 'Fraunces9pt-Regular.ttf', 'Times-Roman')
  font('serif-bold', 'Fraunces9pt-SemiBold.ttf', 'Times-Bold')
  font('mono', 'JetBrainsMono-Regular.ttf', 'Courier')
  const paint = () => {
    doc.save().rect(0, 0, doc.page.width, doc.page.height).fill(C.bone).restore()
    doc.fillColor(C.ink).font('serif').fontSize(10.5)
    doc.x = M; doc.y = M
  }
  doc.on('pageAdded', paint)
  paint()
  return { doc, done }
}

const width = (doc: Doc) => doc.page.width - M * 2
// scores are small fractions in v2, big integers elsewhere: keep 3 significant decimals at most
export const num = (n: number) => Number.isInteger(n) ? String(n) : Math.abs(n) < 10 ? String(Number(n.toFixed(3))) : String(Number(n.toFixed(1)))
function space(doc: Doc, h: number) { if (doc.y + h > doc.page.height - M) doc.addPage() }

function cover(doc: Doc, kicker: string, title: string, sub: string) {
  doc.font('mono').fontSize(8.5).fillColor(C.muted).text(kicker.toUpperCase(), { characterSpacing: 1.5 })
  doc.moveDown(0.4).font('display').fontSize(30).fillColor(C.ink).text(title)
  doc.moveDown(0.2).font('serif').fontSize(12).fillColor(C.muted).text(sub)
  rule(doc)
}
function rule(doc: Doc) {
  doc.moveDown(0.6)
  doc.save().moveTo(M, doc.y).lineTo(M + width(doc), doc.y).lineWidth(0.6).strokeColor(C.rule).stroke().restore()
  doc.moveDown(0.8)
}
function h2(doc: Doc, text: string) {
  space(doc, 60)
  doc.moveDown(0.6).font('display').fontSize(17).fillColor(C.ink).text(text, M)
  doc.moveDown(0.3)
}
function h3(doc: Doc, text: string, color = C.ink) {
  space(doc, 40)
  doc.moveDown(0.3).font('serif-bold').fontSize(11.5).fillColor(color).text(text, M)
}
function para(doc: Doc, text: string, color = C.ink) {
  doc.font('serif').fontSize(10.5).fillColor(color).text(text, M, doc.y, { width: width(doc), lineGap: 2 })
}
function mono(doc: Doc, text: string, color = C.muted) {
  doc.font('mono').fontSize(8.5).fillColor(color).text(text, M, doc.y, { width: width(doc), lineGap: 1.5 })
}
// label: value pairs, numbers in mono
function facts(doc: Doc, rows: [string, string | number | undefined][]) {
  for (const [k, v] of rows) {
    if (v === undefined || v === '') continue
    space(doc, 16)
    const y = doc.y
    doc.font('serif').fontSize(10).fillColor(C.muted).text(k, M, y, { width: 150 })
    doc.font(typeof v === 'number' ? 'mono' : 'serif').fontSize(10).fillColor(C.ink).text(typeof v === 'number' ? num(v) : v, M + 160, y, { width: width(doc) - 160 })
    doc.y = Math.max(doc.y, y + 14)
  }
}
function table(doc: Doc, head: string[], rows: (string | number)[][], widths: number[]) {
  if (!rows.length) return
  const total = widths.reduce((a, b) => a + b, 0)
  const ws = widths.map(w => (w / total) * width(doc))
  const line = (cells: (string | number)[], header: boolean) => {
    space(doc, 18)
    const y = doc.y
    let x = M
    let h = 0
    cells.forEach((c, i) => {
      const isNum = typeof c === 'number'
      doc.font(header ? 'mono' : isNum ? 'mono' : 'serif').fontSize(header ? 7.5 : 9).fillColor(header ? C.muted : C.ink)
      const t = header ? String(c).toUpperCase() : typeof c === 'number' ? num(c) : c
      doc.text(t, x + 2, y, { width: ws[i] - 4, align: isNum && !header ? 'right' : 'left' })
      h = Math.max(h, doc.y - y)
      x += ws[i]
    })
    doc.y = y + h + 4
    doc.save().moveTo(M, doc.y - 2).lineTo(M + width(doc), doc.y - 2).lineWidth(0.4).strokeColor(C.rule).stroke().restore()
  }
  line(head, true)
  rows.forEach(r => line(r, false))
  doc.x = M
  doc.moveDown(0.4)
}

const pop = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(Math.round(n))
const pct = (x: number) => `${Math.round(x * 100)}%`
const words = (s: string) => s.replace(/_/g, ' ')

// human cost is never in the score, so it always goes up front
function humanCost(doc: Doc, s: RunSummary) {
  const c = s.humanCost
  if (!c) return
  h3(doc, 'human cost', c.deaths > 0 ? C.ember : C.ink)
  facts(doc, [
    ['deaths', c.deaths ? pop(c.deaths) : undefined],
    ['famine deaths', c.famineDeaths ? pop(c.famineDeaths) : undefined],
    ['unrest deaths', c.unrestDeaths ? pop(c.unrestDeaths) : undefined],
    ['displaced', c.displaced ? pop(c.displaced) : undefined],
    ['approval at the end', pct(c.approval)],
  ])
}

function summaryFacts(doc: Doc, s: RunSummary) {
  facts(doc, [
    ['world', s.runId],
    ['outcome', `${words(s.status)} ${s.endDate}`],
    ['score', s.score],
    ['frontier', s.frontier === 'none' ? undefined : words(s.frontier)],
    ['period life expectancy', s.peakPeriodLifeExpectancy ? s.peakPeriodLifeExpectancy.toFixed(1) : undefined],
    ['peak population', pop(s.peakPopulation)],
    ['final population', s.finalPopulation ? pop(s.finalPopulation) : undefined],
    ['cities founded', s.citiesFounded || undefined],
    ['diseases eradicated', s.diseasesEradicated?.length ? s.diseasesEradicated.join(', ') : undefined],
    ['lessons applied', s.lessonsApplied || undefined],
  ])
  if (s.causeOfDeath) { doc.moveDown(0.3); para(doc, `cause of death: ${s.causeOfDeath}`, C.ember) }
}

// reports are the one place the no-ai twin shows
function aiVsTwin(doc: Doc, record: RunRecord) {
  const last = record.frames[record.frames.length - 1]
  if (!last || !record.baseline.length) return
  const twin = record.baseline.find(b => b.tick === last.tick) ?? record.baseline[record.baseline.length - 1]
  const rows = last.regions.map(r => {
    const t = twin.regions.find(x => x.id === r.id)
    if (!t) return null
    return [r.name, pop(r.population), pop(t.population), Math.round(r.foodKcalPerCapita), Math.round(t.foodKcalPerCapita), pct(r.unrest), pct(t.unrest), pct(r.techLevel), pct(t.techLevel)]
  }).filter((r): r is (string | number)[] => !!r)
  if (!rows.length) return
  h2(doc, 'ai vs no-ai twin')
  mono(doc, `same seed ${record.seed}. twin: ${record.summary.baselineStatus} ${record.summary.baselineEndDate}. compared at ${last.date}`)
  doc.moveDown(0.4)
  table(doc, ['region', 'pop ai', 'pop twin', 'kcal ai', 'kcal twin', 'unrest ai', 'unrest twin', 'tech ai', 'tech twin'], rows, [2.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1])
}

// requirements on the two goal tracks: mars and 200 years
function requirementsTable(doc: Doc, record: RunRecord) {
  const last = record.frames[record.frames.length - 1]
  const reqs = (last?.requirements ?? []).filter(r => r.track === 'mars' || r.track === 'longevity')
  if (!reqs.length) return
  h2(doc, 'requirements: mars and 200 years')
  const date = (t?: number) => (t === undefined ? '' : record.frames.find(f => f.tick >= t)?.date ?? last.date)
  const sorted = [...reqs].sort((a, b) => a.track.localeCompare(b.track) || b.progress - a.progress)
  table(doc, ['requirement', 'track', 'tier', 'progress', 'unlocked'], sorted.map(r => [r.name, r.track, r.tier, pct(r.progress), date(r.unlockedTick)]), [3.4, 1, 1, 0.8, 0.9])
}

// crowd topics are where the satire lives; pick the loudest distinct ones, preferring the odd ones over policy names
function crowdMoments(record: RunRecord, n = 6): { date: string; region: string; c: CrowdState; endedBored?: string }[] {
  const seen = new Map<string, { date: string; region: string; c: CrowdState; score: number }>()
  for (const f of record.frames) for (const r of f.regions) for (const c of r.crowds ?? []) {
    if (c.intensity < 0.2 || c.phase === 'unaware') continue
    const key = c.topic.toLowerCase()
    const odd = c.topic.split(' ').length >= 6 ? 1 : 0
    const score = c.intensity + odd + (c.phase === 'outraged' ? 0.3 : 0)
    const prev = seen.get(key)
    if (!prev || score > prev.score) seen.set(key, { date: f.date, region: r.name, c, score })
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, n).map(m => {
    const bored = record.frames.find(f => f.date > m.date && f.regions.some(r => r.crowds?.some(c => c.topic === m.c.topic && c.phase === 'bored')))
    return { date: m.date, region: m.region, c: m.c, endedBored: bored?.date }
  })
}

function story(doc: Doc, record: RunRecord, everyYears = 1) {
  const frames = [...record.frames].sort((a, b) => a.tick - b.tick)
  let prevReligion = '', prevSchool = '', lastShown = -Infinity
  const arc: string[] = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const nextDecisionTick = frames.slice(i + 1).find(x => x.decision)?.tick ?? Infinity
    if (!f.decision && i !== 0) continue
    const events: WorldEvent[] = frames.filter(x => x.tick >= f.tick && x.tick < nextDecisionTick).flatMap(x => x.newEvents)
    const school = `${f.schoolPolicy.purpose} (${f.schoolPolicy.yearsRequired} yrs: ${f.schoolPolicy.curriculum.join(', ')})`
    if (f.religionPolicy !== prevReligion) arc.push(`${f.date}  religion ${words(f.religionPolicy)}`)
    if (school !== prevSchool) arc.push(`${f.date}  school ${school}`)
    prevReligion = f.religionPolicy; prevSchool = school
    const big = [...events].sort((a, b) => (b.significance ?? b.severity) - (a.significance ?? a.severity)).slice(0, 4)
    // long runs: show every n years, but never skip a year with a major event
    if (f.tick - lastShown < everyYears * 12 && !big.some(e => (e.significance ?? 0) >= 0.6)) continue
    const d = f.decision
    if (!d && !events.length) continue
    lastShown = f.tick
    h3(doc, `${f.date}   ${words(f.frontier ?? 'none') === 'none' ? '' : words(f.frontier)}`.trim())
    if (d?.publicStatement) para(doc, `“${d.publicStatement}”`)
    if (d?.rationale) para(doc, d.rationale, C.muted)
    if (d?.laws.length) for (const l of d.laws) { doc.moveDown(0.2); para(doc, `law: ${l.title}. ${l.text}`) }
    if (d?.repeal.length) mono(doc, `repealed ${d.repeal.join(', ')}`)
    if (d?.foundCities?.length) mono(doc, `founded ${d.foundCities.map(c => c.name).join(', ')}`)
    if (d?.lessonsApplied?.length) mono(doc, `applied lessons ${d.lessonsApplied.join(', ')}`)
    if (d) mono(doc, `budget  ${Object.entries(d.budget).map(([k, v]) => `${k} ${pct(v)}`).join('  ')}`)
    for (const e of big) mono(doc, `${e.kind}  ${e.headline ?? e.text}`, ['famine', 'revolt', 'war', 'disaster', 'pandemic'].includes(e.kind) && e.severity > 0.7 ? C.ember : C.muted)
    doc.moveDown(0.3)
  }
  return arc
}

function learningCurve(doc: Doc, rows: LearningRow[]) {
  if (!rows.length) return
  h2(doc, 'learning curve')
  const w = width(doc), h = 120
  space(doc, h + 40)
  const x0 = M, y0 = doc.y + 6
  const maxScore = Math.max(1, ...rows.map(r => r.bestScore))
  const maxLessons = Math.max(1, ...rows.map(r => r.lessonsKnown))
  const xs = (i: number) => x0 + (rows.length === 1 ? w / 2 : (i / (rows.length - 1)) * w)
  doc.save().rect(x0, y0, w, h).lineWidth(0.5).strokeColor(C.rule).stroke().restore()
  const line = (vals: number[], max: number, color: string, dash = false) => {
    doc.save().lineWidth(1.4).strokeColor(color)
    if (dash) doc.dash(3, { space: 3 })
    vals.forEach((v, i) => { const x = xs(i), y = y0 + h - (v / max) * (h - 8); if (i === 0) doc.moveTo(x, y); else doc.lineTo(x, y) })
    doc.stroke()
    vals.forEach((v, i) => doc.circle(xs(i), y0 + h - (v / max) * (h - 8), 2).fill(color))
    doc.restore()
  }
  line(rows.map(r => r.bestScore), maxScore, C.ink)
  line(rows.map(r => r.lessonsKnown), maxLessons, C.muted, true)
  doc.y = y0 + h + 6
  mono(doc, `solid: best score per generation (max ${num(maxScore)})   dashed: lessons known (max ${maxLessons})`)
  doc.moveDown(0.4)
  table(doc, ['gen', 'best score', 'lessons', 'deaths', 'repeat-mistake rate'], rows.slice(-12).map(r => [r.generation, r.bestScore, r.lessonsKnown, r.deaths, pct(r.repeatMistakeRate)]), [0.6, 1, 1, 1, 1.4])
}

export type DigestInput = {
  generation: GenerationFile; leaderboard: LeaderboardEntry[]; bestRecord: RunRecord | null; allRuns: RunSummary[]
  learning?: LearningRow[]; lessonsKnown?: number
}

export async function digestPdf({ generation: g, leaderboard, bestRecord, allRuns, learning = [], lessonsKnown }: DigestInput): Promise<Buffer> {
  const { doc, done } = makeDoc(`generation ${g.generation} digest`)
  const ranked = [...g.population].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const best = ranked[0]
  const goals = allRuns.filter(isWin).length
  const deaths = allRuns.filter(r => r.status === 'destroyed')
  cover(doc, 'hypothetical / generation digest', `generation ${g.generation}`,
    `${g.population.length} constitutions on seeds ${g.seeds.join(' and ')}. ${deaths.length} of ${allRuns.length} worlds died${goals ? `, ${goals} achieved the goal` : ''}.${lessonsKnown !== undefined ? ` ${lessonsKnown} lessons known.` : ''}`)

  if (bestRecord) {
    const s = bestRecord.summary
    h2(doc, 'the best world')
    mono(doc, best?.score !== undefined ? `${best.name}, average score ${num(best.score)}` : '')
    humanCost(doc, s)
    doc.moveDown(0.3)
    summaryFacts(doc, s)
  }

  learningCurve(doc, learning)

  const fresh = g.stats?.newLessons ?? []
  if (fresh.length) {
    h2(doc, 'new lessons')
    for (const l of fresh) { h3(doc, l.rule); mono(doc, `from ${l.fromRunId}`); para(doc, `mistake: ${l.mistake}`); para(doc, `result: ${l.consequence}`, C.ember) }
  }

  if (deaths.length) {
    h2(doc, 'deaths')
    for (const d of deaths) {
      h3(doc, `${d.runId}, died ${d.endDate}`, C.ember)
      if (d.causeOfDeath) para(doc, d.causeOfDeath, C.ember)
      mono(doc, `score ${num(d.score)}   frontier ${words(d.frontier)}   life exp ${d.peakPeriodLifeExpectancy.toFixed(1)}   deaths ${pop(d.humanCost?.deaths ?? 0)}`)
    }
  }

  if (bestRecord) {
    requirementsTable(doc, bestRecord)
    const moments = crowdMoments(bestRecord)
    if (moments.length) {
      h2(doc, 'the crowd, at its finest')
      for (const m of moments) para(doc, `${m.date}, ${m.region}: ${words(m.c.phase)} about ${m.c.topic}${m.endedBored ? `. bored of it by ${m.endedBored}.` : '.'}`)
    }
    h2(doc, 'the best world, year by year')
    const years = Math.max(1, Math.ceil(bestRecord.summary.ticks / 12 / 40))
    if (years > 1) mono(doc, `every ${years} years, plus every year with a major event`)
    const arc = story(doc, bestRecord, years)
    if (arc.length) { h2(doc, 'religion and school arc'); for (const a of arc) mono(doc, a, C.ink) }
    aiVsTwin(doc, bestRecord)
  }

  const hall = g.stats?.newHall ?? []
  if (hall.length) {
    h2(doc, 'new in the hall of history')
    for (const e of hall) {
      const year = 2026 + Math.floor((e.tick + 10) / 12)
      h3(doc, `${e.title}, ${year}`, e.kind === 'catastrophe' ? C.ember : C.ink)
      para(doc, e.text, e.kind === 'catastrophe' ? C.ember : C.ink)
      mono(doc, `${e.kind}   world ${e.runId}`)
    }
  }

  const agents = readAgents().filter(a => a.worlds > 0).sort((x, y) => Number(x.retired) - Number(y.retired) || y.avgScore - x.avgScore)
  if (agents.length) {
    h2(doc, 'agents')
    table(doc, ['agent', 'avg', 'best', 'worlds', 'died', 'frontier', 'life exp', ''],
      agents.slice(0, 15).map(a => [a.name, a.avgScore, a.bestScore, a.worlds, a.deaths, words(a.bestFrontier), a.bestPeriodLifeExpectancy ? a.bestPeriodLifeExpectancy.toFixed(1) : '', [a.champion ? 'champion' : '', a.retired ? 'retired' : '', a.protected ? 'protected' : ''].filter(Boolean).join(', ')]),
      [2.2, 0.8, 0.8, 0.7, 0.6, 1.4, 0.8, 1.2])
    const tree = familyTree()
    if (tree.length) { h3(doc, 'family tree'); for (const line of tree) mono(doc, line, C.ink) }
  }

  if (leaderboard.length) {
    h2(doc, 'leaderboard, all time')
    table(doc, ['#', 'constitution', 'gen', 'score', 'best world'],
      leaderboard.slice(0, 5).map((e, i) => [i + 1, e.name, e.generation, e.score, `${words(e.best.status)} ${e.best.endDate}`]), [0.4, 3.4, 0.6, 0.8, 1.6])
  }

  if (best) { h2(doc, `full text: ${best.name}`); para(doc, best.constitution) }

  const changed = g.population.filter(c => c.origin === 'mutation' || c.origin === 'crossover')
  if (changed.length) {
    h2(doc, 'how the constitutions changed')
    for (const c of changed) {
      h3(doc, `${c.name}`)
      mono(doc, `${c.origin} of ${c.parents.join(' x ')}${c.score !== undefined ? `   score ${num(c.score)}` : ''}`)
      if (c.changes) para(doc, c.changes)
    }
  }
  doc.end()
  return done
}

export async function goalPdf(record: RunRecord, agentName: string): Promise<Buffer> {
  const s = record.summary
  const { doc, done } = makeDoc(`goal achieved: ${s.runId}`)
  cover(doc, 'hypothetical / goal achieved', `humanity endures, ${s.endDate}`, `${agentName}. world ${s.runId}, generation ${record.generation}, seed ${record.seed}`)
  humanCost(doc, s)
  doc.moveDown(0.3)
  summaryFacts(doc, s)
  h2(doc, 'the constitution')
  para(doc, record.constitution)
  requirementsTable(doc, record)
  h2(doc, 'year by year')
  const arc = story(doc, record, 1)
  const last = record.frames[record.frames.length - 1]
  const laws = (last?.laws ?? []).filter(l => !l.vetoed).sort((a, b) => b.support * b.compliance - a.support * a.compliance).slice(0, 8)
  if (laws.length) {
    h2(doc, 'the laws that mattered')
    table(doc, ['law', 'enacted', 'support', 'compliance'], laws.map(l => [l.title, record.frames.find(f => f.tick >= l.enactedTick)?.date ?? String(l.enactedTick), pct(l.support), pct(l.compliance)]), [3.5, 1, 1, 1])
  }
  if (arc.length) { h2(doc, 'religion and school arc'); for (const a of arc) mono(doc, a, C.ink) }
  const moments = crowdMoments(record)
  if (moments.length) { h2(doc, 'the crowd, at its finest'); for (const m of moments) para(doc, `${m.date}, ${m.region}: ${words(m.c.phase)} about ${m.c.topic}.`) }
  aiVsTwin(doc, record)
  doc.end()
  return done
}
