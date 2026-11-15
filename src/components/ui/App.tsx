'use client'
import { useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { TICKS_PER_SECOND, useStore } from '../state/store'
import { api, Offline } from './api'
import Inspector from './Inspector'
import Timeline from './Timeline'
import LivePanel from './LivePanel'
import { Leaderboard, ModeToggle, RulesDrawer, TopLeft, TopRight } from './Chrome'

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
  const setLive = useStore((s) => s.setLive)
  const liveRunId = useStore((s) => s.liveRunId)
  const drawerOpen = useStore((s) => s.drawerOpen)

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
      <div className="pointer-events-none absolute inset-0 flex flex-col p-4">
        <div className="flex items-start justify-between gap-4">
          <TopLeft />
          <div className="flex flex-col items-center gap-2"><ModeToggle /><Notice /></div>
          <TopRight onLive={startLive} />
        </div>
        <div className="mt-4 flex min-h-0 flex-1 items-start justify-between gap-4">
          <div className="flex flex-col gap-3">
            <Leaderboard />
            <LivePanel />
          </div>
          <div className="flex items-start gap-3">
            <Inspector />
            {drawerOpen && <RulesDrawer />}
          </div>
        </div>
        <div className="mt-4"><Timeline /></div>
      </div>
    </main>
  )
}
