'use client'
// the three panels of the life view: journal, family, health. one open at a time, esc closes it.
// numbers are in mono and always come with words.
import type { LifeRecord } from '@/lib/life/types'
import { DAYS_PER_TICK, snapAt } from './day'
import { yearOf } from '@/lib/life/facts'
import { familyView, healthView, journalView } from '@/lib/life/views'

export type PanelKind = 'journal' | 'family' | 'health'

export default function Panel({ kind, record, tick, onSeek, onClose, onFocusKin }: { kind: PanelKind; record: LifeRecord; tick: number; onSeek: (days: number) => void; onClose: () => void; onFocusKin: (id: string) => void }) {
  return (
    <aside className="chip panel-in" role="dialog" aria-label={kind} style={{ position: 'absolute', top: 16, right: 16, bottom: 96, width: 'min(360px, calc(100% - 32px))', borderRadius: 20, padding: '18px 18px 14px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{kind === 'journal' ? 'journal' : kind === 'family' ? 'family' : 'health'}</h2>
        <button aria-label="close" onClick={onClose} style={{ fontSize: 13, opacity: 0.55 }}>close</button>
      </div>
      <div className="scroll-thin" style={{ overflowY: 'auto', flex: 1, paddingRight: 4 }}>
        {kind === 'journal' && <Journal record={record} tick={tick} onSeek={onSeek} />}
        {kind === 'family' && <Family record={record} tick={tick} onFocus={onFocusKin} />}
        {kind === 'health' && <Health record={record} tick={tick} />}
      </div>
    </aside>
  )
}

// ---------- journal: one line a year, identical years merged into one ----------
function Journal({ record, tick, onSeek }: { record: LifeRecord; tick: number; onSeek: (days: number) => void }) {
  const nowYear = yearOf(tick)
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
      {journalView(record, tick).map(r => {
        const current = nowYear >= r.from && nowYear <= r.to
        return (
          <li key={r.from}>
            <button onClick={() => onSeek((r.seekTick + 0.5) * DAYS_PER_TICK)} style={{ display: 'grid', gridTemplateColumns: '78px 1fr', gap: 10, textAlign: 'left', width: '100%', padding: '6px 6px', borderRadius: 10, background: current ? 'color-mix(in srgb, var(--ink) 7%, transparent)' : 'none' }}>
              <span className="mono" style={{ fontSize: 12, opacity: 0.55, paddingTop: 2 }}>{r.span}</span>
              <span style={{ fontSize: 14, lineHeight: 1.35, fontStyle: r.quiet ? 'italic' : 'normal', opacity: r.quiet ? 0.55 : 1 }}>{r.text}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

// ---------- family: parents, siblings and partner, children, grandchildren, as of now (src/lib/life/views) ----------
// a living person: click swings the camera to where they are right now. someone who died: when, and at what age
function Family({ record, tick, onFocus }: { record: LifeRecord; tick: number; onFocus: (id: string) => void }) {
  const v = familyView(record, tick)
  return (
    <div>
      {v.sections.map(sec => (
        <section key={sec.title} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 6 }}>{sec.title}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
            {sec.items.map(i => (
              <button key={i.id} disabled={!i.alive} onClick={() => onFocus(i.id)} title={i.alive ? `show where ${i.name} is right now` : undefined} style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 12, border: '1px solid var(--line)', opacity: i.alive ? 1 : 0.5, minWidth: 0, cursor: i.alive ? 'pointer' : 'default' }}>
                <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.name}</div>
                <div style={{ fontSize: 12, opacity: 0.6 }}><Nums text={i.text} /></div>
              </button>
            ))}
          </div>
        </section>
      ))}
      {v.note && <p style={{ fontSize: 13, opacity: 0.6 }}>{v.note}</p>}
    </div>
  )
}
// numbers in mono
const Nums = ({ text }: { text: string }) => <>{text.split(/(\d+)/).map((p, i) => (i % 2 ? <span key={i} className="mono">{p}</span> : p))}</>

// ---------- health: the line of their health across life, conditions, habits ----------
function Health({ record, tick }: { record: LifeRecord; tick: number }) {
  const v = healthView(record, tick)
  const s = snapAt(record, tick)
  const pts = record.snaps.filter((_, i) => i % 6 === 0)
  const W = 300, H = 80
  const last = record.snaps[record.snaps.length - 1].tick || 1
  const x = (t: number) => (t / last) * (W - 4) + 2
  const y = (h: number) => H - 4 - h * (H - 8)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.tick).toFixed(1)} ${y(p.health).toFixed(1)}`).join(' ')
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <div style={{ fontSize: 15 }}>health now: <b>{v.now}</b> <span className="mono" style={{ opacity: 0.6, fontSize: 13 }}>({v.score} of 100)</span></div>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="health across their life, 100 at the top" style={{ marginTop: 8 }}>
          <path d={d} stroke="var(--ink)" strokeOpacity="0.25" strokeWidth="1.5" fill="none" />
          <path d={pts.filter(p => p.tick <= tick).map((p, i) => `${i ? 'L' : 'M'}${x(p.tick).toFixed(1)} ${y(p.health).toFixed(1)}`).join(' ')} stroke="var(--ink)" strokeWidth="2" fill="none" />
          <circle cx={x(tick)} cy={y(s.health)} r="3.5" fill="var(--ink)" />
        </svg>
      </div>
      {v.conditions.length > 0 && (
        <div>
          <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 4 }}>conditions</div>
          {v.conditions.map(c => <div key={c.what} style={{ fontSize: 14 }}>{c.what}, since age <span className="mono">{c.since}</span></div>)}
        </div>
      )}
      {v.habits.length > 0 && (
        <div>
          <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 4 }}>habits</div>
          <div style={{ fontSize: 14 }}>{v.habits.join(', ')}</div>
        </div>
      )}
      {v.hungry && <div style={{ fontSize: 14, color: 'var(--ember)' }}>hungry this month</div>}
    </div>
  )
}
