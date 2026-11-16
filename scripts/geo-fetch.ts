// npx tsx scripts/geo-fetch.ts -> raw downloads into data/geo/raw (gitignored), then run scripts/geo-bake.ts
// coarsest versions that still look right. see data/geo/sources.md for every dataset, url and license.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const RAW = path.join(process.cwd(), 'data', 'geo', 'raw')
fs.mkdirSync(RAW, { recursive: true })
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson'
const G = 'https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL'
const GIBS = (w: number, h: number) => `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=VIIRS_Black_Marble&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=${w}&HEIGHT=${h}&FORMAT=image/tiff&TIME=2016-01-01`
const FILES: [string, string][] = [
  [`${NE}/ne_10m_populated_places.geojson`, 'ne_10m_populated_places.geojson'],
  [`${NE}/ne_10m_admin_0_countries.geojson`, 'ne_10m_admin_0_countries.geojson'],
  [`${NE}/ne_10m_admin_1_states_provinces.geojson`, 'ne_10m_admin_1_states_provinces.geojson'],
  [`${NE}/ne_10m_roads.geojson`, 'ne_10m_roads.geojson'],
  [`${NE}/ne_10m_railroads.geojson`, 'ne_10m_railroads.geojson'],
  [`${NE}/ne_10m_ports.geojson`, 'ne_10m_ports.geojson'],
  ['https://wri-dataportal-prod.s3.amazonaws.com/manual/global_power_plant_database_v_1_3.zip', 'gppd.zip'],
  ['https://davidmegginson.github.io/ourairports-data/airports.csv', 'airports.csv'],
  [GIBS(1440, 720), 'blackmarble_gibs_025.tif'],
  [GIBS(7200, 3600), 'blackmarble_gibs_005.tif'],
  ['https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_tavg.zip', 'wc_tavg_10m.zip'],
  ['https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_prec.zip', 'wc_prec_10m.zip'],
  [`${G}/GHS_BUILT_S_GLOBE_R2023A/GHS_BUILT_S_E2025_GLOBE_R2023A_4326_30ss/V1-0/GHS_BUILT_S_E2025_GLOBE_R2023A_4326_30ss_V1_0.zip`, 'ghs_built_s_2025_30ss.zip'],
  [`${G}/GHS_BUILT_V_GLOBE_R2023A/GHS_BUILT_V_E2025_GLOBE_R2023A_4326_30ss/V1-0/GHS_BUILT_V_E2025_GLOBE_R2023A_4326_30ss_V1_0.zip`, 'ghs_built_v_2025_30ss.zip'],
  [`${G}/GHS_POP_GLOBE_R2023A/GHS_POP_E2025_GLOBE_R2023A_4326_30ss/V1-0/GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.zip`, 'ghs_pop_2025_30ss.zip'],
]
for (const [url, name] of FILES) {
  const out = path.join(RAW, name)
  if (fs.existsSync(out) && fs.statSync(out).size > 0) { console.log(`have ${name}`); continue }
  // plain browser user agent and http/1.1: some hosts reject custom agents or flake on http/2
  execFileSync('curl', ['-sSL', '--fail', '--http1.1', '--retry', '3', '-m', '3600', '-A', 'Mozilla/5.0', '-o', out, url], { stdio: 'inherit' })
  console.log(`got ${name} ${fs.statSync(out).size} bytes`)
}
