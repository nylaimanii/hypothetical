'use client'
// /live: one person, their whole life, the camera always on them. the clock runs at a day, a year or a decade per
// second; big moments pause it gently with a one-line caption. default chrome stays under ~25 words.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import type { LifeRecord } from '@/lib/life/types'
import type { Emotion } from '@/lib/types'
import Scene, { layoutFor, type CamPreset, type WorldNow } from './Scene'
import type { LiveState } from './ChosenPerson'
import { DAYS_PER_TICK, SPEEDS, ageAt, householdAt, lastDay, momentsOf, moodAt, snapAt, storyHour, tickOf, whereAt, yearOf, type Moment, type Speed } from './day'
import { feelingWords, moodToAUs } from './facs'

const HOLD_MS = 3400
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export default function LiveView({ record, mainSiteUrl, nextLifeHref }: { record: LifeRecord; mainSiteUrl: string | null; nextLifeHref: string | null }) {
  const moments = useMemo(() => momentsOf(record), [record])
  const end = useMemo(() => lastDay(record), [record])
  const clock = useRef({ days: 0, speed: 'year' as Speed, playing: true, holdUntil: 0, lastTick: -1, momentIdx: 0, captionOn: false })
  const live = useRef<LiveState>({ pos: new THREE.Vector3(), heading: 0, walking: false, act: 'sleep', mood: {}, fatigue: 0, age: 0, heat: 0, flinch: null, gaze: null, hug: 0, head: new THREE.Vector3(0, 1.5, 0), forward: new THREE.Vector3(0, 0, 1) })
  const world = useRef<WorldNow>({ tick: 0, hour: 9, cityId: record.birthplace.cityId, home: record.snaps[0]?.home ?? 'family_home', indoors: true, lotId: -1, hunger: false, food: 1, protest: false, disaster: 0, law: null, rain: 0, heat: 0, dead: false, family: [], arrivedAgoH: -1 })

  const [ui, setUi] = useState({ tick: 0, day: 0, age: 0, cityId: record.birthplace.cityId, city: record.birthplace.city, home: world.current.home, playing: true, speed: 'year' as Speed, done: false })
  const [caption, setCaption] = useState<Moment | null>(null)
  const [preset, setPreset] = useState<{ kind: CamPreset; at: number } | null>(null)
  const [director, setDirector] = useState(true)
  const [showFeel, setShowFeel] = useState(false)
  const [feel, setFeel] = useState<{ text: string; at: number } | null>(null)
  const lastFeel = useRef('')
  const layouts = useRef(new Map<string, ReturnType<typeof layoutFor>>())
  const layoutOf = useCallback((cityId: string) => { let l = layouts.current.get(cityId); if (!l) { l = layoutFor(record, cityId); layouts.current.set(cityId, l) } return l }, [record])

  // dev only: the live state on window, for debugging in the browser console
  useEffect(() => { if (process.env.NODE_ENV === 'development') (window as unknown as Record<string, unknown>).__life = { live: live.current, world: world.current, clock: clock.current } }, [])

  // seek from ?t=<tick>
  useEffect(() => {
    const t = Number(new URLSearchParams(window.location.search).get('t'))
    if (Number.isFinite(t) && t > 0) { clock.current.days = Math.min(end, t * DAYS_PER_TICK); clock.current.momentIdx = moments.findIndex(m => m.tick >= t); if (clock.current.momentIdx < 0) clock.current.momentIdx = moments.length }
  }, [end, moments])

  // ---- the clock ----
  useEffect(() => {
    let raf = 0, last = performance.now(), lastUi = 0
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const c = clock.current
      if (c.playing && now > c.holdUntil && c.days < end) c.days = Math.min(end, c.days + SPEEDS[c.speed] * dt)
      const tick = tickOf(c.days)
      // big moments: pause gently, caption, a director angle, a flinch on the face
      while (c.momentIdx < moments.length && moments[c.momentIdx].tick <= tick) {
        const m = moments[c.momentIdx++]
        if (m.tick < tick - 1) continue // skipped by a seek, don't replay
        c.holdUntil = now + HOLD_MS
        setCaption(m)
        c.captionOn = true
        if (m.emotion) live.current.flinch = { emotion: m.emotion as Emotion, at: performance.now() / 1000 }
        if (directorRef.current) setPreset({ kind: m.move ? 'wide' : m.kind === 'family' && (m.emotion === 'grief' || m.emotion === 'joy') ? 'face' : m.kind === 'world' ? 'side' : 'shoulder', at: now })
      }
      if (c.captionOn && now > c.holdUntil + 300) { c.captionOn = false; setCaption(null) }
      tickWorld(c.days, c.speed)
      if (now - lastUi > 120) {
        lastUi = now
        const W = world.current
        setUi(u => (u.tick === tick && u.cityId === W.cityId && u.home === W.home && u.playing === c.playing && u.speed === c.speed && u.done === (c.days >= end) && Math.floor(u.day) === Math.floor(c.days)) ? u : { tick, day: c.days, age: ageAt(c.days), cityId: W.cityId, city: cityName(record, W.cityId), home: W.home, playing: c.playing, speed: c.speed, done: c.days >= end })
        // the feeling in words, for 2s when it changes (only when the toggle is on)
        const { mix } = moodToAUs(live.current.mood as Partial<Record<Emotion, number>>, live.current.fatigue)
        const words = feelingWords(live.current.mood as Partial<Record<Emotion, number>>, mix)
        if (words !== lastFeel.current) { lastFeel.current = words; setFeel({ text: words, at: now }) }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, moments, record])
  const directorRef = useRef(director)
  directorRef.current = director

  // ---- what the clock means for the person and their world this frame ----
  const tickWorld = (days: number, speed: Speed) => {
    const tick = tickOf(days)
    const snap = snapAt(record, tick)
    const L = live.current, W = world.current
    const hour = speed === 'day' ? (days % 1) * 24 : storyHour(snap.activity)
    const layout = layoutOf(snap.cityId)
    const home = layout.homes[0]
    const fam = householdAt(record, tick)
    const kids = fam.some(f => f.relation === 'child' && f.age < 14)
    const where = whereAt(layout, home, snap, kids, hour, speed !== 'day')
    L.pos.set(where.pos.x, 0, where.pos.z)
    let dh = where.heading - L.heading
    dh = Math.atan2(Math.sin(dh), Math.cos(dh))
    L.heading += dh * (where.walking ? 0.25 : 0.06)
    L.walking = where.walking
    L.act = where.act
    L.age = ageAt(days)
    L.mood = moodAt(record, days)
    // tired underneath: grief months, poor health, late hours
    const lastLoss = [...record.events].reverse().find(e => e.tick <= tick && e.kind === 'family' && / died/.test(e.text))
    const sinceLoss = lastLoss ? tick - lastLoss.tick : 999
    L.fatigue = Math.min(1, (snap.activity === 'grieving' ? 0.5 : 0) + Math.max(0, 0.6 - snap.health) * 1.4 + (sinceLoss < 36 ? 0.45 * (1 - sinceLoss / 36) : 0) + (hour > 21.5 ? 0.25 : 0))
    // heat and rain: ESTIMATE from latitude and month until B ships local weather (types-v5 Weather)
    const place = record.places.find(p => p.cityId === snap.cityId) ?? record.birthplace
    const month = (tick + 10) % 12
    const summer = place.lat >= 0 ? (month >= 5 && month <= 8) : (month <= 1 || month === 11)
    const tropic = Math.abs(place.lat) < 23.5
    W.heat = (tropic ? 0.55 : summer ? 0.35 : 0) * (hour > 10 && hour < 17 ? 1 : 0.3)
    L.heat = W.heat
    const dayN = Math.floor(days)
    const wet = tropic ? (summer ? 0.45 : 0.2) : 0.18
    W.rain = ((Math.sin(dayN * 91.17 + record.seed) * 43758.5453) % 1 + 1) % 1 < wet ? 0.7 : 0
    // the world reaching in
    const env = [...record.env].reverse().find(e => e.tick <= tick) ?? record.env[0]
    const evs = record.events.filter(e => e.tick === tick || e.tick === tick - 1)
    W.tick = tick; W.hour = hour; W.cityId = snap.cityId; W.home = snap.home; W.indoors = where.indoors; W.lotId = where.lot.id
    W.hunger = !!snap.hunger; W.food = env?.food ?? 1
    W.protest = evs.some(e => /protest/.test(e.text))
    W.disaster = evs.some(e => e.worldKind === 'disaster' || e.worldKind === 'war') ? 1 : env?.damage === 'disaster' || env?.damage === 'war' ? env.damageLevel : 0
    W.law = evs.find(e => e.worldKind === 'law')?.text.replace(/^on the news screen: /, '') ?? null
    W.dead = days >= end
    W.family = fam
    W.arrivedAgoH = where.at === 'home' ? where.arrivedAgoH : -1
    // who they look at: a small child first, then their partner, when they are together at home
    const atHome = where.at === 'home' && fam.length > 0 && !(where.act === 'sleep')
    if (atHome) {
      const i = Math.max(0, fam.findIndex(f => f.relation === 'child'))
      const a = (i / Math.max(1, fam.length)) * Math.PI * 2 + 0.6
      const f = fam[i]
      L.gaze = (L.gaze ?? new THREE.Vector3()).set(home.x + Math.cos(a) * (0.75 + (i % 2) * 0.25), 0.9 + 0.7 * Math.min(1, f.age / 16), home.z + Math.sin(a) * (0.75 + (i % 2) * 0.25) * 0.8)
    } else L.gaze = null
    const hugNow = atHome && where.arrivedAgoH >= 0 && where.arrivedAgoH < 0.8 ? 1 : 0
    L.hug += (hugNow - L.hug) * 0.1
  }

  // ---- controls ----
  const setSpeed = (s: Speed) => { clock.current.speed = s; setUi(u => ({ ...u, speed: s })) }
  const toggle = () => { const c = clock.current; if (c.days >= end) { c.days = 0; c.momentIdx = 0 } c.playing = !c.playing; c.holdUntil = 0; setUi(u => ({ ...u, playing: c.playing })) }
  const seek = (frac: number) => { const c = clock.current; c.days = Math.max(0, Math.min(end, frac * end)); const t = tickOf(c.days); c.momentIdx = moments.findIndex(m => m.tick > t); if (c.momentIdx < 0) c.momentIdx = moments.length; c.holdUntil = 0; setCaption(null) }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); toggle() }
      if (e.key === 'Escape') setCaption(null)
      if (e.key === '1') setSpeed('day'); if (e.key === '2') setSpeed('year'); if (e.key === '3') setSpeed('decade')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const first = record.name.split(' ')[0]
  const date = `${yearOf(ui.tick)}${ui.speed === 'day' ? ` ${MONTHS[(ui.tick + 10) % 12]}` : ''}`
  const worldLink = mainSiteUrl ? `${mainSiteUrl.replace(/\/$/, '')}/?run=${encodeURIComponent(record.worldId)}&t=${ui.tick}` : null

  return (
    <main style={{ position: 'fixed', inset: 0 }}>
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 38, near: 0.05, far: 200, position: [4, 3, 6] }} gl={{ antialias: true }}>
        <Scene key={ui.cityId} record={record} layout={layoutOf(ui.cityId)} homeType={ui.home} live={live} world={world} preset={preset} onUserCamera={() => setPreset(null)} />
      </Canvas>

      {/* top left: who and when */}
      <div style={{ position: 'absolute', top: 16, left: 16, pointerEvents: 'none' }}>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>{record.name}</div>
        <div className="mono" style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>{date} · {Math.floor(ui.age)} · {ui.city.toLowerCase()}</div>
      </div>

      {/* feeling in words, 2s when it changes (toggle) */}
      {showFeel && feel && <div key={feel.at} className="feeling" style={{ position: 'absolute', top: 70, left: 16, fontSize: 14, fontStyle: 'italic', opacity: 0.75, pointerEvents: 'none' }}>{feel.text}</div>}

      {/* caption for big moments */}
      {caption && !ui.done && (
        <div key={`${caption.tick}${caption.caption}`} className="caption-in" style={{ position: 'absolute', left: 16, right: 16, bottom: 96, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <div className="chip" style={{ padding: '10px 18px', maxWidth: 680, fontSize: 15, lineHeight: 1.35, textAlign: 'center', borderRadius: 16 }}>
            <Numbers text={caption.caption} />
          </div>
        </div>
      )}

      {/* death: a quiet ending card */}
      {ui.done && <EndCard record={record} worldLink={worldLink} nextLifeHref={nextLifeHref} onReplay={toggle} />}

      {/* bottom: controls + timeline */}
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="chip" style={{ display: 'flex', alignItems: 'center', padding: 3, gap: 2 }}>
            <button className="icon-btn" aria-label={ui.playing ? 'pause' : 'play'} onClick={toggle}><Icon kind={ui.playing ? 'pause' : 'play'} /></button>
            {(['day', 'year', 'decade'] as Speed[]).map(s => (
              <button key={s} className="icon-btn mono" style={{ width: 'auto', padding: '0 10px', fontSize: 12 }} aria-pressed={ui.speed === s} aria-label={`a ${s} per second`} title={`a ${s} per second`} onClick={() => setSpeed(s)}>{s === 'day' ? '1d' : s === 'year' ? '1y' : '10y'}</button>
            ))}
          </div>
          <div className="chip" style={{ display: 'flex', alignItems: 'center', padding: 3, gap: 2 }}>
            {(['face', 'shoulder', 'side', 'top', 'wide'] as CamPreset[]).map(k => (
              <button key={k} className="icon-btn" aria-label={`${k} view`} title={`${k} view`} aria-pressed={preset?.kind === k} onClick={() => setPreset({ kind: k, at: performance.now() })}><Icon kind={k} /></button>
            ))}
            <button className="icon-btn" aria-label="director: auto camera for big moments" title="director" aria-pressed={director} onClick={() => setDirector(d => !d)}><Icon kind="director" /></button>
          </div>
          <div className="chip" style={{ display: 'flex', alignItems: 'center', padding: 3, gap: 2 }}>
            <button className="icon-btn" aria-label="show the feeling in words" title="feelings in words" aria-pressed={showFeel} onClick={() => setShowFeel(v => !v)}><Icon kind="feel" /></button>
            {worldLink && <a className="icon-btn" aria-label="see this moment in the world" title="see this moment in the world" href={worldLink} target="_blank" rel="noreferrer"><Icon kind="globe" /></a>}
          </div>
        </div>
        <Timeline record={record} moments={moments} day={ui.day} end={end} onSeek={seek} />
      </div>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }} aria-live="polite">{caption?.caption ?? ''}</span>
      <noscript>{first}</noscript>
    </main>
  )
}

const cityName = (r: LifeRecord, id: string) => r.places.find(p => p.cityId === id)?.city ?? r.birthplace.city

// every number in jetbrains mono
function Numbers({ text }: { text: string }) {
  const parts = text.split(/(\d[\d.,%$x]*)/)
  return <>{parts.map((p, i) => (/^\d/.test(p) ? <span key={i} className="mono">{p}</span> : <span key={i}>{p}</span>))}</>
}

function Timeline({ record, moments, day, end, onSeek }: { record: LifeRecord; moments: Moment[]; day: number; end: number; onSeek: (f: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); onSeek((e.clientX - r.left) / r.width) }
  return (
    <div ref={ref} role="slider" aria-label="life timeline" aria-valuemin={2026} aria-valuemax={yearOf(record.deathTick ?? 0)} aria-valuenow={yearOf(tickOf(day))} tabIndex={0}
      onPointerDown={e => { (e.target as Element).setPointerCapture?.(e.pointerId); drag(e) }} onPointerMove={e => { if (e.buttons) drag(e) }}
      style={{ position: 'relative', height: 22, cursor: 'pointer', touchAction: 'none' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 10, height: 2, background: 'var(--line)', borderRadius: 2 }} />
      <div style={{ position: 'absolute', left: 0, width: `${(day / end) * 100}%`, top: 10, height: 2, background: 'var(--ink)', borderRadius: 2 }} />
      {moments.filter(m => m.kind === 'milestone').map(m => (
        <div key={`${m.tick}${m.caption}`} style={{ position: 'absolute', left: `${((m.tick * DAYS_PER_TICK) / end) * 100}%`, top: 8, width: 2, height: 6, background: 'var(--ink)', opacity: 0.3 }} />
      ))}
      <div style={{ position: 'absolute', left: `calc(${(day / end) * 100}% - 6px)`, top: 5, width: 12, height: 12, borderRadius: 99, background: 'var(--ink)' }} />
    </div>
  )
}

function EndCard({ record, worldLink, nextLifeHref, onReplay }: { record: LifeRecord; worldLink: string | null; nextLifeHref: string | null; onReplay: () => void }) {
  const s = record.score
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--bone) 55%, transparent)', padding: 16 }}>
      <div className="chip card-in" style={{ borderRadius: 22, padding: '28px 30px', maxWidth: 560, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}><Numbers text={record.epitaph ?? record.name} /></div>
        <div style={{ marginTop: 8, fontSize: 14, opacity: 0.7 }}>{record.deathCause}</div>
        {s && <div className="mono" style={{ marginTop: 18, fontSize: 30 }}>{s.total.toFixed(2)}</div>}
        {s && <div style={{ fontSize: 12, opacity: 0.55 }}>life score</div>}
        {record.lessonsLeft.length > 0 && (
          <div style={{ marginTop: 20, textAlign: 'left', display: 'grid', gap: 8 }}>
            {record.lessonsLeft.map(l => <div key={l.id} style={{ fontSize: 15, lineHeight: 1.4 }}>“{l.rule}”</div>)}
          </div>
        )}
        <div style={{ marginTop: 22, display: 'flex', gap: 14, justifyContent: 'center', fontSize: 13, flexWrap: 'wrap' }}>
          <button onClick={onReplay} style={{ textDecoration: 'underline' }}>live it again</button>
          {nextLifeHref && <a href={nextLifeHref} style={{ color: 'inherit' }}>the next life →</a>}
          {worldLink && <a href={worldLink} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>see this moment in the world</a>}
        </div>
      </div>
    </div>
  )
}

function Icon({ kind }: { kind: string }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  switch (kind) {
    case 'play': return <svg {...p}><path d="M8 5l11 7-11 7z" fill="currentColor" /></svg>
    case 'pause': return <svg {...p}><path d="M8 5v14M16 5v14" /></svg>
    case 'face': return <svg {...p}><circle cx="12" cy="12" r="8" /><circle cx="9.5" cy="10.5" r="0.8" fill="currentColor" /><circle cx="14.5" cy="10.5" r="0.8" fill="currentColor" /><path d="M9 15c1.6 1.2 4.4 1.2 6 0" /></svg>
    case 'shoulder': return <svg {...p}><circle cx="15" cy="8" r="3.2" /><path d="M7 20c0-4 3.6-7 8-7s5 1.5 5 1.5" /></svg>
    case 'side': return <svg {...p}><circle cx="12" cy="7" r="3" /><path d="M12 10v6M9 21l3-5 3 5M8 13h8" /></svg>
    case 'top': return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="12" cy="12" r="2" fill="currentColor" /></svg>
    case 'wide': return <svg {...p}><path d="M3 18l5-6 4 4 3-3 6 5" /><path d="M3 20h18" /></svg>
    case 'director': return <svg {...p}><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M3 8l3-4h4l-3 4M10 8l3-4h4l-3 4" /></svg>
    case 'feel': return <svg {...p}><path d="M12 20s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.5-7 10-7 10z" /></svg>
    case 'globe': return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" /></svg>
    default: return null
  }
}
