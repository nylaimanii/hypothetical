import * as THREE from 'three'
import { create } from 'zustand'
import type { RapierRigidBody } from '@react-three/rapier'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Behavior, Citizen, Emotion } from '@/lib/types'
import { PIP } from './lib'

// ---- proportions, in pip units (adult about 1.1 tall, scaled to PIP world units) ----
export const P = {
  hipY: 0.415,
  hipX: 0.075,
  legR: 0.06,
  legHalf: 0.14,
  legCenter: -0.215,
  torsoR: 0.13,
  torsoHalf: 0.08,
  torsoCenter: 0.2,
  shoulderY: 0.33,
  armR: 0.05,
  armHalf: 0.1,
  armCenter: -0.15,
  handY: -0.33,
  neckY: 0.4,
  headCenter: 0.15,
}

export const buildW = (b: Citizen['build']) => (b === 'slim' ? 0.85 : b === 'broad' ? 1.22 : 1)
export const shoulderX = (bw: number) => P.torsoR * bw + 0.05
export const pipScale = (c: Citizen) => (PIP * c.heightCm) / 170 / 1.1
export const headScale = (c: Citizen) => (c.age < 14 ? 1.32 : c.age < 18 ? 1.1 : 1)

// ---- agents ----
export type Agent = {
  key: string
  citizen: Citizen
  home: THREE.Vector3 // unit normal at the region center
  color: string
  revolt: boolean
  famine: boolean
  angry: boolean
  migrant?: { from: THREE.Vector3; to: THREE.Vector3; k: number; n: number }
  behavior: Behavior
  emo: Emotion // dominant emotion
  emoLevel: number
  val: number // mood valence 0..1
  drifting?: boolean // protesting while the crowd has gone bored: wandering off
  line?: { k: number; n: number } // place in a marching line
  goal?: THREE.Vector3 // unit vector of a new city they are walking to
  parentKey?: string // a small kid pip following a parent
}

export type RagdollBodies = { torso: RapierRigidBody; head: RapierRigidBody; armL: RapierRigidBody; armR: RapierRigidBody; legL: RapierRigidBody; legR: RapierRigidBody }

// written every frame by the renderer, read by ragdolls
export const pipRegistry = {
  agents: new Map<string, Agent>(),
  roots: new Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion; heading: THREE.Vector3 }>(),
  ragdolls: new Map<string, RagdollBodies>(),
  knockAt: new Map<string, number>(), // procedural knockdowns, seconds (clock time)
  shocks: [] as { id: number; center: THREE.Vector3; at: number; strength: number; radius: number }[],
  debris: [] as { id: number; origin: THREE.Vector3; at: number }[],
}

export const usePhys = create<{ keys: string[]; debrisTick: number; setKeys: (k: string[]) => void; bumpDebris: () => void }>((set) => ({
  keys: [],
  debrisTick: 0,
  setKeys: (keys) => set({ keys }),
  bumpDebris: () => set((s) => ({ debrisTick: s.debrisTick + 1 })),
}))

// ---- geometry, one shared base mesh per part ----
const ni = (g: THREE.BufferGeometry) => {
  const out = g.index ? g.toNonIndexed() : g
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2))
  return out
}
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)))
  return ni(g)
}
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs, false)!

// hair is built around the neck pivot. head box center y 0.15, half extents 0.14 / 0.135 / 0.13
const cap = (h = 0.1, back = 0.0) => at(new RoundedBoxGeometry(0.31, h, 0.29 + back, 2, 0.045), 0, 0.29 - h / 2 + 0.035, -back / 2 - 0.005)
const ball = (r: number, x: number, y: number, z: number) => at(new THREE.SphereGeometry(r, 10, 8), x, y, z)
const strand = (r: number, len: number, x: number, y: number, z: number, rx = 0, rz = 0) => at(new THREE.CapsuleGeometry(r, len, 3, 8), x, y, z, rx, 0, rz)

let hairCache: Record<Citizen['hair'], THREE.BufferGeometry | null> | null = null
export function hairGeometries() {
  if (hairCache) return hairCache
  const coils: THREE.BufferGeometry[] = [cap(0.07)]
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    coils.push(ball(0.045, Math.cos(a) * 0.11, 0.285 + (i % 2) * 0.012, Math.sin(a) * 0.1))
  }
  const locs: THREE.BufferGeometry[] = [cap(0.11, 0.02)]
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * 0.15 + (i / 8) * Math.PI * 0.7
    locs.push(strand(0.026, 0.2, Math.cos(a) * 0.15, 0.13, -Math.sin(a) * 0.13 - 0.01, -0.1, Math.cos(a) * 0.15))
  }
  hairCache = {
    bald: null,
    buzz: cap(0.05),
    short_straight: merge([cap(0.11, 0.02), at(new RoundedBoxGeometry(0.3, 0.12, 0.06, 2, 0.025), 0, 0.2, -0.13)]),
    short_wavy: merge([cap(0.1), ball(0.06, -0.08, 0.3, 0.06), ball(0.065, 0.03, 0.31, 0.08), ball(0.055, 0.1, 0.29, 0.02), ball(0.06, 0, 0.3, -0.07)]),
    short_coily: merge(coils),
    afro: merge([at(new THREE.SphereGeometry(0.25, 16, 12), 0, 0.24, -0.03, 0, 0, 0, 1, 0.9, 1)]),
    locs: merge(locs),
    braids: merge([cap(0.1, 0.02), strand(0.03, 0.22, -0.06, 0.06, -0.14, 0.15), strand(0.03, 0.22, 0.06, 0.06, -0.14, 0.15), ball(0.035, -0.06, -0.08, -0.16), ball(0.035, 0.06, -0.08, -0.16)]),
    long_straight: merge([cap(0.11, 0.03), at(new RoundedBoxGeometry(0.32, 0.34, 0.07, 2, 0.03), 0, 0.1, -0.14)]),
    long_wavy: merge([cap(0.11, 0.03), at(new RoundedBoxGeometry(0.3, 0.3, 0.07, 2, 0.03), 0, 0.12, -0.14), ball(0.06, -0.1, -0.04, -0.13), ball(0.065, 0, -0.06, -0.14), ball(0.06, 0.1, -0.04, -0.13)]),
    bun: merge([cap(0.1, 0.02), ball(0.075, 0, 0.33, -0.1)]),
    ponytail: merge([cap(0.1, 0.02), ball(0.045, 0, 0.22, -0.16), strand(0.035, 0.16, 0, 0.08, -0.19, 0.25)]),
  }
  return hairCache
}

export const HAIRS: Citizen['hair'][] = ['bald', 'buzz', 'short_straight', 'short_wavy', 'short_coily', 'afro', 'locs', 'braids', 'long_straight', 'long_wavy', 'bun', 'ponytail']

let partCache: Record<string, THREE.BufferGeometry> | null = null
export function partGeometries() {
  if (partCache) return partCache
  partCache = {
    torso: new THREE.CapsuleGeometry(P.torsoR, P.torsoHalf * 2, 6, 14),
    head: new RoundedBoxGeometry(0.28, 0.27, 0.26, 3, 0.1),
    limbArm: new THREE.CapsuleGeometry(P.armR, P.armHalf * 2, 4, 10),
    limbLeg: new THREE.CapsuleGeometry(P.legR, P.legHalf * 2 - 0.06, 4, 10),
    hand: new THREE.SphereGeometry(0.066, 12, 10),
    foot: new RoundedBoxGeometry(0.12, 0.07, 0.19, 2, 0.03),
    eye: new RoundedBoxGeometry(0.045, 0.07, 0.02, 2, 0.012),
    brow: new RoundedBoxGeometry(0.085, 0.028, 0.03, 1, 0.008),
    halo: new THREE.TorusGeometry(0.12, 0.018, 8, 28).rotateX(Math.PI / 2),
    dot: new THREE.SphereGeometry(0.03, 10, 8),
  }
  return partCache
}
