'use client'
// minimal shell: the globe gets the screen. default chrome is the world name + date, the tabs strip,
// one stats line and the timeline. one panel at a time, esc closes it, depth lives in "full report".
import { useEffect, useMemo, useState } from 'react'
import { populationOf, recorded } from './truth'
import Link from 'next/link'
import type { Frame, Region, WorldEvent } from '@/lib/types'
import { useCurrentFrame, useStore, type Overlay, type View } from '../state/store'
import { Num, fmt } from './bits'
import { formatDay, formatHour, formatTime, localHour, utcHourOf, worldDate } from '../world/time'
import { legendFor } from '../world/modes'
import { frontierLabel, Leaderboard, RulesDrawer } from './Chrome'
import { replayIntro } from './Extras'
import { AgentsPanel, HallPanel } from './Agents'
import Roadmap from './Roadmap'
import Chronicle from './Chronicle'
import LivePanel from './LivePanel'
import Dossier from './Dossier'
import { EpitaphCard } from './WorldViews'
import { agentOf, prettyAgent, worldNumber } from './WorldTabs'
import { openRun, startAB } from './worlds'
import { mayPair } from './ab'
import { PlaceCard, PlaceReport, SeaCard } from './PlaceCard'
import { usePhone } from './usePhone'
import { lifeHref, lifeNear, useLives } from '../state/useLives'
import { StoryLine, useLinks } from './chains'


// ---------- top left: just text ----------
export function WorldTitle() {
  const { frame, record } = useCurrentFrame()
  const playhead = useStore((s) => s.playhead)
  const hour = useStore((s) => s.hour)
  const playing = useStore((s) => s.playing)
  const source = useStore((s) => s.source)
  const compare = useStore((s) => s.compare)
  const runs = useStore((s) => s.runs)
  const agents = useStore((s) => s.agents)
  const d = worldDate(playhead, hour, playing)
  const agent = agentOf(record, agents)
  const dot = frame.status === 'destroyed' ? 'bg-ember' : frame.status === 'goal_achieved' ? 'bg-[#C9A227]' : frame.status === 'complete' ? 'bg-ink/60' : 'bg-[#7FAE7A]'
  return (
    <div className="pointer-events-auto select-none leading-tight text-ink drop-shadow-[0_1px_0_rgba(243,237,224,0.6)]">
      <div className="flex items-center gap-2 font-display text-[15px]">
        <span className={`h-2 w-2 rounded-full ${dot}`} title={frame.status} aria-label={frame.status} />
        {compare ? <span>comparing <Num>{compare.records.length}</Num> worlds</span> : <span>{agent?.name ?? prettyAgent(record.agentId)} <span className="text-ink/55">· world #<Num>{worldNumber(record.runId, runs)}</Num></span></span>}
        {source === 'live' && !compare && <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60">live</span>}
      </div>
      <Num className="mt-0.5 block text-[12.5px] text-ink/65">{formatDay(d)} · {formatTime(d)}</Num>
      {!compare && record.branchedFrom && (
        <button onClick={() => openRun(record.branchedFrom!.runId, record.branchedFrom!.tick)} className="mt-0.5 block text-[11px] text-ink/50 underline decoration-ink/20 underline-offset-2 hover:text-ink">branched from world #<Num>{worldNumber(record.branchedFrom.runId, runs)}</Num></button>
      )}
      {!compare && mayPair(record.runId) && (
        <button onClick={() => startAB(record.runId, playhead)} className="mt-0.5 block text-[11px] text-ink/50 underline decoration-ink/20 underline-offset-2 hover:text-ink">compare with the original, side by side</button>
      )}
    </div>
  )
}

// ---------- the one menu ----------
const Burger = () => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>

export function MenuButton() {
  const menu = useStore((s) => s.menu)
  return (
    <button onClick={() => useStore.getState().setMenu(!menu)} aria-label="menu" aria-expanded={menu} className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-bone/85 text-ink shadow-sm hover:bg-bone">
      <Burger />
    </button>
  )
}

function Item({ label, hint, onClick, href, on = false }: { label: string; hint?: string; onClick?: () => void; href?: string; on?: boolean }) {
  const cls = `flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-ink/5 ${on ? 'bg-ink/5' : ''}`
  const body = <><span className="font-display">{label}</span>{hint && <span className="text-[11.5px] text-ink/45">{hint}</span>}</>
  return href ? <Link href={href} className={cls}>{body}</Link> : <button onClick={onClick} className={cls}>{body}</button>
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mt-3"><div className="px-3 pb-1 text-[10.5px] uppercase tracking-[0.16em] text-ink/40">{title}</div>{children}</div>
}

export function SideMenu({ onLive }: { onLive: () => void }) {
  const menu = useStore((s) => s.menu)
  const liveRunId = useStore((s) => s.liveRunId)
  const caps = useStore((s) => s.caps)
  const phone = usePhone()
  if (!menu) return null
  const s = useStore.getState()
  const view = (v: View) => () => s.setView(v)
  return (
    <aside className={`pointer-events-auto absolute z-40 flex flex-col bg-bone/96 px-2 shadow-2xl ${phone ? 'sheet-up inset-x-0 bottom-0 max-h-[78vh] rounded-t-3xl border-t border-ink/10 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2' : 'sheet-in bottom-0 right-0 top-0 w-72 border-l border-ink/10 py-4'}`} aria-label="menu">
      {phone && <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink/20" aria-hidden />}
      <div className="flex items-center justify-between px-3">
        <span className="font-display text-[18px]">hypothetical</span>
        <button onClick={() => s.setMenu(false)} aria-label="close menu" className="text-[18px] leading-none text-ink/50 hover:text-ink">×</button>
      </div>
      <nav className="scroll-thin mt-2 min-h-0 flex-1 overflow-y-auto">
        <Group title="all worlds">
          <Item label="worlds" hint="leaderboard, learning" onClick={() => s.setSheet('worlds')} />
          <Item label="agents" onClick={() => s.setPanel('agents')} />
          <Item label="hall of history" onClick={() => s.setPanel('hall')} />
          <Item label="the story so far" hint="every world, every lesson" href="/story" />
          <Item label="assumptions" hint="the rules, with sources" href="/assumptions" />
          <Item label="tradeoffs" hint="what each world gave up" href="/tradeoffs" />
          {caps.evolveNow && <Item label="mission control" href="/mission" />}
          {caps.playLive && <Item label={liveRunId ? 'live: on' : 'play live'} onClick={() => { s.setMenu(false); onLive() }} />}
        </Group>
        <Group title="this world">
          <Item label="the daily" onClick={view('daily')} />
          <Item label="graphs" onClick={view('graphs')} />
          <Item label="people" onClick={view('people')} />
          <Item label="the steps" onClick={view('steps')} />
          <Item label="chronicle" hint="every event" onClick={() => s.setSheet('chronicle')} />
          <Item label="off-world" onClick={() => s.setPanel('offworld')} />
          <Item label="200 years" onClick={() => s.setPanel('longevity')} />
          <Item label="map layers" hint="emotion, energy…" onClick={() => s.setSheet('layers')} />
        </Group>
        <Group title="help">
          <Item label="rules" onClick={() => s.setDrawer(true)} />
          <Item label="settings" hint="sound, quality, director" onClick={() => s.setAdvanced(true)} />
          <Item label="shortcuts" hint="?" onClick={() => s.setShortcuts(true)} />
        </Group>
      </nav>
    </aside>
  )
}

// ---------- bottom: one thin stats line, one quiet event line ----------
export function StatsLine() {
  const { frame, mode } = useCurrentFrame()
  const cost = frame.humanCost
  const parts: React.ReactNode[] = []
  if (populationOf(frame) > 0) parts.push(<span key="p"><Num>{fmt.people(populationOf(frame))}</Num> people</span>)
  if (frame.globalPeriodLifeExpectancy > 0) parts.push(<span key="l">life <Num>{frame.globalPeriodLifeExpectancy.toFixed(1)}</Num>y</span>)
  parts.push(<span key="f">{frontierLabel(frame.frontier)}</span>)
  if (cost.approval > 0) parts.push(<span key="a">approval <Num>{fmt.pct(cost.approval)}</Num></span>)
  if (mode === 'ai' && cost.deaths > 0) parts.push(<span key="d" className="text-ember"><Num>{fmt.people(cost.deaths)}</Num> dead</span>)
  return (
    <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-2 rounded-full bg-bone/75 px-3 py-0.5 text-[10.5px] text-ink/75 sm:flex-nowrap sm:whitespace-nowrap sm:text-[11.5px]">
      {parts.map((p, i) => <span key={i} className="flex items-center gap-2">{i > 0 && <span className="text-ink/25">·</span>}{p}</span>)}
    </div>
  )
}

// the latest event that matters (significance >= 0.6), for 6 seconds. click to go there
export function EventLine() {
  const { record, frame, idx } = useCurrentFrame()
  const view = useStore((s) => s.view)
  const [ev, setEv] = useState<{ e: WorldEvent; tick: number; index: number } | null>(null)
  // only when the world moves forward: pick the most significant new event, if any matters enough
  const [seen, setSeen] = useState(idx)
  if (idx !== seen) {
    setSeen(idx)
    if (idx > seen) {
      const i = frame.newEvents.reduce((b, e, k) => ((e.significance ?? 0) >= 0.6 && (b < 0 || (e.significance ?? 0) > (frame.newEvents[b].significance ?? 0)) ? k : b), -1)
      if (i >= 0) setEv({ e: frame.newEvents[i], tick: frame.tick, index: i })
    }
  }
  useEffect(() => {
    if (!ev) return
    const t = setTimeout(() => setEv(null), 6000)
    return () => clearTimeout(t)
  }, [ev])
  // a dead world: a quiet line instead of a card over the globe
  const dead = frame.status === 'destroyed' && idx === record.frames.length - 1
  if (view !== 'globe') return null
  if (dead) {
    return (
      <button onClick={() => useStore.getState().setSheet('epitaph')} className="fade-line pointer-events-auto text-[12.5px] text-ink/70 hover:text-ink">
        this world is gone. <span className="underline decoration-ink/25 underline-offset-2">read its epitaph</span>
      </button>
    )
  }
  if (!ev) return null
  const danger = ['famine', 'war', 'pandemic', 'disaster', 'death'].includes(ev.e.kind)
  const go = () => {
    const s = useStore.getState()
    s.setPlaying(false)
    s.setPlayhead(ev.tick)
    s.requestShot(ev.e.regionId ? { target: 'region', regionId: ev.e.regionId, force: true } : { target: 'core', force: true })
  }
  return (
    <button key={`${ev.tick}-${ev.index}`} onClick={go} className="fade-line pointer-events-auto max-w-[40rem] truncate text-[12.5px] text-ink/75 hover:text-ink">
      <span className={danger ? 'text-ember' : 'text-ink/45'}>{ev.e.kind}</span> · {ev.e.text}
    </button>
  )
}

// ---------- region card: slim, right side ----------
type Stats = { happiness: number; economy: number; livability: number }
function regionStats(r: Region): Stats {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const gdpPc = r.gdpUsd / Math.max(1, r.population)
  const economy = clamp(Math.log10(Math.max(500, gdpPc)) / 5 - 0.35 - (r.visual?.damage.level ?? 0) * 0.4)
  const food = clamp((r.foodKcalPerCapita - 1700) / 1500)
  const safety = clamp(1 - r.unrest * 1.1)
  const health = recorded(r.periodLifeExpectancy) ? clamp((r.periodLifeExpectancy - 50) / 40) : 0.5 // not computed yet: neutral
  const air = clamp(1 - (r.visual?.pollution ?? 0.3))
  const happiness = clamp(r.approval * 0.6 + safety * 0.2 + food * 0.2)
  return { happiness, economy, livability: clamp((happiness + economy + safety + health + air + food) / 6) }
}

function whyLine(r: Region, trend: 'rising' | 'stable' | 'declining') {
  const drivers = r.whys.flatMap((w) => w.drivers.map((d) => ({ ...d, stat: w.stat })))
  const bad = (d: { stat: string; delta: number }) => (d.stat === 'unrest' ? d.delta > 0 : d.delta < 0)
  const pick = drivers.filter((d) => (trend === 'declining' ? bad(d) : !bad(d)) && Math.abs(d.delta) > 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0]
  return pick ? `${trend}: ${pick.label}` : trend === 'stable' ? 'steady this year' : trend
}

function Bar({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-20 text-ink/60">{label}</span>
      <span className="h-1.5 flex-1 rounded-full bg-ink/10"><span className="block h-full rounded-full bg-ink/70" style={{ width: `${Math.round(v * 100)}%` }} /></span>
      <Num className="w-8 text-right text-ink/70">{Math.round(v * 100)}</Num>
    </div>
  )
}

const Arrow = ({ t }: { t: 'rising' | 'stable' | 'declining' }) => (
  <span className={t === 'rising' ? 'text-[#5E8C4A]' : t === 'declining' ? 'text-ember' : 'text-ink/40'} aria-label={t}>{t === 'rising' ? '▲' : t === 'declining' ? '▼' : '■'}</span>
)

export function RegionCard({ r, frame, prev, links }: { r: Region; frame: Frame; prev?: Frame; links: ReturnType<typeof useLinks> }) {
  const now = useMemo(() => regionStats(r), [r])
  const before = useMemo(() => { const p = prev?.regions.find((x) => x.id === r.id); return p ? regionStats(p) : null }, [prev, r.id])
  const delta = before ? now.happiness + now.economy - before.happiness - before.economy : 0
  const trend = delta > 0.03 ? 'rising' : delta < -0.03 ? 'declining' : 'stable'
  void frame
  return (
    <div className="sheet-in panel pointer-events-auto w-[20rem] max-w-full p-4 [.phone-sheet_&]:w-full [.phone-sheet_&]:rounded-none [.phone-sheet_&]:border-0 [.phone-sheet_&]:shadow-none">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-display text-[19px] leading-tight">{r.name} <Arrow t={trend} /></div>
          <div className="mt-0.5 text-[12px] text-ink/55"><Num>{fmt.people(r.population)}</Num> people</div>
        </div>
        <button onClick={() => useStore.getState().select(null)} aria-label="close" className="text-[16px] leading-none text-ink/40 hover:text-ink">×</button>
      </div>
      <div className="mt-3 space-y-1.5">
        <Bar label="happiness" v={now.happiness} />
        <Bar label="economy" v={now.economy} />
        <Bar label="livability" v={now.livability} />
      </div>
      <div className="mt-3"><StoryLine story={r.story} links={links} frame={frame} fallback={whyLine(r, trend)} /></div>
      <button onClick={() => useStore.getState().setReport(true)} className="mt-2 text-[12px] text-ink/60 underline decoration-ink/25 underline-offset-2 hover:text-ink">full report</button>
    </div>
  )
}

// ---------- map layers: the overlay pills live here now ----------
const OVERLAYS: Overlay[] = ['real', 'happiness', 'economy', 'livability', 'trend', 'population', 'emotion', 'movement', 'energy', 'damage']
const OVERLAY_LABEL: Partial<Record<Overlay, string>> = { livability: 'great place to live' }
function LayersSheet() {
  const overlay = useStore((s) => s.overlay)
  const explain = useStore((s) => s.explain)
  const { frame } = useCurrentFrame()
  const legend = legendFor(overlay, frame)
  const s = useStore.getState()
  return (
    <div className="sheet-in panel pointer-events-auto w-[20rem] max-w-full p-4 text-[12.5px] [.phone-sheet_&]:w-full [.phone-sheet_&]:rounded-none [.phone-sheet_&]:border-0 [.phone-sheet_&]:shadow-none">
      <div className="font-display text-[17px]">map layers</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {OVERLAYS.map((o) => <button key={o} onClick={() => s.setOverlay(o)} className={`rounded-full px-2.5 py-1 ${overlay === o ? 'bg-ink text-bone' : 'border border-ink/15 text-ink/70 hover:bg-ink/5'}`}>{OVERLAY_LABEL[o] ?? o}</button>)}
      </div>
      <p className="mt-3 text-ink/75">{legend.line}</p>
      {legend.items.length > 0 && <ul className="mt-2 space-y-1">{legend.items.map((it) => <li key={it.text} className="flex items-center gap-2 text-ink/70"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: it.color }} />{it.text}</li>)}</ul>}
      <label className="mt-4 flex items-center justify-between gap-3 border-t border-ink/10 pt-3">
        <span>explain what&apos;s in view<span className="block text-[11px] text-ink/50">up to 3 notes, up close only</span></span>
        <input type="checkbox" checked={explain} onChange={(e) => s.setExplain(e.target.checked)} className="h-4 w-4 accent-[var(--ink)]" />
      </label>
    </div>
  )
}

// a one line legend when a data layer is on, so the colors are never a mystery
export function LayerHint() {
  const overlay = useStore((s) => s.overlay)
  const view = useStore((s) => s.view)
  const { frame } = useCurrentFrame()
  if (overlay === 'real' || view !== 'globe') return null
  return (
    <button onClick={() => useStore.getState().setSheet('layers')} className="pointer-events-auto max-w-[36rem] truncate rounded-full bg-bone/75 px-3 py-0.5 text-[11.5px] text-ink/70 hover:text-ink">
      <span className="text-ink/45">{OVERLAY_LABEL[overlay] ?? overlay}:</span> {legendFor(overlay, frame).line}
    </button>
  )
}

function SettingsSheet() {
  const quality = useStore((s) => s.quality)
  const showTwin = useStore((s) => s.showTwin)
  const director = useStore((s) => s.director)
  const soundOn = useStore((s) => s.soundOn)
  const volume = useStore((s) => s.volume)
  const mode = useStore((s) => s.mode)
  const s = useStore.getState()
  const row = 'mt-3 flex items-center justify-between gap-3'
  return (
    <div className="sheet-in panel pointer-events-auto w-[20rem] max-w-full p-4 text-[12.5px] [.phone-sheet_&]:w-full [.phone-sheet_&]:rounded-none [.phone-sheet_&]:border-0 [.phone-sheet_&]:shadow-none">
      <div className="font-display text-[17px]">settings</div>
      <label className={row}><span>sound</span><input type="checkbox" checked={soundOn} onChange={(e) => s.setSound(e.target.checked)} className="h-4 w-4 accent-[var(--ink)]" /></label>
      {soundOn && <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => s.setVolume(Number(e.target.value))} className="mt-2 w-full accent-[var(--ink)]" aria-label="volume" />}
      <label className={row}><span>director mode<span className="block text-[11px] text-ink/50">the camera follows what matters</span></span><input type="checkbox" checked={director} onChange={(e) => s.setDirector(e.target.checked)} className="h-4 w-4 accent-[var(--ink)]" /></label>
      <div className={row}>
        <span>render quality</span>
        <div className="flex rounded-full border border-ink/15 p-0.5 font-mono text-[10px] uppercase tracking-[0.14em]">
          {(['high', 'fast'] as const).map((q) => <button key={q} onClick={() => s.setQuality(q)} className={`rounded-full px-2.5 py-1 ${quality === q ? 'bg-ink text-bone' : 'text-ink/60'}`}>{q}</button>)}
        </div>
      </div>
      <div className="mt-4 border-t border-ink/10 pt-1 text-[11px] uppercase tracking-[0.14em] text-ink/40">advanced</div>
      <label className={row}><span>show the no-ai twin</span><input type="checkbox" checked={showTwin} onChange={(e) => s.setShowTwin(e.target.checked)} className="h-4 w-4 accent-[var(--ink)]" /></label>
      {showTwin && (
        <div className="mt-2 flex justify-end gap-1 text-[11.5px]">
          {(['ai', 'baseline'] as const).map((m) => <button key={m} onClick={() => s.setMode(m)} className={`rounded-full px-2.5 py-0.5 ${mode === m ? 'bg-ink text-bone' : 'text-ink/60'}`}>{m === 'ai' ? 'with ai' : 'without ai'}</button>)}
        </div>
      )}
      <button onClick={replayIntro} className="mt-4 text-[12px] text-ink/60 underline decoration-ink/25 underline-offset-2 hover:text-ink">replay intro</button>
    </div>
  )
}

// ---------- the one open panel ----------
export function PanelHost() {
  const selection = useStore((s) => s.selection)
  const report = useStore((s) => s.report)
  const sheet = useStore((s) => s.sheet)
  const panel = useStore((s) => s.panel)
  const drawerOpen = useStore((s) => s.drawerOpen)
  const advanced = useStore((s) => s.advancedOpen)
  const { frame, record, idx } = useCurrentFrame()
  const phone = usePhone()
  const prev = record.frames[Math.max(0, idx - 12)]
  const links = useLinks(record, idx)
  let right: React.ReactNode = null
  if (selection?.kind === 'sea') right = <SeaCard ocean={selection.ocean} chokepoint={selection.chokepoint} />
  else if (selection && (selection.kind === 'country' || selection.kind === 'admin' || selection.kind === 'city')) {
    right = report ? <PlaceReport kind={selection.kind} id={selection.id} /> : <PlaceCard kind={selection.kind} id={selection.id} />
  } else if (selection?.kind === 'region' && !report) {
    const r = frame.regions.find((x) => x.id === selection.id)
    if (r) right = <RegionCard r={r} frame={frame} prev={prev} links={links} />
  } else if (selection) right = <div className="flex min-h-0 flex-col">{report && <button onClick={() => useStore.getState().setReport(false)} className="mb-1 self-end text-[11.5px] text-ink/60 underline decoration-ink/25 underline-offset-2">back to the card</button>}<Dossier /></div>
  else if (sheet === 'layers') right = <LayersSheet />
  else if (sheet === 'worlds') right = <div className="sheet-in flex w-[22rem] flex-col gap-3"><Leaderboard /><LivePanel /></div>
  else if (sheet === 'live') right = <div className="sheet-in w-[22rem]"><LivePanel /></div>
  else if (sheet === 'chronicle') right = <div className="sheet-in flex min-h-0 w-[24rem] flex-col"><Chronicle /></div>
  else if (sheet === 'epitaph') right = <EpitaphCard />
  else if (drawerOpen) right = <RulesDrawer />
  else if (advanced) right = <SettingsSheet />
  return (
    <>
      {right && (phone
        ? <div className="phone-sheet sheet-up scroll-thin pointer-events-auto fixed inset-x-0 bottom-0 z-40 max-h-[72vh] overflow-y-auto rounded-t-3xl bg-bone shadow-2xl"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-ink/20" aria-hidden />{right}</div>
        : <div className="scroll-thin pointer-events-none absolute bottom-0 right-0 top-0 z-30 flex flex-col items-end overflow-y-auto">{right}</div>)}
      {panel && (
        <div className="pointer-events-none absolute inset-0 z-30 flex">
          {panel === 'agents' ? <AgentsPanel /> : panel === 'hall' ? <HallPanel /> : <Roadmap />}
        </div>
      )}
    </>
  )
}

// esc closes whatever is open; with nothing open it brings a view back to the globe
export function useEscape() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = useStore.getState()
      const anything = s.menu || s.sheet || s.selection || s.panel || s.drawerOpen || s.advancedOpen || s.shortcutsOpen || s.daily.open
      if (anything) s.closeAll()
      else if (s.view !== 'globe') s.setView('globe')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

// ---------- city view: the way back, the local time, and the hour ----------
const HOURS: { h: number; label: string }[] = [{ h: 3, label: 'night' }, { h: 8, label: '8am' }, { h: 12.5, label: 'noon' }, { h: 17.5, label: 'rush' }, { h: 20, label: '8pm' }]
export function CityBar() {
  const cityView = useStore((s) => s.cityView)
  const playhead = useStore((s) => s.playhead)
  const hour = useStore((s) => s.hour)
  const playing = useStore((s) => s.playing)
  const pinned = useStore((s) => s.hourPinned)
  const { frame, record } = useCurrentFrame()
  const lives = useLives(cityView ? record.runId : undefined)
  const city = frame.cities.find((c) => c.id === cityView)
  if (!city) return null
  const life = lifeNear(lives, city.lat, city.lon)
  const local = localHour(utcHourOf(worldDate(playhead, hour, playing)), city.lon)
  const country = city.countryId ? frame.countries?.find((c) => c.id === city.countryId) : undefined
  // set a local hour: convert back to utc
  const setLocal = (h: number) => useStore.getState().setHour(h - city.lon / 15, true)
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-bone/90 px-3 py-1 text-[12.5px] shadow-sm sm:rounded-full">
      <button onClick={() => useStore.getState().setCityView(null)} className="text-ink/60 hover:text-ink">← globe</button>
      <span className="font-display text-[14px]">{city.name}{country && <span className="text-ink/50">, {country.name}</span>}</span>
      <Num className="text-ink/70">{formatHour(local)} local</Num>
      <div className="flex gap-0.5">
        {HOURS.map((x) => <button key={x.label} onClick={() => setLocal(x.h)} className={`rounded-full px-2 py-0.5 text-[11.5px] ${pinned && Math.abs(local - x.h) < 0.3 ? 'bg-ink text-bone' : 'text-ink/60 hover:bg-ink/5'}`}>{x.label}</button>)}
      </div>
      <input type="range" min={0} max={23.9} step={0.1} value={local} onChange={(e) => setLocal(Number(e.target.value))} className="w-28 accent-[var(--ink)]" aria-label="time of day" />
      {pinned && <button onClick={() => useStore.getState().setHour(useStore.getState().hour, false)} className="text-[11px] text-ink/50 underline decoration-ink/20 underline-offset-2">let the day run</button>}
      {life && lives && <a href={lifeHref(lives, life)} target="_blank" rel="noreferrer" className="text-[11.5px] underline decoration-ink/25 underline-offset-2">watch this life: {life.name}</a>}
    </div>
  )
}
