// the people qa (CLAUDE.md, ragdoll rules): 3 full days in several real cities with their real residents' ages and
// jobs, the same code the city view runs (pipSim, trafficSim, fabricBuild, grid), checked every other frame by qa.ts.
// prints every kind of violation with examples (who, where, what, when) and exits 1 if there are any.
//   npm run qa:city            (QA_RUN=<runId> QA_CITIES="lagos,tokyo" QA_DAYS=3 to narrow it)
import fs from 'node:fs'
import path from 'node:path'
import type { Citizen, RunRecord } from '@/lib/types'
import { citizensAt } from '@/lib/sim/replay-pure'
import { buildGrid } from './grid'
import { buildFabric } from './fabricBuild'
import { lookFor, bareTrees } from './looks'
import { coreOf, type CityProfile } from './realCity'
import type { CityCell, CityRow } from '../real/cities/data'
import { crowdSize, passersbyFor, makePeople, newRig, rigOf, sceneOf, stepPeople, type Rig, type Slots } from './pipSim'
import { driveLines, LEFT_HAND, makeTraffic, stepTraffic, vehicleBox } from './trafficSim'
import { checkFrame, checkSizes, checkTraffic, newQaState, type Violation } from './qa'

const ROOT = process.cwd()
const RUN = process.env.QA_RUN ?? 'g2-meridian-s1005'
const DAYS = Number(process.env.QA_DAYS ?? 3)
const CITIES = (process.env.QA_CITIES ?? 'new york,lagos,dar es salaam,tokyo,mumbai,cairo').split(',').map((s) => s.trim())
const SECONDS_PER_HOUR = 40 // the city view's clock
const DT = 1 / Number(process.env.QA_FPS ?? 30) // the step the city view runs at (QA_FPS=60 checks at 60 fps)

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/geo/cities/index.json'), 'utf8')) as { cities: CityRow[] }
const housing = new Map((JSON.parse(fs.readFileSync(path.join(ROOT, 'data/geo/housing.json'), 'utf8')) as { countries: { id: string; slumUrbanShare: number; campResidents: number; renterShare: number }[] }).countries.map((c) => [c.id, c]))
function cellsOf(row: CityRow): CityCell[] {
  const g = JSON.parse(fs.readFileSync(path.join(ROOT, `public/geo/cities/${row.group}.json`), 'utf8')).cities[row.id] as { lat0: number; lon0: number; res: number; d: string }
  if (!g) return []
  const bin = Buffer.from(g.d, 'base64'), out: CityCell[] = []
  for (let i = 0; i + 3 < bin.length; i += 4) out.push({ lat: g.lat0 - (bin[i + 1] + 0.5) * g.res, lon: g.lon0 + ((bin[i] & 31) + 0.5) * g.res, built: bin[i + 2] / 255, heightM: bin[i + 3], popC: bin[i] >> 5 })
  return out
}

const rec = JSON.parse(fs.readFileSync(path.join(ROOT, `data/runs/${RUN}.json`), 'utf8')) as RunRecord
const tick = rec.frames[rec.frames.length - 1].tick
const roster = citizensAt(rec, tick)
type CitizenX = Citizen & { cityId?: string }

const all: (Violation & { city: string; at: string })[] = []
const sizes = checkSizes()
for (const v of sizes) all.push({ ...v, city: '-', at: '-' })

for (const name of CITIES) {
  const row = idx.cities.find((c) => c.name === name)
  if (!row) { console.log(`no city "${name}" in the index`); continue }
  const cells = cellsOf(row)
  const seed = housing.get(row.country) ?? null
  const profile: CityProfile = { row, cells, core: coreOf(row, cells), seed: seed ? { slumUrbanShare: seed.slumUrbanShare, campResidents: seed.campResidents, renterShare: seed.renterShare } : null }
  // residents: the city's own pips, else its country's, else anyone (copies get their own ages)
  let residents = (roster as CitizenX[]).filter((c) => c.cityId === row.id)
  if (residents.length < 3) residents = [...residents, ...roster.filter((c) => c.countryId === row.country)].slice(0, 8)
  if (residents.length < 3) residents = roster.slice(0, 8)
  residents = residents.map((c) => ({ ...c, countryId: row.country }))
  const look = lookFor(row.country, row.group, row.lat, row.lon)
  const total = crowdSize(row.pop, profile.core.popC)
  const grid = buildGrid(row.id, residents.map((c) => c.workplace ?? 'none'), Math.ceil(total / 3), residents.some((c) => c.belief === 'religious'), true, Math.max(1, Math.min(6, Math.round(profile.core.heightM / 3.2 * 0.8))))
  const leftHand = LEFT_HAND.has(row.country)
  const fabric = buildFabric({ profile, look, grid, informal: seed?.slumUrbanShare ?? 0, camp: (seed?.campResidents ?? 0) > 150000, growing: true, bare: bareTrees(look, row.lat, 0), leftHand })
  const sc = sceneOf(grid, fabric.posts, fabric.boxes)
  const people = makePeople({ cityId: row.id, countryId: row.country, tick, residents, grid, total, passersby: passersbyFor(profile.core.popC) })
  const traffic = makeTraffic(row.id, look, leftHand, grid.tramZ)
  const { cross } = driveLines(grid.tramZ)
  const slots: Slots = new Map()
  const qs = newQaState(), tq = new Map()
  const rigs = new Map<number, Rig>()
  const counts = new Map<string, number>()
  const epi = new Map<string, number>()
  const t0 = Date.now()
  const steps = Math.round(DAYS * 24 * SECONDS_PER_HOUR / DT)
  const ffFrom = steps - Math.round(SECONDS_PER_HOUR / DT) // the last hour runs as fast forward (the timeline playing)
  let lh = 3, frames = 0
  for (let k = 0; k < steps; k++) {
    const playing = k >= ffFrom
    // QA_JITTER=1: every frame a different length between 1/60 and 1/30 s, the way a browser's frames come
    const dt = process.env.QA_JITTER ? 1 / 60 + (((k * 2654435761) >>> 0) % 1000) / 1000 * (1 / 30 - 1 / 60) : DT
    lh = (lh + (playing ? dt * 2 : dt / SECONDS_PER_HOUR)) % 24
    const cars = traffic.vehicles.filter((v) => v.active).map((v) => { const b = vehicleBox(v); return { ...b, vx: v.axis === 0 ? v.dir * v.v : 0, vz: v.axis === 1 ? v.dir * v.v : 0 } })
    stepPeople(sc, people, slots, lh, dt, playing, cars)
    const out = people.filter((p) => p.vis > 0.3 && !p.inside && !p.baby).map((p) => ({ x: p.pos.x, z: p.pos.z, r: p.r, vx: p.moving ? Math.sin(p.heading) * p.speed : 0, vz: p.moving ? Math.cos(p.heading) * p.speed : 0, waiting: (p.curbWait ?? 0) > 0.8 }))
    stepTraffic(traffic, lh, dt, out, cross)
    frames++
    for (const p of people) { if (p.vis <= 0.01 || p.inside) { rigs.delete(p.idx); continue } let R = rigs.get(p.idx); if (!R) { R = newRig(); rigs.set(p.idx, R) } rigOf(p, people, k * DT, R, dt) }
    const vs = [...checkFrame(sc, people, rigs, traffic.vehicles, dt, lh, qs, playing), ...checkTraffic(traffic.vehicles, traffic.far, tq)]
    const TR = Number(process.env.QA_TRACE ?? -1)
    if (TR >= 0 && people[TR]) { const p = people[TR], R = rigs.get(TR); console.log(`t${lh.toFixed(3)} pos ${p.pos.x.toFixed(3)},${p.pos.z.toFixed(3)} seg ${p.seg}/${p.path.length} s ${p.segS.toFixed(3)} lat ${p.lat.toFixed(3)} mv ${p.moving} vis ${p.vis.toFixed(2)} in ${p.inside} head ${p.heading.toFixed(2)} spd ${p.speed.toFixed(2)} st ${R ? R.stance : "-"} bl ${(p.blend ?? 1).toFixed(2)} wk ${p.walked.toFixed(3)} pose ${p.pose} act ${p.act} seat ${p.seatAt ? p.seatAt.x.toFixed(2) + "," + p.seatAt.z.toFixed(2) : "-"} g ${p.guardian >= 0 && people[p.guardian].target ? people[p.guardian].target!.spot.x.toFixed(2) + "," + people[p.guardian].target!.spot.z.toFixed(2) + " gpos " + people[p.guardian].pos.x.toFixed(2) + "," + people[p.guardian].pos.z.toFixed(2) : "-"} ${R ? `feet ${R.feet[0].x.toFixed(3)},${R.feet[0].z.toFixed(3)},${R.feet[0].y.toFixed(3)} | ${R.feet[1].x.toFixed(3)},${R.feet[1].z.toFixed(3)},${R.feet[1].y.toFixed(3)}` : ''} ${vs.filter((v) => v.who.includes('#' + TR + ' ')).map((v) => '!!' + v.rule).join(' ')}`) }
    const day = Math.floor((3 + k * DT / SECONDS_PER_HOUR) / 24) + 1
    if (process.env.QA_EPISODES) for (const v of vs) { const key = v.rule + '|' + v.who.split(' (')[0]; const lastSeen = epi.get(key); if (lastSeen === undefined || k - lastSeen > 30) console.log(`EP ${lh.toFixed(2)}h ${v.rule}: ${v.who} at ${v.where}: ${v.what}`); epi.set(key, k) }
    for (const v of vs) {
      const key = v.rule
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if ((counts.get(key) ?? 0) <= 3) all.push({ ...v, city: name, at: `day ${day} ${lh.toFixed(2)}h${playing ? ' (fast forward)' : ''}` })
      else all.push({ ...v, city: name, at: '' })
    }
  }
  const shown = people.filter((p) => !p.baby && !p.through).length
  const passing = people.filter((p) => p.through).length
  const kids = people.filter((p) => p.age < 8).length
  console.log(`${name.padEnd(14)} ${look.id.padEnd(10)} ${shown} people + ${passing} passing through (${kids} under 8, ${people.filter((p) => p.baby).length} babies), ${traffic.vehicles.length} vehicles, ${frames} frames checked in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${[...counts.values()].reduce((a, b) => a + b, 0)} violations`)
  for (const [rule, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(6)}  ${rule}`)
}

const real = all.filter((v) => v.at !== '' || v.city === '-')
if (real.length) {
  console.log('\nexamples:')
  const byRule = new Map<string, typeof real>()
  for (const v of real) byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v])
  for (const [rule, list] of byRule) {
    console.log(`  ${rule}`)
    for (const v of list.slice(0, 4)) console.log(`    ${v.city} ${v.at}: ${v.who} at ${v.where}: ${v.what}`)
  }
}
const total = all.length
console.log(`\n${total ? `${total} violations` : 'zero violations'}`)
process.exit(total ? 1 : 0)
