// pdf reports styled like the site: bone page, ink text, Fraunces headings, JetBrains Mono numbers,
// ember only for deaths. empty sections are left out instead of printing blanks.
import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import type { RunRecord, RunSummary, WorldEvent } from '../types'
import type { GenerationFile, LeaderboardEntry } from '../evolve/store'

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
    doc.font(typeof v === 'number' ? 'mono' : 'serif').fontSize(10).fillColor(C.ink).text(String(v), M + 160, y, { width: width(doc) - 160 })
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
      const num = typeof c === 'number'
      doc.font(header ? 'mono' : num ? 'mono' : 'serif').fontSize(header ? 7.5 : 9).fillColor(header ? C.muted : C.ink)
      const t = header ? String(c).toUpperCase() : String(c)
      doc.text(t, x + 2, y, { width: ws[i] - 4, align: num && !header ? 'right' : 'left' })
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

const pop = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : String(Math.round(n))
const pct = (x: number) => `${Math.round(x * 100)}%`

function summaryFacts(doc: Doc, s: RunSummary) {
  facts(doc, [
    ['world', s.runId],
    ['outcome', `${s.status} ${s.endDate}`],
    ['score', s.score],
    ['peak population', pop(s.peakPopulation)],
    ['moon stage', s.moonStage === 'none' ? undefined : s.moonStage.replace('_', ' ')],
    ['no-ai twin', `${s.baselineStatus} ${s.baselineEndDate}`],
  ])
  if (s.causeOfDeath) { doc.moveDown(0.3); para(doc, `cause of death: ${s.causeOfDeath}`, C.ember) }
}

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
  mono(doc, `same seed ${record.seed}, compared at ${last.date}`)
  doc.moveDown(0.4)
  table(doc, ['region', 'pop ai', 'pop twin', 'kcal ai', 'kcal twin', 'unrest ai', 'unrest twin', 'tech ai', 'tech twin'], rows, [2.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1])
}

export type DigestInput = { generation: GenerationFile; leaderboard: LeaderboardEntry[]; bestRecord: RunRecord | null; allRuns: RunSummary[] }

export async function digestPdf({ generation: g, leaderboard, bestRecord, allRuns }: DigestInput): Promise<Buffer> {
  const { doc, done } = makeDoc(`generation ${g.generation} digest`)
  const ranked = [...g.population].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const best = ranked[0]
  const moons = allRuns.filter(r => r.status === 'moon').length
  const deaths = allRuns.filter(r => r.status === 'destroyed')
  cover(doc, 'hypothetical / generation digest', `generation ${g.generation}`,
    `${g.population.length} constitutions on seeds ${g.seeds.join(' and ')}. ${moons} reached the moon, ${deaths.length} were destroyed.`)

  if (best) {
    h2(doc, 'best constitution this generation')
    facts(doc, [['name', best.name], ['average score', best.score], ['origin', best.origin]])
    if (bestRecord) { doc.moveDown(0.4); h3(doc, 'its best world'); summaryFacts(doc, bestRecord.summary) }
  }

  if (deaths.length) {
    h2(doc, 'deaths')
    for (const d of deaths) {
      h3(doc, `${d.runId}, died ${d.endDate}`, C.ember)
      if (d.causeOfDeath) para(doc, d.causeOfDeath, C.ember)
      mono(doc, `score ${d.score}   peak ${pop(d.peakPopulation)}   twin ${d.baselineStatus} ${d.baselineEndDate}`)
    }
  }

  if (leaderboard.length) {
    h2(doc, 'leaderboard, all time')
    table(doc, ['#', 'constitution', 'gen', 'score', 'best world'],
      leaderboard.slice(0, 5).map((e, i) => [i + 1, e.name, e.generation, e.score, `${e.best.status} ${e.best.endDate}`]), [0.4, 3.4, 0.6, 0.8, 1.6])
  }

  if (best) { h2(doc, `full text: ${best.name}`); para(doc, best.constitution) }
  if (bestRecord) aiVsTwin(doc, bestRecord)

  const changed = g.population.filter(c => c.origin !== 'seed')
  if (changed.length) {
    h2(doc, 'how the constitutions changed')
    for (const c of changed) {
      h3(doc, `${c.name}`)
      mono(doc, `${c.origin}${c.parents.length ? ` of ${c.parents.join(' x ')}` : ''}   score ${c.score ?? 'n/a'}`)
      if (c.changes) para(doc, c.changes)
    }
  } else {
    h2(doc, 'starting population')
    for (const c of g.population) { h3(doc, c.name); mono(doc, `seed constitution   score ${c.score ?? 'n/a'}`) }
  }
  doc.end()
  return done
}

export async function moonPdf(record: RunRecord): Promise<Buffer> {
  const s = record.summary
  const { doc, done } = makeDoc(`moon: ${s.runId}`)
  cover(doc, 'hypothetical / crewed landing', `the moon, ${s.endDate}`, `world ${s.runId}, generation ${record.generation}, seed ${record.seed}`)
  summaryFacts(doc, s)
  h2(doc, 'the constitution')
  para(doc, record.constitution)

  h2(doc, 'year by year')
  const frames = [...record.frames].sort((a, b) => a.tick - b.tick)
  let prevReligion = '', prevSchool = ''
  const arc: string[] = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const nextDecisionTick = frames.slice(i + 1).find(x => x.decision)?.tick ?? Infinity
    if (!f.decision && i !== 0) continue
    const events: WorldEvent[] = frames.filter(x => x.tick >= f.tick && x.tick < nextDecisionTick).flatMap(x => x.newEvents)
    const d = f.decision
    if (!d && !events.length) continue
    h3(doc, f.date)
    if (d?.rationale) para(doc, d.rationale)
    if (d?.laws.length) for (const l of d.laws) { doc.moveDown(0.2); para(doc, `law: ${l.title}. ${l.text}`) }
    if (d?.repeal.length) mono(doc, `repealed ${d.repeal.join(', ')}`)
    if (d?.migrations.length) for (const m of d.migrations) mono(doc, `migration ${m.from} to ${m.to}: ${pop(m.people)} (${m.reason})`)
    if (d) mono(doc, `budget  ${Object.entries(d.budget).map(([k, v]) => `${k} ${pct(v)}`).join('  ')}`)
    if (d?.respondedToOverrides.length) mono(doc, `responded to overrides ${d.respondedToOverrides.join(', ')}`)
    const big = [...events].sort((a, b) => b.severity - a.severity).slice(0, 4)
    for (const e of big) mono(doc, `${e.kind}  ${e.text}`, ['famine', 'revolt', 'war', 'disaster', 'pandemic'].includes(e.kind) && e.severity > 0.7 ? C.ember : C.muted)
    const school = `${f.schoolPolicy.purpose} (${f.schoolPolicy.yearsRequired} yrs: ${f.schoolPolicy.curriculum.join(', ')})`
    if (f.religionPolicy !== prevReligion) arc.push(`${f.date}  religion ${f.religionPolicy.replace('_', ' ')}`)
    if (school !== prevSchool) arc.push(`${f.date}  school ${school}`)
    prevReligion = f.religionPolicy; prevSchool = school
    doc.moveDown(0.3)
  }

  const last = frames[frames.length - 1]
  const laws = (last?.laws ?? []).filter(l => !l.vetoed).sort((a, b) => b.support * b.compliance - a.support * a.compliance).slice(0, 8)
  if (laws.length) {
    h2(doc, 'the laws that mattered')
    table(doc, ['law', 'enacted', 'support', 'compliance'], laws.map(l => [l.title, frames.find(f => f.tick >= l.enactedTick)?.date ?? String(l.enactedTick), pct(l.support), pct(l.compliance)]), [3.5, 1, 1, 1])
  }
  if (arc.length) { h2(doc, 'religion and school arc'); for (const a of arc) mono(doc, a, C.ink) }
  aiVsTwin(doc, record)
  doc.end()
  return done
}
