'use client'
// the chosen person: the main site's pip (src/components/world/pipShared, read-only) with a detailed face rig on top.
// eyes blink and look, brows and a chunky mouth are driven by facs action units (./facs.ts), plus tears, blush,
// sweat, tired lids with bags, and wrinkles + gray hair with age. every value eases, nothing snaps.
// only this one person gets the rig, so it can afford per-part meshes at 60fps.
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { P, buildW, shoulderX, partGeometries, hairGeometries } from '@/components/world/pipShared'
import { C, HAIR_HEX, MONK, toonGradient } from '@/components/world/lib'
import type { Look } from '@/lib/life/types'
import { FLINCH, moodToAUs, zeroAUs, AUS, type AUs } from './facs'
import { grayShare, heightShare } from './day'
import type { Emotion } from '@/lib/types'

// what the scene tells the rig every frame (a mutable object, so react never re-renders per frame)
export type LiveState = {
  pos: THREE.Vector3; heading: number; walking: boolean; act: string
  mood: Record<string, number>; fatigue: number; age: number; heat: number
  flinch: { emotion: Emotion; at: number } | null
  gaze: THREE.Vector3 | null // world point to look at (someone talking, a kid), or null
  hug: number // 0..1 arms out toward someone
  // written back by the rig
  head: THREE.Vector3; forward: THREE.Vector3
}

export const PERSON_SCALE = 1.45 // pip units (adult ~1.1) to diorama units, so an adult stands ~1.6 like the city pips

const toon = (color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra })
const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt))

export default function ChosenPerson({ look, live, cloth }: { look: Look; live: React.RefObject<LiveState>; cloth: string }) {
  const parts = useMemo(() => partGeometries(), [])
  const hair = useMemo(() => hairGeometries()[look.hair], [look.hair])
  const g = useMemo(() => ({
    lid: new THREE.BoxGeometry(0.07, 0.06, 0.016),
    lowLid: new THREE.BoxGeometry(0.066, 0.03, 0.014),
    mouthMid: new THREE.BoxGeometry(0.05, 0.02, 0.018),
    mouthCorner: new THREE.BoxGeometry(0.032, 0.017, 0.018),
    mouthInner: new THREE.BoxGeometry(0.06, 0.04, 0.01),
    tear: new THREE.SphereGeometry(0.012, 8, 6),
    blush: new THREE.CircleGeometry(0.03, 16),
    sweat: (() => { const s = new THREE.SphereGeometry(0.016, 8, 6); s.scale(1, 1.5, 1); return s })(),
    bag: new THREE.BoxGeometry(0.06, 0.012, 0.01),
    line: new THREE.BoxGeometry(0.07, 0.006, 0.006),
  }), [])
  const skinHex = MONK[Math.max(0, Math.min(9, look.skinTone - 1))]
  const m = useMemo(() => ({
    skin: toon(skinHex), cloth: toon(cloth), legs: toon(new THREE.Color(cloth).multiplyScalar(0.62)), hair: toon(HAIR_HEX[look.hairColor] ?? '#2a221c'),
    eye: toon(C.ink), brow: toon(new THREE.Color(HAIR_HEX[look.hairColor] ?? '#2a221c').multiplyScalar(0.8)),
    lid: toon(new THREE.Color(skinHex).multiplyScalar(0.94)), mouth: toon('#3b2724'), inner: toon('#5a2f2c'),
    tear: new THREE.MeshBasicMaterial({ color: '#9fd3ee', transparent: true, opacity: 0 }),
    blush: new THREE.MeshBasicMaterial({ color: '#e88a86', transparent: true, opacity: 0, depthWrite: false }),
    sweat: new THREE.MeshBasicMaterial({ color: '#bfe6f5', transparent: true, opacity: 0 }),
    bag: new THREE.MeshBasicMaterial({ color: new THREE.Color(skinHex).multiplyScalar(0.7), transparent: true, opacity: 0 }),
    line: new THREE.MeshBasicMaterial({ color: new THREE.Color(skinHex).multiplyScalar(0.72), transparent: true, opacity: 0 }),
  }), [skinHex, cloth, look.hairColor])
  const baseHair = useMemo(() => new THREE.Color(HAIR_HEX[look.hairColor] ?? '#2a221c'), [look.hairColor])
  const gray = useMemo(() => new THREE.Color('#c9c4bb'), [])

  const R = {
    root: useRef<THREE.Group>(null), hip: useRef<THREE.Group>(null), neck: useRef<THREE.Group>(null), headScale: useRef<THREE.Group>(null),
    armL: useRef<THREE.Group>(null), armR: useRef<THREE.Group>(null), legL: useRef<THREE.Group>(null), legR: useRef<THREE.Group>(null),
    eyeL: useRef<THREE.Mesh>(null), eyeR: useRef<THREE.Mesh>(null), lidL: useRef<THREE.Mesh>(null), lidR: useRef<THREE.Mesh>(null),
    lowL: useRef<THREE.Mesh>(null), lowR: useRef<THREE.Mesh>(null), browL: useRef<THREE.Mesh>(null), browR: useRef<THREE.Mesh>(null),
    mMid: useRef<THREE.Mesh>(null), mL: useRef<THREE.Mesh>(null), mR: useRef<THREE.Mesh>(null), mIn: useRef<THREE.Mesh>(null),
    tearL: useRef<THREE.Mesh>(null), tearR: useRef<THREE.Mesh>(null), sweat: useRef<THREE.Mesh>(null),
  }
  const st = useRef({ aus: zeroAUs(), gazeX: 0, gazeY: 0, headYaw: 0, headPitch: 0, blinkAt: 2, blinkPhase: 0, tear: 0, walk: 0, lastX: 0, lastZ: 0, speed: 0 })
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4() }), [])

  useFrame(({ clock }, rawDt) => {
    const L = live.current
    if (!L || !R.root.current) return
    const dt = Math.min(rawDt, 0.05)
    const t = clock.elapsedTime
    const s = st.current

    // ---- body: size by age, walk cycle, idle sway ----
    const share = heightShare(L.age)
    const kid = L.age < 14
    const scale = PERSON_SCALE * (look.adultHeightCm / 170) * share
    const root = R.root.current
    root.position.copy(L.pos)
    root.rotation.y = L.heading
    root.scale.setScalar(scale)
    const moved = Math.hypot(L.pos.x - s.lastX, L.pos.z - s.lastZ) / Math.max(dt, 1e-3)
    s.lastX = L.pos.x; s.lastZ = L.pos.z
    s.speed = damp(s.speed, Math.min(moved, 4), 8, dt)
    const walking = L.walking || s.speed > 0.3
    s.walk += dt * (walking ? 9 : 0)
    const sw = walking ? Math.sin(s.walk) : 0
    const bw = buildW(look.build)
    const sitting = L.act === 'sit' || L.act === 'rest'
    const sleeping = L.act === 'sleep'
    const age = L.age
    const stoop = age > 70 ? Math.min(0.25, (age - 70) * 0.01) : 0
    const sad = L.mood.grief ?? 0
    R.hip.current!.position.y = sitting ? P.hipY * 0.55 : P.hipY + (walking ? Math.abs(Math.cos(s.walk)) * 0.02 : Math.sin(t * 1.6) * 0.004)
    R.hip.current!.rotation.x = sleeping ? -1.45 : stoop + sad * 0.12 + (walking ? 0.05 : 0)
    R.legL.current!.rotation.x = sitting ? -1.4 : sw * 0.55
    R.legR.current!.rotation.x = sitting ? -1.4 : -sw * 0.55
    const hug = L.hug
    R.armL.current!.rotation.x = -sw * 0.5 - hug * 1.3 + (sitting ? -0.4 : 0)
    R.armR.current!.rotation.x = sw * 0.5 - hug * 1.3 + (sitting ? -0.4 : 0)
    R.armL.current!.rotation.z = 0.08 + hug * 0.35
    R.armR.current!.rotation.z = -0.08 - hug * 0.35
    R.armL.current!.position.x = shoulderX(bw)
    R.armR.current!.position.x = -shoulderX(bw)

    // ---- face: mood + fatigue -> action units, with a flinch on news ----
    const { aus: target, gaze } = moodToAUs(L.mood as Partial<Record<Emotion, number>>, L.fatigue)
    if (L.flinch) {
      const k = (t - L.flinch.at) / 0.6
      if (k >= 0 && k < 1) {
        const f = FLINCH[L.flinch.emotion] ?? {}
        const w = Math.sin(Math.PI * k) // in and out
        for (const a of AUS) target[a] = Math.max(target[a], (f[a] ?? 0) * w)
      }
    }
    // older faces move a little slower (ESTIMATE), every value eases toward its target
    const rate = 6 - Math.min(2.5, Math.max(0, age - 50) * 0.05)
    for (const a of AUS) s.aus[a] = damp(s.aus[a], target[a], rate, dt)
    const A: AUs = s.aus

    // gaze: toward whoever they are with, else down when sad and up when hopeful
    let gx = 0, gy = gaze * 0.6
    let wantYaw = 0, wantPitch = -gaze * 0.18
    if (L.gaze && R.neck.current) {
      R.neck.current.getWorldPosition(tmp.v)
      const dx = L.gaze.x - tmp.v.x, dz = L.gaze.z - tmp.v.z, dy = L.gaze.y - tmp.v.y
      const yaw = Math.atan2(dx, dz) - L.heading
      const wrapped = Math.atan2(Math.sin(yaw), Math.cos(yaw))
      wantYaw = Math.max(-0.9, Math.min(0.9, wrapped))
      gx = Math.max(-1, Math.min(1, (wrapped - wantYaw) * 2 + wantYaw * 0.4))
      wantPitch = -Math.max(-0.4, Math.min(0.4, Math.atan2(dy, Math.hypot(dx, dz))))
      gy = -wantPitch * 1.5
    }
    s.headYaw = damp(s.headYaw, wantYaw, 4, dt)
    s.headPitch = damp(s.headPitch, wantPitch + (sleeping ? 0 : 0), 4, dt)
    s.gazeX = damp(s.gazeX, gx, 10, dt)
    s.gazeY = damp(s.gazeY, gy, 10, dt)
    R.neck.current!.rotation.set(s.headPitch, s.headYaw, Math.sin(t * 0.7) * 0.02)
    R.headScale.current!.scale.setScalar(kid ? 1.3 - Math.max(0, age - 6) * 0.02 : 1)

    // blinks: ~15-20 a minute (bentivoglio et al. 1997, https://doi.org/10.1002/mds.870120629), longer in old age
    if (t > s.blinkAt) { s.blinkPhase = 1; s.blinkAt = t + 2.2 + ((Math.sin(t * 12.9898) * 43758.5453) % 1 + 1) % 1 * 3.5 }
    const blinkDur = 0.14 + Math.max(0, age - 60) * 0.003
    s.blinkPhase = Math.max(0, s.blinkPhase - dt / blinkDur)
    const blink = s.blinkPhase > 0 ? Math.sin(Math.PI * (1 - s.blinkPhase)) : 0
    const close = sleeping ? 1 : Math.min(1, Math.max(blink, A.au43 * 0.9))
    const open = 1 + 0.35 * A.au5 // upper lid raiser shows more eye
    for (const [eye, lid, low, sx] of [[R.eyeL, R.lidL, R.lowL, 1], [R.eyeR, R.lidR, R.lowR, -1]] as const) {
      eye.current!.position.set(sx * 0.06 + s.gazeX * 0.012, 0.02 + s.gazeY * 0.01, 0.131)
      eye.current!.scale.set(1, (1 - close * 0.92) * open * (1 - A.au7 * 0.3 - A.au6 * 0.2), 1)
      // upper lid comes down to close; tilted down at the inner end in anger, the outer end in sadness
      lid.current!.position.set(sx * 0.06, 0.02 + 0.06 - close * 0.045 - A.au7 * 0.01 + A.au5 * 0.008, 0.138)
      lid.current!.rotation.z = sx * (0.35 * A.au4 - 0.3 * A.au1)
      lid.current!.scale.y = 0.4 + close * 0.6
      // lower lid rises with a real smile (au6) and narrowing (au7)
      low.current!.position.set(sx * 0.06, 0.02 - 0.04 + (A.au6 + A.au7) * 0.012, 0.137)
      low.current!.scale.y = 0.4 + (A.au6 + A.au7) * 0.6
    }
    // brows: inner raise (au1), outer raise (au2), lower + pull together (au4)
    for (const [brow, sx] of [[R.browL, 1], [R.browR, -1]] as const) {
      const b = brow.current!
      b.position.set(sx * (0.065 - A.au4 * 0.012), 0.088 + 0.018 * (A.au1 + A.au2) / 2 - 0.016 * A.au4, 0.135)
      b.rotation.z = sx * (0.4 * A.au2 - 0.5 * A.au1 + 0.35 * A.au4)
    }
    // mouth: three chunky segments. corners up (au12) or down (au15), one side tucked (au14), stretched (au20),
    // pressed or tight (au23/24), open (au25/26). trembles when crying
    const cry = sad > 0.65 || (L.flinch?.emotion === 'grief' && t - L.flinch.at < 3)
    const tremble = cry ? Math.sin(t * 38) * 0.003 : 0
    const cornerY = 0.016 * A.au12 - 0.016 * A.au15 - 0.004 * A.au20
    const wide = 0.04 + 0.012 * A.au20 + 0.006 * A.au12 - 0.008 * A.au24
    const openY = Math.max(A.au25 * 0.5, A.au26)
    const pressed = Math.max(A.au23, A.au24)
    const my = -0.07 - openY * 0.006 + 0.004 * A.au17
    R.mMid.current!.position.set(0, my + tremble, 0.131)
    R.mMid.current!.scale.set(1 - A.au20 * 0.1 + A.au12 * 0.15, 1 - pressed * 0.45, 1)
    R.mL.current!.position.set(wide, my + cornerY + tremble, 0.13)
    R.mR.current!.position.set(-wide, my + cornerY - 0.01 * A.au14 + tremble, 0.13)
    R.mL.current!.rotation.z = Math.atan2(cornerY, 0.03) * 1.2
    R.mR.current!.rotation.z = -Math.atan2(cornerY - 0.01 * A.au14, 0.03) * 1.2
    R.mIn.current!.position.set(0, my - 0.012 * openY, 0.127)
    R.mIn.current!.scale.set(0.6 + 0.4 * openY + 0.2 * A.au20, 0.15 + openY, 1)
    R.mIn.current!.visible = openY > 0.12

    // extras
    s.tear = damp(s.tear, cry ? 1 : 0, 2, dt)
    for (const [tear, sx, ph] of [[R.tearL, 1, 0], [R.tearR, -1, 0.5]] as const) {
      const k = ((t * 0.5 + ph) % 1)
      tear.current!.position.set(sx * 0.07, -0.005 - k * 0.09, 0.136)
    }
    m.tear.opacity = s.tear * 0.85
    // blushing shows less on darker skin, so it fades with the monk tone instead of turning muddy
    const blushK = 1 - (look.skinTone - 1) / 12
    m.blush.opacity = damp(m.blush.opacity, blushK * Math.min(0.5, 0.45 * Math.max(0, (L.mood.joy ?? 0) - 0.55) * 2 + 0.3 * (L.mood.pride ?? 0) + 0.2 * L.heat), 2, dt)
    m.sweat.opacity = damp(m.sweat.opacity, Math.max(L.heat > 0.5 ? 0.8 : 0, (L.mood.fear ?? 0) > 0.6 ? 0.8 : 0), 2, dt)
    R.sweat.current!.position.set(0.13, 0.075 - ((t * 0.25) % 1) * 0.06, 0.07)
    m.bag.opacity = damp(m.bag.opacity, Math.min(0.75, L.fatigue * 0.9), 1.5, dt)
    m.line.opacity = Math.min(0.8, Math.max(0, (age - 42) / 30))
    m.hair.color.copy(baseHair).lerp(gray, grayShare(age))
    m.brow.color.copy(baseHair).multiplyScalar(0.8).lerp(gray, grayShare(age) * 0.7)

    // camera hooks
    R.neck.current!.getWorldPosition(L.head)
    L.head.y += 0.15 * scale
    L.forward.set(Math.sin(L.heading), 0, Math.cos(L.heading))
  })

  const lineAt = (x: number, y: number, rz = 0, w = 1) => <mesh geometry={g.line} material={m.line} position={[x, y, 0.132]} rotation={[0, 0, rz]} scale={[w, 1, 1]} />
  return (
    <group ref={R.root}>
      <group ref={R.hip}>
        <mesh geometry={parts.torso} material={m.cloth} position={[0, P.torsoCenter, 0]} scale={[buildW(look.build), 1, buildW(look.build) * 0.85]} castShadow />
        <group ref={R.armL} position={[shoulderX(buildW(look.build)), P.shoulderY, 0]}>
          <mesh geometry={parts.limbArm} material={m.cloth} position={[0, P.armCenter, 0]} castShadow />
          <mesh geometry={parts.hand} material={m.skin} position={[0, P.handY, 0]} />
        </group>
        <group ref={R.armR} position={[-shoulderX(buildW(look.build)), P.shoulderY, 0]}>
          <mesh geometry={parts.limbArm} material={m.cloth} position={[0, P.armCenter, 0]} castShadow />
          <mesh geometry={parts.hand} material={m.skin} position={[0, P.handY, 0]} />
        </group>
        <group ref={R.neck} position={[0, P.neckY, 0]}>
          <group ref={R.headScale}>
            <group position={[0, P.headCenter, 0]}>
              <mesh geometry={parts.head} material={m.skin} castShadow />
              {/* eyes, lids, brows */}
              <mesh ref={R.eyeL} geometry={parts.eye} material={m.eye} />
              <mesh ref={R.eyeR} geometry={parts.eye} material={m.eye} />
              <mesh ref={R.lidL} geometry={g.lid} material={m.lid} />
              <mesh ref={R.lidR} geometry={g.lid} material={m.lid} />
              <mesh ref={R.lowL} geometry={g.lowLid} material={m.lid} />
              <mesh ref={R.lowR} geometry={g.lowLid} material={m.lid} />
              <mesh ref={R.browL} geometry={parts.brow} material={m.brow} />
              <mesh ref={R.browR} geometry={parts.brow} material={m.brow} />
              {/* mouth */}
              <mesh ref={R.mIn} geometry={g.mouthInner} material={m.inner} />
              <mesh ref={R.mMid} geometry={g.mouthMid} material={m.mouth} />
              <mesh ref={R.mL} geometry={g.mouthCorner} material={m.mouth} />
              <mesh ref={R.mR} geometry={g.mouthCorner} material={m.mouth} />
              {/* tears, blush, sweat, tired bags, wrinkles */}
              <mesh ref={R.tearL} geometry={g.tear} material={m.tear} />
              <mesh ref={R.tearR} geometry={g.tear} material={m.tear} />
              <mesh geometry={g.blush} material={m.blush} position={[0.085, -0.035, 0.1305]} />
              <mesh geometry={g.blush} material={m.blush} position={[-0.085, -0.035, 0.1305]} />
              <mesh ref={R.sweat} geometry={g.sweat} material={m.sweat} />
              <mesh geometry={g.bag} material={m.bag} position={[0.06, -0.026, 0.1315]} />
              <mesh geometry={g.bag} material={m.bag} position={[-0.06, -0.026, 0.1315]} />
              {lineAt(0, 0.112)}{lineAt(0, 0.124, 0, 0.8)}
              {lineAt(0.112, 0.03, 0.5, 0.3)}{lineAt(-0.112, 0.03, -0.5, 0.3)}
            </group>
            {hair && <mesh geometry={hair} material={m.hair} castShadow />}
          </group>
        </group>
      </group>
      <group ref={R.legL} position={[P.hipX, P.hipY, 0]}>
        <mesh geometry={parts.limbLeg} material={m.legs} position={[0, P.legCenter + 0.03, 0]} castShadow />
        <mesh geometry={parts.foot} material={m.legs} position={[0, -P.hipY + 0.035, 0.03]} />
      </group>
      <group ref={R.legR} position={[-P.hipX, P.hipY, 0]}>
        <mesh geometry={parts.limbLeg} material={m.legs} position={[0, P.legCenter + 0.03, 0]} castShadow />
        <mesh geometry={parts.foot} material={m.legs} position={[0, -P.hipY + 0.035, 0.03]} />
      </group>
    </group>
  )
}
