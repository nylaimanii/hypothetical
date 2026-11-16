// the body: a chunky two-segment skeleton (thigh + shin, upper arm + forearm) with proportions by age, a procedural
// walk with foot planting, and a library of poses that blend into each other. used for the chosen person and the crowd.
//
// how games do believable crowds, applied here (cf. "procedural animation" talks: Rosen, GDC 2014 "An Indie Approach to
// Procedural Animation"; Wolfire's Overgrowth locomotion; and two-bone foot IK as in Unity/Unreal):
//   - the gait is driven by DISTANCE, not time: the cycle advances by how far the body moved, so feet never slide
//   - stance feet are planted: during stance the foot target moves backward at exactly the body's speed (it stays still
//     in the world); swing feet lift on an arc and land heel first
//   - legs reach their foot targets with analytic two-bone IK (law of cosines), so knees bend naturally
//   - the pelvis bobs twice per cycle and yaws against the shoulders; arms swing opposite to the legs
//   - every action is a pose; the body eases from pose to pose (no snapping), which gives each action a start and an end
// units: body-local, the person faces +z, left is +x, the ground is y = 0. an adult stands about 1.0 tall.
import * as THREE from 'three'

export type Body = {
  H: number; age: number
  headH: number; headW: number; hipH: number; thigh: number; shin: number; footH: number; footL: number
  torso: number; torsoW: number; torsoD: number; hipW: number; shoulderW: number
  upper: number; fore: number; limb: number; stride: number
}

// stylized proportions by age (pip style: big heads). ESTIMATE, from the usual figure-drawing ratios (an adult is about
// 7.5 heads tall, a toddler about 4, a newborn about 4), compressed to our chunky look
export function bodyFor(age: number, heightCm: number, build: 'slim' | 'average' | 'broad'): Body {
  const share = growth(age)
  const H = (heightCm / 170) * share * 1.0
  const headRatio = age < 1 ? 0.34 : age < 3 ? 0.3 : age < 8 ? 0.26 : age < 14 ? 0.23 : 0.21
  const legRatio = age < 1 ? 0.26 : age < 3 ? 0.31 : age < 8 ? 0.37 : age < 14 ? 0.41 : 0.43
  const bw = build === 'slim' ? 0.88 : build === 'broad' ? 1.2 : 1
  const stoop = age > 70 ? Math.min(1, (age - 70) / 20) : 0
  const headH = H * headRatio
  const hipH = H * legRatio
  const footH = H * 0.045
  return {
    H, age, headH, headW: headH * 1.02, hipH,
    thigh: (hipH - footH) * 0.53, shin: (hipH - footH) * 0.51, footH, footL: H * 0.13,
    torso: H - hipH - headH * 0.92, torsoW: H * 0.26 * bw, torsoD: H * 0.16 * bw, hipW: H * 0.075 * bw, shoulderW: H * 0.15 * bw,
    upper: H * 0.2, fore: H * 0.19, limb: H * 0.075 * (0.9 + bw * 0.1),
    // a full cycle (two steps) covers about 0.6 of standing height on these short pip legs (longer would over-reach)
    stride: H * (age < 3 ? 0.42 : 0.6) * (1 - stoop * 0.25),
  }
}
// share of adult height by age (who growth standards / cdc charts, smoothed). ESTIMATE
export function growth(age: number) {
  const pts: [number, number][] = [[0, 0.29], [1, 0.44], [2, 0.51], [5, 0.65], [9, 0.78], [13, 0.9], [16, 0.97], [18, 1]]
  if (age >= 18) return age > 70 ? 1 - Math.min(0.04, (age - 70) * 0.002) : 1
  for (let i = 1; i < pts.length; i++) if (age < pts[i][0]) { const [a0, h0] = pts[i - 1], [a1, h1] = pts[i]; return h0 + (h1 - h0) * (age - a0) / (a1 - a0) }
  return 1
}

// ---------- poses ----------
// a pose is a set of numbers, so any two poses blend by lerp. feet are targets (body-local) reached by IK
export type Pose = {
  pelvisY: number; pelvisPitch: number; pelvisYaw: number; pelvisRoll: number
  spinePitch: number; spineYaw: number; spineRoll: number; headPitch: number; headYaw: number
  footL: [number, number, number]; footR: [number, number, number]; toeL: number; toeR: number
  armL: [number, number, number, number]; armR: [number, number, number, number] // pitch (forward +), roll (out +), yaw, elbow bend
}
export const KEYS = ['pelvisY', 'pelvisPitch', 'pelvisYaw', 'pelvisRoll', 'spinePitch', 'spineYaw', 'spineRoll', 'headPitch', 'headYaw', 'toeL', 'toeR'] as const

export function blendInto(out: Pose, target: Pose, k: number) {
  for (const key of KEYS) out[key] += (target[key] - out[key]) * k
  for (let i = 0; i < 3; i++) { out.footL[i] += (target.footL[i] - out.footL[i]) * k; out.footR[i] += (target.footR[i] - out.footR[i]) * k }
  for (let i = 0; i < 4; i++) { out.armL[i] += (target.armL[i] - out.armL[i]) * k; out.armR[i] += (target.armR[i] - out.armR[i]) * k }
}
export function mix(a: Pose, b: Pose, k: number): Pose { const o = clonePose(a); blendInto(o, b, k); return o }
export const clonePose = (p: Pose): Pose => ({ ...p, footL: [...p.footL], footR: [...p.footR], armL: [...p.armL], armR: [...p.armR] })

// what someone is doing, as a pose. t: seconds (for small living motion), seed: per person, so nobody moves in sync
export type Action = 'stand' | 'walk' | 'sit' | 'lie' | 'hold_baby' | 'held' | 'talk' | 'cook' | 'sweep' | 'carry_head' | 'work' | 'type' | 'hug' | 'wave' | 'phone' | 'play' | 'pray' | 'wait'
export type Mood = { tired: number; sad: number; hurry: number }

export function poseFor(b: Body, a: Action, t: number, seed: number, mood: Mood, seatH = 0): Pose {
  const s = seed * 7.13
  const stoop = b.age > 65 ? Math.min(0.35, (b.age - 65) * 0.012) : 0
  const droop = mood.sad * 0.18 + mood.tired * 0.12
  // standing idle: a slow weight shift from foot to foot and a look around now and then
  const shift = Math.sin(t * 0.55 + s) * 0.5
  const look = Math.sin(t * 0.23 + s * 1.7) * 0.5 + Math.sin(t * 0.61 + s) * 0.2
  const stand: Pose = {
    pelvisY: b.hipH - Math.abs(shift) * b.H * 0.006, pelvisPitch: 0, pelvisYaw: 0, pelvisRoll: shift * 0.05,
    spinePitch: stoop + droop, spineYaw: 0, spineRoll: -shift * 0.03, headPitch: droop * 0.8, headYaw: look * 0.5,
    footL: [b.hipW * 1.15 + shift * b.H * 0.01, b.footH, 0.01], footR: [-b.hipW * 1.15 + shift * b.H * 0.01, b.footH, -0.01], toeL: 0, toeR: 0,
    armL: [0.05, 0.12, 0, 0.2], armR: [0.05, 0.12, 0, 0.2],
  }
  switch (a) {
    case 'stand': case 'wait': return stand
    case 'walk': return stand // replaced by gait() in practice
    case 'sit': {
      // on a chair or stoop: thighs level, shins down, feet planted in front
      const h = seatH || b.thigh * 1.05
      return { ...stand, pelvisY: h, pelvisRoll: 0, spinePitch: 0.08 + droop + stoop * 0.6, headPitch: droop * 0.6 + 0.05, headYaw: look * 0.6,
        footL: [b.hipW * 1.2, b.footH, b.thigh * 0.95], footR: [-b.hipW * 1.2, b.footH, b.thigh * 0.95], armL: [0.55, 0.08, 0, 0.9], armR: [0.55, 0.08, 0, 0.9] }
    }
    case 'lie': return { ...stand, pelvisY: b.torsoD * 0.6 + 0.3, pelvisPitch: -Math.PI / 2, spinePitch: 0, headPitch: 0, headYaw: 0.3,
      footL: [b.hipW, 0.3 + b.footH, -(b.thigh + b.shin)], footR: [-b.hipW, 0.3 + b.footH, -(b.thigh + b.shin)], armL: [0.1, 0.15, 0, 0.3], armR: [0.1, 0.15, 0, 0.3] }
    case 'hold_baby': {
      // cradling a baby across the chest, rocking gently, head bent toward the baby
      const rock = Math.sin(t * 1.6 + s) * 0.06
      return { ...stand, pelvisRoll: rock * 0.5, spineRoll: -rock, spinePitch: 0.05 + stoop, headPitch: 0.35, headYaw: Math.sin(t * 0.3 + s) * 0.25,
        // upper arms hang a little forward, forearms come across the belly toward each other: a cradle, not a guard
        armL: [0.35, -0.05, -0.65, 1.3], armR: [0.3, -0.05, -0.55, 1.4] }
    }
    case 'held': return { ...stand, pelvisY: b.hipH, spinePitch: -0.25, headPitch: -0.1, footL: [b.hipW, b.footH, 0.05], footR: [-b.hipW, b.footH, 0.05], armL: [0.6, 0.3, 0, 0.8], armR: [0.6, 0.3, 0, 0.8] }
    case 'talk': {
      // facing someone, one hand gesturing on the beat of the conversation, head nodding a little
      const beat = Math.max(0, Math.sin(t * 1.9 + s)) ** 2
      return { ...stand, headYaw: Math.sin(t * 0.4 + s) * 0.12, headPitch: -0.03 + Math.sin(t * 2.3 + s) * 0.04,
        armR: [0.35 + beat * 0.45, 0.2, -0.2, 1.1 + beat * 0.4], armL: [0.05 + (Math.sin(t * 0.7 + s) > 0.6 ? 0.5 : 0), 0.12, 0, 0.3] }
    }
    case 'phone': return { ...stand, headPitch: 0.45, armR: [0.75, 0.05, -0.35, 1.8], armL: [0.05, 0.12, 0, 0.25] }
    case 'cook': { const st = Math.sin(t * 3 + s); return { ...stand, spinePitch: 0.18 + stoop, headPitch: 0.45, armR: [0.8 + st * 0.15, -0.1, -0.25, 1.2], armL: [0.6, 0.0, 0.2, 1.0] } }
    case 'sweep': { const sw = Math.sin(t * 2.4 + s); return { ...stand, spinePitch: 0.38 + stoop, spineYaw: sw * 0.2, headPitch: 0.3, armR: [0.7 + sw * 0.25, -0.15, -0.3 + sw * 0.2, 0.6], armL: [0.9 + sw * 0.25, -0.1, 0.3 + sw * 0.2, 0.5] } }
    case 'carry_head': return { ...stand, headPitch: -0.04, armL: [Math.PI * 0.9, 0.25, 0, 0.6], armR: [0.05, 0.12, 0, 0.2] } // one hand steadies the basin on her head
    case 'work': { const w = Math.sin(t * 4 + s) * 0.2; return { ...stand, spinePitch: 0.22 + stoop, headPitch: 0.4, armR: [0.9 + w, -0.1, -0.2, 1.1], armL: [0.9 - w, -0.1, 0.2, 1.1] } }
    case 'type': { const f = Math.sin(t * 9 + s) * 0.05; const h = seatH || b.thigh * 1.05; return { ...poseFor(b, 'sit', t, seed, mood, h), spinePitch: 0.15, headPitch: 0.3, armL: [1.0 + f, -0.05, 0.25, 1.35], armR: [1.0 - f, -0.05, -0.25, 1.35] } }
    case 'hug': return { ...stand, spinePitch: 0.1, headPitch: 0.1, armL: [1.3, 0.35, 0.4, 1.0], armR: [1.3, 0.35, -0.4, 1.0] }
    case 'wave': { const w = Math.sin(t * 7 + s); return { ...stand, armR: [Math.PI * 0.8, 0.5, 0, 0.6 + w * 0.4], headYaw: 0 } }
    case 'play': { const j = Math.abs(Math.sin(t * 5 + s)); return { ...stand, pelvisY: b.hipH + j * b.H * 0.06, armL: [0.5 + j, 0.6, 0, 0.5], armR: [0.5 + j, 0.6, 0, 0.5] } }
    case 'pray': return { ...poseFor(b, 'sit', t, seed, mood, seatH), headPitch: 0.5, armL: [0.9, -0.3, 0.5, 1.6], armR: [0.9, -0.3, -0.5, 1.6] }
  }
}

// ---------- the walk ----------
// phase is in cycles (0..1 = two steps), advanced by distance / stride. mood bends the walk: kids bounce, elders take
// short careful steps, the tired drag their feet, the hurried lean forward
export function gait(b: Body, phase: number, mood: Mood, t: number, seed: number): Pose {
  const kid = b.age < 13, old = b.age > 68
  const lift = b.H * (kid ? 0.08 : old ? 0.045 : 0.055) * (1 - mood.tired * 0.4)
  const bob = b.H * (kid ? 0.03 : old ? 0.01 : 0.018)
  const C = b.stride
  // the ankle offset that keeps the toes planted when the foot pitches toes-down by `toe` (negative)
  const roll = (toe: number) => (toe < 0 ? { y: -Math.sin(toe) * b.footL, z: b.footL * (1 - Math.cos(toe)) } : { y: 0, z: 0 })
  const leg = (p: number): [[number, number, number], number] => {
    p = ((p % 1) + 1) % 1
    if (p < 0.6) {
      // stance: planted. relative to the hip the foot slides back exactly as fast as the body moves forward
      const s = p / 0.6
      const z = C * 0.3 * (1 - 2 * s)
      const toe = s < 0.15 ? 0.25 * (1 - s / 0.15) : s > 0.75 ? -0.5 * ((s - 0.75) / 0.25) : 0 // heel strike, flat, toe-off
      // toe-off pivots on the toes: the heel rises and the ankle rolls forward, so the toes stay on the ground where
      // they are instead of dipping into it
      return [[0, b.footH + roll(toe).y, z + roll(toe).z], toe]
    }
    const s = (p - 0.6) / 0.4 // swing: lift on an arc, reach forward, land heel first
    // the swing leaves and lands at ground speed (moving back under the body exactly as the stance foot does), so the
    // foot is never dragged at lift-off or skidding at touch-down: a cubic with matched end speeds
    const s2 = s * s, s3 = s2 * s, m = -0.4 * C
    const z = (2 * s3 - 3 * s2 + 1) * (-0.3 * C) + (s3 - 2 * s2 + s) * m + (-2 * s3 + 3 * s2) * (0.3 * C) + (s3 - s2) * m
    const toe = -0.5 * Math.max(0, 1 - s / 0.25) + 0.25 * Math.max(0, (s - 0.6) / 0.4) // continues the toe-off, then heel first
    return [[0, b.footH + roll(toe).y + lift * Math.sin(Math.PI * s), z], toe] // the toes clear the ground as the foot swings
  }
  const [fl, tl] = leg(phase), [fr, tr] = leg(phase + 0.5)
  fl[0] = b.hipW * 1.05; fr[0] = -b.hipW * 1.05
  const w = Math.PI * 2 * phase
  const swing = 0.45 * (kid ? 1.2 : old ? 0.5 : 1) * (1 - mood.tired * 0.4)
  const lean = 0.06 + mood.hurry * 0.18 + (old ? 0.22 : 0) + mood.sad * 0.12
  return {
    // the body is highest over the planted foot, twice per cycle
    // knees stay a little bent while walking; the body is highest at mid-stance (phase 0.3 and 0.8), lowest at heel strike
    pelvisY: b.hipH - b.H * 0.035 + bob * Math.cos(2 * (w - Math.PI * 2 * 0.3)),
    pelvisPitch: 0, pelvisYaw: 0.14 * Math.sin(w) * (old ? 0.5 : 1), pelvisRoll: 0.04 * Math.sin(w),
    spinePitch: lean, spineYaw: -0.24 * Math.sin(w) * (old ? 0.5 : 1), spineRoll: -0.03 * Math.sin(w),
    headPitch: mood.sad * 0.25 + mood.tired * 0.15 - 0.02, headYaw: Math.sin(t * 0.21 + seed) * 0.25,
    footL: fl, footR: fr, toeL: tl, toeR: tr,
    // arms swing opposite to their legs (left arm forward with the right leg), elbows bend more on the forward swing
    armL: [-swing * Math.sin(w), 0.1, 0, 0.25 + 0.3 * Math.max(0, -Math.sin(w))],
    armR: [swing * Math.sin(w), 0.1, 0, 0.25 + 0.3 * Math.max(0, Math.sin(w))],
  }
}

// ---------- solving the skeleton ----------
// output: one box per bone (from a to b, width, depth) in body-local space, plus the head and torso frames
export type Bone = { a: THREE.Vector3; b: THREE.Vector3; w: number; d: number }
export type Solved = { pelvis: THREE.Vector3; neck: THREE.Vector3; spine: THREE.Quaternion; head: THREE.Quaternion; headPos: THREE.Vector3; torso: Bone; bones: Bone[]; hands: [THREE.Vector3, THREE.Vector3]; chest: THREE.Vector3 }

const V = () => new THREE.Vector3()
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = V(), _v2 = V(), _n = V(), _f = new THREE.Vector3(0, 0, 1), _x = new THREE.Vector3(1, 0, 0)
export function makeSolved(): Solved {
  const bone = (): Bone => ({ a: V(), b: V(), w: 0, d: 0 })
  return { pelvis: V(), neck: V(), spine: new THREE.Quaternion(), head: new THREE.Quaternion(), headPos: V(), torso: bone(), bones: Array.from({ length: 10 }, bone), hands: [V(), V()], chest: V() }
}

export function solve(b: Body, p: Pose, out: Solved): Solved {
  // pelvis and spine
  out.pelvis.set(0, p.pelvisY, 0)
  const pelvisQ = _q.setFromEuler(_e.set(p.pelvisPitch, p.pelvisYaw, p.pelvisRoll, 'YXZ'))
  out.spine.copy(pelvisQ).multiply(_q2.setFromEuler(_e.set(p.spinePitch, p.spineYaw, p.spineRoll, 'YXZ')))
  out.neck.set(0, b.torso, 0).applyQuaternion(out.spine).add(out.pelvis)
  out.torso.a.copy(out.pelvis); out.torso.b.copy(out.neck); out.torso.w = b.torsoW; out.torso.d = b.torsoD
  out.chest.set(0, b.torso * 0.7, b.torsoD * 0.6).applyQuaternion(out.spine).add(out.pelvis)
  out.head.copy(out.spine).multiply(_q2.setFromEuler(_e.set(p.headPitch, p.headYaw, 0, 'YXZ')))
  out.headPos.set(0, b.headH * 0.55, 0).applyQuaternion(out.head).add(out.neck)
  // legs: two-bone ik from the hip joint to the foot target
  const legs: [number, [number, number, number], number][] = [[1, p.footL, p.toeL], [-1, p.footR, p.toeR]]
  legs.forEach(([side, foot, toe], i) => {
    const hip = _v.set(side * b.hipW, 0, 0).applyQuaternion(pelvisQ).add(out.pelvis)
    const target = _v2.set(foot[0], foot[1], foot[2])
    const toT = target.clone().sub(hip)
    const reach = b.thigh + b.shin - 1e-4
    let d = toT.length()
    if (d > reach) { toT.setLength(reach); d = reach }
    if (d < 1e-4) { toT.set(0, -1e-3, 0); d = 1e-3 }
    const dir = toT.clone().normalize()
    const cosA = Math.max(-1, Math.min(1, (b.thigh * b.thigh + d * d - b.shin * b.shin) / (2 * b.thigh * d)))
    // the knee bends forward: rotate the hip-to-foot direction toward +z (around the axis dir x forward)
    _n.crossVectors(dir, _f.set(0, 0, 1))
    if (_n.lengthSq() < 1e-6) _n.copy(_x)
    _n.normalize()
    const knee = dir.clone().applyAxisAngle(_n, Math.acos(cosA)).multiplyScalar(b.thigh).add(hip)
    const ankle = hip.clone().add(toT)
    const thigh = out.bones[i * 3], shin = out.bones[i * 3 + 1], footB = out.bones[i * 3 + 2]
    thigh.a.copy(hip); thigh.b.copy(knee); thigh.w = b.limb * 1.25; thigh.d = b.limb * 1.25
    shin.a.copy(knee); shin.b.copy(ankle); shin.w = b.limb * 1.05; shin.d = b.limb * 1.05
    footB.a.copy(ankle).add(_v.set(0, -b.footH * 0.5, -b.footL * 0.2))
    footB.b.copy(footB.a).add(_v.set(0, Math.sin(toe) * b.footL, Math.cos(toe) * b.footL))
    footB.w = b.limb * 1.15; footB.d = b.footH * 1.1
  })
  // arms: forward kinematics from the shoulders
  const arms: [number, [number, number, number, number]][] = [[1, p.armL], [-1, p.armR]]
  arms.forEach(([side, [pitch, roll, yaw, elbow]], i) => {
    const shoulder = _v.set(side * b.shoulderW, b.torso * 0.86, 0).applyQuaternion(out.spine).add(out.pelvis).clone()
    const armQ = out.spine.clone().multiply(_q2.setFromEuler(_e.set(-pitch, side * yaw, side * roll, 'YXZ')))
    const elbowP = new THREE.Vector3(0, -b.upper, 0).applyQuaternion(armQ).add(shoulder)
    const foreQ = armQ.clone().multiply(_q2.setFromEuler(_e.set(-elbow, 0, 0)))
    const hand = new THREE.Vector3(0, -b.fore, 0).applyQuaternion(foreQ).add(elbowP)
    const up = out.bones[6 + i * 2], fo = out.bones[7 + i * 2]
    up.a.copy(shoulder); up.b.copy(elbowP); up.w = b.limb; up.d = b.limb
    fo.a.copy(elbowP); fo.b.copy(hand); fo.w = b.limb * 0.92; fo.d = b.limb * 0.92
    out.hands[i].copy(hand)
  })
  return out
}

// a box from a to b as a matrix (unit box geometry, centered), composed with the root
const _m = new THREE.Matrix4(), _pos = V(), _scl = V(), _y = new THREE.Vector3(0, 1, 0)
export function boneMatrix(root: THREE.Matrix4, bone: Bone, out: THREE.Matrix4, lenPad = 0): THREE.Matrix4 {
  _v.subVectors(bone.b, bone.a)
  const len = _v.length()
  _q.setFromUnitVectors(_y, len > 1e-6 ? _v.divideScalar(len) : _y)
  _pos.addVectors(bone.a, bone.b).multiplyScalar(0.5)
  _scl.set(bone.w, len + lenPad, bone.d)
  _m.compose(_pos, _q, _scl)
  return out.multiplyMatrices(root, _m)
}

// ---------- arm ik: hands to a target (holding a baby, carrying something) ----------
// two-bone analytic ik from the shoulder to a body-local target; the elbow bends down and out (a pole below and to
// the side), the way arms wrap under a held baby. overwrites the arm's bones and hand from solve().
const _s = V(), _t = V(), _pole = V(), _e2 = V()
export function reachArm(b: Body, out: Solved, i: 0 | 1, target: THREE.Vector3) {
  const side = i === 0 ? 1 : -1
  _s.set(side * b.shoulderW, b.torso * 0.86, 0).applyQuaternion(out.spine).add(out.pelvis)
  _t.copy(target).sub(_s)
  const reach = b.upper + b.fore - 1e-4
  let d = _t.length()
  if (d > reach) { _t.setLength(reach); d = reach }
  if (d < 1e-3) { _t.set(0, -1e-3, 0); d = 1e-3 }
  const dir = _t.clone().normalize()
  const cosA = Math.max(-1, Math.min(1, (b.upper * b.upper + d * d - b.fore * b.fore) / (2 * b.upper * d)))
  // pole: down, out to this side, a little back; the elbow goes toward it
  _pole.set(side * 0.7, -1, -0.3).normalize()
  _n.crossVectors(dir, _pole)
  if (_n.lengthSq() < 1e-6) _n.copy(_x)
  _n.normalize()
  // rotate dir toward the pole by the shoulder angle
  _e2.copy(dir).applyAxisAngle(_n, -Math.acos(cosA)).multiplyScalar(b.upper).add(_s)
  // pick the solution whose elbow is nearer the pole side
  const alt = dir.clone().applyAxisAngle(_n, Math.acos(cosA)).multiplyScalar(b.upper).add(_s)
  const elbow = alt.clone().sub(_s).dot(_pole) > _e2.clone().sub(_s).dot(_pole) ? alt : _e2.clone()
  const hand = _s.clone().add(_t)
  const up = out.bones[6 + i * 2], fo = out.bones[7 + i * 2]
  up.a.copy(_s); up.b.copy(elbow); up.w = b.limb; up.d = b.limb
  fo.a.copy(elbow); fo.b.copy(hand); fo.w = b.limb * 0.92; fo.d = b.limb * 0.92
  out.hands[i].copy(hand)
}

// where a held baby lies in the carrier's arms (body-local to the carrier): in front of the chest, clear of the
// body, at forearm height; the left hand under the head end, the right under the bottom. the baby is given by its
// own body (length and swaddle depth), so a bigger baby sits further out and lower
export function cradleFor(carrier: Body, out: Solved, baby: Body) {
  const half = baby.torsoD * 1.2 // the swaddle's half-depth (ChosenPerson draws it torsoD * 2.4 deep)
  const shoulderY = carrier.torso * 0.86
  const center = V().set(0, shoulderY - carrier.upper * 0.75, carrier.torsoD * 0.5 + half + 0.015).applyQuaternion(out.spine).add(out.pelvis)
  const under = V().set(0, -half * 0.9, 0)
  const hl = V().set(baby.H * 0.3, 0, 0).applyQuaternion(out.spine).add(center).add(under)
  const hr = V().set(-baby.H * 0.28, 0, 0).applyQuaternion(out.spine).add(center).add(under)
  return { center, hl, hr }
}

// a body's footprint on the ground: half the arm span (shoulders plus the upper arms) by half the depth of the body
// (the torso, a little more for the feet). people clip when these oriented rectangles overlap
export const footprint = (b: Body) => ({ hw: b.shoulderW + b.limb * 0.5, hd: Math.max(b.torsoD * 0.5, b.footL * 0.45) + 0.01 })
// penetration of two oriented footprints (separating-axis test in 2d); 0 when apart
// pad: extra clearance on every side (people keep a few cm between them; the checker uses 0)
export function footOverlap(ax: number, az: number, ah: number, a: Body, bx: number, bz: number, bh: number, b: Body, pad = 0): number {
  const fa0 = footprint(a), fb0 = footprint(b)
  const fa = { hw: fa0.hw + pad, hd: fa0.hd + pad }, fb = { hw: fb0.hw + pad, hd: fb0.hd + pad }
  const axes = [[Math.cos(ah), -Math.sin(ah)], [Math.sin(ah), Math.cos(ah)], [Math.cos(bh), -Math.sin(bh)], [Math.sin(bh), Math.cos(bh)]]
  const dx = bx - ax, dz = bz - az
  let min = Infinity
  for (const [x, z] of axes) {
    const ra = fa.hw * Math.abs(Math.cos(ah) * x - Math.sin(ah) * z) + fa.hd * Math.abs(Math.sin(ah) * x + Math.cos(ah) * z)
    const rb = fb.hw * Math.abs(Math.cos(bh) * x - Math.sin(bh) * z) + fb.hd * Math.abs(Math.sin(bh) * x + Math.cos(bh) * z)
    const pen = ra + rb - Math.abs(dx * x + dz * z)
    if (pen <= 0) return 0
    min = Math.min(min, pen)
  }
  return min
}
