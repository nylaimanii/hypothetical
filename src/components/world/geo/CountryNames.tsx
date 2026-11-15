'use client'
// far zoom: the names of at most the 5 most populous simulated countries in view. click = the country card
import { useMemo } from 'react'
import type { Frame } from '@/lib/types'
import { LAND_TOP, ZOOM_FAR, latLonToVec3, sceneRefs } from '../lib'
import { useStore } from '../../state/store'
import { COUNTRY_TABLE, countryIndexOf } from './countries'
import { LabelPool, type LabelItem } from './labels'

export default function CountryNames({ frame }: { frame: Frame }) {
  const items = useMemo<LabelItem[]>(() => (frame.countries ?? []).flatMap((c) => {
    const k = countryIndexOf(c.id)
    if (k < 0) return []
    const row = COUNTRY_TABLE[k]
    return [{ key: c.id, text: c.name, pos: latLonToVec3(row.lat, row.lon, 1).normalize().multiplyScalar(LAND_TOP + 1.6), weight: c.stats.population, onClick: () => useStore.getState().select({ kind: 'country', id: c.id }) }]
  }), [frame.countries])
  // in from the far threshold outward, gone again once the orrery takes over
  const opacity = () => Math.min(Math.max(0, Math.min(1, (sceneRefs.camDist - ZOOM_FAR) / 4)), Math.max(0, Math.min(1, (85 - sceneRefs.camDist) / 10)))
  return <LabelPool items={() => items} opacity={opacity} />
}
