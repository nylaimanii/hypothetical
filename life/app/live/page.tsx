import type { Metadata } from 'next'
import { findLife, listWorlds, readIndex } from '@/lib/life/store'
import { placeInfo } from '@/lib/life/place'
import type { LifeSummary } from '@/lib/life/types'
import LiveView, { type LifeLink } from '../../components/LiveView'

export const metadata: Metadata = { title: 'one life · live' }

// /live?life=<lifeId>&t=<tick>. without ?life: the most recent finished life
export default async function LivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams
  const all: LifeSummary[] = listWorlds().flatMap(w => readIndex(w)).filter(l => l.status === 'done')
  all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const wanted = typeof q.life === 'string' ? q.life : all[all.length - 1]?.lifeId
  const record = wanted ? findLife(wanted) : null
  if (!record) return <main style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 18, opacity: 0.7 }}>no life has been lived yet</main>
  const sameWorld = all.filter(l => l.worldId === record.worldId).sort((a, b) => a.lifeNo - b.lifeNo)
  const next = sameWorld.find(l => l.lifeNo === record.lifeNo + 1)
  // the real places she lived: climate, density, building height and the city grid (B's geo layer, read-only)
  const seen = new Set<string>()
  const places = [record.birthplace, ...record.places].filter(p => (seen.has(p.cityId) ? false : (seen.add(p.cityId), true))).map(p => placeInfo(p))
  const others: LifeLink[] = all.map(l => ({ lifeId: l.lifeId, name: l.name, city: l.lastCity, age: l.deathAge ?? 0, dead: l.deathAge !== null, worldId: l.worldId }))
  const { provenance: _p, ...client } = record
  void _p
  return <LiveView record={{ ...client, provenance: {} }} places={places} others={others} mainSiteUrl={process.env.MAIN_SITE_URL ?? null} nextLifeHref={next ? `/live?life=${next.lifeId}` : null} />
}
