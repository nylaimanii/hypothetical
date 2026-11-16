import Link from 'next/link'
import { listWorlds, readIndex } from '@/lib/life/store'
import type { LifeSummary } from '@/lib/life/types'
import Portrait from '../components/Portrait'

export const dynamic = 'force-dynamic'

// home: one row per world. every chosen person who lived there, alive or dead, with their life score and
// "life #N in this world", and a line of scores across the lives against what each would get with the usual choices.
// stays near ~25 words by default; the stories live on each life's ending card and on /compare
export default function Home() {
  const worlds = listWorlds().map(w => ({ id: w, lives: readIndex(w).filter(l => l.status === 'done').sort((a, b) => a.lifeNo - b.lifeNo) })).filter(w => w.lives.length)
  if (!worlds.length) return <main style={{ display: 'grid', placeItems: 'center', height: '100%', opacity: 0.7 }}>no life has been lived yet</main>
  return (
    <main style={{ height: '100%', overflowY: 'auto', padding: '32px 16px 48px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <header style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 30, fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>one life</h1>
          <p style={{ margin: '6px 0 0', opacity: 0.6, fontSize: 15 }}>one person per world, birth to death</p>
        </header>
        {worlds.map(w => <WorldRow key={w.id} id={w.id} lives={w.lives} />)}
      </div>
    </main>
  )
}

function WorldRow({ id, lives }: { id: string; lives: LifeSummary[] }) {
  const first = lives[0], last = lives[lives.length - 1]
  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>world <span className="mono" style={{ fontWeight: 400, fontSize: 14, opacity: 0.7 }}>{id}</span></h2>
        {lives.length > 1 && <Link href={`/compare?a=${first.lifeId}&b=${last.lifeId}`} style={{ fontSize: 14, color: 'inherit' }}>compare two lives →</Link>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
        {[...lives].reverse().map(l => <LifeCard key={l.lifeId} l={l} />)}
      </div>
      {lives.length > 1 && <ScoreLine lives={lives} />}
    </section>
  )
}

function LifeCard({ l }: { l: LifeSummary }) {
  const dead = l.deathAge !== null
  return (
    <Link href={`/live?life=${l.lifeId}`} className="chip" style={{ borderRadius: 20, padding: 16, color: 'inherit', textDecoration: 'none', display: 'grid', gap: 10, justifyItems: 'start' }}>
      <Portrait look={l.look} age={l.deathAge ?? 30} dead={dead} size={88} title={`${l.name}, ${dead ? `died at ${Math.floor(l.deathAge!)}` : 'alive'}`} />
      <div style={{ minWidth: 0, width: '100%' }}>
        <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>{l.lastCity.toLowerCase()} · <span className="mono">{dead ? `2026–${2026 + Math.floor(((l.deathTick ?? 0) + 10) / 12)}` : 'alive'}</span></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        {l.score !== null && <span className="mono" style={{ fontSize: 24, lineHeight: 1 }}>{l.score.toFixed(2)}</span>}
        <span style={{ fontSize: 12, opacity: 0.55 }}>life <span className="mono">#{l.lifeNo}</span></span>
      </div>
    </Link>
  )
}

// each life's score (solid) against what the same person gets with the usual choices (dashed)
function ScoreLine({ lives }: { lives: LifeSummary[] }) {
  const W = 520, H = 120, pad = 28
  const vals = lives.flatMap(l => [l.score ?? 0, l.twinScore ?? 0])
  const lo = Math.max(0, Math.min(...vals) - 0.05), hi = Math.min(1, Math.max(...vals) + 0.05)
  const x = (i: number) => pad + (i / Math.max(1, lives.length - 1)) * (W - pad * 2)
  const y = (v: number) => H - 22 - ((v - lo) / Math.max(0.01, hi - lo)) * (H - 40)
  const line = (k: 'score' | 'twinScore') => lives.map((l, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(l[k] ?? 0).toFixed(1)}`).join(' ')
  const label = `life scores across ${lives.length} lives: ${lives.map(l => `${l.name.split(' ')[0]} ${(l.score ?? 0).toFixed(2)} (usual choices ${(l.twinScore ?? 0).toFixed(2)})`).join(', ')}`
  return (
    <figure style={{ margin: '18px 0 0', maxWidth: W }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}>
        <title>{label}</title>
        <path d={line('twinScore')} stroke="var(--ink)" strokeOpacity="0.3" strokeWidth="1.5" fill="none" strokeDasharray="3 4" />
        <path d={line('score')} stroke="var(--ink)" strokeWidth="2" fill="none" strokeLinejoin="round" />
        {lives.map((l, i) => (
          <g key={l.lifeId}>
            <circle cx={x(i)} cy={y(l.score ?? 0)} r="3.5" fill="var(--ink)" />
            <text x={x(i)} y={y(l.score ?? 0) - 9} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)">{(l.score ?? 0).toFixed(2)}</text>
            <text x={x(i)} y={H - 4} textAnchor="middle" fontSize="11" opacity="0.6">{l.name.split(' ')[0]}</text>
          </g>
        ))}
      </svg>
      <figcaption style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>solid: each life. dashed: the same person making the usual choices.</figcaption>
    </figure>
  )
}
