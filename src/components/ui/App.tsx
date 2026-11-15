'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { TICKS_PER_SECOND, useStore } from '../state/store'
import { api, Offline } from './api'
import Dossier from './Dossier'
import { SideDrawer, useNarrow } from './Side'
import { Caption, EventFeed, Intro, useIntroGate, useSound } from './Extras'
import { stopReel } from './Timeline'
import { loadAgents, openRun, startCompare } from './worlds'
import Chronicle from './Chronicle'
import { ShortcutSheet, toggleGlobeOnly, useShortcuts } from './Shortcuts'
import { ensureWindow, needsWindow } from '../state/frames'
import { AgentsPanel, HallPanel } from './Agents'
import CompareView from './Compare'
import Timeline from './Timeline'
import LivePanel from './LivePanel'
import { AdvancedDrawer, Leaderboard, MissionBar, RulesDrawer, TopLeft, TopRight } from './Chrome'
import Roadmap from './Roadmap'

// dev shows an fps meter in the bottom right corner of the middle row; panels leave it room
const DEV = process.env.NODE_ENV === 'development'

const Globe = dynamic(() => import('../world/Globe'), { ssr: false })

function usePlayback() {
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const s = useStore.getState()
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

function useRuns() {
  const setRuns = useStore((s) => s.setRuns)
  useEffect(() => {
    api.runs().then((runs) => { if (Array.isArray(runs) && runs.length) setRuns(runs, 'api') }).catch(() => {})
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
        if (stop) return
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

// every view is a deep link: ?run=<id>&t=<tick>, or ?cmp=<agent,agent>&t=<tick>. back and forward work
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
        const run = q.get('run')
        if (run && run !== useStore.getState().record.runId) await openRun(run, t)
      }
      if (t !== undefined && isFinite(t)) useStore.getState().setPlayhead(t)
      setTimeout(() => { applying.current = false }, 50)
    }
    apply()
    const onPop = () => { apply() }
    window.addEventListener('popstate', onPop)
    let lastKey = ''
    let lastWrite = 0
    const unsub = useStore.subscribe((s) => {
      if (applying.current) return
      const key = s.compare ? `cmp=${s.compare.agentIds.join(',')}` : `run=${s.record.runId}`
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

function LeftTabs({ tab, setTab }: { tab: 'runs' | 'chronicle'; setTab: (t: 'runs' | 'chronicle') => void }) {
  return (
    <div className="panel pointer-events-auto flex w-fit gap-1 p-1 text-[12px]">
      {(['runs', 'chronicle'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 ${tab === t ? 'bg-ink text-bone' : 'text-ink/60 hover:bg-ink/5'}`}>{t}</button>)}
    </div>
  )
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
  const [leftTab, setLeftTab] = useState<'runs' | 'chronicle'>('runs')
  const setLive = useStore((s) => s.setLive)
  const liveRunId = useStore((s) => s.liveRunId)
  const drawerOpen = useStore((s) => s.drawerOpen)
  const selection = useStore((s) => s.selection)
  const panel = useStore((s) => s.panel)
  const advancedOpen = useStore((s) => s.advancedOpen)
  const narrow = useNarrow()
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  // narrow layout: picking something or opening the rules slides the right drawer in, clearing both closes it
  const wantsRight = Boolean(selection) || drawerOpen || advancedOpen
  const [prevWants, setPrevWants] = useState(wantsRight)
  if (prevWants !== wantsRight) { setPrevWants(wantsRight); setRightOpen(wantsRight) }
  const [prevLive, setPrevLive] = useState(liveRunId)
  if (prevLive !== liveRunId) { setPrevLive(liveRunId); if (liveRunId) setLeftOpen(true) }

  const startLive = async () => {
    const s = useStore.getState()
    if (liveRunId) { setLive(null); return }
    try {
      const { runId } = await api.liveStart({ constitution: s.record.constitution })
      s.setRunnerOffline(false)
      setLive(runId)
      s.setPlaying(true)
    } catch {
      // no runner: a local sandbox on the current world, overrides still drive the visuals
      s.setRunnerOffline(true)
      setLive('sandbox')
      s.setNotice('runner offline')
    }
  }

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      {compare ? <CompareView /> : <Globe />}
      {globeOnly && (
        <button onClick={() => toggleGlobeOnly(false)} className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-bone/70 px-3 py-1 text-[11px] text-ink/60 backdrop-blur hover:text-ink">press f or esc for the ui</button>
      )}
      <div className={`pointer-events-none absolute inset-0 z-10 flex flex-col p-3 transition-opacity duration-300 xl:p-4 ${globeOnly ? 'invisible opacity-0' : ''}`}>
        <div className="relative flex flex-wrap items-start justify-between gap-2">
          <TopLeft />
          <div className="order-last flex w-full min-w-0 flex-col items-center gap-2 min-[1720px]:order-none min-[1720px]:w-auto min-[1720px]:flex-1">
            <MissionBar />
            <Loading />
            <Notice />
          </div>
          <TopRight onLive={startLive} />
        </div>
        <div className="relative mt-3 flex min-h-0 flex-1 items-stretch justify-between gap-4 xl:mt-4">
          {narrow ? (
            <>
              {!compare && (
                <SideDrawer side="left" label="runs" open={leftOpen} onToggle={() => setLeftOpen(!leftOpen)}>
                  <LeftTabs tab={leftTab} setTab={setLeftTab} />
                  {leftTab === 'runs' ? <><Leaderboard /><LivePanel /></> : <Chronicle />}
                </SideDrawer>
              )}
              {!compare && <div className={`absolute right-0 top-12 flex min-h-0 ${DEV ? 'bottom-14' : 'bottom-0'}`}><EventFeed /></div>}
              <SideDrawer side="right" label="details" open={rightOpen} onToggle={() => setRightOpen(!rightOpen)} reserveBottom={DEV}>
                <AdvancedDrawer />
                <Dossier />
                {drawerOpen && <RulesDrawer />}
              </SideDrawer>
            </>
          ) : (
            <>
              {compare ? <div /> : (
                <div className="scroll-thin flex min-h-0 flex-col gap-3 overflow-y-auto">
                  <LeftTabs tab={leftTab} setTab={setLeftTab} />
                  {leftTab === 'runs' ? <><Leaderboard /><LivePanel /></> : <Chronicle />}
                </div>
              )}
              <div className={`flex min-h-0 items-stretch gap-3 ${DEV ? 'mb-14' : ''}`}>
                <div className="scroll-thin flex min-h-0 flex-col items-end gap-3 overflow-y-auto">
                  <AdvancedDrawer />
                  <Dossier />
                  {drawerOpen && <RulesDrawer />}
                </div>
                {!compare && <EventFeed />}
              </div>
            </>
          )}
          {panel && (
            <div className={`pointer-events-none absolute left-0 top-0 z-20 flex ${DEV ? 'bottom-14' : 'bottom-0'} ${narrow ? 'right-0' : selection ? (compare ? 'right-[25rem]' : 'right-[38rem]') : compare ? 'right-0' : 'right-[14.5rem]'}`}>
              {panel === 'agents' ? <AgentsPanel /> : panel === 'hall' ? <HallPanel /> : <Roadmap />}
            </div>
          )}
          <div className="pointer-events-none absolute bottom-2 left-1/2 z-0 -translate-x-1/2"><Caption /></div>
        </div>
        <div className="mt-3 shrink-0 xl:mt-4"><Timeline /></div>
      </div>
      <ShortcutSheet />
      <Intro />
    </main>
  )
}
