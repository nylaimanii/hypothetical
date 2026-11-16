'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Step } from '@/lib/types'
import { worldSteps, type WorldStep } from '@/lib/mock/steps'
import { useStore } from '../../state/store'
import { Num } from '../bits'
import { yearOfTick, type ViewWorld } from './shared'

const HELP = '#3f6b4e' // green-ish ink: helped
const KINDS: Record<Step['kind'], string> = { law: 'law', budget: 'budget', policy: 'policy', city: 'city', research: 'research' }

function Kind({ k }: { k: Step['kind'] }) {
  return <span className="shrink-0 rounded border border-ink/20 px-1 font-mono text-[9px] uppercase tracking-wide text-ink/60">{KINDS[k]}</span>
}

// diverging bar around a center line: help grows right, harm grows left
function Effect({ v, max, deaths }: { v: number; max: number; deaths?: boolean }) {
  const w = Math.min(1, Math.abs(v) / (max || 1)) * 50
  return (
    <div className="relative h-2.5 w-28 shrink-0" title={`effect ${v >= 0 ? '+' : ''}${v.toFixed(2)}`}>
      <div className="absolute inset-y-0 left-1/2 w-px bg-ink/25" />
      <div className={`absolute inset-y-0 ${v >= 0 ? 'rounded-r-[3px]' : 'rounded-l-[3px]'}`}
        style={{ left: v >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: v >= 0 ? HELP : deaths ? 'var(--ember)' : 'color-mix(in srgb, var(--ink) 35%, transparent)' }} />
    </div>
  )
}

function StepRow({ s, max }: { s: WorldStep; max: number }) {
  return (
    <li>
      <button onClick={() => useStore.getState().setPlayhead(s.tick)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink/5">
        <Kind k={s.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2"><span className="truncate text-[13px]">{s.text}</span><Num className="text-[10.5px] text-ink/45">{yearOfTick(s.tick)}</Num></div>
          <p className={`text-[11.5px] ${s.deathsUp && s.effect < 0 ? 'text-ember' : 'text-ink/60'}`}>{s.why}</p>
        </div>
        <Effect v={s.effect} max={max} deaths={s.deathsUp} />
      </button>
    </li>
  )
}

function Dots({ ids, worlds, hurt }: { ids: string[]; worlds: ViewWorld[]; hurt?: boolean }) {
  const open = worlds.filter((w) => ids.includes(w.record.runId))
  const rest = ids.length - open.length
  if (!ids.length) return null
  return (
    <span className="flex items-center gap-1">
      <span className="text-[10px] text-ink/50">{hurt ? 'hurt' : 'helped'}</span>
      {open.map((w) => <span key={w.record.runId} title={w.label} className="h-2.5 w-2.5 rounded-full" style={hurt ? { border: `2px solid ${w.color}` } : { background: w.color }} />)}
      {rest > 0 && <Num className="text-[10px] text-ink/50">+{rest}</Num>}
    </span>
  )
}

function useRecipe(worlds: ViewWorld[]) {
  const ids = worlds.map((w) => w.record.runId).join(',')
  const [api, setApi] = useState<{ ids: string; steps: Step[] } | null>(null)
  useEffect(() => {
    let stop = false
    fetch(`/api/steps?runs=${encodeURIComponent(ids)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (!stop && Array.isArray(b) && b.length) setApi({ ids, steps: b as Step[] }) })
      .catch(() => {})
    return () => { stop = true }
  }, [ids])
  // the recipe only from the api (no invented confidence): nothing until it answers
  return api && api.ids === ids ? { steps: api.steps, mock: false } : { steps: [] as Step[], mock: false }
}

export default function Steps({ worlds }: { worlds: ViewWorld[] }) {
  const active = worlds.find((w) => w.active) ?? worlds[0]
  const mine = useMemo(() => (active ? worldSteps(active.record) : []), [active])
  const recipe = useRecipe(worlds)
  if (!active) return null
  const dead = active.record.summary.status === 'destroyed'
  const killers = dead ? [...mine].filter((s) => s.effect < 0).sort((a, b) => a.effect - b.effect).slice(0, 5) : []
  const ranked = mine.slice(0, 16)
  const max = Math.max(0.001, ...mine.map((s) => Math.abs(s.effect)))
  const help = recipe.steps.filter((s) => s.effect > 0).slice(0, 10)
  const avoid = [...recipe.steps].filter((s) => s.effect < 0).sort((a, b) => a.effect * b.confidence - b.effect * a.confidence).slice(0, 6)
  const rmax = Math.max(0.001, ...recipe.steps.map((s) => Math.abs(s.effect)))
  const recipeRow = (s: Step) => (
    <li key={s.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5">
      <Kind k={s.kind} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{s.text}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <Dots ids={s.helpedWorlds} worlds={worlds} />
          <Dots ids={s.hurtWorlds} worlds={worlds} hurt />
          <span className="text-[10px] text-ink/45">confidence <Num>{Math.round(s.confidence * 100)}%</Num></span>
        </div>
      </div>
      <Effect v={s.effect} max={rmax} deaths={s.effect < 0 && s.hurtWorlds.length > 0} />
    </li>
  )

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-2">
      <section className="scroll-thin flex min-h-0 flex-col gap-3 overflow-y-auto rounded-xl border border-ink/10 bg-bone/60 p-3">
        {killers.length > 0 && (
          <div id="steps-killed">
            <h3 className="font-display text-[17px] text-ember">the steps that killed it</h3>
            <p className="mb-1 text-[11.5px] text-ink/55">{active.label}: the decisions followed by the worst turns, worst first</p>
            <ul>{killers.map((s) => <StepRow key={s.key} s={s} max={max} />)}</ul>
          </div>
        )}
        <div>
          <h3 className="font-display text-[17px]">this world&apos;s key decisions</h3>
          <p className="mb-1 text-[11.5px] text-ink/55">ranked by impact: how life expectancy, approval and growth moved in the 2 years after, compared with the 2 before. click one to jump there</p>
          {ranked.length ? <ul>{ranked.map((s) => <StepRow key={s.key} s={s} max={max} />)}</ul> : <p className="text-[12px] text-ink/50">no decisions with enough history around them yet</p>}
        </div>
      </section>
      <section className="scroll-thin flex min-h-0 flex-col gap-3 overflow-y-auto rounded-xl border border-ink/10 bg-bone/60 p-3">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-[17px]">the recipe across worlds</h3>
            {recipe.mock && <span className="rounded border border-dashed border-ink/25 px-1 font-mono text-[9px] uppercase tracking-wide text-ink/50">estimate</span>}
          </div>
          <p className="mb-1 text-[11.5px] text-ink/55">steps that kept worlds going, across every open world. filled dots helped that world, rings were in worlds that went worse</p>
          {help.length > 0 && <ul>{help.map(recipeRow)}</ul>}
        </div>
        {avoid.length > 0 && (
          <div>
            <h3 className="font-display text-[15px]">steps to avoid</h3>
            <ul>{avoid.map(recipeRow)}</ul>
          </div>
        )}
      </section>
    </div>
  )
}
