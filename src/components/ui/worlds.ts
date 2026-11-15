'use client'
import type { Agent, Divergence, HallEntry, RunRecord } from '@/lib/types'
import { mockRuns } from '@/lib/mock/run'
import { buildAgents, computeDivergences, computeHall } from '@/lib/mock/agents'
import { frameIndexAt, useStore } from '../state/store'
import { Offline } from './api'
import { normalizeRecord } from '../state/normalize'

async function get<T>(url: string): Promise<T> {
  let res: Response
  try { res = await fetch(url, { cache: 'no-store' }) } catch { throw new Offline('runner offline') }
  if (!res.ok) throw new Offline(String(res.status))
  return res.json() as Promise<T>
}

export async function fetchRecord(runId: string): Promise<{ rec: RunRecord; source: 'mock' | 'api' } | null> {
  const mock = mockRuns().find((r) => r.runId === runId)
  if (mock) return { rec: mock, source: 'mock' }
  try { return { rec: await get<RunRecord>(`/api/runs/${encodeURIComponent(runId)}`), source: 'api' } } catch { return null }
}

// open a world, optionally at a tick; leaves compare mode
export async function openRun(runId: string, tick?: number) {
  const s = useStore.getState()
  if (s.record.runId === runId && !s.compare) {
    if (tick !== undefined) s.setPlayhead(tick)
    return true
  }
  const got = await fetchRecord(runId)
  if (!got) { s.setNotice('could not open that world'); return false }
  if (s.compare) s.setCompare(null)
  s.setRecord(got.rec, got.source)
  if (tick !== undefined) s.setPlayhead(got.rec.frames[frameIndexAt(got.rec.frames, tick)]?.tick ?? 0)
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

// one world per agent, on the same seed when possible
export async function startCompare(agentIds: string[]) {
  const s = useStore.getState()
  const ids = agentIds.slice(0, 4)
  let records: RunRecord[] = []
  let divergences: Divergence[] = []
  try {
    const res = await get<{ runs: RunRecord[]; divergences: Divergence[] }>(`/api/compare?agents=${ids.map(encodeURIComponent).join(',')}`)
    records = (res.runs ?? []).map(normalizeRecord)
    divergences = res.divergences ?? []
  } catch { /* fall back to mock */ }
  if (records.length < 2) {
    const pool = mockRuns()
    const bySeed = new Map<number, number>()
    for (const r of pool) bySeed.set(r.seed, (bySeed.get(r.seed) ?? 0) + 1)
    const pickFor = (id: string) => pool.filter((r) => r.agentId === id).sort((a, b) => (bySeed.get(b.seed) ?? 0) - (bySeed.get(a.seed) ?? 0))[0]
    records = ids.map(pickFor).filter(Boolean) as RunRecord[]
    divergences = computeDivergences(records)
  }
  if (records.length < 2) { s.setNotice('need at least two agents with worlds to compare'); return false }
  s.setCompare({ agentIds: records.map((r) => r.agentId), records, divergences })
  s.setPlayhead(0)
  return true
}
