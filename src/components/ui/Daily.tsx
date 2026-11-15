'use client'
import { useEffect, useMemo, useRef } from 'react'
import { useCurrentFrame, useStore } from '../state/store'
import { ensureWindow } from '../state/frames'
import { Num } from './bits'
import { buildIssue, fmtPeople, yearsOf, type Issue, type Story } from './dailyIssue'

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const longDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`

// jump the scrubber and the camera to what a story is about
function go(s: Story, close: () => void) {
  if (!s.ref) return
  const st = useStore.getState()
  st.setPlayhead(s.ref.tick)
  st.requestShot(s.ref.regionId ? { target: 'region', regionId: s.ref.regionId, force: true } : { target: 'core', force: true })
  if (s.ref.index !== undefined) st.select({ kind: 'event', tick: s.ref.tick, index: s.ref.index })
  close()
}

function StoryBlock({ s, size, onGo }: { s: Story; size: 'lead' | 'small'; onGo: (s: Story) => void }) {
  return (
    <article className={size === 'lead' ? '' : 'border-t border-ink/25 pt-2'}>
      <button onClick={() => onGo(s)} className="text-left hover:underline hover:decoration-ink/30 hover:underline-offset-4">
        <h3 className={size === 'lead' ? 'font-display text-[30px] font-semibold leading-[1.05] tracking-tight' : 'font-display text-[16px] font-semibold leading-snug'}>{s.headline}</h3>
      </button>
      <p className={size === 'lead' ? 'mt-2.5 columns-2 gap-5 text-justify text-[13px] leading-[1.45] [hyphens:auto]' : 'mt-1 text-[12px] leading-[1.4] text-ink/85'}>{s.body}</p>
    </article>
  )
}

function FrontPage({ issue, onGo }: { issue: Issue; onGo: (s: Story) => void }) {
  return (
    <div className="font-display text-ink">
      {/* masthead */}
      <div className="border-b-[3px] border-double border-ink pb-2 text-center">
        <div className="flex items-end justify-between text-[10.5px] uppercase tracking-[0.2em] text-ink/60">
          <span>vol. 1 · no. <Num>{issue.number}</Num></span>
          <span>price: one floor wage</span>
        </div>
        <h1 className="mt-1 text-[56px] font-semibold leading-none tracking-tight [font-variant:small-caps]">the daily</h1>
        <div className="mt-1.5 flex items-center justify-between border-t border-ink/40 pt-1 text-[11px] italic text-ink/70">
          <span>all the news the core will allow</span>
          <Num className="not-italic">{longDate(issue.date)}</Num>
          <span>printed on recycled bulletins</span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-[1fr_15rem] gap-6">
        <div className="min-w-0">
          <StoryBlock s={issue.lead} size="lead" onGo={onGo} />
          {issue.stories.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
              {issue.stories.map((s, i) => <StoryBlock key={i} s={s} size="small" onGo={onGo} />)}
            </div>
          )}
        </div>
        <aside className="flex flex-col gap-4">
          <div className="border-2 border-ink p-3">
            <div className="text-center text-[11px] uppercase tracking-[0.22em]">public mood</div>
            <p className="mt-1.5 text-center text-[14px] italic leading-snug">{issue.mood.line}</p>
            <ul className="mt-2 space-y-1">
              {issue.mood.top.map((m) => (
                <li key={m.emotion} className="flex items-center gap-2 text-[11px]">
                  <span className="w-14">{m.emotion}</span>
                  <span className="h-1.5 flex-1 bg-ink/10"><span className="block h-full bg-ink" style={{ width: `${m.value * 100}%` }} /></span>
                </li>
              ))}
            </ul>
            {issue.mood.approval > 0 && <div className="mt-2 text-center text-[11px] text-ink/70">approval of the core: <Num>{Math.round(issue.mood.approval * 100)}%</Num></div>}
          </div>
          {issue.coreSays && (
            <div className="border-y-2 border-ink py-3 text-center">
              <div className="text-[11px] uppercase tracking-[0.22em]">the core says</div>
              <blockquote className="mt-1.5 text-[17px] italic leading-snug">&ldquo;{issue.coreSays.quote}&rdquo;</blockquote>
              <div className="mt-1 text-[10px] text-ink/55">statement of <Num>{longDate(issue.coreSays.date)}</Num></div>
            </div>
          )}
          {issue.cost && (
            <div className="border border-ink/40 p-2.5 text-center">
              <div className="text-[11px] uppercase tracking-[0.22em]">this year&apos;s toll</div>
              {issue.cost.deaths > 0 && <div className="mt-1 text-[13px]"><Num className="text-ember">{fmtPeople(issue.cost.deaths)}</Num> dead</div>}
              {issue.cost.displaced > 0 && <div className="text-[12px] text-ink/75"><Num>{fmtPeople(issue.cost.displaced)}</Num> displaced</div>}
              <div className="mt-1 text-[10px] italic text-ink/55">no jokes in this box</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

// full broadsheet with back issues
export function DailyPaper() {
  const daily = useStore((s) => s.daily)
  const setDaily = useStore((s) => s.setDaily)
  const { record, frame } = useCurrentFrame()
  const meta = useStore((s) => s.slim[record.runId])
  const years = useMemo(() => yearsOf(record, meta?.lazy ? meta.lastTick : undefined), [record, meta])
  const current = Math.floor(frame.tick / 12)
  const year = daily.year ?? current
  // lazy runs: make sure that year's frames are loaded
  useEffect(() => { if (daily.open) ensureWindow(record.runId, year * 12 + 6) }, [daily.open, year, record.runId])
  const issue = useMemo(() => (daily.open ? buildIssue(record, year) : null), [daily.open, record, year])
  if (!daily.open) return null
  const close = () => setDaily({ open: false, year: null })
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink/35 p-4 backdrop-blur-[1px]" onClick={close}>
      <div className="dossier-in flex max-h-full w-full max-w-4xl flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-3 text-bone">
          <div className="flex items-center gap-1.5">
            <button disabled={year <= 0} onClick={() => setDaily({ year: year - 1 })} className="rounded-full bg-bone/90 px-3 py-1 text-[12px] text-ink disabled:opacity-40">← older</button>
            <button disabled={year >= years.length - 1} onClick={() => setDaily({ year: year + 1 })} className="rounded-full bg-bone/90 px-3 py-1 text-[12px] text-ink disabled:opacity-40">newer →</button>
          </div>
          <div className="scroll-thin flex max-w-[60%] gap-1 overflow-x-auto">
            {years.map((y) => (
              <button key={y} onClick={() => setDaily({ year: y })} className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10.5px] ${y === year ? 'bg-bone text-ink' : 'bg-bone/25 text-bone hover:bg-bone/50'}`}>{2026 + y}</button>
            ))}
          </div>
          <button onClick={close} className="rounded-full bg-bone/90 px-3 py-1 text-[12px] text-ink">close</button>
        </div>
        <div className="scroll-thin overflow-y-auto rounded-sm bg-[#F3EDE0] p-7 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] [background-image:radial-gradient(rgba(29,27,25,0.035)_1px,transparent_1px)] [background-size:3px_3px]">
          {issue ? <FrontPage issue={issue} onGo={(s) => go(s, close)} /> : <div className="space-y-3 py-10"><div className="skel mx-auto h-12 w-64 rounded" /><div className="skel h-6 w-3/4 rounded" /><div className="skel h-24 w-full rounded" /></div>}
        </div>
      </div>
    </div>
  )
}

// director mode: each new year, a folded front page slides in for a few seconds
export function DailyPeek() {
  const daily = useStore((s) => s.daily)
  const setDaily = useStore((s) => s.setDaily)
  const director = useStore((s) => s.director)
  const playing = useStore((s) => s.playing)
  const { record, frame, mode } = useCurrentFrame()
  const year = Math.floor(frame.tick / 12)
  const lastYear = useRef(year)
  useEffect(() => {
    if (year === lastYear.current) return
    lastYear.current = year
    // the paper reports on the year that just ended
    if (director && playing && mode === 'ai' && !daily.open && year > 0) setDaily({ peek: year - 1 })
  }, [year, director, playing, mode, daily.open, setDaily])
  useEffect(() => {
    if (daily.peek === null) return
    const t = setTimeout(() => setDaily({ peek: null }), 8000)
    return () => clearTimeout(t)
  }, [daily.peek, setDaily])
  const issue = useMemo(() => (daily.peek !== null ? buildIssue(record, daily.peek) : null), [daily.peek, record])
  if (!issue || daily.open) return null
  return (
    <div className="dossier-in pointer-events-auto w-[22rem] rotate-[-1.2deg] rounded-sm bg-[#F3EDE0] p-4 font-display text-ink shadow-[0_18px_40px_-14px_rgba(0,0,0,0.55)]">
      <div className="flex items-end justify-between border-b-2 border-double border-ink pb-1">
        <span className="text-[24px] font-semibold leading-none [font-variant:small-caps]">the daily</span>
        <Num className="text-[10px] text-ink/60">{longDate(issue.date)}</Num>
      </div>
      <h3 className="mt-2 text-[17px] font-semibold leading-snug">{issue.lead.headline}</h3>
      <p className="mt-1 line-clamp-3 text-[11.5px] leading-snug text-ink/80">{issue.lead.body}</p>
      {issue.stories[0] && <p className="mt-1.5 border-t border-ink/20 pt-1.5 text-[12px] font-semibold leading-snug">{issue.stories[0].headline}</p>}
      <div className="mt-2 flex justify-between">
        <button onClick={() => setDaily({ open: true, year: issue.yearIndex, peek: null })} className="text-[11.5px] underline decoration-ink/30 underline-offset-2">read the full issue</button>
        <button onClick={() => setDaily({ peek: null })} className="text-[11px] text-ink/50">dismiss</button>
      </div>
    </div>
  )
}
