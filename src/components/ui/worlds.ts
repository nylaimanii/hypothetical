'use client'
import type { Agent, CompareResponse, Divergence, HallEntry, RunRecord, SlimRun } from '@/lib/types'
import { useStore } from '../state/store'
import { Offline } from './api'
import { normalizeRecord } from '../state/normalize'
import { loadInitial, metaFromSlim, shellFromSlim, slimFromRecord } from '../state/frames'

async function get<T>(url: string): Promise<T> {
  let res: Response
  try { res = await fetch(url, { cache: 'no-store' }) } catch { throw new Offline('runner offline') }
  if (!res.ok) throw new Offline(String(res.status))
  return res.json() as Promise<T>
}

const isSlim = (x: unknown): x is SlimRun => !!x && typeof x === 'object' && Array.isArray((x as SlimRun).years) && !Array.isArray((x as RunRecord).frames)

// a slim run becomes a record holding only the frames around `center`
async function fromSlim(s: SlimRun, center: number): Promise<RunRecord | null> {
  const meta = metaFromSlim(s)
  const c = Math.max(meta.firstTick, Math.min(meta.lastTick, center))
  const frames = await loadInitial(s.runId, meta, c).catch(() => [])
  if (!frames.length) return null
  useStore.getState().setSlim(s.runId, meta)
  return { ...shellFromSlim(s), frames }
}

// prefer the slim api (long runs load frames lazily); fall back to a full record
// every world shown comes from the records (no mock worlds: an api that has nothing means nothing is shown)
export async function fetchRecord(runId: string, center = 0): Promise<{ rec: RunRecord; source: 'api' } | null> {
  try {
    const body = await get<SlimRun | RunRecord>(`/api/runs/${encodeURIComponent(runId)}?slim=1`)
    if (isSlim(body)) { const rec = await fromSlim(body, center); if (rec) return { rec, source: 'api' } }
    else if (Array.isArray((body as RunRecord).frames) && (body as RunRecord).frames.length) {
      const rec = normalizeRecord(body as RunRecord)
      useStore.getState().setSlim(runId, slimFromRecord(rec))
      return { rec, source: 'api' }
    }
  } catch { /* not found */ }
  return null
}

// open a world, optionally at a tick; leaves compare mode
export async function openRun(runId: string, tick?: number) {
  const s = useStore.getState()
  if (s.record.runId === runId && !s.compare) {
    if (tick !== undefined) s.setPlayhead(tick)
    return true
  }
  s.setLoading('opening world')
  const got = await fetchRecord(runId, tick ?? 0).finally(() => useStore.getState().setLoading(null))
  if (!got) { s.setNotice('could not open that world'); return false }
  if (s.compare) s.setCompare(null)
  s.setRecord(got.rec, got.source)
  if (tick !== undefined) s.setPlayhead(Math.max(got.rec.frames[0].tick, tick))
  return true
}

export async function loadAgents() {
  const s = useStore.getState()
  try {
    const agents = await get<Agent[]>('/api/agents')
    if (Array.isArray(agents)) { s.setAgents(agents, 'api'); return }
  } catch { /* offline: nothing to show */ }
  s.setAgents([], 'api')
}

export async function loadHall(): Promise<{ entries: HallEntry[]; mock: boolean }> {
  try {
    const entries = await get<HallEntry[]>('/api/hall')
    if (Array.isArray(entries)) return { entries, mock: false }
  } catch { /* offline: nothing to show */ }
  return { entries: [], mock: false }
}

// one world per agent, on the same seed when possible. the api answers slim; frames load per globe
export async function startCompare(agentIds: string[], tick = 0) {
  useStore.getState().setLoading('loading worlds to compare')
  try { return await compareInner(agentIds, tick) } finally { useStore.getState().setLoading(null) }
}

async function compareInner(agentIds: string[], tick: number) {
  const s = useStore.getState()
  const ids = agentIds.slice(0, 4)
  let records: RunRecord[] = []
  let divergences: Divergence[] = []
  let note: string | undefined
  try {
    const res = await get<CompareResponse | { runs: RunRecord[]; divergences: Divergence[]; note?: string }>(`/api/compare?agents=${ids.map(encodeURIComponent).join(',')}`)
    divergences = res.divergences ?? []
    note = res.note
    const built = await Promise.all((res.runs ?? []).map(async (r: SlimRun | RunRecord) => {
      if (isSlim(r)) return fromSlim(r, tick)
      const rec = normalizeRecord(r as RunRecord)
      useStore.getState().setSlim(rec.runId, slimFromRecord(rec))
      return rec
    }))
    records = built.filter(Boolean) as RunRecord[]
  } catch { /* offline: nothing to compare */ }
  if (records.length < 2) { s.setNotice(note ?? 'need at least two agents with worlds to compare'); return false }
  s.setCompare({ agentIds: records.map((r) => r.agentId), records, divergences })
  s.setPlayhead(tick)
  if (note) s.setNotice(note)
  return true
}
