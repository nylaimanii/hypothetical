import Link from 'next/link'
import { listWorlds, readIndex, readJsonSafe, livesFile } from '@/lib/life/store'
import { CONTINENTS, CONTINENT_NAME, continentOf, type Continent } from '@/lib/life/births'
import type { LifeSummary } from '@/lib/life/types'
import Portrait from '../components/Portrait'
import { cardView } from '@/lib/life/views'

export const dynamic = 'force-dynamic'

type Card = LifeSummary & { agent: string }

// home: the chosen people grouped by continent, at least two per continent, each in a different world. every card
// says which agent's world it is ("lagos · halcyon"), so the same kind of city can be compared across agents.
// stays near ~25 words by default; the stories live on each life's ending card and on /compare
export default function Home() {
  // the agent that governed each world, written next to its lives by scripts/life-roster.ts (data/lives/<world>/world.json)
  const agentOf = (w: string) => readJsonSafe<{ agent: string }>(livesFile(w, 'world.json'))?.agent ?? 'no agent'
  const lives: Card[] = listWorlds().flatMap(w => { const agent = agentOf(w); return readIndex(w).filter(l => l.status === 'done').map(l => ({ ...l, agent })) })
  if (!lives.length) return <main style={{ display: 'grid', placeItems: 'center', height: '100%', opacity: 0.7 }}>no life has been lived yet</main>
  const by = new Map<Continent, Card[]>(CONTINENTS.map(c => [c, []]))
  for (const l of lives) { const c = continentOf(l.birthplace.countryId); if (c) by.get(c)!.push(l) }
  return (
    <main style={{ height: '100%', overflowY: 'auto', padding: '32px 16px 48px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <header style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 30, fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>one life</h1>
          <p style={{ margin: '6px 0 0', opacity: 0.6, fontSize: 15 }}>people born the same month on every continent, each in a different world</p>
        </header>
        {CONTINENTS.map(c => <ContinentRow key={c} name={CONTINENT_NAME[c]} lives={by.get(c)!} />)}
      </div>
    </main>
  )
}

function ContinentRow({ name, lives }: { name: string; lives: Card[] }) {
  // compare: the two most recent lives in different worlds (the same continent under two agents)
  const sorted = [...lives].sort((a, b) => (a.worldId === b.worldId ? b.lifeNo - a.lifeNo : a.worldId.localeCompare(b.worldId)))
  const a = sorted[0], b = sorted.find(l => a && l.worldId !== a.worldId)
  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{name} {lives.length > 0 && <span className="mono" style={{ fontWeight: 400, fontSize: 14, opacity: 0.6 }}>{lives.length}</span>}</h2>
        {a && b && <Link href={`/compare?a=${a.lifeId}&b=${b.lifeId}`} style={{ fontSize: 14, color: 'inherit' }}>compare {a.agent} and {b.agent} →</Link>}
      </div>
      {lives.length
        ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>{sorted.map(l => <LifeCard key={l.lifeId} l={l} />)}</div>
        : <p style={{ margin: 0, fontSize: 14, opacity: 0.5 }}>no life here yet</p>}
    </section>
  )
}

function LifeCard({ l }: { l: Card }) {
  const v = cardView(l)
  const dead = v.deathAge !== null
  return (
    <Link href={`/live?life=${l.lifeId}`} className="chip" style={{ borderRadius: 20, padding: 16, color: 'inherit', textDecoration: 'none', display: 'grid', gap: 10, justifyItems: 'start' }}>
      <Portrait look={l.look} age={l.deathAge ?? 30} dead={dead} size={88} title={`${v.name}, ${v.status}`} />
      <div style={{ minWidth: 0, width: '100%' }}>
        <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>{l.birthplace.city.toLowerCase()} · {l.agent}</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}><span className="mono">{v.years}</span> · {v.status}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        {l.score !== null && <span className="mono" style={{ fontSize: 24, lineHeight: 1 }}>{l.score.toFixed(2)}</span>}
        <span style={{ fontSize: 12, opacity: 0.55 }}>life <span className="mono">#{l.lifeNo}</span></span>
      </div>
    </Link>
  )
}
