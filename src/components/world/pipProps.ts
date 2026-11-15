import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Emotion } from '@/lib/types'

// every prop and icon is an original chunky shape. icons carry vertex colors so one mesh can be two-toned

function paint(g: THREE.BufferGeometry, hex: string) {
  const out = g.index ? g.toNonIndexed() : g
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2))
  const c = new THREE.Color(hex)
  const n = out.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b }
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return out
}
const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)))
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts, false)!

export type IconKind = 'heart' | 'cloud' | 'spark' | 'tear' | 'crown' | 'eye' | 'zzz' | 'drop'
export const ICONS: IconKind[] = ['heart', 'cloud', 'spark', 'tear', 'crown', 'eye', 'zzz', 'drop']
export const EMOTION_ICON: Record<Emotion, IconKind> = {
  joy: 'heart', anger: 'cloud', hope: 'spark', awe: 'spark', grief: 'tear', pride: 'crown', distrust: 'eye', envy: 'eye', boredom: 'zzz', fear: 'drop',
}
// per-instance tint multiplies the baked colors (envy is a green eye, awe a paler spark)
export const EMOTION_TINT: Partial<Record<Emotion, string>> = { envy: '#9BE08F', awe: '#E6F2FF' }

let iconCache: Record<IconKind, THREE.BufferGeometry> | null = null
export function iconGeometries() {
  if (iconCache) return iconCache
  const z = (y: number, s: number) => [
    paint(place(new THREE.BoxGeometry(0.16, 0.035, 0.035), 0, y + 0.06 * s, 0, 0, 0, 0, s, 1, 1), '#E9E4F6'),
    paint(place(new THREE.BoxGeometry(0.17, 0.035, 0.035), 0, y, 0, 0, 0, 0.62, s, 1, 1), '#E9E4F6'),
    paint(place(new THREE.BoxGeometry(0.16, 0.035, 0.035), 0, y - 0.06 * s, 0, 0, 0, 0, s, 1, 1), '#E9E4F6'),
  ]
  iconCache = {
    heart: merge([
      paint(place(new THREE.SphereGeometry(0.075, 12, 10), -0.055, 0.03, 0), '#EE8FA2'),
      paint(place(new THREE.SphereGeometry(0.075, 12, 10), 0.055, 0.03, 0), '#EE8FA2'),
      paint(place(new THREE.ConeGeometry(0.11, 0.15, 4), 0, -0.06, 0, Math.PI, Math.PI / 4, 0, 1.15, 1, 0.6), '#EE8FA2'),
    ]),
    cloud: merge([
      paint(place(new THREE.SphereGeometry(0.08, 12, 10), -0.07, 0, 0), '#6B6874'),
      paint(place(new THREE.SphereGeometry(0.1, 12, 10), 0.02, 0.03, 0), '#6B6874'),
      paint(place(new THREE.SphereGeometry(0.07, 12, 10), 0.1, -0.01, 0), '#6B6874'),
      paint(place(new THREE.BoxGeometry(0.035, 0.1, 0.03), 0.0, -0.11, 0.02, 0, 0, 0.4), '#F2D16B'),
      paint(place(new THREE.BoxGeometry(0.035, 0.09, 0.03), 0.03, -0.18, 0.02, 0, 0, -0.4), '#F2D16B'),
    ]),
    // six even rays: reads as a sparkle, never as a cross
    spark: merge([
      paint(place(new THREE.OctahedronGeometry(0.065), 0, 0, 0), '#F7E39A'),
      ...[0, 1, 2].map((k) => paint(place(new THREE.BoxGeometry(0.26, 0.035, 0.035), 0, 0, 0, 0, 0, (k * Math.PI) / 3 + Math.PI / 6), '#F7E39A')),
    ]),
    tear: merge([
      paint(place(new THREE.SphereGeometry(0.075, 12, 10), 0, -0.03, 0), '#86AEE0'),
      paint(place(new THREE.ConeGeometry(0.072, 0.12, 12), 0, 0.075, 0), '#86AEE0'),
    ]),
    crown: merge([
      paint(place(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 14, 1, true), 0, -0.04, 0), '#E5C25A'),
      paint(place(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 14), 0, -0.07, 0), '#E5C25A'),
      ...[0, 1, 2, 3, 4].map((k) => paint(place(new THREE.ConeGeometry(0.03, 0.09, 6), Math.cos((k / 5) * Math.PI * 2) * 0.1, 0.03, Math.sin((k / 5) * Math.PI * 2) * 0.1), '#E5C25A')),
    ]),
    eye: merge([
      paint(place(new THREE.SphereGeometry(0.1, 14, 10), 0, 0, 0, 0, 0, 0, 1.4, 0.75, 0.5), '#F4F1EA'),
      paint(place(new THREE.SphereGeometry(0.045, 12, 10), 0, 0, 0.035), '#2A2730'),
    ]),
    zzz: merge([...z(0.06, 1), ...z(-0.1, 0.7).map((g) => place(g, 0.1, 0, 0))]),
    drop: merge([
      paint(place(new THREE.SphereGeometry(0.06, 12, 10), 0, -0.02, 0), '#BFE3F0'),
      paint(place(new THREE.ConeGeometry(0.058, 0.1, 12), 0, 0.06, 0), '#BFE3F0'),
    ]),
  }
  return iconCache
}

let propCache: Record<'sign' | 'box' | 'phone' | 'glow' | 'confetti', THREE.BufferGeometry> | null = null
export function propGeometries() {
  if (propCache) return propCache
  propCache = {
    // held beyond the hand: in arm space, -y runs from the shoulder past the hand
    sign: merge([
      paint(place(new THREE.BoxGeometry(0.035, 0.7, 0.035), 0, -0.66, 0), '#8B6E50'),
      // tilted so the blank face catches the camera above the crowd
      paint(place(new RoundedBoxGeometry(0.62, 0.44, 0.04, 2, 0.025), 0, -1.12, 0.02, 1.1, 0, 0), '#F4F0E6'),
    ]),
    box: new RoundedBoxGeometry(0.26, 0.2, 0.2, 2, 0.03),
    phone: new RoundedBoxGeometry(0.06, 0.1, 0.015, 1, 0.006),
    glow: new THREE.CircleGeometry(0.32, 28).rotateX(-Math.PI / 2),
    confetti: new THREE.BoxGeometry(0.035, 0.008, 0.022),
  }
  return propCache
}

export const CONFETTI_COLORS = ['#F2D16B', '#7FC0D0', '#C27FA9', '#6FAE7E', '#F4F0E6', '#8A86C4']
