'use client'
// words on everything. 3d pieces register callouts (things worth labelling) and hover tips (what an object is).
// the Explain layer in Globe shows the ~6 most significant callouts in view; the ui shows the hover tip near the cursor.
import { useEffect } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { useStore } from '../state/store'

export type Callout = {
  id: string
  pos: THREE.Vector3 // world position of the thing
  title: string // short: "rail line"
  text: string // plain words: "cut travel to 3 hours. built 2034 by meridian ii's law #12"
  weight: number // significance, higher shows first
  danger?: boolean
}

// a plain module registry: no react state, read every frame by the Explain layer
export const callouts = new Map<string, Callout[]>()

// register a group of callouts under a stable owner key; replaced whenever the list changes
export function useCallouts(owner: string, list: Callout[]) {
  useEffect(() => {
    callouts.set(owner, list)
    return () => { callouts.delete(owner) }
  }, [owner, list])
}

// spread onto any mesh/group: hovering shows a plain-words tooltip
export function tipProps(title: string, text: string) {
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      useStore.getState().setTip({ title, text, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const t = useStore.getState().tip
      if (t && t.title === title) useStore.getState().setTip({ ...t, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
    },
    onPointerOut: () => {
      const t = useStore.getState().tip
      if (t && t.title === title) useStore.getState().setTip(null)
    },
  }
}

export const yearOf = (tick: number) => 2026 + Math.floor((tick + 10) / 12)
