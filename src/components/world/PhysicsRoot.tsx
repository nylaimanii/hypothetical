'use client'
// rapier and the ragdoll layer in one lazily loaded chunk (see Globe)
import { Physics } from '@react-three/rapier'
import PhysicsLayer from './PhysicsLayer'

export default function PhysicsRoot() {
  return (
    <Physics gravity={[0, 0, 0]} timeStep={1 / 60}>
      <PhysicsLayer />
    </Physics>
  )
}
