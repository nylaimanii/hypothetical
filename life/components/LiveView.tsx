'use client'
// /live: one person living their life in their city, the camera always on them.
// 1d (the default): a day plays in about two and a half minutes; time slows to walking pace while she is out on the
// street, so you watch her actually walk, wait for the bus, ride it. 1y and 10y: a montage of real moments from each
// year (her walk to work, work, lunch, evening at home) with the year's line.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import type { LifeRecord } from '@/lib/life/types'
import type { PlaceInfo } from '@/lib/life/place'
import type { Emotion } from '@/lib/types'
import Scene, { type CamPreset, type WorldNow } from './Scene'
import { BUS_FARE_MONTH, LifeWorld, newLive, newWorld, type Speed } from './lifeworld'
export type { Speed }
import type { LiveState } from './ChosenPerson'
import { DAYS_PER_TICK, ageAt, householdAt, kinAliveAt, lastDay, momentsOf, moodAt, snapAt, tickOf, yearOf, type Moment } from './day'
import { hash01, planDay, schedule, whereIn, type DayPlan, type Where } from './plan'
import { feelingWords, moodToAUs } from './facs'
import { narrate, yearLine } from './narrate'
import Panel, { type PanelKind } from './Panels'
import Minimap from './Minimap'
import { nameFor } from '@/lib/life/births'
import { mulberry32 } from '@/lib/sim/rng'
import { lifeStory, scoreWords, pron } from '@/lib/life/story'

// 1d is paced like a documentary: inside a shot, time runs at 15x real time, so anyone walking moves at a natural pace.
// when nothing changes for a while (at work, asleep), a soft dip cuts forward to just before the next thing she does;
// long walks show their start and end
const REAL_X = 15
const PER_S: Record<Speed, number> = { day: REAL_X / 86400, year: 365.25, decade: 3652.5 }
const SHOT_STOP_S = 16 // seconds of a stop before cutting ahead
const SHOT_WALK_S = 20 // seconds of a walk before cutting to its end
const HOLD_MS = 3600
const MONTAGE_S = 1.6 // each montage shot at fast speeds, real seconds

export type LifeLink = { lifeId: string; name: string; city: string; age: number; dead: boolean; worldId: string }

export default function LiveView({ record, places, mainSiteUrl, nextLifeHref, others }: { record: LifeRecord; places: PlaceInfo[]; mainSiteUrl: string | null; nextLifeHref: string | null; others: LifeLink[] }) {
  const moments = useMemo(() => momentsOf(record), [record])
  const end = useMemo(() => lastDay(record), [record])
  const she = record.sex === 'female' ? 'she' : 'he', her = record.sex === 'female' ? 'her' : 'his'
  const religious = useMemo(() => record.snaps.some(s => s.behavior.includes('prays')), [record])
  const clock = useRef({ endShot: false, days: 7 / 24, speed: 'day' as Speed, playing: true, holdUntil: 0, momentIdx: 0, captionOn: false, traveling: false, onBus: false, lastPos: new THREE.Vector3(), montageT: 0, shot: 0, shotT: 0, dipping: false, lastCity: '', beatKey: '', beatSeen: '', beatStart: 0, beatNext: 24, beatWalk: false })
  const live = useRef<LiveState>(newLive())
  const world = useRef<WorldNow>(newWorld(record))
  const focus = useRef<{ id: string; until: number } | null>(null)

  const [ui, setUi] = useState({ tick: 0, day: 7 / 24, age: 0, cityId: record.birthplace.cityId, city: record.birthplace.city, home: world.current.home, playing: true, speed: 'day' as Speed, done: false })
  const [caption, setCaption] = useState<Moment | null>(null)
  const [line, setLine] = useState('')
  const [preset, setPreset] = useState<{ kind: CamPreset; at: number; user?: boolean } | null>(null)
  const [director, setDirector] = useState(true)
  const [showFeel, setShowFeel] = useState(false)
  const [feel, setFeel] = useState<{ text: string; at: number } | null>(null)
  const [panel, setPanel] = useState<PanelKind | null>(null)
  // adaptive quality: 2 full, 1 lighter pixels and crowd, 0 no shadows and a small crowd. drops before frames drop
  const [q, setQ] = useState(2)
  const budget = useRef(120)
  useEffect(() => { budget.current = [45, 80, 120][q] }, [q])
  // a calm loading state until the scene has really drawn, then a fade; and a short dip through bone for every jump
  const [ready, setReady] = useState(false)
  const veil = useRef<HTMLDivElement>(null)
  const dip = useCallback((apply: () => void, ms = 170) => {
    const v = veil.current, c = clock.current
    if (!v || c.dipping) { apply(); return }
    c.dipping = true
    v.style.transition = `opacity ${ms}ms ease-in`
    v.style.opacity = '1'
    setTimeout(() => {
      apply()
      requestAnimationFrame(() => requestAnimationFrame(() => { v.style.transition = 'opacity 380ms ease-out'; v.style.opacity = '0'; c.dipping = false }))
    }, ms + 10)
  }, [])
  const lastFeel = useRef('')
  const lw = useMemo(() => new LifeWorld(record, places, live.current, world.current), [record, places])
  const layoutOf = useCallback((cityId: string) => lw.layoutOf(cityId), [lw])
  const placeOf = useCallback((cityId: string) => lw.placeOf(cityId), [lw])
  const said = useRef({ day: -1, keys: new Map<string, string>() })
  // the neighbor out front (crowd agent 0), named like everyone in her region
  const neighborName = useMemo(() => nameFor(mulberry32(record.seed ^ 0x4e1), record.birthplace.regionId, 'female').given, [record])
  const directorRef = useRef(director)
  useEffect(() => { directorRef.current = director }, [director])

  // dev only: the live state on window, for debugging
  useEffect(() => { if (process.env.NODE_ENV === 'development') (window as unknown as Record<string, unknown>).__life = { live: live.current, world: world.current, clock: clock.current } }, [])

  // seek from ?t=<tick>
  useEffect(() => {
    const t = Number(new URLSearchParams(window.location.search).get('t'))
    if (Number.isFinite(t) && t > 0) { clock.current.days = Math.min(end, Math.ceil(t * DAYS_PER_TICK) + 7 / 24); clock.current.momentIdx = moments.findIndex(m => m.tick >= t); if (clock.current.momentIdx < 0) clock.current.momentIdx = moments.length }
  }, [end, moments])

  // ---- the clock ----
  useEffect(() => {
    let raf = 0, last = performance.now(), lastUi = 0, lastLine = 0
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const c = clock.current
      if (c.playing && now > c.holdUntil && c.days < end) {
        c.days = Math.min(end, c.days + PER_S[c.speed] * dt)
        // documentary cuts: a beat that would run on with nothing changing cuts ahead, under a dip
        if (c.speed === 'day' && !c.dipping) {
          if (c.beatKey !== c.beatSeen) { c.beatSeen = c.beatKey; c.beatStart = now }
          const realIn = (now - c.beatStart) / 1000
          const hour = (c.days % 1) * 24
          const realLeft = ((c.beatNext - hour) * 3600) / REAL_X
          const lead = c.beatWalk ? 9 : 6
          if (realIn > (c.beatWalk ? SHOT_WALK_S : SHOT_STOP_S) && realLeft > lead + 3) {
            const to = Math.floor(c.days) + (c.beatNext - (lead * REAL_X) / 3600) / 24
            c.beatStart = now + 1e9 // don't cut again while this one lands
            dip(() => { c.days = Math.min(end, Math.max(c.days, to)) })
          }
        }
        if (c.speed !== 'day') {
          c.montageT += dt
          c.shotT += dt
          // each montage shot ends with a soft dip to the next one, never a hard cut
          if (c.shotT > MONTAGE_S && !c.dipping) { c.shotT = -1; dip(() => { c.shot++; c.shotT = 0 }, 140) }
        }
      }
      const tick = tickOf(c.days)
      while (c.momentIdx < moments.length && moments[c.momentIdx].tick <= tick) {
        const m = moments[c.momentIdx++]
        if (m.tick < tick - 1) continue
        c.holdUntil = now + HOLD_MS
        setCaption(m)
        c.captionOn = true
        if (m.emotion) live.current.flinch = { emotion: m.emotion as Emotion, at: performance.now() / 1000 }
        if (directorRef.current) setPreset({ kind: m.move ? 'wide' : m.kind === 'family' && (m.emotion === 'grief' || m.emotion === 'joy') ? 'face' : 'side', at: now })
      }
      if (c.captionOn && now > c.holdUntil + 300) { c.captionOn = false; setCaption(null) }
      if (c.days >= end && !c.endShot) { c.endShot = true; setPreset({ kind: 'wide', at: now }) }
      if (c.days < end) c.endShot = false
      const where = tickWorld(c.days, c.speed, c.montageT)
      // moving to a new city rebuilds the scene: hide the rebuild behind the veil
      if (c.lastCity && world.current.cityId !== c.lastCity && veil.current && !c.dipping) { veil.current.style.transition = 'none'; veil.current.style.opacity = '1'; setTimeout(() => { if (veil.current) { veil.current.style.transition = 'opacity 600ms ease-out'; veil.current.style.opacity = '0' } }, 400) }
      c.lastCity = world.current.cityId
      if (now - lastLine > 600) { lastLine = now; setLine(lineFor(c.days, c.speed, where)) }
      if (now - lastUi > 120) {
        lastUi = now
        const W = world.current
        setUi(u => (u.tick === tick && u.cityId === W.cityId && u.home === W.home && u.playing === c.playing && u.speed === c.speed && u.done === (c.days >= end) && Math.abs(u.day - c.days) < 0.02) ? u : { tick, day: c.days, age: ageAt(c.days), cityId: W.cityId, city: placeOf(W.cityId)?.city ?? record.birthplace.city, home: W.home, playing: c.playing, speed: c.speed, done: c.days >= end })
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

  // ---- what the clock means for her and her world this frame (pure, in ./lifeworld) ----
  function tickWorld(days: number, speed: Speed, montageT: number): Where {
    const c = clock.current
    const plan = lw.planFor(days)
    // fast speeds: cut between real moments of the day (walking to work, work, lunch, evening at home)
    let hour = (days % 1) * 24
    if (speed !== 'day') {
      const legs = plan.legs.flat().filter(l => l.kind !== 'wait' && l.total > 4)
      const shots = [legs[0] ? (legs[0].start + legs[0].end) / 2 : 8, 10.5, 12.6, 19.4]
      const k = c.shot % shots.length
      hour = shots[k] + Math.max(0, c.shotT) * 0.04 // a little real motion inside each shot
      void montageT
    }
    const where = lw.tick(days, hour, speed, end)
    c.traveling = where.traveling
    c.onBus = where.onBus
    // the beat she is in (a stop or a walk) and when it next changes, for the documentary cuts
    if (where.leg) { c.beatKey = `L${where.leg.start}`; c.beatNext = where.leg.end; c.beatWalk = true }
    else {
      const i = plan.stops.indexOf(where.stop)
      const nextLeg = plan.legs[i + 1]?.[0]
      c.beatKey = `S${where.stop.hour}`; c.beatNext = nextLeg ? nextLeg.start : plan.stops[i + 1]?.hour ?? 24; c.beatWalk = false
    }
    return where
  }

  function lineFor(days: number, speed: Speed, where: Where): string {
    const tick = tickOf(days)
    if (speed !== 'day') return yearLine(record, yearOf(tick))
    const snap = snapAt(record, tick)
    const prev = tick >= 12 ? snapAt(record, tick - 12) : null
    const env = [...record.env].reverse().find(e => e.tick <= tick) ?? null
    const prevEnv = [...record.env].reverse().find(e => e.tick <= tick - 12) ?? null
    const S = said.current
    if (S.day !== Math.floor(days)) { S.day = Math.floor(days); S.keys.clear() }
    return narrate({ once: (k, scope) => { const at = S.keys.get(k); if (at === undefined) { S.keys.set(k, scope); return true } return at === scope }, record, snap, prevYearSnap: prev, env, prevEnv, where, hour: world.current.hour, family: world.current.family, kin: world.current.kin, carrierId: live.current.carrier, neighbor: neighborName, exactAge: live.current.age, presentAt: (id, lotId) => { const p = world.current.kinPos.get(id); const l = layoutOf(world.current.cityId).lots.find(x => x.id === lotId); return !!p && !!l && Math.abs(p.x - l.x) < l.w && Math.abs(p.z - l.z) < l.d }, rain: world.current.rain > 0, tempC: world.current.tempC, canBus: snap.income >= BUS_FARE_MONTH / 0.08, busFareShare: snap.income > 0 ? BUS_FARE_MONTH / snap.income : 1, she, her })
  }

  // ---- controls ----
  const setSpeed = (s: Speed) => { if (clock.current.speed === s) return; dip(() => { const c = clock.current; c.speed = s; c.montageT = 0; c.shot = 0; c.shotT = 0; setUi(u => ({ ...u, speed: s })) }) }
  const toggle = () => { const c = clock.current; if (c.days >= end) { c.days = 7 / 24; c.momentIdx = 0 } c.playing = !c.playing; c.holdUntil = 0; setUi(u => ({ ...u, playing: c.playing })) }
  const seek = (frac: number) => { const c = clock.current; c.days = Math.max(0, Math.min(end, clock.current.speed === 'day' ? Math.floor(frac * end) + 7 / 24 : frac * end)); const t = tickOf(c.days); c.momentIdx = moments.findIndex(m => m.tick > t); if (c.momentIdx < 0) c.momentIdx = moments.length; c.holdUntil = 0; setCaption(null) }
  const seekDays = (days: number) => dip(() => seek(days / end))
  const onUserCamera = useCallback(() => { setPreset(null); focus.current = null }, [])
  const focusKin = (id: string) => { focus.current = { id, until: performance.now() + 5000 }; setPanel(null) }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); toggle() }
      if (e.key === 'Escape') { setCaption(null); setPanel(null); focus.current = null }
      if (e.key === '1') setSpeed('day'); if (e.key === '2') setSpeed('year'); if (e.key === '3') setSpeed('decade')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const date = `${yearOf(ui.tick)}${ui.speed === 'day' ? ` ${['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][(ui.tick + 10) % 12]}` : ''}`
  // the main site at this exact moment, focused on her country (A: ?run=&t= are read by the main site; &place= asks it to fly there)
  const country = (record.places.find(p => p.cityId === ui.cityId) ?? record.birthplace)
  const worldLink = mainSiteUrl ? `${mainSiteUrl.replace(/\/$/, '')}/?run=${encodeURIComponent(record.worldId)}&t=${ui.tick}&place=${encodeURIComponent(country.countryId)}` : null
  const curPlace = placeOf(ui.cityId)

  return (
    <main style={{ position: 'fixed', inset: 0 }}>
      <Canvas shadows={q > 0} dpr={q === 2 ? [1, 2] : q === 1 ? 1.25 : 1} camera={{ fov: 40, near: 0.05, far: 220, position: [4, 3, 6] }} gl={{ antialias: true }}>
        <PerformanceMonitor flipflops={3} onDecline={() => setQ(x => Math.max(0, x - 1))} onIncline={() => setQ(x => Math.min(2, x + 1))} onFallback={() => setQ(0)} />
        <Ready onReady={() => setReady(true)} />
        <Scene key={ui.cityId} record={record} layout={layoutOf(ui.cityId)} homeType={ui.home} live={live} world={world} preset={preset} focus={focus} place={curPlace} budget={budget} onUserCamera={onUserCamera} />
      </Canvas>

      {/* the veil: a calm loading screen first, then the soft dip used for every jump */}
      <div ref={veil} data-veil aria-hidden={ready} style={{ position: 'absolute', inset: 0, background: 'var(--bone)', opacity: 1, transition: 'opacity 700ms ease-out', pointerEvents: ready ? 'none' : 'auto', display: 'grid', placeItems: 'center', zIndex: 3 }}>
        {!ready && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 600 }}>{record.name}</div><div style={{ fontSize: 14, opacity: 0.6, marginTop: 6 }}>{record.birthplace.city.toLowerCase()}, {record.birthplace.country.toLowerCase()}</div></div>}
      </div>
      {ready && <VeilLift veil={veil} />}

      {/* top left: who and when */}
      <div style={{ position: 'absolute', top: 12, left: 12, pointerEvents: 'none', padding: '6px 10px', borderRadius: 12, background: 'color-mix(in srgb, var(--bone) 70%, transparent)' }}>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>{record.name}</div>
        <div className="mono" style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>{date} · {Math.floor(ui.age)} · {ui.city.toLowerCase()}</div>
      </div>

      {/* top right: other lives + the place minimap */}
      <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        <Switcher current={record.lifeId} others={others} />
        {curPlace && <Minimap place={curPlace} record={record} tick={ui.tick} world={world} live={live} />}
      </div>

      {showFeel && feel && <div key={feel.at} className="feeling" style={{ position: 'absolute', top: 70, left: 16, fontSize: 14, fontStyle: 'italic', opacity: 0.75, pointerEvents: 'none' }}>{feel.text}</div>}

      {panel && !ui.done && <Panel kind={panel} record={record} tick={ui.tick} onSeek={seekDays} onClose={() => setPanel(null)} onFocusKin={focusKin} />}

      {ui.done && <EndCard key="end" record={record} worldLink={worldLink} nextLifeHref={nextLifeHref} onReplay={toggle} />}

      {/* bottom: milestone caption above the narration line, then controls and the timeline */}
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* one line at a time: a milestone caption takes the narration's place while it shows. both fade */}
        {!ui.done && (
          <div style={{ alignSelf: 'center', display: 'grid', placeItems: 'center', minHeight: 34, maxWidth: 720, pointerEvents: 'none' }}>
            <div key={caption ? `c${caption.tick}${caption.caption}` : 'line'} className="caption-in" style={{ gridArea: '1 / 1', padding: caption ? '9px 16px' : '5px 12px', borderRadius: caption ? 16 : 10, background: `color-mix(in srgb, var(--bone) ${caption ? 94 : 82}%, transparent)`, border: caption ? '1px solid var(--line)' : 'none', fontSize: caption ? 15 : 14, lineHeight: 1.35, textAlign: 'center', color: caption ? 'var(--ink)' : 'color-mix(in srgb, var(--ink) 85%, transparent)' }} aria-live="polite">
              {caption ? <Numbers text={caption.caption} /> : <LineText line={line} />}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="chip" style={{ display: 'flex', alignItems: 'center', padding: 3, gap: 2 }}>
            <button className="icon-btn" aria-label={ui.playing ? 'pause' : 'play'} onClick={toggle}><Icon kind={ui.playing ? 'pause' : 'play'} /></button>
            {(['day', 'year', 'decade'] as Speed[]).map(s => (
              <button key={s} className="icon-btn mono" style={{ width: 'auto', padding: '0 10px', fontSize: 12 }} aria-pressed={ui.speed === s} aria-label={s === 'day' ? 'one day at a time' : `a ${s} per second`} title={s === 'day' ? 'one day at a time (about 2.5 minutes)' : `a ${s} per second`} onClick={() => setSpeed(s)}>{s === 'day' ? '1d' : s === 'year' ? '1y' : '10y'}</button>
            ))}
          </div>
          <div className="chip" style={{ display: 'flex', alignItems: 'center', padding: 3, gap: 2 }}>
            {(['face', 'side', 'shoulder', 'top', 'wide'] as CamPreset[]).map(k => (
              <button key={k} className="icon-btn" aria-label={`${k} view`} title={`${k} view`} aria-pressed={preset?.kind === k} onClick={() => { focus.current = null; setPreset({ kind: k, at: performance.now(), user: true }) }}><Icon kind={k} /></button>
            ))}
            <button className="icon-btn" aria-label="director: auto camera for big moments" title="director" aria-pressed={director} onClick={() => setDirector(d => !d)}><Icon kind="director" /></button>
          </div>
          <div className="chip" style={{ display: 'flex', alignItems: 'center', padding: 3, gap: 2 }}>
            {(['journal', 'family', 'health'] as PanelKind[]).map(k => (
              <button key={k} className="icon-btn" aria-label={k} title={k} aria-pressed={panel === k} onClick={() => setPanel(p => (p === k ? null : k))}><Icon kind={k} /></button>
            ))}
            <button className="icon-btn" aria-label="show the feeling in words" title="feelings in words" aria-pressed={showFeel} onClick={() => setShowFeel(v => !v)}><Icon kind="feel" /></button>
          </div>
          {worldLink && <a className="chip" href={worldLink} target="_blank" rel="noreferrer" style={{ padding: '8px 14px', fontSize: 13, color: 'inherit', textDecoration: 'none', display: 'flex', gap: 6, alignItems: 'center' }} title={`what the core was doing to ${country.country} in ${yearOf(ui.tick)}`}><Icon kind="globe" /> world</a>}
        </div>
        <Timeline record={record} moments={moments} day={ui.day} end={end} onSeek={seek} onScrub={on => { const v = veil.current; if (!v) return; v.style.transition = on ? 'opacity 150ms ease-in' : 'opacity 450ms ease-out'; v.style.opacity = on ? '0.9' : '0' }} />
      </div>
    </main>
  )
}

// every number in jetbrains mono
function Numbers({ text }: { text: string }) {
  // a number ends on a digit (or am/pm, °c), so trailing commas and periods stay in the text face
  const parts = text.split(/(\d(?:[\d.,:%]*\d)?(?:am|pm|°c|%)?)/)
  return <>{parts.map((p, i) => (/^\d/.test(p) ? <span key={i} className="mono">{p}</span> : <span key={i}>{p}</span>))}</>
}

function Switcher({ current, others }: { current: string; others: LifeLink[] }) {
  const [open, setOpen] = useState(false)
  if (others.length < 2) return null
  return (
    <div style={{ position: 'relative' }}>
      <button className="chip" style={{ padding: '7px 12px', fontSize: 13 }} aria-expanded={open} onClick={() => setOpen(o => !o)}>other lives</button>
      {open && (
        <div className="chip panel-in" style={{ position: 'absolute', right: 0, top: 40, borderRadius: 16, padding: 6, minWidth: 230, zIndex: 5 }}>
          {others.map(o => (
            <a key={o.lifeId} href={`/live?life=${o.lifeId}`} aria-current={o.lifeId === current} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderRadius: 10, color: 'inherit', textDecoration: 'none', background: o.lifeId === current ? 'color-mix(in srgb, var(--ink) 7%, transparent)' : 'none' }}>
              <span style={{ fontSize: 14 }}>{o.name.split(' ')[0]} <span style={{ opacity: 0.55 }}>· {o.city.toLowerCase()}</span></span>
              <span className="mono" style={{ fontSize: 12, opacity: 0.6 }}>{o.dead ? `died ${Math.floor(o.age)}` : Math.floor(o.age)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function Timeline({ record, moments, day, end, onSeek, onScrub }: { record: LifeRecord; moments: Moment[]; day: number; end: number; onSeek: (f: number) => void; onScrub: (on: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); onSeek((e.clientX - r.left) / r.width) }
  return (
    <div ref={ref} role="slider" aria-label="life timeline" aria-valuemin={2026} aria-valuemax={yearOf(record.deathTick ?? 0)} aria-valuenow={yearOf(tickOf(day))} tabIndex={0}
      onPointerDown={e => { (e.target as Element).setPointerCapture?.(e.pointerId); onScrub(true); drag(e) }} onPointerMove={e => { if (e.buttons) drag(e) }} onPointerUp={() => onScrub(false)} onPointerCancel={() => onScrub(false)}
      style={{ position: 'relative', height: 22, cursor: 'pointer', touchAction: 'none' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 10, height: 2, background: 'var(--line)', borderRadius: 2 }} />
      <div style={{ position: 'absolute', left: 0, width: `${(day / end) * 100}%`, top: 10, height: 2, background: 'var(--ink)', borderRadius: 2 }} />
      {moments.filter(m => m.kind === 'milestone').map(m => <div key={`${m.tick}${m.caption}`} style={{ position: 'absolute', left: `${((m.tick * DAYS_PER_TICK) / end) * 100}%`, top: 8, width: 2, height: 6, background: 'var(--ink)', opacity: 0.3 }} />)}
      <div style={{ position: 'absolute', left: `calc(${(day / end) * 100}% - 6px)`, top: 5, width: 12, height: 12, borderRadius: 99, background: 'var(--ink)' }} />
    </div>
  )
}

// the quiet ending: who they were, plainly, the score against their usual-choices self, what they left the next person
function EndCard({ record, worldLink, nextLifeHref, onReplay }: { record: LifeRecord; worldLink: string | null; nextLifeHref: string | null; onReplay: () => void }) {
  const s = record.score
  const story = lifeStory(record)
  const words = scoreWords(record)
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--bone) 55%, transparent)', padding: 16 }}>
      <div className="chip card-in" style={{ borderRadius: 22, padding: '28px 30px', maxWidth: 560, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}><Numbers text={record.epitaph ?? record.name} /></div>
        <p style={{ margin: '12px 0 0', fontSize: 15, lineHeight: 1.45, textAlign: 'left' }}><Numbers text={story.join(' ')} /></p>
        {s && <div className="mono" style={{ marginTop: 18, fontSize: 30 }}>{s.total.toFixed(2)}</div>}
        {words && <div style={{ fontSize: 13, opacity: 0.65 }}>life score: <Numbers text={words} /></div>}
        {record.lessonsLeft.length > 0 && (
          <div style={{ marginTop: 18, textAlign: 'left' }}>
            <div style={{ fontSize: 12, opacity: 0.55, marginBottom: 6 }}>what {pron(record).she} left the next person</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>{record.lessonsLeft.map(l => <li key={l.id} style={{ fontSize: 14, lineHeight: 1.4 }}>{l.rule}</li>)}</ul>
          </div>
        )}
        {!record.lessonsLeft.length && (record.deathAge ?? 0) < 16 && <div style={{ marginTop: 16, fontSize: 14, opacity: 0.7 }}>too young to leave anything but the people who loved {pron(record).her2}.</div>}
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
    case 'journal': return <svg {...p}><path d="M6 4h10a2 2 0 012 2v14H8a2 2 0 01-2-2z" /><path d="M6 18a2 2 0 012-2h10M10 8h5M10 11h5" /></svg>
    case 'family': return <svg {...p}><circle cx="12" cy="5.5" r="2.2" /><circle cx="6" cy="17.5" r="2.2" /><circle cx="18" cy="17.5" r="2.2" /><path d="M12 7.7V12M6 15.3V12h12v3.3" /></svg>
    case 'health': return <svg {...p}><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>
    case 'globe': return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" /></svg>
    default: return null
  }
}

// the narration line: the clock ticks in place; the rest of the line only crossfades when what she is doing changes
function LineText({ line }: { line: string }) {
  const m = /^(\d{1,2}:\d{2}(?:am|pm)|\d{4}, age \d+)\.? ?(.*)$/.exec(line)
  const time = m?.[1] ?? '', rest = m?.[2] ?? line
  return <><span className="mono">{time}{time ? '. ' : ''}</span><span key={rest} className="line-in"><Numbers text={rest} /></span></>
}

// the scene counts as drawn after a few real frames (shaders compiled, first shadows), not when react mounts
function Ready({ onReady }: { onReady: () => void }) {
  const n = useRef(0), done = useRef(false)
  useFrame(() => { if (!done.current && ++n.current > 12) { done.current = true; onReady() } })
  return null
}
function VeilLift({ veil }: { veil: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => { const v = veil.current; if (v) { v.style.transition = 'opacity 900ms ease-out'; v.style.opacity = '0' } }, [veil])
  return null
}
