// redo the land class byte in data/geo/grid-025.bin.gz from the stored climate, population and built-up bytes
// (no rebake needed when the rule in geo-lib.ts landClassOf changes). usage: npx tsx scripts/geo-landclass.ts
import fs from 'node:fs'
import zlib from 'node:zlib'
import { landClassOf } from './geo-lib'
const F = 'data/geo/grid-025.bin.gz', RES = 0.25, W = 1440, L = 29
const buf = zlib.gunzipSync(fs.readFileSync(F))
for (let i = 0; i < buf.length / L; i++) {
  // same cell area as geo-bake.ts
  const lat = 90 - (Math.floor(i / W) + 0.5) * RES
  const km2 = 111.32 * RES * 111.32 * RES * Math.cos((lat * Math.PI) / 180)
  buf[i * L + 4] = landClassOf(buf, i * L, km2)
}
fs.writeFileSync(F, zlib.gzipSync(buf, { level: 9 }))
console.log('land classes rewritten', (fs.statSync(F).size / 1e6).toFixed(2), 'MB')
