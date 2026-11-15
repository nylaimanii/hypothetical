'use client'
// cause chains (B): one plain line by default, the whole chain on tap.
// drought -> prices -> protests -> law -> result, each step with its date and number, each one a jump on the timeline
import { useMemo, useState } from 'react'
import type { CauseLink, Citizen, Frame, Layer, Reasoning, RunRecord, Story } from '@/lib/types'
import { useStore } from '../state/store'
import { Num } from './bits'

const yearOf = (tick: number) => 2026 + Math.floor((tick + 10) / 12)

// every link the world made up to the current frame
export function useLinks(record: RunRecord, idx: number) {
  return useMemo(() => {
    const m = new Map<string, CauseLink>()
    for (let i = 0; i <= idx && i < record.frames.length; i++) for (const l of record.frames[i].causes ?? []) m.set(l.id, l)
    return m
  }, [record, idx])
}

const num = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}k` : Math.abs(v) < 1 ? `${Math.round(v * 100)}%` : `${Math.round(v)}`)

export function jumpTo(l: CauseLink, frame: Frame) {
  const s = useStore.getState()
  s.setPlaying(false)
  s.setPlayhead(l.tick)
  if (frame.regions.some((r) => r.id === l.placeId)) s.requestShot({ target: 'region', regionId: l.placeId, force: true })
}

export function ChainList({ ids, links, frame }: { ids: string[]; links: Map<string, CauseLink>; frame: Frame }) {
  const steps = ids.map((id) => links.get(id)).filter(Boolean) as CauseLink[]
  if (!steps.length) return null
  return (
    <ol className="mt-2 space-y-0.5 border-l border-ink/15 pl-3">
      {steps.map((l) => (
        <li key={l.id}>
          <button onClick={() => jumpTo(l, frame)} className="group flex w-full items-baseline gap-2 text-left text-[12px] leading-snug hover:text-ink">
            <Num className="w-9 shrink-0 text-[10.5px] text-ink/45">{yearOf(l.tick)}</Num>
            <span className="text-ink/80 group-hover:underline group-hover:decoration-ink/25 group-hover:underline-offset-2">{l.what}</span>
            {l.value !== 0 && !l.stat && <Num className="ml-auto shrink-0 text-[10.5px] text-ink/45">{num(l.value)}</Num>}
          </button>
        </li>
      ))}
    </ol>
  )
}

// the one-line story; tap for its chain
export function StoryLine({ story, links, frame, fallback }: { story?: Story | null; links: Map<string, CauseLink>; frame: Frame; fallback: string }) {
  const [open, setOpen] = useState(false)
  const line = story?.sentences[0]
  if (!line) return <p className="text-[12.5px] leading-snug text-ink/75">{fallback}</p>
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="text-left text-[12.5px] leading-snug text-ink/80 hover:text-ink" aria-expanded={open}>
        {line} <span className="text-[11px] text-ink/45">{open ? 'hide' : 'how'}</span>
      </button>
      {open && <ChainList ids={story!.chainIds[0] ?? []} links={links} frame={frame} />}
    </div>
  )
}

// "why jonas is protesting: ..." from what the person is doing and the chains around them
const DOING: Partial<Record<Citizen['behavior'], string>> = {
  protesting: 'protesting', striking: 'on strike', rioting: 'rioting', migrating: 'leaving', moving_to_new_city: 'moving to a new city', hoarding: 'hoarding', panic_buying: 'panic buying',
  celebrating: 'celebrating', praying: 'praying', volunteering: 'volunteering', starting_family: 'starting a family', conspiracy_posting: 'posting conspiracies', idle: 'out of work', working: 'at work',
}
export function whyDoing(c: Citizen, frame: Frame, links: Map<string, CauseLink>): string | null {
  const doing = DOING[c.behavior]
  if (!doing || c.behavior === 'working') return null
  const first = c.name.split(' ')[0]
  const region = frame.regions.find((r) => r.id === c.regionId)
  const recent = [...links.values()].filter((l) => l.placeId === c.regionId && frame.tick - l.tick <= 24 && !l.stat).sort((a, b) => b.tick - a.tick)
  const outraged = region?.crowds.find((x) => x.phase === 'outraged' || x.phase === 'alarmed')
  let because: string | undefined
  if (['protesting', 'striking', 'rioting'].includes(c.behavior)) because = outraged ? `the crowd is angry about ${outraged.topic}` : recent.find((l) => l.byWhom === 'core')?.what.toLowerCase()
  else if (['hoarding', 'panic_buying'].includes(c.behavior)) because = recent.find((l) => /food|grain|harvest|famine|price/i.test(l.what))?.what.toLowerCase() ?? (region && region.foodKcalPerCapita < 2300 ? `food here is down to ${Math.round(region.foodKcalPerCapita)} kcal a day` : undefined)
  else if (['migrating', 'moving_to_new_city'].includes(c.behavior)) because = frame.flows?.find((f) => f.from === c.regionId)?.reason ?? recent[0]?.what.toLowerCase()
  else if (c.behavior === 'celebrating') because = recent.find((l) => l.byWhom === 'core' || /launch|landing|breakthrough/i.test(l.what))?.what.toLowerCase()
  else if (c.behavior === 'idle') because = c.employed === false ? 'they lost their job' : undefined
  because ??= recent[0]?.because ?? c.thought.split('.')[0].toLowerCase()
  return `why ${first} is ${doing}: ${because}`
}

// layer cards: one sentence on what changed and why
const LAYER_WORD: Partial<Record<Layer, string>> = { religion: 'faith', economy: 'the economy', government: 'trust in the core', tech: 'technology', family: 'family life', biology: 'health', media: 'the news', physics: 'the launch program' }
export function layerSentence(layer: Layer, regionId: string, record: RunRecord, idx: number, series: number[]): string | null {
  if (series.length < 2) return null
  const from = Math.max(0, series.length - 1 - 60)
  const a = series[from], b = series[series.length - 1]
  if (!a && !b) return null
  const change = a ? (b - a) / Math.abs(a) : 0
  const word = LAYER_WORD[layer] ?? layer
  const region = record.frames[idx]?.regions.find((r) => r.id === regionId)
  // the biggest thing that happened there in that window
  let big: { text: string; tick: number; s: number } | null = null
  for (let i = from; i <= idx && i < record.frames.length; i++) for (const e of record.frames[i].newEvents) if (e.regionId === regionId && e.kind !== 'law' && (!big || e.severity > big.s)) big = { text: e.text, tick: record.frames[i].tick, s: e.severity }
  const dir = Math.abs(change) < 0.03 ? 'held steady' : change > 0 ? `rose ${Math.round(change * 100)}%` : `fell ${Math.round(-change * 100)}%`
  return `${word} ${dir} in ${region?.name ?? 'this region'} since ${yearOf(record.frames[from].tick)}${big ? `, after ${big.text.toLowerCase()} in ${yearOf(big.tick)}` : ''}.`
}

// the core's decision in two short lines: what it saw -> what it chose, and why
export function ReasoningLines({ r, className = '' }: { r?: Reasoning; className?: string }) {
  if (!r) return null
  return (
    <div className={`text-[12.5px] leading-snug ${className}`}>
      <div><span className="text-ink/45">saw</span> {r.saw.slice(0, 2).join(', ')} <span className="text-ink/35">→</span> <span className="text-ink/45">chose</span> {r.chose.slice(0, 2).join(', ')}</div>
      <div className="text-ink/70"><span className="text-ink/45">why</span> {r.expected}</div>
    </div>
  )
}
