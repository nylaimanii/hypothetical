import type { Metadata } from 'next'
import Link from 'next/link'
import { findLife, listWorlds, readIndex } from '@/lib/life/store'
import { lifeStory, scoreWords } from '@/lib/life/story'
import type { LifeRecord, ScoreParts } from '@/lib/life/types'
import { compareView } from '@/lib/life/views'
import Portrait from '../../components/Portrait'

export const metadata: Metadata = { title: 'one life · compare' }
export const dynamic = 'force-dynamic'

const PARTS: [keyof ScoreParts, string][] = [['healthyYears', 'healthy years'], ['relationships', 'people close to them'], ['contribution', 'help given to others'], ['meaning', 'sense of purpose'], ['wellbeing', 'how good the days felt']]
const first = (r: LifeRecord) => r.name.split(' ')[0]

// /compare?a=<lifeId>&b=<lifeId>: two lives in the same world. what did one do differently from the other?
export default async function Compare({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams
  const all = listWorlds().flatMap(w => readIndex(w)).filter(l => l.status === 'done')
  const a = typeof q.a === 'string' ? findLife(q.a) : null
  const b = typeof q.b === 'string' ? findLife(q.b) : null
  if (!a || !b) return <main style={{ padding: '28px 16px', maxWidth: 1040, margin: '0 auto' }}><h1 style={{ fontSize: 26, fontWeight: 600 }}>compare two lives</h1><Picker all={all} /></main>
  const sameWorld = all.filter(l => l.worldId === a.worldId)

  // decisions lined up by the kind of decision, in the order they came in life
  const cv = compareView(a, b)
  const rows = cv.rows
  const lessonsB = b.milestones.filter(m => m.lessonApplied).length

  return (
    <main style={{ height: '100%', overflowY: 'auto', padding: '28px 16px 48px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <Link href="/" style={{ fontSize: 13, color: 'inherit', opacity: 0.6 }}>← one life</Link>
        <h1 style={{ fontSize: 26, fontWeight: 600, margin: '10px 0 4px' }}>{first(a)} and {first(b)}</h1>
        <p style={{ margin: 0, fontSize: 15, opacity: 0.75, maxWidth: 720 }}>{takeaway(a, b, cv.differ, cv.both, lessonsB)}</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginTop: 22 }}>
          {[a, b].map(r => (
            <article key={r.lifeId} className="chip" style={{ borderRadius: 20, padding: 18, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Portrait look={r.look} age={r.deathAge ?? 30} dead={r.deathAge !== null} size={64} title={r.name} />
                <div>
                  <div style={{ fontSize: 17, fontWeight: 600 }}>{r.name} <span style={{ fontSize: 12, opacity: 0.55, fontWeight: 400 }}>life <span className="mono">#{r.lifeNo}</span></span></div>
                  <div style={{ fontSize: 13, opacity: 0.6 }}>born in {r.birthplace.city.toLowerCase()}, {r.family.story.split(',')[0].replace(` in ${r.birthplace.city}`, '')}</div>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>{lifeStory(r).join(' ')}</p>
              <div style={{ fontSize: 13 }}><span className="mono" style={{ fontSize: 20 }}>{r.score?.total.toFixed(2)}</span> <span style={{ opacity: 0.65 }}>{scoreWords(r)?.replace(/^[\d.]+ out of 1, /, '')}</span></div>
              <Bars r={r} />
              <Link href={`/live?life=${r.lifeId}`} style={{ fontSize: 13, color: 'inherit' }}>watch {first(r)}&apos;s life →</Link>
            </article>
          ))}
        </div>

        <h2 style={{ fontSize: 17, fontWeight: 600, margin: '28px 0 8px' }}>the decisions, side by side</h2>
        <p style={{ margin: '0 0 10px', fontSize: 13, opacity: 0.6 }}>marked rows are where they chose differently. &ldquo;lesson&rdquo; means an earlier life&apos;s advice shaped the choice.</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 560 }}>
            <thead><tr style={{ textAlign: 'left', fontSize: 12, opacity: 0.6 }}><th style={{ padding: '6px 8px', fontWeight: 400 }}>decision</th><th style={{ padding: '6px 8px', fontWeight: 400 }}>{first(a)}</th><th style={{ padding: '6px 8px', fontWeight: 400 }}>{first(b)}</th></tr></thead>
            <tbody>
              {rows.map(r => {
                const diff = r.differ
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--line)', background: diff ? 'color-mix(in srgb, var(--ink) 5%, transparent)' : 'none' }}>
                    <td style={{ padding: '7px 8px', opacity: 0.75 }}>{diff ? '● ' : ''}{r.what}</td>
                    {[r.a, r.b].map((m, i) => (
                      <td key={i} style={{ padding: '7px 8px' }}>
                        {m ? <>{m.label} <span className="mono" style={{ fontSize: 11, opacity: 0.5 }}>at {m.age}</span>{m.lesson && <span style={{ fontSize: 11, opacity: 0.6 }}> · lesson</span>}</> : <span style={{ opacity: 0.4 }}>didn&apos;t come up</span>}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {sameWorld.length > 2 && <Picker all={sameWorld} a={a.lifeId} b={b.lifeId} />}
      </div>
    </main>
  )
}

// the one thing to take away: who did better than their own usual-choices self, and whether lessons or luck explain it
function takeaway(a: LifeRecord, b: LifeRecord, differ: number, total: number, lessonsB: number): string {
  const ga = (a.score?.total ?? 0) - (a.twin?.score.total ?? 0), gb = (b.score?.total ?? 0) - (b.twin?.score.total ?? 0)
  const parts = PARTS.map(([k, w]) => ({ w, d: (b.score?.[k] ?? 0) - (a.score?.[k] ?? 0) })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
  const raw = (b.score?.total ?? 0) - (a.score?.total ?? 0)
  const s1 = `${first(b)} scored ${Math.abs(raw) < 0.01 ? 'the same as' : raw > 0 ? `${raw.toFixed(2)} more than` : `${(-raw).toFixed(2)} less than`} ${first(a)}${Math.abs(parts[0].d) > 0.03 ? `, mostly in ${parts[0].w}` : ''}.`
  const s2 = `they chose differently at ${differ} of the ${total} decisions both of them faced, and ${lessonsB} of ${first(b)}'s choices leaned on an earlier life's advice.`
  const s3 = Math.abs(gb - ga) < 0.03
    ? `against their own usual-choices selves they did about equally well (${ga >= 0 ? '+' : ''}${ga.toFixed(2)} and ${gb >= 0 ? '+' : ''}${gb.toFixed(2)}), so the difference is mostly where and to whom they were born.`
    : `against their own usual-choices selves, ${gb > ga ? first(b) : first(a)} gained more (${ga >= 0 ? '+' : ''}${ga.toFixed(2)} vs ${gb >= 0 ? '+' : ''}${gb.toFixed(2)}).`
  return `${s1} ${s2} ${s3}`
}

function Bars({ r }: { r: LifeRecord }) {
  if (!r.score) return null
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      {PARTS.map(([k, w]) => (
        <div key={k} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 40px', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ opacity: 0.65 }}>{w}</span>
          <span style={{ height: 6, borderRadius: 3, background: 'var(--line)', position: 'relative' }}><span style={{ position: 'absolute', inset: 0, width: `${r.score![k] * 100}%`, borderRadius: 3, background: 'var(--ink)' }} /></span>
          <span className="mono" style={{ textAlign: 'right' }}>{r.score![k].toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}

function Picker({ all, a, b }: { all: { lifeId: string; name: string; lifeNo: number; worldId: string }[]; a?: string; b?: string }) {
  return (
    <form action="/compare" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 26, fontSize: 14 }}>
      <span style={{ opacity: 0.6 }}>compare</span>
      <select name="a" defaultValue={a} aria-label="first life" style={{ font: 'inherit', padding: '4px 8px', borderRadius: 8 }}>{all.map(l => <option key={l.lifeId} value={l.lifeId}>{l.name} · life #{l.lifeNo}</option>)}</select>
      <span style={{ opacity: 0.6 }}>with</span>
      <select name="b" defaultValue={b ?? all[all.length - 1]?.lifeId} aria-label="second life" style={{ font: 'inherit', padding: '4px 8px', borderRadius: 8 }}>{all.map(l => <option key={l.lifeId} value={l.lifeId}>{l.name} · life #{l.lifeNo}</option>)}</select>
      <button className="chip" style={{ padding: '6px 14px' }}>compare</button>
    </form>
  )
}
