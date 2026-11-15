'use client'
// v3: every open world is a tab. a live mini globe, the agent, the world number, the year it reached and how it is doing.
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Agent, Frame, RunRecord, RunSummary } from '@/lib/types'
import { useStore } from '../state/store'
import { buildTiles, latLonToVec3, tileIndexAt } from '../world/lib'
import { sunDirection, tickToDate } from '../world/time'
import Emblem from './Emblem'
import { Num } from './bits'
import { fetchRecord, openRun } from './worlds'

// "world #7": the run's own trailing number when it has one, else its place in the run list
export function worldNumber(runId: string, runs: RunSummary[]) {
  const m = runId.match(/(\d+)$/)
  if (m) return Number(m[1])
  const i = runs.findIndex((r) => r.runId === runId)
  return i >= 0 ? i + 1 : 0
}

// readable name when the agent roster doesn't know the id: "meridian-ii-x-solace" -> "meridian ii × solace"
export const prettyAgent = (id?: string) => (id ?? '').replace(/-x-/g, ' × ').replace(/-/g, ' ')

export function agentOf(rec: RunRecord | undefined, agents: Agent[]) {
  return rec ? agents.find((a) => a.id === (rec.agentId ?? rec.summary.agentId)) : undefined
}

export const statusTone = (status?: string) =>
  status === 'destroyed' ? { dot: 'bg-ink/35', ring: 'ring-1 ring-ember/70', word: 'lost' }
    : status === 'goal_achieved' ? { dot: 'bg-[#C9A227]', ring: 'ring-1 ring-[#C9A227]/70', word: 'goal reached' }
      : status === 'complete' ? { dot: 'bg-ink/60', ring: '', word: 'reached 2126' }
        : { dot: 'bg-[#7FAE7A]', ring: '', word: 'alive' }

// world colors for graphs and dots: one per tab, steady per position
export const WORLD_COLORS = ['#1D1B19', '#3E7CB1', '#C27C2C', '#5E8C4A', '#8A5FB0', '#B04F6A', '#2F8C8C', '#7A6A4F', '#4F5BA8']

// ---- the mini globe: a tiny orthographic render on a 2d canvas, refreshed every few seconds ----
const BIOME_RGB = [0x79, 0xa8, 0x5e]
function Thumb({ frame, dead }: { frame: Frame | undefined; dead: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [spin, setSpin] = useState(0)
  useEffect(() => { const id = setInterval(() => setSpin((s) => s + 1), 3000); return () => clearInterval(id) }, [])
  const tiles = useMemo(() => (frame ? buildTiles(frame.regions).tiles : null), [frame])
  useEffect(() => {
    const cv = ref.current
    if (!cv || !frame || !tiles) return
    const S = cv.width
    const g = cv.getContext('2d')
    if (!g) return
    const img = g.createImageData(S, S)
    const sun = sunDirection(tickToDate(frame.tick))
    // look at the world from a slowly turning longitude
    const lon0 = ((spin * 25) % 360) - 180
    const cam = latLonToVec3(18, lon0, 1).normalize()
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), cam).normalize()
    const up = new THREE.Vector3().crossVectors(cam, right)
    const haze = frame.atmosphere?.haze ?? 0
    const tint = new THREE.Color(frame.atmosphere?.tint ?? '#bfe3ff')
    const p = new THREE.Vector3()
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S * 2 - 1, v = 1 - (y + 0.5) / S * 2
      const rr = u * u + v * v
      const o = (y * S + x) * 4
      if (rr > 1) { img.data[o + 3] = 0; continue }
      p.copy(cam).multiplyScalar(Math.sqrt(1 - rr)).addScaledVector(right, u).addScaledVector(up, v)
      const t = tiles[tileIndexAt(p)]
      const reg = t && t.region >= 0 ? frame.regions[t.region] : undefined
      const vis = reg?.visual
      let r: number, gg: number, b: number
      if (t?.land) {
        if (t.ice) { r = 240; gg = 242; b = 240 } else {
          const forest = vis?.forest ?? 0.4, poll = vis?.pollution ?? 0.2, dmg = vis?.damage.level ?? 0
          r = BIOME_RGB[0] * (1 - forest * 0.3) + 120 * poll; gg = BIOME_RGB[1] * (0.8 + forest * 0.3) - 30 * poll; b = BIOME_RGB[2] - 20 * poll
          r = r * (1 - dmg) + 120 * dmg; gg = gg * (1 - dmg) + 116 * dmg; b = b * (1 - dmg) + 110 * dmg
        }
      } else {
        const poll = reg?.visual?.pollution ?? 0.2
        r = 74 + 40 * poll; gg = 127 + 10 * poll; b = 157 - 50 * poll
      }
      // day and night; lit cities on the night side
      const day = Math.max(0, Math.min(1, (p.dot(sun) + 0.15) / 0.45))
      const light = 0.35 + 0.65 * day
      r *= light; gg *= light; b *= light
      if (day < 0.3 && t?.land && reg && (vis?.lightDensity ?? 0.5) * (1 - (vis?.damage.level ?? 0)) > 0.35 && ((x * 7 + y * 13) % 5 === 0)) { r = 255; gg = 214; b = 140 }
      // atmosphere haze
      r = r * (1 - haze * 0.5) + tint.r * 255 * haze * 0.5; gg = gg * (1 - haze * 0.5) + tint.g * 255 * haze * 0.5; b = b * (1 - haze * 0.5) + tint.b * 255 * haze * 0.5
      if (dead) { const l = (r + gg + b) / 3; r = gg = b = l * 0.85 }
      // soft rim
      const rim = Math.pow(rr, 6) * 0.5
      img.data[o] = r * (1 - rim) + 230 * rim; img.data[o + 1] = gg * (1 - rim) + 236 * rim; img.data[o + 2] = b * (1 - rim) + 245 * rim; img.data[o + 3] = 255
    }
    g.putImageData(img, 0, 0)
  }, [frame, tiles, spin, dead])
  if (!frame) return <span className="skel inline-block h-7 w-7 rounded-full" />
  return <canvas ref={ref} width={56} height={56} className="h-7 w-7 shrink-0 rounded-full" aria-hidden />
}

// load every tab's record so tabs, graphs and the daily can compare them
export function useTabRecords() {
  const tabs = useStore((s) => s.tabs)
  const have = useStore((s) => s.tabRecords)
  useEffect(() => {
    for (const id of tabs) if (!have[id]) fetchRecord(id).then((got) => { if (got) useStore.getState().setTabRecord(got.rec) })
  }, [tabs, have])
}

// the last loaded frame of a tab's world: what its thumbnail shows
function lastFrame(rec: RunRecord | undefined, active: boolean, playheadFrame: Frame | undefined) {
  if (!rec) return undefined
  return active && playheadFrame ? playheadFrame : rec.frames[rec.frames.length - 1]
}

// switch worlds with a quick zoom out and in
export async function switchTab(runId: string) {
  const s = useStore.getState()
  if (s.record.runId === runId && !s.compare) return
  s.setSwapping(true)
  await new Promise((r) => setTimeout(r, 180))
  const t = Math.round(s.playhead)
  await openRun(runId, t)
  setTimeout(() => useStore.getState().setSwapping(false), 40)
}

export function closeTab(runId: string) {
  const s = useStore.getState()
  if (s.tabs.length <= 1) return
  const i = s.tabs.indexOf(runId)
  const tabs = s.tabs.filter((x) => x !== runId)
  s.setTabs(tabs)
  if (s.record.runId === runId) switchTab(tabs[Math.max(0, i - 1)])
}

export function addTab(runId: string, focus = true) {
  const s = useStore.getState()
  if (!s.tabs.includes(runId)) s.setTabs([...s.tabs, runId])
  if (focus) switchTab(runId)
}

function Picker({ onClose, onLive }: { onClose: () => void; onLive: () => void }) {
  const runs = useStore((s) => s.runs)
  const agents = useStore((s) => s.agents)
  const tabs = useStore((s) => s.tabs)
  const [by, setBy] = useState<'leaderboard' | 'agents' | 'lost'>('leaderboard')
  const rows = useMemo(() => {
    const list = [...runs]
    if (by === 'leaderboard') return list.sort((a, b) => b.score - a.score)
    if (by === 'lost') return list.filter((r) => r.status === 'destroyed')
    return list.sort((a, b) => (a.agentId ?? '').localeCompare(b.agentId ?? '') || b.score - a.score)
  }, [runs, by])
  return (
    <div className="panel pointer-events-auto absolute left-0 top-full z-40 mt-2 w-[26rem] p-3 shadow-xl" onMouseLeave={onClose}>
      <div className="mb-2 flex items-center gap-1 text-[12px]">
        {(['leaderboard', 'agents', 'lost'] as const).map((k) => <button key={k} onClick={() => setBy(k)} className={`rounded-full px-2.5 py-0.5 ${by === k ? 'bg-ink text-bone' : 'text-ink/60 hover:bg-ink/5'}`}>{k === 'lost' ? 'the hall of the lost' : k}</button>)}
        <button onClick={() => { onLive(); onClose() }} className="ml-auto rounded-full border border-ink/25 px-2.5 py-0.5 hover:bg-ink hover:text-bone">start a live world</button>
      </div>
      <ul className="scroll-thin max-h-80 overflow-y-auto">
        {rows.map((r) => {
          const a = agents.find((x) => x.id === r.agentId)
          const open = tabs.includes(r.runId)
          const tone = statusTone(r.status)
          return (
            <li key={r.runId}>
              <button onClick={() => { addTab(r.runId); onClose() }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-ink/5">
                {a && <Emblem seed={a.emblemSeed} size={20} />}
                <span className="min-w-0 flex-1 truncate">{a?.name ?? prettyAgent(r.agentId)} <span className="text-ink/50">world #<Num>{worldNumber(r.runId, runs)}</Num></span></span>
                <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                <Num className="w-10 text-right text-ink/60">{r.endDate.slice(0, 4)}</Num>
                <Num className="w-12 text-right">{r.score.toFixed(2)}</Num>
                {open && <span className="text-[10px] text-ink/45">open</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function WorldTabs({ onLive }: { onLive: () => void }) {
  useTabRecords()
  const tabs = useStore((s) => s.tabs)
  const recs = useStore((s) => s.tabRecords)
  const active = useStore((s) => (s.compare ? null : s.record.runId))
  const runs = useStore((s) => s.runs)
  const agents = useStore((s) => s.agents)
  const playhead = useStore((s) => s.playhead)
  const activeRec = useStore((s) => s.record)
  const [picker, setPicker] = useState(false)
  const drag = useRef<string | null>(null)
  const playFrame = useMemo(() => { let f = activeRec.frames[0]; for (const x of activeRec.frames) if (x.tick <= playhead + 1e-6) f = x; return f }, [activeRec, playhead])

  // ctrl+1..9 jumps to a tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return
      const n = Number(e.key)
      if (!n) return
      const id = useStore.getState().tabs[n - 1]
      if (id) { e.preventDefault(); switchTab(id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const drop = (target: string) => {
    const from = drag.current
    drag.current = null
    if (!from || from === target) return
    const list = tabs.filter((x) => x !== from)
    list.splice(list.indexOf(target), 0, from)
    useStore.getState().setTabs(list)
  }

  return (
    <nav className="pointer-events-auto relative flex min-w-0 items-center gap-1.5" aria-label="open worlds">
      <div className="scroll-thin flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5">
        {tabs.map((id, i) => {
          const rec = recs[id] ?? (activeRec.runId === id ? activeRec : undefined)
          const on = id === active
          const f = lastFrame(rec, on, playFrame)
          const status = on ? playFrame.status : rec?.summary.status
          const tone = statusTone(status)
          const a = agentOf(rec, agents)
          const year = f ? tickToDate(f.tick).getUTCFullYear() : undefined
          return (
            <div key={id} draggable onDragStart={() => { drag.current = id }} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(id)}
              className={`group flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-2 text-[12px] transition ${on ? 'bg-ink text-bone shadow-md' : 'panel hover:bg-bone'} ${tone.ring}`}>
              <button onClick={() => switchTab(id)} className="flex items-center gap-2" title={`ctrl+${i + 1}`}>
                <Thumb frame={f} dead={status === 'destroyed'} />
                {a && <Emblem seed={a.emblemSeed} size={18} />}
                <span className="flex flex-col items-start leading-tight">
                  <span className="max-w-[9rem] truncate font-display text-[13px]">{a?.name ?? (rec ? prettyAgent(rec.agentId) : 'loading')}</span>
                  <span className={`text-[10.5px] ${on ? 'text-bone/70' : 'text-ink/55'}`}>world #<Num>{worldNumber(id, runs)}</Num>{year && <> · <Num>{year}</Num></>}</span>
                </span>
                <span className={`h-2 w-2 rounded-full ${tone.dot}`} title={tone.word} />
              </button>
              {tabs.length > 1 && <button onClick={() => closeTab(id)} aria-label="close world" className={`ml-0.5 rounded-full px-1 text-[13px] leading-none opacity-0 transition group-hover:opacity-100 ${on ? 'text-bone/70 hover:text-bone' : 'text-ink/50 hover:text-ink'}`}>×</button>}
            </div>
          )
        })}
      </div>
      <div className="relative shrink-0">
        <button onClick={() => setPicker((p) => !p)} aria-label="open another world" className="panel flex h-9 w-9 items-center justify-center rounded-full text-[18px] leading-none hover:bg-bone">+</button>
        {picker && <Picker onClose={() => setPicker(false)} onLive={onLive} />}
      </div>
    </nav>
  )
}
