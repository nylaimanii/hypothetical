// a flat portrait of a chosen person in the pip style: rounded square head, square eyes, brows, hair shape by
// style, monk skin tone, hair grayed by age. pure svg, no webgl, so the home page stays light
import { HAIR_HEX, MONK } from '@/components/world/lib'
import type { Look } from '@/lib/life/types'

const GRAY = '#c9c4bb'
function mix(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16)
  const c = (s: number) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k)
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`
}

export default function Portrait({ look, age, dead, size = 96, title }: { look: Look; age: number; dead: boolean; size?: number; title: string }) {
  const skin = MONK[Math.max(0, Math.min(9, look.skinTone - 1))]
  const hair = mix(HAIR_HEX[look.hairColor] ?? '#2a221c', GRAY, Math.max(0, Math.min(1, (age - 40) / 35)))
  const ink = '#1d1b19'
  const long = /long|braids|locs|ponytail/.test(look.hair)
  const big = look.hair === 'afro'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title} style={{ display: 'block', opacity: dead ? 0.82 : 1 }}>
      <title>{title}</title>
      <rect x="0" y="0" width="100" height="100" rx="22" fill="var(--bone-deep)" />
      {/* shoulders */}
      <rect x="22" y="78" width="56" height="30" rx="14" fill={dead ? '#a9a39a' : '#5F7FA0'} />
      {long && <rect x="25" y="34" width="50" height="46" rx="10" fill={hair} />}
      {big && <circle cx="50" cy="40" r="31" fill={hair} />}
      {/* head */}
      <rect x="28" y="24" width="44" height="44" rx="14" fill={skin} />
      {/* hair cap */}
      {look.hair !== 'bald' && !big && <path d={look.hair === 'buzz' ? 'M29 36 Q29 23 50 23 Q71 23 71 36 L71 33 Q70 26 50 26 Q30 26 29 33 Z' : 'M27 40 Q26 20 50 20 Q74 20 73 40 Q66 30 50 31 Q34 30 27 40 Z'} fill={hair} />}
      {look.hair === 'bun' && <circle cx="50" cy="17" r="8" fill={hair} />}
      {/* face: closed eyes for the dead, open for the living */}
      {dead ? (
        <>
          <path d="M37 47 Q41 50 45 47" stroke={ink} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M55 47 Q59 50 63 47" stroke={ink} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x="38" y="42" width="5" height="8" rx="1.5" fill={ink} />
          <rect x="57" y="42" width="5" height="8" rx="1.5" fill={ink} />
        </>
      )}
      <rect x="36" y="37" width="9" height="2.4" rx="1" fill={hair} />
      <rect x="55" y="37" width="9" height="2.4" rx="1" fill={hair} />
      <path d="M44 58 Q50 61 56 58" stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />
      {age > 55 && <path d="M40 31 L60 31" stroke={mix(skin, ink, 0.25)} strokeWidth="1" />}
    </svg>
  )
}
