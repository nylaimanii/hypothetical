'use client'
import type { Agent, CompareResponse, Divergence, HallEntry, RunRecord, SlimRun } from '@/lib/types'
import { mockRuns } from '@/lib/mock/run'
import { buildAgents, computeDivergences, computeHall } from '@/lib/mock/agents'
import { useStore } from '../state/store'
import { Offline } from './api'
import { normalizeRecord } from '../state/normalize'
import { lazyMock, loadInitial, metaFromSlim, shellFromSlim, slimFromMock, slimFromRecord } from '../state/frames'

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
export async function fetchRecord(runId: string, center = 0): Promise<{ rec: RunRecord; source: 'mock' | 'api' } | null> {
  const mock = mockRuns().find((r) => r.runId === runId)
  if (mock && lazyMock()) { const rec = await fromSlim(slimFromMock(mock), center); return rec ? { rec, source: 'api' } : null }
  if (mock) { useStore.getState().setSlim(runId, slimFromRecord(mock)); return { rec: mock, source: 'mock' } }
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
  const got = await fetchRecord(runId, tick ?? 0)
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
    if (Array.isArray(agents) && agents.length) { s.setAgents(agents, 'api'); return }
  } catch { /* fall back */ }
  s.setAgents(buildAgents(mockRuns()), 'mock')
}

export async function loadHall(): Promise<{ entries: HallEntry[]; mock: boolean }> {
  try {
    const entries = await get<HallEntry[]>('/api/hall')
    if (Array.isArray(entries) && entries.length) return { entries, mock: false }
  } catch { /* fall back */ }
  return { entries: computeHall(mockRuns()), mock: true }
}

// one world per agent, on the same seed when possible. the api answers slim; frames load per globe
export async function startCompare(agentIds: string[], tick = 0) {
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
  } catch { /* fall back to mock */ }
  if (records.length < 2) {
    const pool = mockRuns()
    const bySeed = new Map<number, number>()
    for (const r of pool) bySeed.set(r.seed, (bySeed.get(r.seed) ?? 0) + 1)
    const pickFor = (id: string) => pool.filter((r) => r.agentId === id).sort((a, b) => (bySeed.get(b.seed) ?? 0) - (bySeed.get(a.seed) ?? 0))[0]
    const picked = ids.map(pickFor).filter(Boolean) as RunRecord[]
    if (lazyMock()) records = (await Promise.all(picked.map((r) => fromSlim(slimFromMock(r), tick)))).filter(Boolean) as RunRecord[]
    else { records = picked; for (const r of picked) useStore.getState().setSlim(r.runId, slimFromRecord(r)) }
    divergences = computeDivergences(picked)
  }
  if (records.length < 2) { s.setNotice(note ?? 'need at least two agents with worlds to compare'); return false }
  s.setCompare({ agentIds: records.map((r) => r.agentId), records, divergences })
  s.setPlayhead(tick)
  if (note) s.setNotice(note)
  return true
}
