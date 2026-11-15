// real countries: natural earth admin-0 polygons via world-atlas countries-110m (public domain, see SOURCES.md).
// maps every planet tile to the country under its center, so tiles can take their country's color.
import { geoArea, geoCentroid, geoContains } from 'd3-geo'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import countriesTopo from 'world-atlas/countries-110m.json'
import type { Tile } from '../lib'

// iso 3166-1 numeric to alpha-3 for every feature in countries-110m. features without a numeric code
// (kosovo, northern cyprus, somaliland) get user-assigned codes by name below
const A3: Record<string, string> = {
  '004': 'AFG', '008': 'ALB', '010': 'ATA', '012': 'DZA', '024': 'AGO', '031': 'AZE', '032': 'ARG', '036': 'AUS', '040': 'AUT', '044': 'BHS',
  '050': 'BGD', '051': 'ARM', '056': 'BEL', '064': 'BTN', '068': 'BOL', '070': 'BIH', '072': 'BWA', '076': 'BRA', '084': 'BLZ', '090': 'SLB',
  '096': 'BRN', '100': 'BGR', '104': 'MMR', '108': 'BDI', '112': 'BLR', '116': 'KHM', '120': 'CMR', '124': 'CAN', '140': 'CAF', '144': 'LKA',
  '148': 'TCD', '152': 'CHL', '156': 'CHN', '158': 'TWN', '170': 'COL', '178': 'COG', '180': 'COD', '188': 'CRI', '191': 'HRV', '192': 'CUB',
  '196': 'CYP', '203': 'CZE', '204': 'BEN', '208': 'DNK', '214': 'DOM', '218': 'ECU', '222': 'SLV', '226': 'GNQ', '231': 'ETH', '232': 'ERI',
  '233': 'EST', '238': 'FLK', '242': 'FJI', '246': 'FIN', '250': 'FRA', '260': 'ATF', '262': 'DJI', '266': 'GAB', '268': 'GEO', '270': 'GMB',
  '275': 'PSE', '276': 'DEU', '288': 'GHA', '300': 'GRC', '304': 'GRL', '320': 'GTM', '324': 'GIN', '328': 'GUY', '332': 'HTI', '340': 'HND',
  '348': 'HUN', '352': 'ISL', '356': 'IND', '360': 'IDN', '364': 'IRN', '368': 'IRQ', '372': 'IRL', '376': 'ISR', '380': 'ITA', '384': 'CIV',
  '388': 'JAM', '392': 'JPN', '398': 'KAZ', '400': 'JOR', '404': 'KEN', '408': 'PRK', '410': 'KOR', '414': 'KWT', '417': 'KGZ', '418': 'LAO',
  '422': 'LBN', '426': 'LSO', '428': 'LVA', '430': 'LBR', '434': 'LBY', '440': 'LTU', '442': 'LUX', '450': 'MDG', '454': 'MWI', '458': 'MYS',
  '466': 'MLI', '478': 'MRT', '484': 'MEX', '496': 'MNG', '498': 'MDA', '499': 'MNE', '504': 'MAR', '508': 'MOZ', '512': 'OMN', '516': 'NAM',
  '524': 'NPL', '528': 'NLD', '540': 'NCL', '548': 'VUT', '554': 'NZL', '558': 'NIC', '562': 'NER', '566': 'NGA', '578': 'NOR', '586': 'PAK',
  '591': 'PAN', '598': 'PNG', '600': 'PRY', '604': 'PER', '608': 'PHL', '616': 'POL', '620': 'PRT', '624': 'GNB', '626': 'TLS', '630': 'PRI',
  '634': 'QAT', '642': 'ROU', '643': 'RUS', '646': 'RWA', '682': 'SAU', '686': 'SEN', '688': 'SRB', '694': 'SLE', '703': 'SVK', '704': 'VNM',
  '705': 'SVN', '706': 'SOM', '710': 'ZAF', '716': 'ZWE', '724': 'ESP', '728': 'SSD', '729': 'SDN', '732': 'ESH', '740': 'SUR', '748': 'SWZ',
  '752': 'SWE', '756': 'CHE', '760': 'SYR', '762': 'TJK', '764': 'THA', '768': 'TGO', '780': 'TTO', '784': 'ARE', '788': 'TUN', '792': 'TUR',
  '795': 'TKM', '800': 'UGA', '804': 'UKR', '807': 'MKD', '818': 'EGY', '826': 'GBR', '834': 'TZA', '840': 'USA', '854': 'BFA', '858': 'URY',
  '860': 'UZB', '862': 'VEN', '887': 'YEM', '894': 'ZMB',
}
const BY_NAME: Record<string, string> = { Kosovo: 'XKX', 'N. Cyprus': 'XNC', Somaliland: 'XSL' }

export type CountryRow = { iso3: string; name: string; numeric: string; lat: number; lon: number; areaKm2?: number }

type Poly = { country: number; f: Feature<Polygon>; rings: number[][][]; minLon: number; maxLon: number; minLat: number; maxLat: number; wrap: boolean }

// planar even-odd test on lon/lat rings: exact enough at 110m and ~20x faster than the spherical test.
// polygons that wrap the antimeridian or a pole still use d3's spherical geoContains
function inRings(rings: number[][][], lon: number, lat: number) {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

const EARTH_KM2 = 4 * Math.PI * 6371 * 6371

function build() {
  const topo = countriesTopo as unknown as Topology<{ countries: GeometryCollection }>
  const fc = feature(topo, topo.objects.countries) as unknown as { features: (Feature<MultiPolygon | Polygon> & { id?: string; properties: { name: string } })[] }
  const table: CountryRow[] = []
  const polys: Poly[] = []
  for (const f of fc.features) {
    if (!f.geometry) continue
    const numeric = String(f.id ?? '')
    const iso3 = A3[numeric] ?? BY_NAME[f.properties.name] ?? numeric
    const list = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]
    // centroid of the largest polygon, so france sits in europe and not between its overseas parts
    let best: Feature<Polygon> | null = null, bestArea = -1
    const idx = table.length
    for (const coords of list) {
      const pf: Feature<Polygon> = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: coords } }
      const a = geoArea(pf)
      if (a > bestArea) { bestArea = a; best = pf }
      let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90
      for (const [lo, la] of coords[0]) {
        minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo); minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la)
      }
      polys.push({ country: idx, f: pf, rings: coords, minLon, maxLon, minLat, maxLat, wrap: maxLon - minLon > 180 || minLat < -60 })
    }
    const [lon, lat] = best ? geoCentroid(best) : [0, 0]
    table.push({ iso3, name: f.properties.name.toLowerCase(), numeric, lat, lon, areaKm2: Math.round((geoArea(f) / (4 * Math.PI)) * EARTH_KM2) })
  }
  return { table, polys }
}

const built = build()
export const COUNTRY_TABLE: CountryRow[] = built.table
const POLYS = built.polys
const byIso = new Map(COUNTRY_TABLE.map((c, i) => [c.iso3, i]))
export const countryIndexOf = (iso3: string) => byIso.get(iso3) ?? -1

export function countryIndexAt(lat: number, lon: number): number {
  for (const p of POLYS) {
    if (p.wrap) { if (geoContains(p.f, [lon, lat])) return p.country; continue }
    if (lon < p.minLon || lon > p.maxLon || lat < p.minLat || lat > p.maxLat) continue
    if (inRings(p.rings, lon, lat)) return p.country
  }
  return -1
}

const cache = new Map<number, Int16Array>()
// every tile's country (index into COUNTRY_TABLE), -1 for ocean. land tiles that miss every polygon
// (coarse 110m coasts) take their nearest land neighbor's country
export function tileCountries(tiles: Tile[]): Int16Array {
  const hit = cache.get(tiles.length)
  if (hit) return hit
  const out = new Int16Array(tiles.length).fill(-1)
  const miss: number[] = []
  tiles.forEach((t, i) => {
    if (!t.land || t.ice) return
    const c = countryIndexAt(t.lat, t.lon)
    if (c >= 0) out[i] = c
    else miss.push(i)
  })
  for (const i of miss) {
    let best = -1, bd = -2
    const n = tiles[i].normal
    tiles.forEach((t, j) => { if (out[j] >= 0) { const d = n.dot(t.normal); if (d > bd) { bd = d; best = j } } })
    if (best >= 0 && bd > 0.995) out[i] = out[best]
  }
  cache.set(tiles.length, out)
  return out
}
