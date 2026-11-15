'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCurrentFrame, useStore, type Caption as CaptionT } from '../state/store'
import { chime, rumble, setCrowd, setTension, setVolume, soundStart, soundStop, whoosh } from '../sound/engine'
import { feedFor } from './events'
import { Num } from './bits'

const LS_VOLUME = 'hyp.volume'
const LS_INTRO = 'hyp.introSeen'
const lsGet = (k: string) => { try { return window.localStorage.getItem(k) } catch { return null } }
const lsSet = (k: string, v: string) => { try { window.localStorage.setItem(k, v) } catch { /* private mode */ } }

// ---- caption: fades in bottom center during each director shot ----
export function Caption() {
  const caption = useStore((s) => s.caption)
  // keep the last caption around while it fades out
  const [shown, setShown] = useState<CaptionT | null>(null)
  const [prev, setPrev] = useState<CaptionT | null>(null)
  if (caption !== prev) { setPrev(caption); if (caption) setShown(caption) }
  useEffect(() => {
    if (caption) return
    const t = setTimeout(() => setShown(null), 500)
    return () => clearTimeout(t)
  }, [caption])
  if (!shown) return null
  return (
    <div key={shown.id} className={`panel pointer-events-none max-w-[min(42rem,90vw)] px-4 py-2 text-center text-[13px] leading-snug ${caption ? 'caption-in' : 'caption-out'}`}>
      {shown.danger && <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-ember align-middle" />}
      {shown.parts.map((p, i) => (p.mono ? <Num key={i}>{p.t}</Num> : <span key={i}>{p.t}</span>))}
    </div>
  )
}

// ---- event feed: thin ticker on the right edge ----
const KIND_LABEL: Record<string, string> = { decision: 'the core decides', injected: 'injected' }

export function EventFeed() {
  const { record, idx, mode } = useCurrentFrame()
  const setPlayhead = useStore((s) => s.setPlayhead)
  const requestShot = useStore((s) => s.requestShot)
  const items = useMemo(() => (mode === 'ai' ? feedFor(record, idx).slice(0, 80) : []), [record, idx, mode])
  const regions = record.frames[idx]?.regions ?? []
  if (!items.length) return null
  return (
    <div className="scroll-thin pointer-events-auto flex max-h-full w-52 shrink-0 flex-col gap-1 overflow-y-auto pr-0.5" aria-label="event feed">
      {items.map((it) => {
        const region = regions.find((r) => r.id === it.regionId)?.name
        return (
          <button key={it.key} onClick={() => { setPlayhead(it.tick); requestShot(it.kind === 'decision' || !it.regionId ? { target: 'core', force: true } : { target: 'region', regionId: it.regionId, force: true }) }}
            className={`feed-in rounded-xl border-l-2 bg-bone/80 px-2.5 py-1.5 text-left shadow-sm backdrop-blur hover:bg-bone ${it.danger ? 'border-ember' : 'border-ink/25'}`}>
            <div className="flex items-baseline justify-between gap-2 whitespace-nowrap text-[10px]">
              <span className={it.danger ? 'text-ember' : 'text-ink/60'}>{KIND_LABEL[it.kind] ?? it.kind}</span>
              <Num className="text-ink/45">{it.date}</Num>
            </div>
            {region && <div className="truncate text-[11px] text-ink/70">{region}</div>}
            <div className="line-clamp-2 text-[11.5px] leading-snug">{it.text}</div>
          </button>
        )
      })}
    </div>
  )
}

// ---- top bar controls ----
export function DirectorToggle() {
  const on = useStore((s) => s.director)
  const paused = useStore((s) => s.director && s.directorPaused)
  const setDirector = useStore((s) => s.setDirector)
  return (
    <button onClick={() => setDirector(!on)} title={on ? (paused ? 'director paused while you steer' : 'director mode on') : 'director mode off'} aria-pressed={on}
      className={`panel flex h-9 items-center gap-1.5 whitespace-nowrap px-3 text-[12px] xl:text-[13px] ${on ? 'bg-ink! text-bone' : 'text-ink/70 hover:bg-bone'} ${paused ? 'opacity-60' : ''}`}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><rect x="1.5" y="4" width="9" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10.5 7l4-2.2v6.4l-4-2.2z" fill="currentColor" /></svg>
      director
    </button>
  )
}

export function SoundControls() {
  const on = useStore((s) => s.soundOn)
  const volume = useStore((s) => s.volume)
  const setSound = useStore((s) => s.setSound)
  const setVol = useStore((s) => s.setVolume)
  return (
    <div className={`panel flex h-9 items-center gap-2 whitespace-nowrap px-2 ${on ? '' : 'text-ink/70'}`}>
      <button onClick={() => setSound(!on)} aria-label={on ? 'sound off' : 'sound on'} aria-pressed={on} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-ink/10">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" />
          {on ? <path d="M10.5 5.5a3.5 3.5 0 010 5M12.3 3.8a6 6 0 010 8.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /> : <path d="M10.5 6l4 4M14.5 6l-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
        </svg>
      </button>
      {on && <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => { setVol(+e.target.value); lsSet(LS_VOLUME, e.target.value) }} aria-label="master volume" className="w-20" />}
    </div>
  )
}

// ---- sound driver: maps world state to the synth ----
export function useSound() {
  const on = useStore((s) => s.soundOn)
  const volume = useStore((s) => s.volume)
  const setVol = useStore((s) => s.setVolume)
  const zoom = useStore((s) => s.zoom)
  const juice = useStore((s) => s.juice)
  const { frame, idx, mode } = useCurrentFrame()
  const seen = useRef(0)
  const lastIdx = useRef(idx)

  useEffect(() => {
    const v = lsGet(LS_VOLUME)
    if (v !== null && isFinite(+v)) setVol(Math.max(0, Math.min(1, +v)))
  }, [setVol])
  useEffect(() => { if (on) setVolume(volume) }, [volume, on])
  useEffect(() => { if (on) soundStart(useStore.getState().volume); else soundStop() }, [on])

  // ambient tension follows population weighted unrest
  useEffect(() => {
    if (!on) return
    const pop = frame.regions.reduce((a, r) => a + r.population, 0) || 1
    const unrest = frame.regions.reduce((a, r) => a + r.unrest * r.population, 0) / pop
    setTension((unrest - 0.2) / 0.5)
  }, [on, frame])

  // crowd murmur at close zoom, angry when people revolt
  useEffect(() => {
    if (!on) return
    const recentRevolt = juice.some((j) => (j.kind === 'revolt' || j.kind === 'war') && performance.now() - j.at < 12000)
    const revolt = frame.newEvents.some((e) => e.kind === 'revolt' || e.kind === 'war') || recentRevolt
    const maxUnrest = Math.max(0, ...frame.regions.map((r) => r.unrest))
    setCrowd(zoom === 'close' ? 1 : 0, revolt ? 1 : Math.max(0, (maxUnrest - 0.45) / 0.55))
  }, [on, zoom, frame, juice])

  useEffect(() => {
    for (const j of juice) {
      if (j.id <= seen.current) continue
      seen.current = j.id
      if (!on) continue
      if (j.kind === 'disaster' || j.kind === 'war' || j.kind === 'injected') rumble(j.severity)
      if (j.kind === 'launch') whoosh()
    }
  }, [juice, on])

  useEffect(() => {
    if (lastIdx.current === idx) return
    lastIdx.current = idx
    if (on && mode === 'ai' && frame.decision) chime()
  }, [idx, on, mode, frame.decision])
}

// ---- intro: first visit only ----
export function useIntroGate() {
  const setIntro = useStore((s) => s.setIntro)
  useEffect(() => { if (lsGet(LS_INTRO) !== '1') setIntro(true) }, [setIntro])
}

export function Intro() {
  const open = useStore((s) => s.introOpen)
  const [step, setStep] = useState(0)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (!open) return
    const ts = [300, 1700, 3300, 5200].map((ms, i) => setTimeout(() => setStep(i + 1), ms))
    return () => ts.forEach(clearTimeout)
  }, [open])
  if (!open) return null
  const watch = () => {
    lsSet(LS_INTRO, '1')
    setLeaving(true)
    setTimeout(() => {
      const s = useStore.getState()
      s.setIntro(false)
      s.setDirector(true)
      if (s.playhead >= (s.record.frames.at(-1)?.tick ?? 0)) s.setPlayhead(s.record.frames[0].tick)
      s.setPlaying(true)
    }, 700)
  }
  const line = (n: number) => `transition-all duration-1000 ${step >= n ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`
  return (
    <div className={`absolute inset-0 z-50 flex items-center justify-center bg-gradient-to-b from-bone/70 via-bone/45 to-bone/80 px-6 backdrop-blur-[2px] transition-opacity duration-700 ${leaving ? 'opacity-0' : 'opacity-100'}`}>
      <div className="max-w-2xl text-center">
        <p className={`font-mono text-[13px] uppercase tracking-[0.3em] text-ink/60 ${line(1)}`}>november 2026</p>
        <p className={`mt-5 font-display text-3xl leading-tight md:text-4xl ${line(2)}`}>every government on earth hands control to one ai.</p>
        <p className={`mt-4 font-display text-xl italic leading-snug text-ink/80 md:text-2xl ${line(3)}`}>its only goal: get humans to the moon without losing civilization.</p>
        <button onClick={watch} className={`mt-10 rounded-full bg-ink px-8 py-3 font-mono text-[12px] uppercase tracking-[0.3em] text-bone hover:bg-ink/85 ${line(4)}`}>watch</button>
      </div>
    </div>
  )
}
