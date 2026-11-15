'use client'
import type { Provenance } from '@/lib/types'

export const fmt = {
  people: (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}b` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : `${Math.round(n)}`),
  usd: (n: number) => (n >= 1e12 ? `$${(n / 1e12).toFixed(1)}t` : n >= 1e9 ? `$${(n / 1e9).toFixed(0)}b` : `$${(n / 1e6).toFixed(0)}m`),
  pct: (n: number) => `${Math.round(n * 100)}%`,
  kcal: (n: number) => `${Math.round(n)}`,
  twh: (n: number) => `${Math.round(n).toLocaleString('en-US')}`,
}

export function Num({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <span className={`font-mono tabular-nums ${className}`} style={style}>{children}</span>
}

export function Prov({ p }: { p?: Provenance }) {
  if (!p) return null
  if (p.kind === 'SOURCED' && p.url)
    return <a href={p.url} target="_blank" rel="noreferrer" className="rounded border border-ink/25 px-1 font-mono text-[9px] uppercase tracking-wide text-ink/70 hover:bg-ink hover:text-bone">sourced</a>
  return <span className="rounded border border-dashed border-ink/25 px-1 font-mono text-[9px] uppercase tracking-wide text-ink/50">estimate</span>
}

export function Bar({ value, label, danger = false }: { value: number; label?: string; danger?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="w-20 shrink-0 text-[11px] text-ink/60">{label}</span>}
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10">
        <div className={`h-full rounded-full ${danger ? 'bg-ember' : 'bg-ink/75'}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </div>
      <Num className="w-9 text-right text-[11px]">{fmt.pct(value)}</Num>
    </div>
  )
}

export function Sparkline({ values, w = 220, h = 36, danger = false }: { values: number[]; w?: number; h?: number; danger?: boolean }) {
  if (values.length < 2) return null
  const lo = Math.min(...values), hi = Math.max(...values)
  const span = hi - lo || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 4) + 2},${h - 3 - ((v - lo) / span) * (h - 6)}`).join(' ')
  const last = pts.split(' ').at(-1)!.split(',')
  return (
    <svg width={w} height={h} className="block overflow-visible">
      <polyline points={pts} fill="none" stroke={danger ? 'var(--ember)' : 'var(--ink)'} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.6} fill={danger ? 'var(--ember)' : 'var(--ink)'} />
    </svg>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-ink/45">{title}</div>
      {children}
    </div>
  )
}

export function Delta({ v, invert = false, format }: { v: number; invert?: boolean; format: (n: number) => string }) {
  if (!isFinite(v) || Math.abs(v) < 1e-9) return null
  const good = invert ? v < 0 : v > 0
  return <Num className={`text-[10px] ${good ? 'text-ink/60' : 'text-ink/40'}`}>{v > 0 ? '+' : '-'}{format(Math.abs(v))}</Num>
}

// loading placeholder in the bone palette, never a blank box
export function Skel({ className = '' }: { className?: string }) {
  return <span className={`skel block rounded-lg ${className}`} aria-hidden />
}
