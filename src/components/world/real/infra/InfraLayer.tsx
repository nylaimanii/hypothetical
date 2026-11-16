'use client'
// v5 phase 1, mid zoom: the real infrastructure and the sim's changes to it, in one mountable layer.
// each part fades itself in at mid zoom and costs nothing at far or close zoom.
import type { Agent, Frame } from '@/lib/types'
import RoadsRail from './RoadsRail'
import Plants from './Plants'
import Hubs from './Hubs'
import Diffs from './Diffs'

export default function InfraLayer({ frame, agent }: { frame: Frame; agent?: Agent }) {
  return (
    <>
      <RoadsRail frame={frame} />
      <Plants frame={frame} />
      <Hubs frame={frame} />
      <Diffs frame={frame} agent={agent} />
    </>
  )
}
