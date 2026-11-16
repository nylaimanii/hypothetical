real map data, all SOURCED

- countries (admin-0 polygons): natural earth 1:110m admin 0 countries, via the world-atlas package
  (countries-110m.json). public domain. https://www.naturalearthdata.com/downloads/110m-cultural-vectors/
  and https://github.com/topojson/world-atlas (isc license for the packaging)
- state and province lines (admin-1): natural earth 1:50m admin 1 states and provinces lines
  (ne_50m_admin_1_states_provinces_lines). public domain.
  https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-1-states-provinces/
  fetched from https://github.com/nvkelso/natural-earth-vector (geojson/ne_50m_admin_1_states_provinces_lines.geojson).
  admin1-lines.json is that file simplified: coordinates rounded to 0.05 degrees, points closer than
  0.15 degrees dropped, stored as flat [lon, lat, lon, lat, ...] arrays. at 1:50m natural earth only
  ships these lines for the largest countries (usa, canada, brazil, russia, china, india, indonesia,
  australia, south africa)

tile places (tile-places.json, used by places.ts and StateRidges)

- states and provinces (admin-1 polygons): natural earth 1:10m admin 1 states and provinces
  (ne_10m_admin_1_states_provinces). public domain.
  https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/
- named seas: natural earth 1:10m marine polygons (ne_10m_geography_marine_polys). public domain.
  https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-physical-labels/
- populated places: natural earth 1:10m populated places simple (ne_10m_populated_places_simple). public domain.
  https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/
- country populations: natural earth 1:110m admin 0 countries (POP_EST, POP_YEAR). public domain.
  all fetched from https://github.com/nvkelso/natural-earth-vector (geojson/). the polygons are not shipped.

how tile-places.json is built: for every tile of the default planet grid (lib.ts buildTiles, n = 34, 6936 tiles)
the tile center is tested against the admin-1 polygons (planar point in polygon; tiles south of 60s skipped);
a miss takes the state with the nearest boundary point within 3 degrees. every tile also gets the smallest
named marine polygon containing it, or the nearest named one. only states and seas that some tile points at
are kept (1272 states, 234 seas). per tile indices are stored base 36.

state populations: for 1163 of the 1272 states, GHS-POP 2025 summed over the state (SOURCED, https://ghsl.jrc.ec.europa.eu/download.php?ds=pop, taken from agent B's data/geo/admin1.json, matched by iso_3166_2 id). for the other 109 (no match in B's file) they remain an ESTIMATE, derived as follows:
  state population = country 2026 population x (w_state / sum of w over the country's states)
  w_state = 0.5 x (state summed pop_max / country summed pop_max)
          + 0.5 x (state count of populated places / country count of populated places)
          + 0.02 x (state area_sqkm / country summed area_sqkm)
  (pop_max and counts come from the natural earth 10m populated places inside each state; the area term
  is a small floor so a state with no populated places is never zero)
  country 2026 population: for the 13 mock countries, the un wpp 2024 figures in src/lib/mock/v4.ts
  (https://population.un.org/wpp/); for every other country natural earth POP_EST x 1.009^(2026 - POP_YEAR);
  for territories missing from admin-0 110m, the summed pop_max of their places (at least 1000).
  rounded to 3 significant digits.
  measured error, 12 states with known populations (uttar pradesh, maharashtra, bihar, west bengal, tamil nadu,
  california, texas, florida, new york, guangdong, shandong, henan): average absolute error 27%
  (california, texas, florida, new york within 10%; bihar 75% low, maharashtra 56% high).
  states holding a megacity still run high (pop_max is metro population); a cap on single-city states was tried
  and rejected: capping at 1.15 x the biggest metro raised the average error to 80%.
  a gridded population dataset (ghsl or worldpop) would be the real fix. the ui always labels these "estimate".
