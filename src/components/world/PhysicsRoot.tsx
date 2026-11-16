'use client'
// rapier and the ragdoll layer in one lazily loaded chunk (see Globe)
import { Physics } from '@react-three/rapier'
import PhysicsLayer from './PhysicsLayer'
import { useStore } from '../state/store'

export default function PhysicsRoot() {
  // paused: the physics world stands still too
  const playing = useStore((s) => s.playing)
  return (
    <Physics gravity={[0, 0, 0]} timeStep={1 / 60} paused={!playing}>
      <PhysicsLayer />
    </Physics>
  )
}
