// land colored by its real class (ESTIMATE from climate + ghsl, see data/geo/sources.md), in the clay palette
import * as THREE from 'three'
import { farTilesNow, tileBuilt, tileClass } from './useFar'

// water, ice, tundra, desert, grass/scrub, forest, tropical forest, cropland, built
const CLASS_HEX = ['#5F97B0', '#F2F4F3', '#A9AF98', '#E3C68C', '#C4AF63', '#4D7A63', '#3F7A4E', '#B9B062', '#B7A99A']
const CLASS = CLASS_HEX.map((h) => new THREE.Color(h))
const SNOW = new THREE.Color('#F3F2EE')
const FOREST = new THREE.Color('#3B6B43')
const SMOG = new THREE.Color('#8C7A5B')
const CITY = new THREE.Color('#B7A99A')

// returns false until the baked tiles have loaded, so the caller keeps its own coloring
export function realLandColor(tileIndex: number, out: THREE.Color, opts: { snowLat: number; lat?: number; forest?: number; pollution?: number }): boolean {
  const t = farTilesNow()
  if (!t) return false
  const c = tileClass(t, tileIndex)
  out.copy(CLASS[c] ?? CLASS[4])
  // cities show through as warm grey where much of the tile is built
  const b = tileBuilt(t, tileIndex)
  if (b > 0.05) out.lerp(CITY, Math.min(0.6, b * 1.2))
  // the sim's decisions still repaint it: regrowth, smog
  if (opts.forest !== undefined && c !== 3 && c !== 1) out.lerp(FOREST, Math.max(0, opts.forest - 0.3) * 0.4)
  if (opts.pollution) out.lerp(SMOG, opts.pollution * 0.3)
  // seasonal snow above the snow line (not on deserts)
  if (opts.lat !== undefined && c !== 3 && opts.lat > opts.snowLat) out.lerp(SNOW, 0.85)
  return true
}
