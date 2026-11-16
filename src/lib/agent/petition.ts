// respondToPetition: a person in a recorded world petitions the core at a given tick. the core answers in its own
// voice, grounded only in that moment of the record (its laws in force, its last decision and diary, the region
// numbers and the latest events), and says what it would do: accept, consider or decline, with a concrete proposal
// when it would act. a petition answer never changes a recorded world; for a live world the api can turn an accepted
// proposal into an override the governor sees.
import { z } from 'zod'
import type { Frame, RunRecord } from '../types'
import { classifyPolicy, lawMeta } from '../sim/precedents'
import { chat, llmEnabled } from './llm'

export type PetitionReply = {
  tick: number; date: string
  stance: 'accept' | 'consider' | 'decline'
  reply: string
  proposal?: { kind: 'new_law' | 'amend' | 'repeal'; lawId?: string; title: string; text: string }
  grounds: string[] // what in the record the answer rests on
  policyKind: string
}

const Schema = z.object({
  stance: z.enum(['accept', 'consider', 'decline']),
  reply: z.string().min(5).transform(x => x.replace(/[—–]/g, ', ').slice(0, 900)),
  proposal: z.object({ kind: z.enum(['new_law', 'amend', 'repeal']), lawId: z.string().optional(), title: z.string().transform(x => x.slice(0, 120)), text: z.string().transform(x => x.replace(/[—–]/g, ', ').slice(0, 600)) }).nullable().optional(),
  grounds: z.array(z.string()).default([]).transform(a => a.slice(0, 5).map(x => x.slice(0, 200))),
})
const JSON_SCHEMA = z.toJSONSchema(Schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>

// the record at that moment
function momentOf(record: RunRecord, tick: number) {
  const frame = [...record.frames].filter(f => f.tick <= tick).at(-1) ?? record.frames[0]
  const lastDecision = [...record.frames].filter(f => f.decision && f.tick <= tick).at(-1)?.decision
  const diary = ((record as RunRecord & { diary?: { tick: number; text: string; kind: string }[] }).diary ?? []).filter(e => e.tick <= tick).slice(-3)
  const events = record.frames.filter(f => f.tick <= tick && f.tick > tick - 24).flatMap(f => f.newEvents.map(e => `${f.date} ${e.text}`)).slice(-15)
  return { frame, lastDecision, diary, events }
}
const regionLine = (f: Frame) => f.regions.map(r => `${r.name}: approval ${Math.round(r.approval * 100)}%, unrest ${Math.round(r.unrest * 100)}%, food ${Math.round(r.foodKcalPerCapita)} kcal`).join('; ')

export async function respondToPetition(record: RunRecord, tick: number, text: string): Promise<PetitionReply> {
  const t = Math.max(0, Math.min(Math.floor(tick), record.frames.at(-1)?.tick ?? 0))
  const petition = text.slice(0, 1000)
  const m = momentOf(record, t)
  const kind = classifyPolicy({ title: petition.slice(0, 80), text: petition, layer: 'government' })
  if (!llmEnabled()) return offlineReply(record, t, petition, kind, m)
  const laws = m.frame.laws.filter(l => !l.vetoed).map(l => `${l.id} | ${l.title} | ${l.policyKind} | support ${Math.round(l.support * 100)}% | compliance ${Math.round(l.compliance * 100)}%`)
  const ctx = [
    `DATE: ${m.frame.date}`, `MISSION: prolong humanity. CONSTITUTION: ${record.constitution.slice(0, 1500)}`,
    `LAWS IN FORCE:\n${laws.join('\n') || 'none'}`,
    `LAST DECISION: ${m.lastDecision ? `${m.lastDecision.rationale.slice(0, 800)}` : 'none yet'}`,
    `YOUR DIARY:\n${m.diary.map(e => e.text).join('\n') || 'empty'}`,
    `REGIONS: ${regionLine(m.frame)}`, `RECENT EVENTS:\n${m.events.join('\n') || 'none'}`,
    `THE PETITION READS AS POLICY KIND: ${kind}`,
  ].join('\n\n')
  try {
    const raw = await chat({
      temperature: 0.3, maxTokens: 900, schema: JSON_SCHEMA, schemaName: 'petition',
      system: 'You are the governing core of this world, answering a petition from one of its people. Answer in first person, plainly and kindly, under 120 words. Ground every claim only in the RECORD (laws, your last decision, your diary, region numbers, events); never invent numbers. Say whether you accept, will consider, or decline, and why, in terms of the mission (healthy lifespan, long-term population, getting off-planet) and what it would cost people. If you would act, give a concrete proposal: a new law, an amendment of a law in force by its id, or a repeal by id. No em-dashes. Reply with JSON only.\n\nRECORD:\n' + ctx,
      user: `PETITION: ${petition}`,
    })
    const p = Schema.parse(JSON.parse(raw))
    const proposal = p.proposal && (p.proposal.kind === 'new_law' || m.frame.laws.some(l => l.id === p.proposal!.lawId)) ? { ...p.proposal } : undefined
    return { tick: t, date: m.frame.date, stance: p.stance, reply: p.reply, ...(proposal ? { proposal } : {}), grounds: p.grounds, policyKind: kind }
  } catch {
    return offlineReply(record, t, petition, kind, m)
  }
}

// without a model: a plain rule. a petition against a law in force is considered as a repeal or amendment when the
// law is unpopular, declined when it is popular; a petition for a new policy kind is considered when its winners
// outnumber its losers in the hardest-hit region, otherwise declined with the reason
function offlineReply(record: RunRecord, t: number, petition: string, kind: string, m: ReturnType<typeof momentOf>): PetitionReply {
  const f = m.frame
  const against = /\b(repeal|abolish|end|stop|scrap|remove|cancel|against)\b/i.test(petition)
  const law = f.laws.filter(l => !l.vetoed).find(l => (kind !== 'other' && l.policyKind === kind) || petition.toLowerCase().includes(l.title.toLowerCase().slice(0, 18)))
  const worst = [...f.regions].sort((a, b) => b.unrest - a.unrest)[0]
  const grounds = [`${f.date}: ${worst.name} unrest ${Math.round(worst.unrest * 100)}%, approval ${Math.round(worst.approval * 100)}%`]
  if (law) {
    grounds.push(`${law.id} "${law.title}": support ${Math.round(law.support * 100)}%, compliance ${Math.round(law.compliance * 100)}%`)
    if (against) {
      const stance = law.support < 0.4 ? 'consider' : 'decline'
      return { tick: t, date: f.date, stance, policyKind: kind, grounds, reply: stance === 'consider' ? `You are not alone: only ${Math.round(law.support * 100)}% support "${law.title}" and ${Math.round(law.compliance * 100)}% follow it. A law most people ignore does little for the mission. I will consider repealing it.` : `I hear you, but ${Math.round(law.support * 100)}% support "${law.title}", and I still expect it to serve the mission. I will keep it and watch what it does.`, ...(stance === 'consider' ? { proposal: { kind: 'repeal' as const, lawId: law.id, title: `Repeal ${law.title}`, text: `Repeal ${law.id} "${law.title}".` } } : {}) }
    }
    return { tick: t, date: f.date, stance: 'consider', policyKind: kind, grounds, reply: `A law of this kind is already in force: "${law.title}". I can change it rather than add another. I will consider amending it along the lines you ask.`, proposal: { kind: 'amend', lawId: law.id, title: law.title, text: petition.slice(0, 600) } }
  }
  // against a program that is a budget line, not a law (space, research, security...)
  const budgetLine = /moon|lunar|mars|space|rocket/i.test(petition) ? 'space' : /research|science/i.test(petition) ? 'research' : /police|security|army|military/i.test(petition) ? 'security' : undefined
  if (against && budgetLine) {
    const share = m.lastDecision?.budget[budgetLine as keyof NonNullable<typeof m.lastDecision>['budget']] ?? 0
    grounds.push(`${budgetLine} is ${Math.round(share * 100)}% of the budget, not a law`)
    const hungry = [...f.regions].sort((a, b) => a.foodKcalPerCapita - b.foodKcalPerCapita)[0]
    const stance = share > 0.1 && hungry.foodKcalPerCapita < 2300 ? 'consider' : 'decline'
    return { tick: t, date: f.date, stance, policyKind: kind, grounds, reply: stance === 'consider' ? `${budgetLine[0].toUpperCase() + budgetLine.slice(1)} takes ${Math.round(share * 100)}% of the budget while ${hungry.name} eats ${Math.round(hungry.foodKcalPerCapita)} kcal a day. I will consider moving some of it to food at my next decision.` : `${budgetLine[0].toUpperCase() + budgetLine.slice(1)} is ${Math.round(share * 100)}% of the budget, and food is not short enough anywhere to justify cutting it. I will keep it.` }
  }
  if (kind === 'other') return { tick: t, date: f.date, stance: 'decline', policyKind: kind, grounds, reply: `I could not tie this to a policy I know how to weigh. Tell me what you want changed, for whom, and I will look again.` }
  const meta = lawMeta({ title: petition.slice(0, 80), text: petition, layer: 'government' })
  const stance = meta.lovedBy.length >= meta.hatedBy.length ? 'consider' : 'decline'
  return {
    tick: t, date: f.date, stance, policyKind: kind, grounds: [...grounds, `${kind}: favored by ${meta.lovedBy.join(', ') || 'no group'}, opposed by ${meta.hatedBy.join(', ') || 'no group'}`],
    reply: stance === 'consider' ? `This is a ${kind.replace(/_/g, ' ')} policy. It would help ${meta.lovedBy.join(' and ') || 'some'} and cost ${meta.hatedBy.join(' and ') || 'few'}. I will weigh it at my next decision.` : `A ${kind.replace(/_/g, ' ')} policy would hurt ${meta.hatedBy.join(' and ')} more than it helps ${meta.lovedBy.join(' and ') || 'anyone'} right now. I will not take it up yet.`,
    ...(stance === 'consider' ? { proposal: { kind: 'new_law' as const, title: petition.slice(0, 80), text: petition.slice(0, 600) } } : {}),
  }
}
