// mutation (llm rewrite through B's client: local ollama by default) and crossover (section splice).
import type { Lesson, RunSummary } from '../types'
import type { Candidate } from './store'
import { wordCount } from './seeds'
import { acquireOllamaLock, chat as llmChat, llmEnabled } from './core'

const SECTIONS = ['Values', 'Religion', 'School', 'Migration', 'Priorities']

export const noEmDash = (s: string) => s.replace(/\s*[\u2014\u2013]\s*/g, ', ')

function trimWords(text: string, max = 250) {
  const words = text.split(/(\s+)/)
  let n = 0, out = ''
  for (const w of words) {
    if (w.trim()) n++
    if (n > max) break
    out += w
  }
  return out.trim()
}

// returns null when no llm is configured or the call fails; the caller then uses the offline mutation
async function chat(prompt: string): Promise<string | null> {
  if (!llmEnabled()) return null
  // B's lockfile: never use ollama while another job holds it
  const release = await acquireOllamaLock('evolve mutation')
  try {
    return await llmChat({ system: 'You revise constitutions for a simulated world government. Reply with JSON only.', user: prompt, json: true, temperature: 0.8, maxTokens: 4096 })
  } catch (e) {
    console.log(`[evolve] mutation llm error: ${(e as Error).message}`)
    return null
  } finally {
    release()
  }
}

function deathSummary(runs: RunSummary[]) {
  return runs.map(r => {
    const ev = r.topEvents.slice(0, 3).map(e => `${e.kind}: ${e.text}`).join('; ')
    const reach = `frontier ${r.frontier}, peak period life expectancy ${r.peakPeriodLifeExpectancy.toFixed(1)}, final population ${(r.finalPopulation / 1e9).toFixed(2)}B`
    return `- world ${r.runId}: ${r.status} at ${r.endDate}, score ${r.score}, ${reach}${r.causeOfDeath ? `. cause of death: ${r.causeOfDeath}` : ''}. top events: ${ev || 'none'}`
  }).join('\n')
}

// offline fallback: append an amendment that targets the failure mode
function offlineMutation(parent: Candidate, runs: RunSummary[], salt: number): { constitution: string; changes: string } {
  const causes = runs.map(r => r.causeOfDeath).filter(Boolean).join(' ').toLowerCase()
  const fixes = [
    [/famine|food|starv/, 'Food reserves of one year per region are constitutional and are funded before every other line.'],
    [/revolt|unrest|riot/, 'When unrest rises in any region, welfare and local assemblies are expanded before any use of force.'],
    [/war/, 'Regions settle disputes through a binding planetary court; standing armies are capped.'],
    [/pandemic|disease/, 'A permanent public health corps and vaccine reserve are funded in every region.'],
    [/energy|blackout/, 'Energy capacity must grow ahead of demand by a protected annual margin.'],
  ] as const
  const hit = fixes.find(([re]) => re.test(causes))
  const amendments = [
    'The space and research shares rise each year that food and unrest targets are met.',
    'Every law is reviewed after two years and repealed if compliance stays low.',
    'Talent migration toward launch regions is subsidized once famine risk is low.',
  ]
  const add = hit ? hit[1] : amendments[salt % amendments.length]
  const text = trimWords(`${parent.constitution.trim()}\n\nAmendment. ${add}`)
  return { constitution: text, changes: `offline amendment: ${add}` }
}

export async function mutate(parent: Candidate, salt: number, lessons: Lesson[] = []): Promise<{ constitution: string; changes: string }> {
  const runs = parent.runs ?? []
  const lessonText = lessons.length ? lessons.map(l => `- ${l.rule} (mistake: ${l.mistake}; result: ${l.consequence})`).join('\n') : '- none yet'
  const sections = /\n\s*Values\./.test(parent.constitution) ? 'Keep the sections Values, Religion, School, Migration, Priorities.' : 'Keep its structure and voice.'
  const prompt = `You are revising a constitution for a single world government. The mission: prolong humanity. Longer healthy lives, a population that endures, and a self-sustaining civilization on Mars and beyond.
It was tested in simulated worlds. Results:
${deathSummary(runs)}

Lessons every earlier world taught (do not repeat these mistakes):
${lessonText}

Rewrite it. Fix what killed it or held it back, apply the lessons, keep what worked. ${sections}
Under 230 words. Plain language. No real politician or party names. Do not use em-dashes.
Respond as JSON: {"constitution": "<full new text>", "changes": "<one sentence on what you changed and why>"}

CURRENT CONSTITUTION:
${parent.constitution}`
  const raw = await chat(prompt)
  if (raw) {
    try {
      const j = JSON.parse(raw) as { constitution?: string; changes?: string }
      if (j.constitution && wordCount(j.constitution) > 40) {
        return { constitution: trimWords(noEmDash(j.constitution)), changes: noEmDash(j.changes ?? 'rewritten by groq') }
      }
    } catch {}
  }
  return offlineMutation(parent, runs, salt)
}

function splitSections(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = new RegExp(`(?:^|\\n)\\s*(${SECTIONS.join('|')})\\.`, 'g')
  const marks = [...text.matchAll(re)].map(m => ({ key: m[1], at: m.index! + m[0].indexOf(m[1]) }))
  marks.forEach((m, i) => { out[m.key] = text.slice(m.at, marks[i + 1]?.at ?? text.length).trim() })
  out.__title = text.slice(0, marks[0]?.at ?? 0).trim()
  return out
}

// section-wise splice: alternate sections between parents, deterministic in salt
export function crossover(a: Candidate, b: Candidate, salt: number): { constitution: string; changes: string } {
  const sa = splitSections(a.constitution), sb = splitSections(b.constitution)
  const picks: string[] = []
  const from: string[] = []
  SECTIONS.forEach((k, i) => {
    const useA = ((i + salt) % 2 === 0 && sa[k]) || !sb[k]
    const part = useA ? sa[k] : sb[k]
    if (part) { picks.push(part); from.push(`${k.toLowerCase()} from ${useA ? a.name : b.name}`) }
  })
  if (picks.length < 3) return { constitution: a.constitution, changes: 'crossover failed, cloned parent' }
  const title = `Charter of the Joined Path.`
  return { constitution: trimWords([title, ...picks].join('\n\n')), changes: from.join(', ') }
}
