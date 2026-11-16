'use client'
// the three panels of the life view: journal, family, health. one open at a time, esc closes it.
// numbers are in mono and always come with words.
import type { JournalLine, Kin, LifeRecord } from '@/lib/life/types'
import { DAYS_PER_TICK, snapAt, yearOf } from './day'

export type PanelKind = 'journal' | 'family' | 'health'

export default function Panel({ kind, record, tick, onSeek, onClose }: { kind: PanelKind; record: LifeRecord; tick: number; onSeek: (days: number) => void; onClose: () => void }) {
  return (
    <aside className="chip panel-in" role="dialog" aria-label={kind} style={{ position: 'absolute', top: 16, right: 16, bottom: 96, width: 'min(360px, calc(100% - 32px))', borderRadius: 20, padding: '18px 18px 14px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{kind === 'journal' ? 'journal' : kind === 'family' ? 'family' : 'health'}</h2>
        <button aria-label="close" onClick={onClose} style={{ fontSize: 13, opacity: 0.55 }}>close</button>
      </div>
      <div className="scroll-thin" style={{ overflowY: 'auto', flex: 1, paddingRight: 4 }}>
        {kind === 'journal' && <Journal record={record} tick={tick} onSeek={onSeek} />}
        {kind === 'family' && <Family record={record} tick={tick} />}
        {kind === 'health' && <Health record={record} tick={tick} />}
      </div>
    </aside>
  )
}

// ---------- journal: one line a year, identical years merged into one ----------
function Journal({ record, tick, onSeek }: { record: LifeRecord; tick: number; onSeek: (days: number) => void }) {
  const rows: { from: JournalLine; to: JournalLine }[] = []
  for (const j of record.journal) {
    const last = rows[rows.length - 1]
    if (last && last.to.text === j.text) last.to = j
    else rows.push({ from: j, to: j })
  }
  const nowYear = yearOf(tick)
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
      {rows.filter(r => r.from.year <= nowYear).map(r => {
        const span = r.from.year === r.to.year ? `${r.from.year}` : `${r.from.year}–${r.to.year}`
        const current = nowYear >= r.from.year && nowYear <= r.to.year
        return (
          <li key={r.from.year}>
            <button onClick={() => onSeek((r.from.age * 12 + 0.5) * DAYS_PER_TICK)} style={{ display: 'grid', gridTemplateColumns: '78px 1fr', gap: 10, textAlign: 'left', width: '100%', padding: '6px 6px', borderRadius: 10, background: current ? 'color-mix(in srgb, var(--ink) 7%, transparent)' : 'none' }}>
              <span className="mono" style={{ fontSize: 12, opacity: 0.55, paddingTop: 2 }}>{span}</span>
              <span style={{ fontSize: 14, lineHeight: 1.35, fontStyle: r.from.text.startsWith('(') ? 'italic' : 'normal', opacity: r.from.text.startsWith('(') ? 0.55 : 1 }}>{r.from.text}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

// ---------- family: parents, siblings and partner, children, grandchildren, as of now ----------
type Item = { k: Kin; label: string }
const isGone = (k: Kin, tick: number) => k.diedTick !== undefined && k.diedTick <= tick
const ageOf = (k: Kin, tick: number) => Math.floor(((isGone(k, tick) ? k.diedTick! : tick) - k.bornTick) / 12)
function FamilyPerson({ k, label, tick }: Item & { tick: number }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 12, border: '1px solid var(--line)', opacity: isGone(k, tick) ? 0.5 : 1, minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.name}</div>
      <div style={{ fontSize: 12, opacity: 0.6 }}>{label}, {isGone(k, tick) ? <>died at <span className="mono">{ageOf(k, tick)}</span></> : <span className="mono">{ageOf(k, tick)}</span>}</div>
    </div>
  )
}
function Row({ title, items, tick }: { title: string; items: Item[]; tick: number }) {
  if (!items.length) return null
  return (
    <section style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>{items.map(i => <FamilyPerson key={i.k.id} {...i} tick={tick} />)}</div>
    </section>
  )
}

function Family({ record, tick }: { record: LifeRecord; tick: number }) {
  const born = (k: Kin) => k.bornTick <= tick
  const by = (rel: Kin['relation']) => record.kin.filter(k => k.relation === rel && born(k))
  const kids = by('child')
  const partners = by('partner').filter(k => (k.sinceTick ?? 0) <= tick)
  return (
    <div>
      <Row tick={tick} title="parents" items={[...by('mother').map(k => ({ k, label: 'mother' })), ...by('father').map(k => ({ k, label: 'father' }))]} />
      <Row tick={tick} title="siblings" items={by('sibling').map(k => ({ k, label: k.sex === 'female' ? 'sister' : 'brother' }))} />
      <Row tick={tick} title="partner" items={partners.map(k => ({ k, label: k.untilTick !== undefined && k.untilTick <= tick ? 'separated' : 'partner' }))} />
      <Row tick={tick} title="children" items={kids.map(k => ({ k, label: k.sex === 'female' ? 'daughter' : 'son' }))} />
      <Row tick={tick} title="grandchildren" items={by('grandchild').map(k => ({ k, label: `${record.kin.find(c => c.id === k.parentId)?.name ?? 'a child'}'s` }))} />
      {!partners.length && !kids.length && tick / 12 > 30 && <p style={{ fontSize: 13, opacity: 0.6 }}>no partner or children so far.</p>}
    </div>
  )
}

// ---------- health: the line of their health across life, conditions, habits ----------
function Health({ record, tick }: { record: LifeRecord; tick: number }) {
  const s = snapAt(record, tick)
  const pts = record.snaps.filter((_, i) => i % 6 === 0)
  const W = 300, H = 80
  const last = record.snaps[record.snaps.length - 1].tick || 1
  const x = (t: number) => (t / last) * (W - 4) + 2
  const y = (h: number) => H - 4 - h * (H - 8)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.tick).toFixed(1)} ${y(p.health).toFixed(1)}`).join(' ')
  const conditions = record.events.filter(e => e.tick <= tick && /^diagnosed with/.test(e.text)).map(e => ({ what: e.text.replace('diagnosed with ', ''), year: yearOf(e.tick), age: Math.floor(e.tick / 12) }))
  const words = (h: number) => (h > 0.85 ? 'strong' : h > 0.7 ? 'good' : h > 0.5 ? 'worn down' : h > 0.3 ? 'poor' : 'very frail')
  const HABIT: Record<string, string> = { smokes: 'smokes', drinks_heavily: 'drinks heavily', exercises: 'exercises', volunteers: 'volunteers', saves: 'saves money', prays: 'prays', mentors: 'mentors', remits: 'sends money home', caregiver: 'cares for family', checkups: 'gets checkups', community: 'in a community group' }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <div style={{ fontSize: 15 }}>health now: <b>{words(s.health)}</b> <span className="mono" style={{ opacity: 0.6, fontSize: 13 }}>({Math.round(s.health * 100)} of 100)</span></div>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="health across their life, 100 at the top" style={{ marginTop: 8 }}>
          <path d={d} stroke="var(--ink)" strokeOpacity="0.25" strokeWidth="1.5" fill="none" />
          <path d={pts.filter(p => p.tick <= tick).map((p, i) => `${i ? 'L' : 'M'}${x(p.tick).toFixed(1)} ${y(p.health).toFixed(1)}`).join(' ')} stroke="var(--ink)" strokeWidth="2" fill="none" />
          <circle cx={x(tick)} cy={y(s.health)} r="3.5" fill="var(--ink)" />
        </svg>
      </div>
      {conditions.length > 0 && (
        <div>
          <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 4 }}>conditions</div>
          {conditions.map(c => <div key={c.what} style={{ fontSize: 14 }}>{c.what}, since age <span className="mono">{c.age}</span></div>)}
        </div>
      )}
      {s.behavior.length > 0 && (
        <div>
          <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 4 }}>habits</div>
          <div style={{ fontSize: 14 }}>{s.behavior.map(b => HABIT[b] ?? b.replace(/_/g, ' ')).join(', ')}</div>
        </div>
      )}
      {s.hunger && <div style={{ fontSize: 14, color: 'var(--ember)' }}>hungry this month</div>}
    </div>
  )
}
