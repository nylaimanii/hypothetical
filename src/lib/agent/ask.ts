// askCore: the governing core answers questions about its own world, in first person, grounded only in
// what the run record contains (its decisions, rationales, laws and events).
import type { RunRecord } from '../types'
import { chat, groqAvailable } from './groq'

const MODEL = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']

function recordContext(record: RunRecord): string {
  const decisions = record.frames.filter(f => f.decision).map(f => ({
    date: f.date,
    rationale: f.decision!.rationale,
    publicStatement: f.decision!.publicStatement,
    laws: f.decision!.laws.map(l => l.title),
    repealed: f.decision!.repeal,
    migrations: f.decision!.migrations.map(m => `${m.from}->${m.to} ${m.people}`),
    budget: f.decision!.budget,
    religionPolicy: f.decision!.religionPolicy,
    respondedToOverrides: f.decision!.respondedToOverrides,
  }))
  const events = record.frames.flatMap(f => f.newEvents.map(e => ({ date: f.date, kind: e.kind, region: e.regionId, text: e.text })))
  const last = record.frames[record.frames.length - 1]
  const lawsNow = last?.laws.map(l => ({ title: l.title, support: l.support, compliance: l.compliance, vetoed: !!l.vetoed })) ?? []
  const ctx = {
    constitution: record.constitution,
    outcome: { status: record.summary.status, endDate: record.summary.endDate, frontier: record.summary.frontier, peakPeriodLifeExpectancy: record.summary.peakPeriodLifeExpectancy, causeOfDeath: record.summary.causeOfDeath, humanCost: record.summary.humanCost },
    decisions,
    lawsAtEnd: lawsNow,
    events: events.slice(-200),
  }
  let s = JSON.stringify(ctx)
  // keep within model context: trim oldest decisions first
  while (s.length > 90_000 && ctx.decisions.length > 4) { ctx.decisions.splice(0, 1); s = JSON.stringify(ctx) }
  return s
}

export async function askCore(record: RunRecord, question: string): Promise<string> {
  const q = question.slice(0, 1000)
  if (!groqAvailable()) return offlineAnswer(record, q)
  try {
    const out = await chat({
      model: MODEL, temperature: 0.3, maxTokens: 2000,
      system: 'You are the governing core of this simulated world. Answer in first person as the core. Ground every claim only in the RECORD below: your decisions, rationales, laws and events. If the record does not say, answer that you do not know. Never invent numbers. Plain language, no em-dashes, under 180 words.\n\nRECORD:\n' + recordContext(record),
      user: q,
    })
    return out.replace(/[—–]/g, ', ').trim() || offlineAnswer(record, q)
  } catch {
    return offlineAnswer(record, q)
  }
}

function offlineAnswer(record: RunRecord, _q: string): string {
  const ds = record.frames.filter(f => f.decision)
  const last = ds[ds.length - 1]
  const s = record.summary
  const end = s.status === 'goal_achieved' ? `we reached the goal in ${s.endDate}: a self-sustaining mars, 200 year lives, a growing population` : s.status === 'destroyed' ? `the world ended in ${s.endDate}: ${s.causeOfDeath ?? 'collapse'}` : s.status === 'complete' ? `we reached ${s.endDate} with the frontier at ${s.frontier}` : `the world is still running at ${s.endDate}`
  return `I cannot reason freely right now, so I can only point to my record. ${end[0].toUpperCase()}${end.slice(1)}. ${last ? `My last decision, in ${last.date}, said: ${last.decision!.rationale}` : 'I have not made a decision yet.'}`
}
