'use client'
// the chosen person: the main site's pip (src/components/world/pipShared, read-only) with a detailed face rig on top.
// eyes blink and look, brows and a chunky mouth are driven by facs action units (./facs.ts), plus tears, blush,
// sweat, tired lids with bags, and wrinkles + gray hair with age. every value eases, nothing snaps.
// only this one person gets the rig, so it can afford per-part meshes at 60fps.
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { partGeometries } from '@/components/world/pipShared'
import { bodyFor, gait, poseFor, solve, makeSolved, blendInto, clonePose, boneMatrix, type Action, type Pose } from './rig'
import { hairGeometry } from './hair'
import { C, HAIR_HEX, MONK, toonGradient } from '@/components/world/lib'
import type { Look } from '@/lib/life/types'
import { FLINCH, moodToAUs, zeroAUs, AUS, type AUs } from './facs'
import { grayShare } from './day'
import type { Seat, Her } from './population'
import type { Emotion } from '@/lib/types'

// what the scene tells the rig every frame (a mutable object, so react never re-renders per frame)
export type LiveState = {
  pos: THREE.Vector3; heading: number; walking: boolean; act: string; pose: string; dead: boolean
  seat: Seat | null // the chair, bench or stoop under her when she sits (./population)
  carrier: string | null // kin id of whoever is holding her (a baby is never alone)
  frame: 'conversation' | 'held' | null // a framing hint for the camera
  cradle: THREE.Vector3; cradleAt: number; cradleHeading: number // where the carrier's arms are and which way she faces (written by the crowd each frame)
  mood: Record<string, number>; fatigue: number; age: number; heat: number
  flinch: { emotion: Emotion; at: number } | null
  gaze: THREE.Vector3 | null // world point to look at (someone talking, a kid), or null
  hug: number // 0..1 arms out toward someone
  // written back by the rig
  head: THREE.Vector3; forward: THREE.Vector3
}

// pip units (adult ~1.1) to diorama units: an adult stands ~1.0, so a bed, a doorway and a bus seat fit her
export const PERSON_SCALE = 0.9

const toon = (color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra })
// a kanga: a bright printed cloth with a border and a repeating motif (generic pattern, not a real print)
let kanga: THREE.Texture | null = null
function kangaTexture(): THREE.Texture {
  if (kanga) return kanga
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#E8A13A'; g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#2F7F6F'; g.fillRect(0, 0, 64, 8); g.fillRect(0, 56, 64, 8)
  g.fillStyle = '#C9483B'; for (let x = 8; x < 64; x += 16) for (let y = 16; y < 56; y += 16) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill() }
  kanga = new THREE.CanvasTexture(c); kanga.colorSpace = THREE.SRGBColorSpace
  return kanga
}
const IDENT = new THREE.Matrix4()
const IDQ = new THREE.Quaternion()
const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt))

export default function ChosenPerson({ her, look, live, cloth }: { her: Her; look: Look; live: React.RefObject<LiveState>; cloth: string }) {
  const parts = useMemo(() => partGeometries(), [])
  const hair = useMemo(() => hairGeometry(look.hair), [look.hair])
  const g = useMemo(() => ({
    lid: new THREE.BoxGeometry(0.07, 0.06, 0.016),
    lowLid: new THREE.BoxGeometry(0.066, 0.03, 0.014),
    mouthMid: new THREE.BoxGeometry(0.05, 0.02, 0.018),
    mouthCorner: new THREE.BoxGeometry(0.032, 0.017, 0.018),
    mouthInner: new THREE.BoxGeometry(0.06, 0.04, 0.01),
    tear: new THREE.SphereGeometry(0.012, 8, 6),
    blush: new THREE.CircleGeometry(0.03, 16),
    bag: new THREE.BoxGeometry(0.06, 0.012, 0.01),
    line: new THREE.BoxGeometry(0.07, 0.006, 0.006),
  }), [])
  const skinHex = MONK[Math.max(0, Math.min(9, look.skinTone - 1))]
  const m = useMemo(() => ({
    skin: toon(skinHex), cloth: toon(cloth), shoes: toon('#2f2a26'), wrap: toon('#E8A13A', { map: kangaTexture() }), legs: toon(new THREE.Color(cloth).multiplyScalar(0.62)), hair: toon(HAIR_HEX[look.hairColor] ?? '#2a221c'),
    eye: toon(C.ink), brow: toon(new THREE.Color(HAIR_HEX[look.hairColor] ?? '#2a221c').multiplyScalar(0.8)),
    lid: toon(new THREE.Color(skinHex).multiplyScalar(0.94)), mouth: toon('#3b2724'), inner: toon('#5a2f2c'),
    tear: new THREE.MeshBasicMaterial({ color: '#9fd3ee', transparent: true, opacity: 0 }),
    blush: new THREE.MeshBasicMaterial({ color: '#e88a86', transparent: true, opacity: 0, depthWrite: false }),
    bag: new THREE.MeshBasicMaterial({ color: new THREE.Color(skinHex).multiplyScalar(0.7), transparent: true, opacity: 0 }),
    line: new THREE.MeshBasicMaterial({ color: new THREE.Color(skinHex).multiplyScalar(0.72), transparent: true, opacity: 0 }),
  }), [skinHex, cloth, look.hairColor])
  const baseHair = useMemo(() => new THREE.Color(HAIR_HEX[look.hairColor] ?? '#2a221c'), [look.hairColor])
  const gray = useMemo(() => new THREE.Color('#c9c4bb'), [])

  const R = {
    root: useRef<THREE.Group>(null), neck: useRef<THREE.Group>(null), swaddle: useRef<THREE.Mesh>(null),
    bones: useRef<(THREE.Mesh | null)[]>([]), torso: useRef<THREE.Mesh>(null), hands: useRef<(THREE.Mesh | null)[]>([]),
    eyeL: useRef<THREE.Mesh>(null), eyeR: useRef<THREE.Mesh>(null), lidL: useRef<THREE.Mesh>(null), lidR: useRef<THREE.Mesh>(null),
    lowL: useRef<THREE.Mesh>(null), lowR: useRef<THREE.Mesh>(null), browL: useRef<THREE.Mesh>(null), browR: useRef<THREE.Mesh>(null),
    mMid: useRef<THREE.Mesh>(null), mL: useRef<THREE.Mesh>(null), mR: useRef<THREE.Mesh>(null), mIn: useRef<THREE.Mesh>(null),
    tearL: useRef<THREE.Mesh>(null), tearR: useRef<THREE.Mesh>(null),
  }
  const st = useRef({ aus: zeroAUs(), gazeX: 0, gazeY: 0, headYaw: 0, headPitch: 0, blinkAt: 2, blinkPhase: 0, tear: 0, phase: 0, lastX: 0, lastZ: 0, started: false, pose: null as Pose | null })
  const sol = useMemo(() => makeSolved(), [])
  const box = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 2, 0.32), [])
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), e: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4() }), [])

  useFrame(({ clock }, rawDt) => {
    const L = live.current
    if (!L || !R.root.current) return
    const dt = Math.min(rawDt, 0.05)
    const t = clock.elapsedTime
    const s = st.current

    // ---- body: ./population's Her (the same code the qa script checks): action, pose, skeleton, world transform ----
    const age = L.age
    const hf = her.step(L, look, t, dt, L.seat)
    const body = hf.body, sol = hf.sol
    const held = L.pose === 'held', lying = L.pose === 'lie'
    const sad = L.mood.grief ?? 0
    const root = R.root.current
    root.visible = !L.dead // after the end she is gone from the scene; the card carries her
    hf.root.decompose(root.position, root.quaternion, root.scale)
    // bones: a box per bone, colored by clothing
    const bm = R.bones.current
    for (let i = 0; i < 10; i++) { const mesh = bm[i]; if (mesh) boneMatrix(IDENT, sol.bones[i], mesh.matrix) }
    if (R.torso.current) boneMatrix(IDENT, sol.torso, R.torso.current.matrix)
    R.hands.current.forEach((hm, i) => { if (hm) hm.matrix.compose(sol.hands[i], IDQ, tmp.v.setScalar(body.limb * 1.25)) })
    // the swaddle: from the feet to the shoulders, a little wider than the body; limbs tucked inside
    const sw = R.swaddle.current
    if (sw) {
      sw.visible = held || (age < 0.5 && lying)
      if (sw.visible) { const a = sol.bones[2].b, top = sol.neck; sw.matrix.compose(tmp.v.addVectors(a, top).multiplyScalar(0.5), sol.spine, new THREE.Vector3(body.torsoW * 1.7, top.y - Math.min(a.y, sol.bones[5].b.y) + body.H * 0.14, body.torsoD * 2.4)) }
      for (const b of R.bones.current) if (b) b.visible = !sw.visible
      if (R.torso.current) R.torso.current.visible = !sw.visible
      for (const h of R.hands.current) if (h) h.visible = !sw.visible
    }
    const neck = R.neck.current!
    neck.position.copy(sol.headPos); neck.quaternion.copy(sol.head)
    neck.scale.setScalar(body.headH / 0.27) // the pip face rig is built for a 0.27-tall head

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
    s.headPitch = damp(s.headPitch, wantPitch, 4, dt)
    s.gazeX = damp(s.gazeX, gx, 10, dt)
    s.gazeY = damp(s.gazeY, gy, 10, dt)
    // look at whoever she is with on top of the body's own head motion
    R.neck.current!.quaternion.multiply(tmp.q.setFromEuler(new THREE.Euler(s.headPitch, s.headYaw, Math.sin(t * 0.7) * 0.02, 'YXZ')))

    // blinks: ~15-20 a minute (bentivoglio et al. 1997, https://doi.org/10.1002/mds.870120629), longer in old age
    if (t > s.blinkAt) { s.blinkPhase = 1; s.blinkAt = t + 2.2 + ((Math.sin(t * 12.9898) * 43758.5453) % 1 + 1) % 1 * 3.5 }
    const blinkDur = 0.14 + Math.max(0, age - 60) * 0.003
    s.blinkPhase = Math.max(0, s.blinkPhase - dt / blinkDur)
    const blink = s.blinkPhase > 0 ? Math.sin(Math.PI * (1 - s.blinkPhase)) : 0
    const close = lying || (held && Math.sin(t * 0.07) > 0.2) ? 1 : Math.min(1, Math.max(blink, A.au43 * 0.9))
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
    m.bag.opacity = damp(m.bag.opacity, Math.min(0.75, L.fatigue * 0.9), 1.5, dt)
    m.line.opacity = Math.min(0.8, Math.max(0, (age - 42) / 30))
    m.hair.color.copy(baseHair).lerp(gray, grayShare(age))
    m.brow.color.copy(baseHair).multiplyScalar(0.8).lerp(gray, grayShare(age) * 0.7)

    // camera hooks
    R.neck.current!.getWorldPosition(L.head)
    L.forward.set(Math.sin(L.heading), 0, Math.cos(L.heading))
  })

  const lineAt = (x: number, y: number, rz = 0, w = 1) => <mesh geometry={g.line} material={m.line} position={[x, y, 0.132]} rotation={[0, 0, rz]} scale={[w, 1, 1]} />
  return (
    <group ref={R.root}>
        <mesh ref={R.torso} geometry={box} material={m.cloth} matrixAutoUpdate={false} castShadow />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (
          <mesh key={i} ref={el => { R.bones.current[i] = el }} geometry={box} matrixAutoUpdate={false} castShadow
            material={i % 3 === 2 && i < 6 ? m.shoes : i < 6 ? m.legs : i === 7 || i === 9 ? m.skin : m.cloth} />
        ))}
        {[0, 1].map(i => <mesh key={`h${i}`} ref={el => { R.hands.current[i] = el }} geometry={parts.hand} material={m.skin} matrixAutoUpdate={false} />)}
        {/* a newborn is swaddled in a bright wrap (a kanga / lamba), only the face showing */}
        <mesh ref={R.swaddle} geometry={box} material={m.wrap} matrixAutoUpdate={false} />
        <group ref={R.neck}>
          <group>
            <group>
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
              <mesh geometry={g.bag} material={m.bag} position={[0.06, -0.026, 0.1315]} />
              <mesh geometry={g.bag} material={m.bag} position={[-0.06, -0.026, 0.1315]} />
              {lineAt(0, 0.112)}{lineAt(0, 0.124, 0, 0.8)}
              {lineAt(0.112, 0.03, 0.5, 0.3)}{lineAt(-0.112, 0.03, -0.5, 0.3)}
              {hair && <mesh geometry={hair} material={m.hair} castShadow />}
            </group>
          </group>
        </group>
    </group>
  )
}
