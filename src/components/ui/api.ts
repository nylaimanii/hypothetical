'use client'
import type { Override, RunRecord, RunSummary } from '@/lib/types'

export class Offline extends Error {}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  } catch {
    throw new Offline('runner offline')
  }
  if (res.status === 404 || res.status === 501 || res.status === 503) throw new Offline('runner offline')
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  runs: () => call<RunSummary[]>('/api/runs'),
  run: (id: string) => call<RunRecord>(`/api/runs/${encodeURIComponent(id)}`),
  ask: (runId: string, question: string) => call<{ answer: string }>('/api/ask', { method: 'POST', body: JSON.stringify({ runId, question }) }),
  liveStart: (body: { constitution?: string; seed?: number } = {}) => call<{ runId: string }>('/api/live/start', { method: 'POST', body: JSON.stringify(body) }),
  live: (id: string) => call<RunRecord>(`/api/live/${encodeURIComponent(id)}`),
  override: (runId: string, override: Override) => call<{ ok: boolean }>('/api/override', { method: 'POST', body: JSON.stringify({ runId, override }) }),
}
