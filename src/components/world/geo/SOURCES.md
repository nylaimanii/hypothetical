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
