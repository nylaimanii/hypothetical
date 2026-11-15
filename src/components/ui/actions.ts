'use client'
import type { Budget, Override, WorldEvent } from '@/lib/types'
import { frameIndexAt, useStore } from '../state/store'
import { api, Offline } from './api'

let oid = 1
const newId = () => `ov-${Date.now().toString(36)}-${oid++}`

// sends an override to the runner. with no runner (sandbox) it applies locally so the world still reacts visually
export async function sendOverride(o: Omit<Override, 'id' | 'tick'>) {
  const s = useStore.getState()
  const frame = s.record.frames[frameIndexAt(s.record.frames, s.playhead)]
  const override: Override = { ...o, id: newId(), tick: frame.tick }
  const live = s.liveRunId && s.liveRunId !== 'sandbox'
  let local = !live
  if (live) {
    try {
      await api.override(s.liveRunId!, override)
    } catch (e) {
      if (e instanceof Offline) { s.setRunnerOffline(true); local = true } else throw e
    }
  }
  s.addOverride({ ...override, tick: frame.tick, local })
  if (o.kind === 'inject_event') {
    s.pushJuice({ kind: (o.eventKind ?? 'disaster') as WorldEvent['kind'], regionId: o.regionId, severity: o.severity ?? 0.6, text: 'injected by you' })
  }
  if (local && o.kind === 'veto_law' && o.lawId) {
    const rec = s.record
    const frames = rec.frames.map((f) => (f.tick >= frame.tick ? { ...f, laws: f.laws.map((l) => (l.id === o.lawId ? { ...l, vetoed: true } : l)) } : f))
    s.replaceRecord({ ...rec, frames })
  }
  if (local && o.kind === 'force_budget' && o.budget) {
    const rec = s.record
    const frames = rec.frames.map((f) => {
      if (f.tick < frame.tick) return f
      const b = { ...f.budget, ...o.budget } as Budget
      const sum = Object.values(b).reduce((a, v) => a + v, 0) || 1
      return { ...f, budget: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v / sum])) as Budget }
    })
    s.replaceRecord({ ...rec, frames })
  }
  s.setNotice(local ? 'applied locally, runner offline' : 'sent to the core')
  return override
}
