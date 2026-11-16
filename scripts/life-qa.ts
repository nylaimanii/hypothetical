// npx tsx scripts/life-qa.ts [--verbose]
// the ragdoll rules (CLAUDE.md) checked against exactly what /live draws: three full sim days, three cities, three ages
// (a newborn in dar es salaam, a 6 year old in luanda, a 34 year old in antananarivo). each day is sampled every 10
// sim minutes with a 3 second watch at 30 fps (1d speed, 15x real time); the first second of each watch settles the
// scene (a cut) and is not judged. every body, seat, held baby and vehicle is checked every frame. exits non-zero on
// any violation; zero violations before a commit that touches people.
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import type { LifeRecord } from '../src/lib/life/types'
import { placeInfo } from '../src/lib/life/place'
import { LifeWorld } from '../life/components/lifeworld'
import { Population, Her, seatFor, type Placed } from '../life/components/population'
import { buildFabric, fabricSolids } from '../life/components/fabric'
import { cityStyle } from '../life/components/style'
import { Traffic } from '../life/components/traffic'
import { Qa, checkTraffic, checkSizes, radiusOf, type QaBody, type Violation } from '../life/components/qa'
import { DIMS } from '../life/components/dims'
import { lastDay, tickOf } from '../life/components/day'
import { occasionsOf } from '../src/lib/life/occasions'

const verbose = process.argv.includes('--verbose')
const CASES: { life: string; age: number; label: string; occasion?: string }[] = [
  { life: 'v2-off-a-life-2', age: 2 / 365.25, label: 'newborn, dar es salaam' },
  { life: 'v2-off-a-life-1', age: 6.3, label: '6 year old, luanda' },
  { life: 'v2-off-a-life-3', age: 34.2, label: '34 year old, antananarivo' },
  // an occasion day: the family gathered for a funeral (src/lib/life/occasions.ts)
  { life: 'v2-off-a-life-2', age: -1, label: 'funeral day, dar es salaam', occasion: 'funeral' },
]
const REAL_X = 15, FPS = 30, WATCH_S = 3, SETTLE_S = 1

function load(id: string): LifeRecord {
  const world = id.replace(/-life-\d+$/, '')
  return JSON.parse(fs.readFileSync(path.join('data', 'lives', world, `${id}.json`), 'utf8')) as LifeRecord
}

const all: (Violation & { case: string })[] = []
firstSeen = new Set<string>()
const worst = new Map<string, { n: number; last: string }>()
const hist = new Map<string, string[]>()
const byFrame = [0, 0, 0, 0, 0, 0]
const sizes = checkSizes({ door: DIMS.door, chairSeat: DIMS.chairSeat, table: DIMS.table, car: DIMS.car.l, bajaji: DIMS.bajaji.l, minibus: DIMS.minibus.l, boda: DIMS.boda.l, adult: 165 / 170 })
for (const v of sizes) all.push({ ...v, case: 'scene' })

for (const c of CASES.filter(x => !process.env.QA_ONLY || x.label.startsWith(process.env.QA_ONLY))) {
  const record = load(c.life)
  const seen = new Set<string>()
  const places = [record.birthplace, ...record.places].filter(p => (seen.has(p.cityId) ? false : (seen.add(p.cityId), true))).map(p => placeInfo(p))
  const lw = new LifeWorld(record, places)
  const end = lastDay(record)
  const day0 = c.occasion ? occasionsOf(record).find(o => o.kind === c.occasion)!.day : Math.floor(c.age * 365.25)
  let pop: Population | null = null, traffic: Traffic | null = null, popCity = ''
  const her = new Her()
  let frames = 0, judged = 0
  let lastVehs: { x: number; z: number; w: number; l: number; heading: number }[] = []
  const counts = new Map<string, number>()
  for (let minute = 0; minute < 24 * 60; minute += 10) {
    let days = day0 + minute / 1440
    const qa = new Qa()
    pop?.cut(); traffic?.cut() // a new watch starts with a cut, like a dip in /live
    let t = minute * 7.3 // the renderer's clock: any continuous seconds
    for (let f = 0; f < WATCH_S * FPS; f++) {
      const dt = 1 / FPS
      days += (REAL_X / 86400) * dt; t += dt
      lw.tick(days, (days % 1) * 24, 'day', end)
      const { L, W } = lw
      const layout = lw.layoutOf(W.cityId)
      const countryId = (record.places.find(p => p.cityId === W.cityId) ?? record.birthplace).countryId
      const style = cityStyle(countryId)
      if (!pop || popCity !== W.cityId) { pop = new Population(record, layout, style, W.cityId); traffic = new Traffic(style, record.seed); popCity = W.cityId }
      const fabric = pop.fabric
      const bodies: Placed[] = pop.step(W, L, t, dt, pop.MAX, lastVehs)
      const hf = her.step(L, record.look, t, dt, L.seat)
      const herBody: QaBody = {
        id: 'her', who: `${record.name} (${L.age.toFixed(1)})`, age: L.age, root: hf.root, x: L.seat?.x ?? L.pos.x, z: L.seat?.z ?? L.pos.z, heading: L.heading, action: hf.action, walking: L.walking, presence: L.pos.y > 0.2 ? 0 : 1,
        body: hf.body, sol: hf.sol, holding: null, heldBy: L.carrier, cradle: null, indoors: W.indoors, lotId: W.lotId, lotKind: layout.lots.find(l => l.id === W.lotId)?.kind ?? '?', seat: L.seat, door: null, her: true,
      }
      const vehs = traffic!.step(W, L, bodies.filter(b => b.presence > 0.3 && !b.indoors).map(b => ({ x: b.x, z: b.z, r: radiusOf(b.body), crossing: b.walking && b.role !== 'passer' })), dt)
      // QA_TRACE="<case label>|<minute of day>|<body id>": every frame of that watch, the body and the vehicles near it
      if (process.env.QA_TRACE) { const [tc, tm, tid] = process.env.QA_TRACE.split('|'); if (c.label.startsWith(tc) && minute === Number(tm)) { const b = bodies.find(x => x.id === tid); if (b) console.log(`trace ${f} ${W.hour.toFixed(3)} ${tid} (${b.x.toFixed(3)},${b.z.toFixed(3)}) feet ${[2, 5].map(i => { const q = b.sol.bones[i].a.clone().applyMatrix4(b.root); return `(${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)})` }).join('')} h${b.heading.toFixed(2)} ${b.action} p${b.presence.toFixed(2)} in:${b.indoors} lot:${b.lotId} to:${b.talkingTo} | ` + vehs.filter(v => Math.hypot(v.x - b.x, v.z - b.z) < 2.5).map(v => `${v.kind}${v.id} (${v.x.toFixed(2)},${v.z.toFixed(2)}) v${v.speed.toFixed(2)} p${v.presence.toFixed(2)}`).join(' ') + ' || ' + bodies.filter(o => o !== b && (Math.hypot(o.x - b.x, o.z - b.z) < 0.6 || o.id === b.talkingTo)).map(o => `${o.id} (${o.x.toFixed(2)},${o.z.toFixed(2)}) h${o.heading.toFixed(2)} ${o.action} [${o.note}]`).join(' ')) } }
      lastVehs = vehs.filter(v => v.id !== 99).map(v => ({ x: v.x, z: v.z, w: v.w, l: v.l, heading: v.heading }))
      frames++
      if (f < SETTLE_S * FPS) { qa.check([...bodies, herBody], ctx(), dt); continue }
      judged++
      for (const b of bodies) { const hh = hist.get(b.id) ?? []; const ft = [2, 5].map(i => { const q = b.sol.bones[i].a.clone().applyMatrix4(b.root); return `(${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)})` }).join(' '); hh.push(`${f} (${b.x.toFixed(3)},${b.z.toFixed(3)}) h${b.heading.toFixed(2)} ${b.action} p${b.presence.toFixed(2)} feet ${ft}`); if (hh.length > 6) hh.shift(); hist.set(b.id, hh) }
      const vs = [...qa.check([...bodies, herBody], ctx(), dt), ...checkTraffic([...bodies, herBody], vehs, W.hour, L.pos)]
      if (vs.length) byFrame[Math.min(5, Math.floor((f - 30) / 10))] += vs.length
      for (const v of vs) {
        counts.set(v.rule, (counts.get(v.rule) ?? 0) + 1)
        const wk = `${c.label} | ${v.rule} | ${v.who}`; worst.set(wk, { n: (worst.get(wk)?.n ?? 0) + 1, last: `${v.where}: ${v.what}` })
        const key = `${v.rule}|${v.who}`
        if (process.env.QA_WHO && v.who === process.env.QA_WHO && v.rule === (process.env.QA_HISTORY ?? v.rule)) { const b = bodies.find(x => x.who === v.who); if (b) console.log(`every ${c.label} ${W.hour.toFixed(3)} ${v.what}\n  ` + (hist.get(b.id) ?? []).slice(-3).join('\n  ')) }
        if (!firstSeen.has(key)) { firstSeen.add(key); all.push({ ...v, case: c.label }); if (process.env.QA_HISTORY && v.rule === process.env.QA_HISTORY) { const b = bodies.find(x => x.who === v.who); if (b) console.log(`history ${v.who}:\n  ` + (hist.get(b.id) ?? []).join('\n  ')) } }
      }
      function ctx() { return { hour: W.hour, fabric, solids: pop!.solids, seats: [...pop!.seats.values()], herLot: W.indoors ? W.lotId : -1, herPos: L.pos } }
    }
  }
  console.log(`${c.label}: ${frames} frames (${judged} judged), ${[...counts.values()].reduce((a, b) => a + b, 0)} violation-frames${counts.size ? ': ' + [...counts].map(([k, n]) => `${k} ${n}`).join(', ') : ''}`)
  void tickOf; void seatFor; void THREE
}
if (verbose) console.log('\nviolation-frames by time since the cut (30-39, 40-49, ... 80-89):', byFrame.join(' '))
if (verbose) { console.log('\nlongest-running (frames):'); for (const [k, v] of [...worst].sort((a, b) => b[1].n - a[1].n).slice(0, 15)) console.log(`  ${v.n}  ${k}  (last: ${v.last})`) }
const firstSeenCount = all.length
console.log(`\n${firstSeenCount ? `${firstSeenCount} distinct violations (rule + who)` : 'zero violations'}`)
for (const v of all.slice(0, verbose ? 1000 : 60)) console.log(`- [${v.case}] ${v.rule}: ${v.who} at ${v.where}: ${v.what}`)
process.exit(firstSeenCount ? 1 : 0)

// caches
var firstSeen: Set<string>
function fabricFor(layout: Parameters<typeof buildFabric>[0], style: Parameters<typeof buildFabric>[1], cityId: string) {
  const k = cityId
  fabCache ??= new Map()
  let f = fabCache.get(k); if (!f) { f = buildFabric(layout, style, cityId); fabCache.set(k, f) } return f
}
function solidsFor(f: ReturnType<typeof buildFabric>) { solidCache ??= new Map(); let s = solidCache.get(f); if (!s) { s = fabricSolids(f); solidCache.set(f, s) } return s }
var fabCache: Map<string, ReturnType<typeof buildFabric>> | undefined
var solidCache: Map<ReturnType<typeof buildFabric>, ReturnType<typeof fabricSolids>> | undefined
