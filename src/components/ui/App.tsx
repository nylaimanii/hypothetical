'use client'
import { useEffect, useRef } from 'react'
import { isPhoneNow, usePhone } from './usePhone'
import { loadGeo } from '../world/geo/lazy'
import dynamic from 'next/dynamic'
import { TICKS_PER_SECOND, useStore, NO_CAPS } from '../state/store'
import { api, Offline } from './api'
import { Caption, Intro, useIntroGate, useSound } from './Extras'
import { stopReel } from './Timeline'
import { loadAgents, openRun, startCompare } from './worlds'
import { DailyPaper } from './Daily'
import { ShortcutSheet, toggleGlobeOnly, useShortcuts } from './Shortcuts'
import { ensureWindow, needsWindow } from '../state/frames'
import CompareView from './Compare'
import Timeline from './Timeline'
import WorldTabs from './WorldTabs'
import { HoverTip, ViewHost } from './WorldViews'
import { CityBar, EventLine, LayerHint, MenuButton, PanelHost, SideMenu, StatsLine, WorldTitle, useEscape } from './Shell'


const Globe = dynamic(() => import('../world/Globe'), { ssr: false })

function usePlayback() {
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const s = useStore.getState()
      // paused means paused: the hour stands still too (the timeline playing moves the world on)
      if (s.playing) {
        const lastOf = (r: typeof s.record) => { const m = s.slim[r.runId]; return m?.lazy ? m.lastTick : r.frames.at(-1)!.tick }
        const end = s.compare ? Math.max(...s.compare.records.map(lastOf)) : lastOf(s.record)
        const next = s.playhead + dt * TICKS_PER_SECOND * s.speed
        if (next >= end) { s.setPlayhead(end); if (s.source !== 'live') s.setPlaying(false) } else s.setPlayhead(next)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
}

// the first world on the leaderboard (the api lists the best first), once the list has answered
async function openDefaultWorld() {
  for (let i = 0; i < 100 && useStore.getState().runsSource !== 'api' && !useStore.getState().runnerOffline; i++) await new Promise((r) => setTimeout(r, 100))
  const first = useStore.getState().runs[0]
  if (first && useStore.getState().source === 'mock') { await openRun(first.runId); useStore.getState().setTabs([first.runId]) }
}

// until a real world is loaded: say what's happening instead of showing an invented one
function Waiting() {
  const runsSource = useStore((s) => s.runsSource)
  const runs = useStore((s) => s.runs)
  const offline = useStore((s) => s.runnerOffline)
  const live = useStore((s) => s.liveRunId)
  const text = offline ? 'the world runner is offline' : live && live !== 'sandbox' ? 'the world is starting' : runsSource === 'api' && runs.length === 0 ? 'no worlds have run yet' : 'loading worlds'
  return <main className="flex h-screen w-screen items-center justify-center bg-bone"><p className="font-display text-[17px] text-ink/60">{text}</p></main>
}

function useRuns() {
  const setRuns = useStore((s) => s.setRuns)
  useEffect(() => {
    // what this server can do; anything missing stays off (controls hide rather than fail)
    fetch('/api/capabilities', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((c) => { if (c && typeof c === 'object') useStore.getState().setCaps({ ...NO_CAPS, ...c }) }).catch(() => {})
    // the real run list, even when empty (no mock worlds); offline is said, not papered over
    api.runs().then((runs) => setRuns(Array.isArray(runs) ? runs : [], 'api')).catch(() => useStore.getState().setRunnerOffline(true))
  }, [setRuns])
}

// poll the live world; mark overrides the core answered
function useLive() {
  const liveRunId = useStore((s) => s.liveRunId)
  useEffect(() => {
    if (!liveRunId || liveRunId === 'sandbox') return
    let stop = false
    const tick = async () => {
      try {
        const rec = await api.live(liveRunId)
        // a world that has just started has no frames yet: keep waiting (the waiting screen says so)
        if (stop || !rec?.frames?.length) return
        const s = useStore.getState()
        const atEnd = s.playhead >= (s.record.frames.at(-1)?.tick ?? 0) - 0.01
        if (s.source !== 'live' || s.record.runId !== rec.runId) s.setRecord(rec, 'live')
        else {
          s.replaceRecord(rec)
          if (atEnd) s.setPlayhead(rec.frames.at(-1)?.tick ?? 0)
        }
        const answered = rec.frames.flatMap((f) => f.decision?.respondedToOverrides ?? [])
        const fresh = s.overrides.filter((o) => !o.responded && answered.includes(o.id))
        if (fresh.length) { s.markResponded(fresh.map((o) => o.id)); s.setNotice('the core responded to your override') }
      } catch (e) {
        if (e instanceof Offline) useStore.getState().setRunnerOffline(true)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { stop = true; clearInterval(id) }
  }, [liveRunId])
}

// highlight reel: one stop every ~6s through the director, then back to where you were
function useReel() {
  const reel = useStore((s) => s.reel)
  useEffect(() => {
    if (!reel) return
    const s = useStore.getState()
    const stop = reel.stops[reel.i]
    s.setPlaying(false)
    s.setPlayhead(stop.tick)
    s.requestShot(stop.regionId ? { target: 'region', regionId: stop.regionId, force: true } : { target: 'core', force: true })
    const t = setTimeout(() => {
      const cur = useStore.getState().reel
      if (!cur || cur !== reel) return
      if (cur.i + 1 < cur.stops.length) useStore.getState().setReel({ ...cur, i: cur.i + 1 })
      else stopReel()
    }, 6400)
    return () => clearTimeout(t)
  }, [reel])
  // grabbing the camera ends the reel
  const paused = useStore((s) => s.directorPaused)
  useEffect(() => { if (paused && useStore.getState().reel) stopReel() }, [paused])
}

// every view is a deep link: ?tabs=<id,id>&active=<id>&t=<tick> (older ?run=<id> still opens), or ?cmp=<agent,agent>&t=<tick>. back and forward work
function useUrlState() {
  const applying = useRef(true)
  useEffect(() => {
    const apply = async () => {
      applying.current = true
      const q = new URLSearchParams(window.location.search)
      const t = q.get('t') !== null ? Number(q.get('t')) : undefined
      const cmp = q.get('cmp')
      const s = useStore.getState()
      if (cmp) {
        const ids = cmp.split(',').filter(Boolean)
        if (s.compare?.agentIds.join() !== ids.join()) await startCompare(ids, t ?? 0)
      } else {
        if (s.compare) s.setCompare(null)
        const tabs = (q.get('tabs') ?? '').split(',').filter(Boolean)
        const run = q.get('active') ?? q.get('run') ?? tabs[0]
        if (tabs.length) useStore.getState().setTabs(run && !tabs.includes(run) ? [...tabs, run] : tabs)
        if (run && run !== useStore.getState().record.runId) await openRun(run, t)
        // no world in the url: open the best real world once the run list is in (never the placeholder)
        if (!run && !q.get('live') && useStore.getState().source === 'mock') await openDefaultWorld()
        if (!useStore.getState().tabs.length && useStore.getState().source !== 'mock') useStore.getState().setTabs([useStore.getState().record.runId])
      }
      if (t !== undefined && isFinite(t)) useStore.getState().setPlayhead(t)
      // ?live=<runId>: follow a live world (a rerun started from /assumptions)
      const live = q.get('live')
      if (live && /^[\w.-]+$/.test(live) && useStore.getState().liveRunId !== live) { useStore.getState().setIntro(false); useStore.getState().setLive(live) }
      // ?place=<country>: fly to that country (iso3 code or name, any case), used by the one-life site's world button
      const place = q.get('place')?.trim().toLowerCase()
      if (place) {
        // a deep link to a country came for that country: skip the intro this visit (it isn't marked seen)
        useStore.getState().setIntro(false)
        loadGeo().then((g) => {
          const c = g.COUNTRY_TABLE.find((x) => x.iso3.toLowerCase() === place || x.name === place)
          if (c) useStore.getState().requestShot({ target: 'place', lat: c.lat, lon: c.lon, dist: 30, label: c.name, force: true })
        }).catch(() => {})
      }
      setTimeout(() => { applying.current = false }, 50)
    }
    apply()
    const onPop = () => { apply() }
    window.addEventListener('popstate', onPop)
    let lastKey = ''
    let lastWrite = 0
    const unsub = useStore.subscribe((s) => {
      if (applying.current) return
      const key = s.compare ? `cmp=${s.compare.agentIds.join(',')}` : `tabs=${(s.tabs.length ? s.tabs : [s.record.runId]).join(',')}&active=${s.record.runId}`
      const url = `?${key}&t=${Math.round(s.playhead)}`
      if (`${window.location.search}` === url) return
      if (key !== lastKey) { lastKey = key; window.history.pushState(null, '', url); return }
      const now = performance.now()
      if (now - lastWrite > 400) { lastWrite = now; window.history.replaceState(null, '', url) }
    })
    return () => { window.removeEventListener('popstate', onPop); unsub() }
  }, [])
}

// long runs: keep about 5 years of frames loaded either side of the scrubber, per world on screen
function useLazyFrames() {
  useEffect(() => {
    const check = () => {
      const s = useStore.getState()
      const ids = s.compare ? s.compare.records.map((r) => r.runId) : [s.record.runId]
      for (const id of ids) if (needsWindow(id, s.playhead)) ensureWindow(id, s.playhead)
    }
    let last = -1
    const unsub = useStore.subscribe((s) => {
      // only look again when the scrubber has moved a few ticks or the worlds changed
      const key = Math.round(s.playhead / 3)
      if (key === last) return
      last = key
      check()
    })
    check()
    return unsub
  }, [])
}

function Loading() {
  const loading = useStore((s) => s.loading)
  if (!loading) return null
  return <div className="panel pointer-events-none flex items-center gap-2 px-4 py-2 text-[12.5px]"><span className="skel inline-block h-2 w-10 rounded-full" />{loading}</div>
}

function Notice() {
  const notice = useStore((s) => s.notice)
  const setNotice = useStore((s) => s.setNotice)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!notice) return
    if (t.current) clearTimeout(t.current)
    t.current = setTimeout(() => setNotice(null), 3200)
  }, [notice, setNotice])
  if (!notice) return null
  return <div className="panel pointer-events-none px-4 py-2 text-[12.5px]">{notice}</div>
}

export default function App() {
  usePlayback()
  useRuns()
  useLive()
  useSound()
  useIntroGate()
  useReel()
  useUrlState()
  useLazyFrames()
  useShortcuts()
  const globeOnly = useStore((s) => s.globeOnly)
  useEffect(() => { loadAgents() }, [])
  const compare = useStore((s) => s.compare)
  const source = useStore((s) => s.source)
  const setLive = useStore((s) => s.setLive)
  const liveRunId = useStore((s) => s.liveRunId)
  useEscape()
  // phones start on fast quality unless the person picked one; a saved choice wins everywhere
  useEffect(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem('hyp.quality') } catch { /* private mode */ }
    if (saved === 'high' || saved === 'fast') useStore.setState({ quality: saved })
    else if (isPhoneNow()) useStore.setState({ quality: 'fast' })
  }, [])
  const phone = usePhone()

  const startLive = async () => {
    const s = useStore.getState()
    if (liveRunId) { setLive(null); return }
    try {
      const { runId } = await api.liveStart({ constitution: s.record.constitution })
      s.setRunnerOffline(false)
      setLive(runId)
      s.setPlaying(true)
      s.setSheet('live')
    } catch {
      // no runner: a local sandbox on the current world, overrides still drive the visuals
      s.setRunnerOffline(true)
      setLive('sandbox')
      s.setNotice('runner offline')
      s.setSheet('live')
    }
  }

  // nothing real loaded yet: no globe, no panels (they'd show the placeholder)
  if (source === 'mock' && !compare) return <Waiting />
  return (
    <main className="relative h-screen w-screen overflow-hidden">
      {compare ? <CompareView /> : <Globe />}
      {globeOnly && (
        <button onClick={() => toggleGlobeOnly(false)} className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-bone/70 px-3 py-1 text-[11px] text-ink/60 hover:text-ink">press f or esc for the ui</button>
      )}
      <div className={`pointer-events-none absolute inset-0 z-10 flex flex-col transition-opacity duration-300 ${phone ? 'px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))]' : 'px-4 pb-3 pt-3'} ${globeOnly ? 'invisible opacity-0' : ''}`}>
        {/* top: the world, its tabs, the one menu */}
        <div className="flex items-start gap-4">
          <div className={phone ? 'min-w-0 flex-1' : 'w-56 shrink-0'}><WorldTitle /></div>
          {!phone && <div className="flex min-w-0 flex-1 flex-col items-center gap-2"><WorldTabs onLive={startLive} /><CityBar /></div>}
          <div className={phone ? 'shrink-0' : 'flex w-56 shrink-0 justify-end'}><MenuButton /></div>
        </div>
        {phone && <div className="mt-2 flex min-w-0 flex-col gap-2"><WorldTabs onLive={startLive} /><CityBar /></div>}
        {/* middle: the globe, and at most one panel */}
        <div className="relative mt-3 min-h-0 flex-1">
          <div className="pointer-events-none absolute left-1/2 top-0 z-20 flex -translate-x-1/2 flex-col items-center gap-2"><Loading /><Notice /></div>
          <PanelHost />
          <ViewHost />
          <div className="pointer-events-none absolute bottom-1 left-1/2 z-0 -translate-x-1/2"><Caption /></div>
        </div>
        {/* bottom: one quiet line, one stats line, the timeline */}
        <div className="mt-2 flex shrink-0 flex-col items-center gap-1.5">
          <div className="flex h-5 items-center"><LayerHint /><EventLine /></div>
          <StatsLine />
          <div className="w-full"><Timeline /></div>
        </div>
      </div>
      <SideMenu onLive={startLive} />
      <DailyPaper />
      <HoverTip />
      <ShortcutSheet />
      <Intro />
    </main>
  )
}
