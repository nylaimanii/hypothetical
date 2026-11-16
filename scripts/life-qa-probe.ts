// npx tsx scripts/life-qa-probe.ts <life-id> <age-years> <hour> <body-id> [frames]
// replays one qa watch (as scripts/life-qa.ts does) and prints, every frame, where one body is, what it is doing,
// its heading and stance foot: for finding the cause of a violation the qa run reported
import fs from 'node:fs'
import * as THREE from 'three'
import { placeInfo } from '../src/lib/life/place'
import { LifeWorld } from '../life/components/lifeworld'
import { Population } from '../life/components/population'
import { cityStyle } from '../life/components/style'
import { Traffic } from '../life/components/traffic'
import { radiusOf } from '../life/components/qa'
const [id, ageS, hourS, who, framesS] = process.argv.slice(2)
const record = JSON.parse(fs.readFileSync(`data/lives/${id.replace(/-life-\d+$/, '')}/${id}.json`, 'utf8'))
const lw = new LifeWorld(record, [placeInfo(record.birthplace)])
const style = cityStyle(record.birthplace.countryId)
let days = Math.floor(Number(ageS) * 365.25) + Number(hourS) / 24
lw.tick(days, (days % 1) * 24, 'day', 1e9)
const pop = new Population(record, lw.layoutOf(lw.W.cityId), style, lw.W.cityId)
const tr = new Traffic(style, record.seed)
let vehs: { x: number; z: number; w: number; l: number; heading: number }[] = []
let prevFoot: THREE.Vector3[] | null = null
for (let f = 0; f < Number(framesS ?? 90); f++) {
  days += 15 / 86400 / 30
  lw.tick(days, (days % 1) * 24, 'day', 1e9)
  const b = pop.step(lw.W, lw.L, f / 30, 1 / 30, pop.MAX, vehs)
  const v = tr.step(lw.W, lw.L, b.filter(x => x.presence > 0.3 && !x.indoors).map(x => ({ x: x.x, z: x.z, r: radiusOf(x.body), crossing: x.walking && x.role !== 'passer' })), 1 / 30)
  vehs = v.filter(q => q.id !== 99).map(q => ({ x: q.x, z: q.z, w: q.w, l: q.l, heading: q.heading }))
  const p = b.find(x => x.id === who)
  if (!p) { console.log(f, 'not drawn'); prevFoot = null; continue }
  const w = (q: THREE.Vector3) => q.clone().applyMatrix4(p.root)
  const feet = [w(p.sol.bones[2].a), w(p.sol.bones[2].b), w(p.sol.bones[5].a), w(p.sol.bones[5].b)]
  const slip = prevFoot ? Math.min(...[0, 1, 2, 3].map(i => feet[i].distanceTo(prevFoot![i]))) : 0
  prevFoot = feet
  console.log(f, lw.W.hour.toFixed(3), `(${p.x.toFixed(2)}, ${p.z.toFixed(2)})`, 'h', p.heading.toFixed(2), p.action, 'pres', p.presence.toFixed(2), 'minslip', slip.toFixed(3), p.note)
}
