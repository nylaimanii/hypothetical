// pdf reports styled like the site: bone page, ink text, Fraunces headings, JetBrains Mono numbers,
// ember only for deaths. empty sections are left out instead of printing blanks.
import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import type { CrowdState, RunRecord, RunSummary, Step, WorldEvent } from '../types'
import { dirs, isWin, readJson, type GenerationFile, type LeaderboardEntry } from '../evolve/store'
import type { LearningRow } from '../evolve/lessons'
import type { StepsFile } from '../evolve/steps'
import { learningReport, worldReport, type LearningReport, type Ref, type ReportSection, type WorldReport } from '../evolve/report'
import { epitaphOf } from './epitaph'
import { familyTree, readAgents } from '../evolve/agents'
import { agentRanges } from '../evolve/uncertainty'

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

// a WorldReport rendered the same way the site shows it: summary lines, then sections of claims with their refs
function renderReport(doc: Doc, r: WorldReport, only?: ReportSection['id'][]) {
  if (r.epitaph) { doc.moveDown(0.2); para(doc, `“${r.epitaph}”`, C.ember) }
  doc.moveDown(0.2)
  for (const line of r.summary) para(doc, line)
  for (const sec of r.sections) {
    if (only && !only.includes(sec.id)) continue
    const deadly = sec.id === 'cost' || (sec.id === 'ending' && r.status === 'destroyed')
    h3(doc, sec.title, deadly ? C.ember : C.ink)
    for (const c of sec.claims) {
      para(doc, c.text)
      refs(doc, c.refs)
      doc.moveDown(0.25)
    }
  }
}

// refs in mono: dates for event ticks, world ids, and source urls as links
function refs(doc: Doc, rs: Ref[]) {
  if (!rs.length) return
  const plain = rs.filter(x => !x.url).map(x => x.date ? `${x.date} (tick ${x.tick})` : x.runId ? `world ${x.runId}` : '').filter(Boolean)
  if (plain.length) mono(doc, plain.join('   '))
  for (const x of rs.filter(x => x.url)) {
    doc.font('mono').fontSize(8).fillColor(C.muted).text(x.url!, M, doc.y, { width: width(doc), link: x.url, underline: true })
  }
}

function stepsPage(doc: Doc, steps: StepsFile) {
  if (!steps.helped.length && !steps.hurt.length) return
  doc.addPage()
  h2(doc, 'the steps')
  mono(doc, `the recipe so far, from ${steps.worlds} real worlds. effect: how much better (or worse) worlds with the step did, in standard units. confidence grows with sample size`)
  const list = (title: string, xs: Step[], color: string) => {
    if (!xs.length) return
    h3(doc, title, color)
    xs.forEach((st, i) => {
      para(doc, `${i + 1}. ${st.text}`, color === C.ember ? C.ember : C.ink)
      mono(doc, `effect ${st.effect > 0 ? '+' : ''}${st.effect}   confidence ${pct(st.confidence)}   helped ${st.helpedWorlds.length}   hurt ${st.hurtWorlds.length}`)
      const proof = [...st.helpedWorlds.slice(0, 3).map(id => `+ ${id}`), ...st.hurtWorlds.slice(0, 3).map(id => `- ${id}`)]
      if (proof.length) mono(doc, proof.join('   '))
    })
  }
  list('in the worlds that did best for everyone', steps.helped, C.ink)
  list('in the worlds that died', steps.hurt, C.ember)
}

function learningStory(doc: Doc, rep: LearningReport, last = 15) {
  const entries = rep.entries.filter(e => e.status === 'destroyed' || e.lesson).slice(-last)
  if (!entries.length) return
  h2(doc, 'the learning story')
  mono(doc, `${rep.worlds} worlds, ${rep.deaths} died, ${rep.lessons} lessons.${rep.avoidedShare !== null ? ` later worlds avoided ${pct(rep.avoidedShare)} of the mistakes a lesson named.` : ''}`)
  for (const e of entries) {
    h3(doc, `#${e.order} ${e.agentName}, ${e.status === 'destroyed' ? `died ${e.endDate}` : `${words(e.status)} ${e.endDate}`}`, e.status === 'destroyed' ? C.ember : C.ink)
    if (e.cause) para(doc, e.cause, C.ember)
    if (e.lesson) para(doc, `lesson: ${e.lesson.rule}`)
    if (e.lesson && e.later.avoided !== null) mono(doc, e.later.avoided ? `avoided by all ${e.later.worlds} later worlds` : `repeated by ${e.later.repeatedBy.length} later world${e.later.repeatedBy.length > 1 ? 's' : ''}: ${e.later.repeatedBy.slice(0, 4).join(', ')}`, e.later.avoided ? C.muted : C.ember)
    mono(doc, `world ${e.runId}`)
  }
}

export type DigestInput = {
  generation: GenerationFile; leaderboard: LeaderboardEntry[]; bestRecord: RunRecord | null; allRuns: RunSummary[]
  learning?: LearningRow[]; lessonsKnown?: number; steps?: StepsFile
}

// same structure as the site's reports (GET /api/report/[runId], /api/report/learning), so both read the same
export async function digestPdf({ generation: g, leaderboard, bestRecord, allRuns, learning = [], lessonsKnown, steps }: DigestInput): Promise<Buffer> {
  const { doc, done } = makeDoc(`generation ${g.generation} digest`)
  const ranked = [...g.population].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const best = ranked[0]
  const goals = allRuns.filter(isWin).length
  const deaths = allRuns.filter(r => r.status === 'destroyed')
  cover(doc, 'hypothetical / generation digest', `generation ${g.generation}`,
    `${g.population.length} constitutions screened for 50 years on seeds ${g.seeds.join(' and ')}, the top 2 run for 100. ${deaths.length} of ${allRuns.length} worlds died${goals ? `, ${goals} achieved the goal` : ''}.${lessonsKnown !== undefined ? ` ${lessonsKnown} lessons known.` : ''}`)

  learningCurve(doc, learning)

  const fresh = g.stats?.newLessons ?? []
  if (fresh.length) {
    h2(doc, 'new lessons')
    for (const l of fresh) { h3(doc, l.rule); mono(doc, `from world ${l.fromRunId}`); para(doc, `mistake: ${l.mistake}`); para(doc, `result: ${l.consequence}`, C.ember) }
  }

  if (bestRecord) {
    h2(doc, 'the best world')
    mono(doc, `world ${bestRecord.runId}${best?.score !== undefined ? `   ${best.name}, screening average ${num(best.score)}` : ''}`)
    renderReport(doc, worldReport(bestRecord))
    requirementsTable(doc, bestRecord)
  }

  if (deaths.length) {
    h2(doc, 'the dead')
    for (const d of deaths) {
      h3(doc, `${d.runId}, died ${d.endDate}`, C.ember)
      const rec = readJson<RunRecord>(path.join(dirs.runs, `${d.runId}.json`))
      if (rec) renderReport(doc, worldReport(rec), ['ending', 'cost'])
      else { para(doc, `“${epitaphOf(d, d.agentId).line}”`, C.ember); if (d.causeOfDeath) para(doc, d.causeOfDeath, C.ember) }
    }
  }

  if (steps) stepsPage(doc, steps)
  learningStory(doc, learningReport())
  if (bestRecord) aiVsTwin(doc, bestRecord)

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
    for (const a of agents.slice(0, 5)) {
      const r = agentRanges(a.id)
      if (r) { h3(doc, `${a.name} across ${r.runs} full runs`); for (const l of r.lines) mono(doc, l, C.ink) }
    }
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
  renderReport(doc, worldReport(record))
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
