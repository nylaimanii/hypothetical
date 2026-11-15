'use client'
import { useState } from 'react'
import type { Budget, WorldEvent } from '@/lib/types'
import { useCurrentFrame, useStore } from '../state/store'
import { Num, fmt } from './bits'
import { sendOverride } from './actions'

const KINDS: WorldEvent['kind'][] = ['disaster', 'famine', 'revolt', 'pandemic', 'war', 'breakthrough']
const KEYS: (keyof Budget)[] = ['food', 'energy', 'education', 'space', 'security', 'welfare', 'research']

export default function LivePanel() {
  const liveRunId = useStore((s) => s.liveRunId)
  const offline = useStore((s) => s.runnerOffline)
  const setLive = useStore((s) => s.setLive)
  const select = useStore((s) => s.select)
  const { frame } = useCurrentFrame()
  const [tab, setTab] = useState<'inject' | 'budget' | 'veto'>('inject')
  const [kind, setKind] = useState<WorldEvent['kind']>('disaster')
  const [region, setRegion] = useState(frame.regions[0]?.id ?? '')
  const [severity, setSeverity] = useState(0.7)
  const [budget, setBudget] = useState<Budget | null>(null)
  if (!liveRunId) return null
  const b = budget ?? frame.budget
  const laws = frame.laws.filter((l) => !l.vetoed)
  return (
    <div className="panel pointer-events-auto w-72 p-4">
      <div className="flex items-center justify-between">
        <div className="font-display text-[17px]">mess with it</div>
        <button onClick={() => setLive(null)} className="text-[11px] text-ink/50 hover:text-ink">end</button>
      </div>
      {offline && <div className="mt-0.5 text-[11px] text-ink/45">runner offline · changes apply locally</div>}
      <div className="mt-3 flex gap-1 text-[12px]">
        {(['inject', 'budget', 'veto'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 ${tab === t ? 'bg-ink text-bone' : 'text-ink/60 hover:bg-ink/5'}`}>{t}</button>
        ))}
      </div>
      {tab === 'inject' && (
        <div className="mt-3 space-y-2 text-[12px]">
          <div className="flex flex-wrap gap-1">
            {KINDS.map((k) => (
              <button key={k} onClick={() => setKind(k)} className={`rounded-full border px-2 py-0.5 ${kind === k ? 'border-ink bg-ink text-bone' : 'border-ink/20'}`}>{k}</button>
            ))}
          </div>
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="w-full rounded-lg border border-ink/20 bg-bone px-2 py-1">
            {frame.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <label className="flex items-center gap-2">
            <span className="w-14 text-ink/60">severity</span>
            <input type="range" min={0.1} max={1} step={0.05} value={severity} onChange={(e) => setSeverity(+e.target.value)} className="flex-1" />
            <Num className="w-8 text-right">{severity.toFixed(2)}</Num>
          </label>
          <button onClick={() => { sendOverride({ kind: 'inject_event', eventKind: kind, regionId: region, severity }); select({ kind: 'region', id: region }) }}
            className="w-full rounded-full bg-ink py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-bone">inject</button>
        </div>
      )}
      {tab === 'budget' && (
        <div className="mt-3 space-y-1.5 text-[12px]">
          {KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2">
              <span className="w-16 text-ink/60">{k}</span>
              <input type="range" min={0} max={0.6} step={0.01} value={b[k]} onChange={(e) => setBudget({ ...b, [k]: +e.target.value })} className="flex-1" />
              <Num className="w-9 text-right">{fmt.pct(b[k])}</Num>
            </label>
          ))}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setBudget(null)} className="flex-1 rounded-full border border-ink/25 py-1.5 text-[11px]">reset</button>
            <button disabled={!budget} onClick={() => { if (budget) sendOverride({ kind: 'force_budget', budget }); setBudget(null) }}
              className="flex-1 rounded-full bg-ink py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-bone disabled:opacity-40">force</button>
          </div>
        </div>
      )}
      {tab === 'veto' && (
        <ul className="scroll-thin mt-3 max-h-56 space-y-1 overflow-y-auto">
          {laws.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 text-[12.5px]">
              <button onClick={() => select({ kind: 'law', id: l.id })} className="truncate text-left hover:underline">{l.title}</button>
              <button onClick={() => sendOverride({ kind: 'veto_law', lawId: l.id })} className="shrink-0 rounded-full border border-ink/30 px-2 py-0.5 font-mono text-[10px] uppercase hover:bg-ink hover:text-bone">veto</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
