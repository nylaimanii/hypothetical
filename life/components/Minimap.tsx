'use client'
// place context, small, always there. one tap cycles: her street (home, work, family as dots, her live position) ->
// the real city (ghsl built-up around her city, 1 x 1 degree, data/geo) -> the globe (orthographic, natural earth
// land) -> back to her street.
import { useEffect, useMemo, useRef, useState } from 'react'
import { geoOrthographic, geoPath, geoGraticule10 } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import landTopo from 'world-atlas/land-110m.json'
import type { LifeRecord } from '@/lib/life/types'
import type { PlaceInfo } from '@/lib/life/place'
import type { LiveState } from './ChosenPerson'
import type { WorldNow } from './Scene'
import { layoutFor } from './Scene'
import { K } from './plan'

const S = 132
type Level = 'street' | 'city' | 'globe'
const land = feature(landTopo as unknown as Topology, (landTopo as unknown as Topology).objects.land as GeometryCollection)

export default function Minimap({ place, record, tick, world, live }: { place: PlaceInfo; record: LifeRecord; tick: number; world: React.RefObject<WorldNow>; live: React.RefObject<LiveState> }) {
  const [level, setLevel] = useState<Level>('street')
  const next: Record<Level, Level> = { street: 'city', city: 'globe', globe: 'street' }
  const label = level === 'street' ? `${place.city.toLowerCase()}, her street` : level === 'city' ? place.city.toLowerCase() : place.country.toLowerCase()
  return (
    <button className="chip" onClick={() => setLevel(l => next[l])} aria-label={`map: ${label}. tap to zoom out`} title="tap to zoom out" style={{ borderRadius: 16, padding: 6, display: 'grid', gap: 4, justifyItems: 'center' }}>
      <div style={{ width: S, height: S, borderRadius: 12, overflow: 'hidden', background: 'var(--bone-deep)' }}>
        {level === 'street' && <Street record={record} tick={tick} world={world} live={live} />}
        {level === 'city' && <City place={place} />}
        {level === 'globe' && <Globe place={place} />}
      </div>
      <div style={{ fontSize: 11, opacity: 0.6 }}>{label}</div>
    </button>
  )
}

// her street: the diorama from above, live
function Street({ record, tick, world, live }: { record: LifeRecord; tick: number; world: React.RefObject<WorldNow>; live: React.RefObject<LiveState> }) {
  const cityId = world.current?.cityId ?? record.birthplace.cityId
  const layout = useMemo(() => layoutFor(record, cityId), [record, cityId])
  const her = useRef<SVGCircleElement>(null)
  const fam = useRef<SVGGElement>(null)
  const k = S / 34, o = S / 2
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const L = live.current, W = world.current
      // world positions are layout positions scaled by K (see plan.ts)
      if (L && her.current) { her.current.setAttribute('cx', String(o + L.pos.x / K * k)); her.current.setAttribute('cy', String(o + L.pos.z / K * k)) }
      if (W && fam.current) {
        const dots = [...W.kinPos.values()]
        fam.current.innerHTML = dots.map(p => `<circle cx="${o + p.x / K * k}" cy="${o + p.z / K * k}" r="2.2" fill="#5F7FA0" />`).join('')
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [live, world, k, o])
  const W = world.current
  void tick
  return (
    <svg width={S} height={S} aria-hidden>
      {[-15, -9, -3, 3, 9, 15].map(s => <g key={s}><rect x={o + s * k - 1.5} y={0} width={3} height={S} fill="#cfc4b0" /><rect x={0} y={o + s * k - 1.5} width={S} height={3} fill="#cfc4b0" /></g>)}
      {layout.lots.map(l => (
        <rect key={l.id} x={o + (l.x - l.w / 2) * k} y={o + (l.z - l.d / 2) * k} width={l.w * k} height={l.d * k} rx={1.5}
          fill={l.id === W?.homeLotId ? '#1d1b19' : l.id === W?.workLotId ? '#8873B0' : l.kind === 'park' ? '#a9c49a' : '#e9e0cf'} opacity={l.id === W?.homeLotId || l.id === W?.workLotId ? 0.85 : 1} />
      ))}
      <g ref={fam} />
      <circle ref={her} r={3.6} fill="#e4572e" stroke="#efe8da" strokeWidth={1.4} />
    </svg>
  )
}

// the real city: ghsl built-up fraction around her city, darker = more built
function City({ place }: { place: PlaceInfo }) {
  const g = place.grid
  if (!g) return <svg width={S} height={S} aria-hidden><text x={S / 2} y={S / 2} textAnchor="middle" fontSize="10" opacity="0.5">no city grid</text></svg>
  const c = S / g.win
  const cx = (place.lon - g.lon0) / g.res * c, cy = (g.lat0 - place.lat) / g.res * c
  return (
    <svg width={S} height={S} aria-hidden>
      {g.built.map((b, i) => <rect key={i} x={(i % g.win) * c} y={Math.floor(i / g.win) * c} width={c + 0.3} height={c + 0.3} fill="#1d1b19" opacity={Math.min(0.85, b * 1.4)} />)}
      <circle cx={cx} cy={cy} r={4} fill="#e4572e" stroke="#efe8da" strokeWidth={1.4} />
    </svg>
  )
}

function Globe({ place }: { place: PlaceInfo }) {
  const proj = geoOrthographic().rotate([-place.lon, -place.lat]).scale(S / 2 - 4).translate([S / 2, S / 2]).clipAngle(90)
  const path = geoPath(proj)
  const p = proj([place.lon, place.lat])
  return (
    <svg width={S} height={S} aria-hidden>
      <circle cx={S / 2} cy={S / 2} r={S / 2 - 4} fill="#dfe6e8" />
      <path d={path(geoGraticule10()) ?? ''} stroke="#1d1b19" strokeOpacity={0.08} fill="none" />
      <path d={path(land) ?? ''} fill="#cfc4b0" />
      {p && <circle cx={p[0]} cy={p[1]} r={4} fill="#e4572e" stroke="#efe8da" strokeWidth={1.4} />}
    </svg>
  )
}
