'use client'
import { useEffect } from 'react'
import { useStore } from '../state/store'

export const SHORTCUTS: [string, string][] = [
  ['space', 'play or pause'],
  ['← →', 'step a year back or forward'],
  ['1 2 3', 'speed 1x, 4x, 16x'],
  ['d', 'director mode on or off'],
  ['f', 'fullscreen globe, ui hidden'],
  ['?', 'this sheet'],
  ['esc', 'close the sheet or leave fullscreen'],
]

function span() {
  const s = useStore.getState()
  const recs = s.compare ? s.compare.records : [s.record]
  const first = (r: typeof s.record) => { const m = s.slim[r.runId]; return m?.lazy ? m.firstTick : r.frames[0].tick }
  const last = (r: typeof s.record) => { const m = s.slim[r.runId]; return m?.lazy ? m.lastTick : r.frames.at(-1)!.tick }
  return [Math.min(...recs.map(first)), Math.max(...recs.map(last))] as const
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const s = useStore.getState()
      const [t0, t1] = span()
      switch (e.key) {
        case ' ':
          e.preventDefault()
          if (!s.playing && s.playhead >= t1) s.setPlayhead(t0)
          s.setPlaying(!s.playing)
          break
        case 'ArrowLeft': e.preventDefault(); s.setPlayhead(Math.max(t0, Math.round(s.playhead) - 12)); break
        case 'ArrowRight': e.preventDefault(); s.setPlayhead(Math.min(t1, Math.round(s.playhead) + 12)); break
        case '1': s.setSpeed(1); break
        case '2': s.setSpeed(4); break
        case '3': s.setSpeed(16); break
        case 'd': s.setDirector(!s.director); s.setNotice(`director ${!s.director ? 'on' : 'off'}`); break
        case 'f': toggleGlobeOnly(); break
        case '?': s.setShortcuts(!s.shortcutsOpen); break
        case 'Escape':
          if (s.shortcutsOpen) s.setShortcuts(false)
          else if (s.globeOnly) toggleGlobeOnly(false)
          break
      }
    }
    // leaving browser fullscreen with esc also brings the ui back
    const onFs = () => { if (!document.fullscreenElement && useStore.getState().globeOnly) useStore.getState().setGlobeOnly(false) }
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs) }
  }, [])
}

export function toggleGlobeOnly(on?: boolean) {
  const s = useStore.getState()
  const next = on ?? !s.globeOnly
  s.setGlobeOnly(next)
  try {
    if (next && !document.fullscreenElement) void document.documentElement.requestFullscreen?.()
    if (!next && document.fullscreenElement) void document.exitFullscreen?.()
  } catch { /* fullscreen can be refused, the ui still hides */ }
}

export function ShortcutSheet() {
  const open = useStore((s) => s.shortcutsOpen)
  const setOpen = useStore((s) => s.setShortcuts)
  if (!open) return null
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink/30 backdrop-blur-[1px]" onClick={() => setOpen(false)}>
      <div className="panel dossier-in w-[22rem] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><div className="font-display text-xl">shortcuts</div><button onClick={() => setOpen(false)} className="text-lg text-ink/50 hover:text-ink" aria-label="close">×</button></div>
        <ul className="mt-3 space-y-1.5">
          {SHORTCUTS.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-ink/70">{v}</span>
              <span className="flex gap-1">{k.split(' ').map((p) => <kbd key={p} className="min-w-7 rounded-md border border-ink/25 bg-bone px-1.5 py-0.5 text-center font-mono text-[11px] shadow-[0_1px_0_rgba(29,27,25,0.25)]">{p}</kbd>)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
