'use client'
import { useMemo } from 'react'

// an original chunky sigil from a seed: base shape, inner motif, rotational symmetry. no letters
const INKS = ['#1D1B19', '#3A3F5C', '#2F4B46', '#5A3E36']
const ACCENTS = ['#7F98D6', '#D9A456', '#6FAE7E', '#C27FA9', '#56AFA9', '#E0B97E', '#8A86C4', '#7FC0D0', '#B49BD0']

function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export default function Emblem({ seed, size = 40, glow = false, faded = false }: { seed: number; size?: number; glow?: boolean; faded?: boolean }) {
  const parts = useMemo(() => {
    const r = rng(seed)
    const sides = [0, 4, 6, 8][Math.floor(r() * 4)]
    const sym = [3, 4, 5, 6][Math.floor(r() * 4)]
    const motif = Math.floor(r() * 4)
    const ink = INKS[Math.floor(r() * INKS.length)]
    const accent = ACCENTS[Math.floor(r() * ACCENTS.length)]
    const rot = r() * 360
    const inner = 0.35 + r() * 0.25
    return { sides, sym, motif, ink, accent, rot, inner }
  }, [seed])
  const { sides, sym, motif, ink, accent, rot, inner } = parts
  const poly = (n: number, rad: number, off = 0) => Array.from({ length: n }, (_, i) => { const a = ((i / n) * 360 + off) * (Math.PI / 180); return `${50 + Math.cos(a) * rad},${50 + Math.sin(a) * rad}` }).join(' ')
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={`shrink-0 ${faded ? 'opacity-40 grayscale' : ''}`} style={glow ? { filter: 'drop-shadow(0 0 6px rgba(242,223,160,0.9))' } : undefined} aria-hidden>
      {sides === 0 ? <circle cx="50" cy="50" r="44" fill="#EFE8DA" stroke={ink} strokeWidth="7" /> : <polygon points={poly(sides, 46, rot)} fill="#EFE8DA" stroke={ink} strokeWidth="7" strokeLinejoin="round" />}
      <g transform={`rotate(${rot} 50 50)`}>
        {Array.from({ length: sym }, (_, i) => {
          const a = (360 / sym) * i
          return (
            <g key={i} transform={`rotate(${a} 50 50)`}>
              {motif === 0 && <rect x="45" y={50 - 40 * inner - 12} width="10" height="22" rx="4" fill={accent} stroke={ink} strokeWidth="4" />}
              {motif === 1 && <circle cx="50" cy={50 - 34 * inner} r="8" fill={accent} stroke={ink} strokeWidth="4" />}
              {motif === 2 && <polygon points={`50,${50 - 46 * inner} 58,${50 - 26 * inner} 42,${50 - 26 * inner}`} fill={accent} stroke={ink} strokeWidth="4" strokeLinejoin="round" />}
              {motif === 3 && <path d={`M40 ${50 - 30 * inner} L50 ${50 - 44 * inner} L60 ${50 - 30 * inner}`} fill="none" stroke={ink} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />}
            </g>
          )
        })}
      </g>
      <circle cx="50" cy="50" r={9 + inner * 6} fill={ink} />
      <circle cx="50" cy="50" r={4} fill={accent} />
    </svg>
  )
}
