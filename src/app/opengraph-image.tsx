import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const alt = 'hypothetical: one ai governs every nation with one mandate, keep humanity alive'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const fraunces = await readFile(join(process.cwd(), 'fonts/Fraunces72pt-SemiBold.ttf'))
const mono = await readFile(join(process.cwd(), 'fonts/JetBrainsMono-Regular.ttf'))

// a few chunky land tiles on the globe silhouette, fixed so the image is stable
const TILES: [number, number, string][] = [
  [118, 92, '#7F98D6'], [150, 92, '#7F98D6'], [182, 92, '#7F98D6'], [118, 124, '#7F98D6'], [150, 124, '#7F98D6'], [214, 124, '#C27FA9'],
  [150, 156, '#D9A456'], [182, 156, '#D9A456'], [246, 156, '#E0B97E'], [278, 156, '#E0B97E'], [246, 188, '#A99B5C'], [278, 188, '#A99B5C'],
  [182, 220, '#6FAE7E'], [214, 220, '#6FAE7E'], [182, 252, '#6FAE7E'], [214, 252, '#6FAE7E'], [214, 284, '#6FAE7E'], [278, 220, '#B9805A'], [310, 220, '#B9805A'],
]

export default async function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', background: '#EFE8DA', padding: '0 80px', gap: 72 }}>
        <div style={{ position: 'relative', width: 420, height: 420, display: 'flex', borderRadius: 210, background: 'radial-gradient(circle at 35% 30%, #7E9DB0 0%, #5E8AA6 55%, #3F5866 100%)', boxShadow: '0 30px 60px -20px rgba(29,27,25,0.45)', overflow: 'hidden' }}>
          {TILES.map(([x, y, c], i) => (
            <div key={i} style={{ position: 'absolute', left: x, top: y, width: 28, height: 28, borderRadius: 7, background: c, boxShadow: 'inset 0 -4px 0 rgba(0,0,0,0.18)' }} />
          ))}
          <div style={{ position: 'absolute', left: 0, top: 0, width: 420, height: 420, borderRadius: 210, border: '10px solid #1D1B19', display: 'flex' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 22, letterSpacing: 8, color: 'rgba(29,27,25,0.55)', textTransform: 'uppercase' }}>november 2026</div>
          <div style={{ fontFamily: 'Fraunces', fontSize: 104, color: '#1D1B19', lineHeight: 1, marginTop: 18 }}>hypothetical</div>
          <div style={{ fontFamily: 'Fraunces', fontSize: 36, color: 'rgba(29,27,25,0.8)', lineHeight: 1.3, marginTop: 28, maxWidth: 560 }}>
            one ai governs every nation. its mandate: keep humanity alive, on more than one world.
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Fraunces', data: fraunces, style: 'normal', weight: 600 }, { name: 'JetBrains Mono', data: mono, style: 'normal', weight: 400 }] },
  )
}
