'use client'
// the tradeoff map: every world that recorded its tradeoffs (b's summary.tradeoffs, sim 5.10.1+), lifespan across,
// population up, freedom as the fill (one hue, light = less free) and off-world progress as the size. the frontier
// (pareto.ts) is the worlds nothing beats on all four; it is outlined, not joined: it has four axes, so a line on two
// of them would suggest a curve that is not there. one sim version at a time: worlds
// from different sims ran different rules, so a frontier across them would mix models
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Num, fmt } from './bits'
import { paretoFront, type TradeoffWorld, type Tradeoffs } from './pareto'

type Plotted = TradeoffWorld & { tradeoffs: Tradeoffs }
const W = 640, H = 380, PAD = { l: 56, r: 16, t: 14, b: 40 }
// freedom 0..1 on one blue ramp, light to dark
const RAMP = ['#DCE4F5', '#B4C4EA', '#8AA2DC', '#5F7FC9', '#3F5FA8', '#2A447E']
const fill = (f: number) => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(f * RAMP.length)))]
const radius = (o: number) => 4 + 10 * Math.sqrt(Math.max(0, Math.min(1, o)))

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const usable = (t: Tradeoffs) => finite(t.lifespan) && t.lifespan > 0 && finite(t.population) && t.population > 0 && finite(t.freedom) && finite(t.offWorld)

function ticks(lo: number, hi: number, n = 5) {
  const step = (hi - lo) / n
  return Array.from({ length: n + 1 }, (_, i) => lo + i * step)
}

export default function TradeoffsPage() {
  const [all, setAll] = useState<TradeoffWorld[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [hover, setHover] = useState<Plotted | null>(null)
  const router = useRouter()
  useEffect(() => {
    fetch('/api/tradeoffs', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject())).then((x: TradeoffWorld[]) => setAll(Array.isArray(x) ? x : [])).catch(() => setFailed(true))
  }, [])
  const versions = useMemo(() => [...new Set((all ?? []).filter((w) => w.tradeoffs).map((w) => w.simVersion ?? 'unrecorded'))], [all])
  const v = version ?? versions[0] ?? null
  const mine = useMemo(() => (all ?? []).filter((w): w is Plotted => !!w.tradeoffs && (w.simVersion ?? 'unrecorded') === v), [all, v])
  // a world whose record broke (5.10.7's housing bug left no final population) has nothing true to plot: counted, not drawn
  const pts = useMemo(() => mine.filter((w) => usable(w.tradeoffs)), [mine])
  const broken = mine.length - pts.length
  const missing = (all ?? []).filter((w) => !w.tradeoffs).length
  const { front, beatenBy } = useMemo(() => paretoFront(pts), [pts])

  const xs = pts.map((p) => p.tradeoffs.lifespan), ys = pts.map((p) => p.tradeoffs.population)
  const pad = (lo: number, hi: number) => { const d = (hi - lo) || Math.abs(hi) * 0.05 || 1; return [lo - d * 0.08, hi + d * 0.08] }
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs)), [y0, y1] = pad(Math.min(...ys), Math.max(...ys))
  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r)
  const sy = (y: number) => H - PAD.b - ((y - y0) / (y1 - y0)) * (H - PAD.t - PAD.b)

  return (
    <main className="page-scroll min-h-screen bg-bone px-4 py-6 text-ink sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="text-[12px] text-ink/55 underline decoration-ink/20 underline-offset-2">back to the world</Link>
        <h1 className="mt-2 font-display text-[28px] leading-tight">the tradeoff map</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-ink/65">every world at its end: how long people lived, how many there were, how free they were, and how far off earth they got. outlined worlds are the frontier: no other world beat them on all four at once, so a world can be on it for one axis this chart does not place, like off-world reach.</p>
        {failed && <p className="mt-6 text-[13px] text-ink/60">the world runner is offline, so there is nothing to map</p>}
        {!failed && !all && <p className="mt-6 text-[13px] text-ink/60">loading worlds</p>}
        {all && !pts.length && !broken && <p className="mt-6 text-[13px] text-ink/60">no world has recorded its tradeoffs yet (the sim records them from version 5.10.1)</p>}
        {pts.length > 0 && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-ink/55">sim</span>
              {versions.map((x) => <button key={x} onClick={() => setVersion(x)} className={`rounded-full px-2.5 py-0.5 font-mono ${x === v ? 'bg-ink text-bone' : 'border border-ink/20 hover:bg-ink/5'}`}>{x}</button>)}
              <span className="text-ink/50"><Num>{pts.length}</Num> worlds{missing > 0 && <>; <Num>{missing}</Num> older worlds ran before the sim measured freedom and are not shown</>}{broken > 0 && <>; <Num>{broken}</Num> more ended without a final population (a sim bug fixed in 5.10.9) and are not shown</>}</span>
            </div>
            <div className="relative mt-3">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="worlds by lifespan and population">
                {ticks(x0, x1).map((t) => <g key={`x${t}`}><line x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink)" strokeOpacity={0.07} /><text x={sx(t)} y={H - PAD.b + 16} textAnchor="middle" className="fill-ink/50 font-mono text-[10px]">{t.toFixed(1)}</text></g>)}
                {ticks(y0, y1).map((t) => <g key={`y${t}`}><line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} stroke="var(--ink)" strokeOpacity={0.07} /><text x={PAD.l - 6} y={sy(t) + 3} textAnchor="end" className="fill-ink/50 font-mono text-[10px]">{fmt.people(t)}</text></g>)}
                <text x={(PAD.l + W - PAD.r) / 2} y={H - 6} textAnchor="middle" className="fill-ink/60 text-[11px]">life expectancy at the end (years)</text>
                <text x={12} y={(PAD.t + H - PAD.b) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(PAD.t + H - PAD.b) / 2})`} className="fill-ink/60 text-[11px]">people alive at the end</text>
                {pts.map((p) => (
                  <circle key={p.runId} cx={sx(p.tradeoffs.lifespan)} cy={sy(p.tradeoffs.population)} r={radius(p.tradeoffs.offWorld)}
                    fill={fill(p.tradeoffs.freedom)} stroke={p.status === 'destroyed' ? 'var(--ember)' : front.has(p.runId) ? 'var(--ink)' : 'var(--bone)'} strokeWidth={front.has(p.runId) || p.status === 'destroyed' ? 2 : 1.5}
                    onPointerEnter={() => setHover(p)} onPointerLeave={() => setHover(null)} className="cursor-pointer"
                    onClick={() => router.push(`/?run=${encodeURIComponent(p.runId)}`)} />
                ))}
              </svg>
              {hover && (
                <div className="pointer-events-none absolute z-10 rounded-xl border border-ink/15 bg-bone/95 px-3 py-2 text-[11.5px] leading-snug shadow-lg"
                  style={{ left: `${Math.min(70, (sx(hover.tradeoffs.lifespan) / W) * 100)}%`, top: `${(sy(hover.tradeoffs.population) / H) * 100}%`, transform: 'translate(12px, -50%)' }}>
                  <div className="font-display text-[13px]">{hover.agentId} · <Num>{hover.runId}</Num></div>
                  <div>life expectancy <Num>{hover.tradeoffs.lifespan.toFixed(1)}</Num> · <Num>{fmt.people(hover.tradeoffs.population)}</Num> people</div>
                  <div>freedom <Num>{hover.tradeoffs.freedom.toFixed(2)}</Num> · off-world <Num>{fmt.pct(hover.tradeoffs.offWorld)}</Num>{hover.tradeoffs.frontier ? <> ({hover.tradeoffs.frontier.replace(/_/g, ' ')})</> : null}</div>
                  <div className="text-ink/60">{front.has(hover.runId) ? 'on the frontier: no world beats it on all four' : <>beaten on all four by <Num>{beatenBy.get(hover.runId)}</Num></>}</div>
                  <div className={hover.status === 'destroyed' ? 'text-ember' : 'text-ink/60'}>{hover.status}</div>
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-ink/60">
              <span className="flex items-center gap-1">freedom {[0.05, 0.5, 0.95].map((f) => <span key={f} className="inline-block h-3 w-3 rounded-full" style={{ background: fill(f) }} />)} <span>less to more free</span></span>
              <span className="flex items-center gap-1">off-world <span className="inline-block h-2 w-2 rounded-full border border-ink/40" /> <span className="inline-block h-4 w-4 rounded-full border border-ink/40" /> <span>none to the farthest frontier</span></span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-ink" /> frontier</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-ember" /> destroyed</span>
            </div>
            <table className="mt-5 w-full border-collapse text-[12px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-[0.12em] text-ink/45"><th className="py-1 font-normal">world</th><th className="font-normal">agent</th><th className="text-right font-normal">life exp.</th><th className="text-right font-normal">people</th><th className="text-right font-normal">freedom</th><th className="text-right font-normal">off-world</th><th className="pl-3 font-normal">frontier</th></tr></thead>
              <tbody>
                {[...pts].sort((a, b) => Number(front.has(b.runId)) - Number(front.has(a.runId)) || b.tradeoffs.lifespan - a.tradeoffs.lifespan).map((p) => (
                  <tr key={p.runId} className="border-t border-ink/8">
                    <td className="py-1"><a href={`/?run=${encodeURIComponent(p.runId)}`} className="font-mono underline decoration-ink/20 underline-offset-2">{p.runId}</a></td>
                    <td>{p.agentId}</td>
                    <td className="text-right"><Num>{p.tradeoffs.lifespan.toFixed(1)}</Num></td>
                    <td className="text-right"><Num>{fmt.people(p.tradeoffs.population)}</Num></td>
                    <td className="text-right"><Num>{p.tradeoffs.freedom.toFixed(2)}</Num></td>
                    <td className="text-right"><Num>{fmt.pct(p.tradeoffs.offWorld)}</Num></td>
                    <td className="pl-3 text-ink/60">{front.has(p.runId) ? 'yes' : <>beaten by <Num>{beatenBy.get(p.runId)}</Num></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-ink/50">freedom is the sim&apos;s defined index (0 to 1): force, censorship, limits on movement and a large security budget lower it, a voice in decisions raises it. its weights are an estimate, after Freedom House&apos;s civil-liberties categories. off-world is the frontier reached, of 7 stages beyond 2026.</p>
          </>
        )}
      </div>
    </main>
  )
}
