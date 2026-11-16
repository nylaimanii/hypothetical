'use client'
import { useMemo } from 'react'
import { dateOfTick, populationOf } from '../truth'
import type { Citizen, Emotion, Frame } from '@/lib/types'
import { dominant } from '@/lib/mock/mood'
import { frameIndexAt, useStore } from '../../state/store'
import { fmt, Num } from '../bits'
import { hash, type ViewWorld } from './shared'

const BANDS = [[0, 9], [10, 19], [20, 29], [30, 39], [40, 49], [50, 59], [60, 69], [70, 79], [80, 200]] as const

// an original line-drawn face per emotion: mouth, brows and eyes change, nothing else
const FACE: Record<Emotion, { mouth: string; brows?: string; eyes?: 'dot' | 'wide' | 'flat' | 'squint'; extra?: string }> = {
  joy: { mouth: 'M7 13.5 Q11 17.5 15 13.5' },
  hope: { mouth: 'M8 14 Q11 15.8 14 14', extra: 'M11 1.5 L11 4 M9.5 2.8 L12.5 2.8' },
  pride: { mouth: 'M8 14 Q11 16 14 13', brows: 'M6 6.5 L9 6 M13 6 L16 6.5' },
  awe: { mouth: 'M11 13 m-2 0 a2 2.4 0 1 0 4 0 a2 2.4 0 1 0 -4 0', eyes: 'wide' },
  fear: { mouth: 'M7.5 15 Q9 13.5 10.5 15 Q12 16.5 13.5 15 Q14.5 14 15 15', brows: 'M6 7 L9 5.8 M13 5.8 L16 7', eyes: 'wide' },
  anger: { mouth: 'M7.5 15.5 Q11 12.5 14.5 15.5', brows: 'M6 5.6 L9.5 7.2 M12.5 7.2 L16 5.6' },
  grief: { mouth: 'M8 15.5 Q11 13 14 15.5', brows: 'M6 7.2 L9 6 M13 6 L16 7.2', extra: 'M8 10.5 Q7.4 12.2 8 13 Q8.6 12.2 8 10.5' },
  envy: { mouth: 'M8 14.5 L14 13.5', eyes: 'squint', brows: 'M6 6.5 L9 6.5' },
  boredom: { mouth: 'M8 14.5 L14 14.5', eyes: 'flat' },
  distrust: { mouth: 'M8 14.5 Q11 13.2 14 14.8', eyes: 'squint', brows: 'M6 6 L9 7 M13 6.4 L16 6.4' },
}

export function EmotionFace({ e, size = 22 }: { e: Emotion; size?: number }) {
  const f = FACE[e]
  const eyes = f.eyes ?? 'dot'
  return (
    <svg viewBox="0 0 22 22" width={size} height={size} className="shrink-0 text-ink" aria-label={e} role="img">
      <circle cx={11} cy={11} r={9.5} fill="var(--bone)" stroke="currentColor" strokeWidth={1.3} />
      {eyes === 'dot' && <><circle cx={8} cy={9} r={1.1} fill="currentColor" /><circle cx={14} cy={9} r={1.1} fill="currentColor" /></>}
      {eyes === 'wide' && <><circle cx={8} cy={9} r={1.7} fill="none" stroke="currentColor" strokeWidth={1.1} /><circle cx={14} cy={9} r={1.7} fill="none" stroke="currentColor" strokeWidth={1.1} /></>}
      {eyes === 'flat' && <path d="M6.8 9.2 L9.2 9.2 M12.8 9.2 L15.2 9.2" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />}
      {eyes === 'squint' && <path d="M6.8 9 Q8 8.2 9.2 9 M12.8 9 Q14 8.2 15.2 9" stroke="currentColor" strokeWidth={1.2} fill="none" strokeLinecap="round" />}
      {f.brows && <path d={f.brows} stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" fill="none" />}
      <path d={f.mouth} stroke="currentColor" strokeWidth={1.3} fill="none" strokeLinecap="round" />
      {f.extra && <path d={f.extra} stroke="currentColor" strokeWidth={1} fill="none" strokeLinecap="round" />}
    </svg>
  )
}

function Block({ title, sub, children, className = '' }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 flex-col rounded-xl border border-ink/10 bg-bone/60 p-3 ${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2"><h3 className="font-display text-[15px]">{title}</h3>{sub && <span className="text-[10.5px] text-ink/50">{sub}</span>}</div>
      {children}
    </section>
  )
}

function Pyramid({ frame }: { frame: Frame }) {
  const cs = frame.citizens
  const scale = cs.length ? populationOf(frame) / cs.length : 0
  const rows = BANDS.map(([lo, hi]) => ({
    label: hi > 100 ? `${lo}+` : `${lo} to ${hi}`,
    f: cs.filter((c) => c.sex === 'female' && c.age >= lo && c.age <= hi).length * scale,
    m: cs.filter((c) => c.sex === 'male' && c.age >= lo && c.age <= hi).length * scale,
  })).reverse()
  const max = Math.max(1, ...rows.flatMap((r) => [r.f, r.m]))
  return (
    <Block title="age and sex" sub={`estimated from ${cs.length} sampled citizens`}>
      <div className="mb-1 grid grid-cols-[1fr_4.2rem_1fr] text-[10.5px] text-ink/50"><span className="text-right">women</span><span /><span>men</span></div>
      <div className="flex flex-1 flex-col justify-between gap-1">
        {rows.map((r) => (
          <div key={r.label} className="group grid grid-cols-[1fr_4.2rem_1fr] items-center text-[11px]" title={`${r.label}: ${fmt.people(r.f)} women, ${fmt.people(r.m)} men`}>
            <div className="flex items-center justify-end gap-1.5">
              {r.f > 0 && <Num className="text-[10px] text-ink/45 opacity-0 group-hover:opacity-100">{fmt.people(r.f)}</Num>}
              <div className="h-3.5 rounded-l-[3px] bg-ink/70" style={{ width: `${(r.f / max) * 100}%` }} />
            </div>
            <Num className="text-center text-[10px] text-ink/55">{r.label}</Num>
            <div className="flex items-center gap-1.5">
              <div className="h-3.5 rounded-r-[3px] bg-ink/35" style={{ width: `${(r.m / max) * 100}%` }} />
              {r.m > 0 && <Num className="text-[10px] text-ink/45 opacity-0 group-hover:opacity-100">{fmt.people(r.m)}</Num>}
            </div>
          </div>
        ))}
      </div>
    </Block>
  )
}

function ByRegion({ frame }: { frame: Frame }) {
  const rs = [...frame.regions].sort((a, b) => b.population - a.population)
  const max = Math.max(1, ...rs.map((r) => r.population))
  return (
    <Block title="where people live" sub="by region">
      <div className="flex flex-col gap-1">
        {rs.map((r) => (
          <button key={r.id} onClick={() => useStore.getState().select({ kind: 'region', id: r.id })} className="grid grid-cols-[7.5rem_1fr_3.6rem] items-center gap-2 rounded text-left text-[11.5px] hover:bg-ink/5">
            <span className="truncate">{r.name}</span>
            <span className="h-2.5 rounded-r-[3px] bg-ink/60" style={{ width: `${(r.population / max) * 100}%` }} />
            <Num className="text-right text-[11px]">{fmt.people(r.population)}</Num>
          </button>
        ))}
      </div>
    </Block>
  )
}

function OffWorld({ frame }: { frame: Frame }) {
  const assets = (frame.space ?? []).filter((a) => a.status === 'active' && (a.population ?? 0) > 0)
  const cities = frame.cities.filter((c) => c.offWorld && c.population > 0)
  const total = assets.reduce((a, x) => a + (x.population ?? 0), 0) + cities.reduce((a, c) => a + c.population, 0)
  if (total <= 0) return null
  return (
    <Block title="off-world" sub="people living beyond earth">
      <Num className="font-display text-[30px] leading-none">{fmt.people(total)}</Num>
      <ul className="mt-2 space-y-0.5 text-[11.5px] text-ink/70">
        {assets.map((a) => <li key={a.id} className="flex justify-between gap-2"><span className="truncate">{a.label}</span><Num>{fmt.people(a.population ?? 0)}</Num></li>)}
        {cities.map((c) => <li key={c.id} className="flex justify-between gap-2"><span className="truncate">{c.name}, {c.offWorld}</span><Num>{fmt.people(c.population)}</Num></li>)}
      </ul>
    </Block>
  )
}

// 12 voices: spread across regions and feelings, stable for the same frame
function pickVoices(frame: Frame): { c: Citizen; e: Emotion }[] {
  const pool = frame.citizens.filter((c) => c.thought).map((c) => ({ c, e: dominant(c.mood), h: hash(c.id) })).sort((a, b) => a.h - b.h)
  const out: typeof pool = []
  const regions = new Map<string, number>(), emos = new Map<string, number>()
  for (let round = 1; out.length < 12 && round <= 4; round++) {
    for (const p of pool) {
      if (out.length >= 12) break
      if (out.includes(p)) continue
      if ((regions.get(p.c.regionId) ?? 0) >= round || (emos.get(p.e) ?? 0) >= round * 2) continue
      out.push(p)
      regions.set(p.c.regionId, (regions.get(p.c.regionId) ?? 0) + 1)
      emos.set(p.e, (emos.get(p.e) ?? 0) + 1)
    }
  }
  return out
}

function Voices({ frame }: { frame: Frame }) {
  const voices = useMemo(() => pickVoices(frame), [frame])
  if (!voices.length) return null
  const regionName = (id: string) => frame.regions.find((r) => r.id === id)?.name ?? id
  return (
    <Block title="voices" sub="what people are thinking right now. click one for their story" className="col-span-full">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
        {voices.map(({ c, e }) => (
          <button key={c.id} onClick={() => useStore.getState().select({ kind: 'pip', id: c.id })} className="flex gap-2 rounded-lg border border-ink/10 bg-bone p-2 text-left hover:border-ink/30">
            <div className="flex flex-col items-center gap-0.5"><EmotionFace e={e} /><span className="text-[9.5px] text-ink/50">{e}</span></div>
            <div className="min-w-0">
              <div className="truncate text-[11px] text-ink/55">{c.name}, <Num>{c.age}</Num>, {regionName(c.regionId)}</div>
              <p className="line-clamp-3 text-[12px] leading-snug">&ldquo;{c.thought}&rdquo;</p>
            </div>
          </button>
        ))}
      </div>
    </Block>
  )
}

export default function People({ world }: { world: ViewWorld }) {
  const playhead = useStore((s) => s.playhead)
  const frame = world.record.frames[frameIndexAt(world.record.frames, playhead)]
  if (!frame) return null
  return (
    <div className="scroll-thin grid h-full min-h-0 auto-rows-min grid-cols-1 gap-3 overflow-y-auto md:grid-cols-3">
      <Pyramid frame={frame} />
      <ByRegion frame={frame} />
      <div className="flex flex-col gap-3">
        <Block title="everyone" sub={world.label}>
          <Num className="font-display text-[30px] leading-none">{fmt.people(populationOf(frame))}</Num>
          <span className="mt-1 text-[11.5px] text-ink/60">people alive in <Num>{dateOfTick(frame.tick)}</Num></span>
        </Block>
        <OffWorld frame={frame} />
      </div>
      <Voices frame={frame} />
    </div>
  )
}
