'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { TICKS_PER_SECOND, useStore } from '../state/store'
import { api, Offline } from './api'
import Dossier from './Dossier'
import { SideDrawer, useNarrow } from './Side'
import { Caption, EventFeed, Intro, useIntroGate, useSound } from './Extras'
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
        const end = s.record.frames.at(-1)!.tick
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
      <Globe />
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col p-3 xl:p-4">
        <div className="relative flex flex-wrap items-start justify-between gap-2">
          <TopLeft />
          <div className="order-last flex w-full min-w-0 flex-col items-center gap-2 xl:order-none xl:w-auto xl:flex-1">
            <MissionBar />
            <Notice />
          </div>
          <TopRight onLive={startLive} />
        </div>
        <div className="relative mt-3 flex min-h-0 flex-1 items-stretch justify-between gap-4 xl:mt-4">
          {narrow ? (
            <>
              <SideDrawer side="left" label="runs" open={leftOpen} onToggle={() => setLeftOpen(!leftOpen)}>
                <Leaderboard />
                <LivePanel />
              </SideDrawer>
              <div className={`absolute right-0 top-12 flex min-h-0 ${DEV ? 'bottom-14' : 'bottom-0'}`}><EventFeed /></div>
              <SideDrawer side="right" label="details" open={rightOpen} onToggle={() => setRightOpen(!rightOpen)} reserveBottom={DEV}>
                <AdvancedDrawer />
                <Dossier />
                {drawerOpen && <RulesDrawer />}
              </SideDrawer>
            </>
          ) : (
            <>
              <div className="scroll-thin flex min-h-0 flex-col gap-3 overflow-y-auto">
                <Leaderboard />
                <LivePanel />
              </div>
              <div className={`flex min-h-0 items-stretch gap-3 ${DEV ? 'mb-14' : ''}`}>
                <div className="scroll-thin flex min-h-0 flex-col items-end gap-3 overflow-y-auto">
                  <AdvancedDrawer />
                  <Dossier />
                  {drawerOpen && <RulesDrawer />}
                </div>
                <EventFeed />
              </div>
            </>
          )}
          {panel && (
            <div className={`pointer-events-none absolute left-0 top-0 z-20 flex ${DEV ? 'bottom-14' : 'bottom-0'} ${narrow ? 'right-0' : selection ? 'right-[38rem]' : 'right-[14.5rem]'}`}>
              <Roadmap />
            </div>
          )}
          <div className="pointer-events-none absolute bottom-2 left-1/2 z-0 -translate-x-1/2"><Caption /></div>
        </div>
        <div className="mt-3 shrink-0 xl:mt-4"><Timeline /></div>
      </div>
      <Intro />
    </main>
  )
}
