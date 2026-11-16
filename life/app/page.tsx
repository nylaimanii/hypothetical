import Link from 'next/link'
import { listWorlds, readIndex } from '@/lib/life/store'
import type { LifeSummary } from '@/lib/life/types'
import Portrait from '../components/Portrait'

export const dynamic = 'force-dynamic'

// home: one chosen person per world (the latest life lived there), alive or dead, with their life score and
// "life #N in this world", and a small line of life scores across that world's lives. under ~25 words by default
export default function Home() {
  const worlds = listWorlds().map(w => ({ id: w, lives: readIndex(w).filter(l => l.status === 'done').sort((a, b) => a.lifeNo - b.lifeNo) })).filter(w => w.lives.length)
  if (!worlds.length) return <main style={{ display: 'grid', placeItems: 'center', height: '100%', opacity: 0.7 }}>no life has been lived yet</main>
  return (
    <main style={{ height: '100%', overflowY: 'auto', padding: '28px 16px 40px' }}>
      <header style={{ maxWidth: 1080, margin: '0 auto 28px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>one life</h1>
        <p style={{ margin: '6px 0 0', opacity: 0.6, fontSize: 15 }}>one person per world, birth to death</p>
      </header>
      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 18 }}>
        {worlds.map(w => <WorldCard key={w.id} lives={w.lives} />)}
      </div>
    </main>
  )
}

function WorldCard({ lives }: { lives: LifeSummary[] }) {
  const l = lives[lives.length - 1]
  const dead = l.deathAge !== null
  const age = l.deathAge ?? 0
  return (
    <Link href={`/live?life=${l.lifeId}`} className="chip" style={{ borderRadius: 20, padding: 18, color: 'inherit', textDecoration: 'none', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <Portrait look={l.look} age={age} dead={dead} size={72} title={l.name} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
          <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>
            {l.lastCity.toLowerCase()} · <span className="mono">{dead ? `2026–${2026 + Math.floor(((l.deathTick ?? 0) + 10) / 12)}` : 'alive'}</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 10 }}>
        <div>
          {l.score !== null && <div className="mono" style={{ fontSize: 24, lineHeight: 1 }}>{l.score.toFixed(2)}</div>}
          <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>life <span className="mono">#{l.lifeNo}</span> in this world</div>
        </div>
        <Spark lives={lives} />
      </div>
    </Link>
  )
}

// life scores across this world's lives, oldest to newest; the faint line is what each person gets with the usual choices
function Spark({ lives }: { lives: LifeSummary[] }) {
  if (lives.length < 2) return null
  const W = 96, H = 34
  const vals = lives.flatMap(l => [l.score ?? 0, l.twinScore ?? 0])
  const lo = Math.min(...vals) - 0.02, hi = Math.max(...vals) + 0.02
  const x = (i: number) => (i / (lives.length - 1)) * (W - 4) + 2
  const y = (v: number) => H - 2 - ((v - lo) / Math.max(0.01, hi - lo)) * (H - 4)
  const line = (k: 'score' | 'twinScore') => lives.map((l, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(l[k] ?? 0).toFixed(1)}`).join(' ')
  const label = `life scores across ${lives.length} lives: ${lives.map(l => (l.score ?? 0).toFixed(2)).join(', ')}`
  return (
    <svg width={W} height={H} role="img" aria-label={label}>
      <title>{label}</title>
      <path d={line('twinScore')} stroke="var(--ink)" strokeOpacity="0.2" strokeWidth="1.5" fill="none" strokeDasharray="2 3" />
      <path d={line('score')} stroke="var(--ink)" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
      {lives.map((l, i) => <circle key={l.lifeId} cx={x(i)} cy={y(l.score ?? 0)} r="2.2" fill="var(--ink)" />)}
    </svg>
  )
}
