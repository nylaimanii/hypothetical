// hair for the chosen person, shaped for her type: a rounded scalp cap that follows the head, with braids and locs
// that hang from it, an afro that sits around it, a bun or ponytail behind. coordinates are head-local: the pip head
// (pipShared, read-only) is a rounded box 0.28 x 0.27 x 0.26 centered at the origin, face toward +z.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Look } from '@/lib/life/types'

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: [number, number, number] = [1, 1, 1]) => {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...s)))
  return g
}
// the scalp: the top of a slightly flattened sphere, sized to sit on the head box with a little overhang
const cap = (thick = 1, low = 0.44) => at(new THREE.SphereGeometry(0.168, 20, 12, 0, Math.PI * 2, 0, Math.PI * low), 0, 0.03, -0.006, 0, 0, 0, [thick, 0.8 * thick, 0.96 * thick])
const strand = (r: number, len: number, a: number, y: number, ring = 0.15, tilt = 0.12) => {
  const g = new THREE.CapsuleGeometry(r, len, 3, 8)
  const x = Math.sin(a) * ring, z = Math.cos(a) * ring
  return at(g, x * (1 + tilt), y - len / 2, z * (1 + tilt), Math.cos(a) * tilt, 0, -Math.sin(a) * tilt)
}

const cache = new Map<string, THREE.BufferGeometry | null>()
export function hairGeometry(style: Look['hair']): THREE.BufferGeometry | null {
  if (cache.has(style)) return cache.get(style)!
  const parts: THREE.BufferGeometry[] = []
  const back = (n: number, from = 0.62, to = 1.38) => Array.from({ length: n }, (_, i) => Math.PI * (from + (to - from) * (i / Math.max(1, n - 1)))) // angles around the back of the head
  switch (style) {
    case 'bald': cache.set(style, null); return null
    case 'buzz': parts.push(cap(0.97, 0.4)); break
    case 'short_straight': parts.push(cap(1.02), at(new THREE.BoxGeometry(0.2, 0.05, 0.04, 2, 1, 1), 0, 0.085, 0.13)); break
    case 'short_wavy': parts.push(cap(1.04)); for (const a of [0.2, 0.9, 1.6, 2.4, 3.2, 4.0, 4.8, 5.6]) parts.push(at(new THREE.SphereGeometry(0.045, 8, 6), Math.sin(a) * 0.12, 0.12, Math.cos(a) * 0.11)); break
    case 'short_coily': parts.push(cap(1.03)); for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, rr = i % 2 ? 0.1 : 0.06; parts.push(at(new THREE.SphereGeometry(0.036, 8, 6), Math.sin(a) * rr, 0.15 + (i % 3) * 0.008, Math.cos(a) * rr)) } break
    case 'afro': parts.push(at(new THREE.SphereGeometry(0.235, 18, 14), 0, 0.075, -0.03, 0, 0, 0, [1, 0.92, 1])); break
    case 'braids': parts.push(cap(1.02, 0.47)); for (const a of back(13)) { const len = 0.2 + Math.abs(Math.sin(a * 3)) * 0.06; parts.push(strand(0.017, len, a, 0.05), at(new THREE.SphereGeometry(0.021, 6, 5), Math.sin(a) * 0.168, 0.05 - len - 0.02, Math.cos(a) * 0.168)) } break
    case 'locs': parts.push(cap(1.03, 0.47)); for (const a of back(11, 0.55, 1.45)) parts.push(strand(0.024, 0.22, a, 0.05, 0.152, 0.16)); break
    case 'long_straight': parts.push(cap(1.03, 0.48), at(new THREE.CylinderGeometry(0.16, 0.175, 0.28, 18, 1, true, Math.PI * 0.62, Math.PI * 0.76), 0, -0.07, -0.01)); break
    case 'long_wavy': parts.push(cap(1.04, 0.48), at(new THREE.CylinderGeometry(0.165, 0.185, 0.26, 18, 1, true, Math.PI * 0.62, Math.PI * 0.76), 0, -0.06, -0.01)); for (const a of back(5)) parts.push(at(new THREE.SphereGeometry(0.05, 8, 6), Math.sin(a) * 0.18, -0.2, Math.cos(a) * 0.17)); break
    case 'bun': parts.push(cap(1.02), at(new THREE.SphereGeometry(0.075, 12, 10), 0, 0.17, -0.1)); break
    case 'ponytail': parts.push(cap(1.02), at(new THREE.SphereGeometry(0.05, 10, 8), 0, 0.1, -0.17), strand(0.035, 0.18, Math.PI, 0.08, 0.2, 0.25)); break
  }
  const merged = mergeGeometries(parts.map(g => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g }), false)
  cache.set(style, merged)
  return merged
}
