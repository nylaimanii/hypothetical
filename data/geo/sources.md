# data/geo sources

Baked by `scripts/geo-countries.ts` and `scripts/geo-bake.ts` from raw downloads fetched by `scripts/geo-fetch.ts`
(raw files are gitignored). Every baked file names its source inside it. Coarsest version of each dataset that still
looks right.

| file | dataset | url | license | notes |
|---|---|---|---|---|
| countries.json | World Bank WDI + WGI (population, GDP, 65+, electricity use, tertiary enrollment, fertility, death rate, under-5 mortality, sex and 5-year age bands, jobs by sector, unemployment, urban share, Gini, homicide, land, forest, farmland, political stability, rule of law) | https://data.worldbank.org | CC BY 4.0 | latest value per country (`mrnev=1`); age bands are UN WPP estimates as published by the World Bank |
| countries.json | FAO food balance sheets, kcal per person per day (via Our World in Data) | https://ourworldindata.org/grapher/daily-per-capita-caloric-supply | CC BY 4.0 | FAOSTAT API was unreachable when baking |
| countries.json | World Happiness Report, Cantril ladder (via Our World in Data) | https://ourworldindata.org/grapher/happiness-cantril-ladder | CC BY 4.0 | starting happiness; the sim drives it from mood afterwards |
| countries.json | Transparency International CPI (via Our World in Data) | https://ourworldindata.org/grapher/ti-corruption-perception-index | CC BY 4.0 (OWID) / TI terms | seeds corruption (phase 4) |
| countries.json | PM2.5 exposure, population weighted (via Our World in Data, from the World Bank / Brauer et al.) | https://ourworldindata.org/grapher/pm25-air-pollution | CC BY 4.0 | air quality |
| countries.json | Pew Research Center, Religious Composition 2010-2020 | https://www.pewresearch.org/religion/2025/06/09/how-the-global-religious-landscape-changed-from-2010-to-2020/ | Pew terms of use (free with attribution) | faith = 1 - religiously unaffiliated, 2020 |
| countries.json | NCD-RisC adult height (age 19, 2019) | https://www.ncdrisc.org/data-downloads-height.html | CC BY 4.0 | |
| countries.json `local` | ESTIMATE: commute mode share, cars per 1,000, farm type, nightlife | WHO Global Status Report on Road Safety 2023 (car ownership curve) https://www.who.int/publications/i/item/9789240086517 | | no open global dataset exists for commute modes or nightlife; formulas are in geo-countries.ts |
| cities.json | Natural Earth 10m populated places v5.1 (`POP_MAX`) | https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/ | public domain | every city over 300k plus every national capital |
| admin1.json, admin1-shapes.geojson | Natural Earth 10m admin-1 states and provinces | https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/ | public domain | population = GHS-POP 2025 summed over each area at 0.05 deg (SOURCED); areas smaller than one cell use the populations of cities inside them (ESTIMATE). shapes simplified to 0.03 deg for display |
| grid-025.bin.gz, grid-near-005.bin.gz | GHSL GHS-BUILT-S R2023A, epoch 2025, 30 arcsec | https://ghsl.jrc.ec.europa.eu/download.php?ds=bu | CC BY 4.0 (European Commission JRC) | built-up fraction per cell |
| grid-025.bin.gz, grid-near-005.bin.gz | GHSL GHS-BUILT-V R2023A, epoch 2025, 30 arcsec | https://ghsl.jrc.ec.europa.eu/download.php?ds=builtV | CC BY 4.0 | mean building height = built volume / built surface (the GHS-BUILT-H height product is only published at 3 arcsec / 100 m, 5.9 GB; V/S at 30 arcsec gives the same average-height measure at a size we can bake) |
| grid-025.bin.gz, grid-near-005.bin.gz | GHSL GHS-POP R2023A, epoch 2025, 30 arcsec | https://ghsl.jrc.ec.europa.eu/download.php?ds=pop | CC BY 4.0 | population per cell |
| grid-025.bin.gz, grid-near-005.bin.gz | NASA Black Marble 2016 night lights, via NASA GIBS WMS (layer VIIRS_Black_Marble) | https://nasa-gibs.github.io/gibs-api-docs/ | NASA open data | the Black Marble GeoTIFF on eoimages.gsfc.nasa.gov was unreachable and the VNP46 annual product needs an Earthdata login, so the public GIBS rendering was sampled at 0.25 and 0.05 deg (relative brightness 0..255, not radiance) |
| grid-025.bin.gz | WorldClim 2.1 monthly climate normals 1970-2000, 10 arc-minutes (tavg, prec) | https://www.worldclim.org/data/worldclim21.html | CC BY 4.0 (Fick & Hijmans 2017) | ERA5 needs a Copernicus account, skipped. daily weather in the sim is seeded from these normals and drifts with emissions |
| grid-025.bin.gz `landClass` | ESTIMATE from WorldClim climate, GHSL built-up and GHS-POP density | | | ESA WorldCover is only published as 10 m tiles (hundreds of GB), too large to bake at this stage; classes: water, ice, tundra, desert, grass/scrub, forest, tropical forest, cropland, built |
| roads.json | Natural Earth 10m roads (major + secondary highways, scalerank <= 7) | https://www.naturalearthdata.com/downloads/10m-cultural-vectors/roads/ | public domain | Douglas-Peucker 0.01 deg |
| rail.json | Natural Earth 10m railroads (scalerank <= 8) | https://www.naturalearthdata.com/downloads/10m-cultural-vectors/railroads/ | public domain | Douglas-Peucker 0.01 deg |
| plants.json | WRI Global Power Plant Database v1.3 | https://datasets.wri.org/dataset/globalpowerplantdatabase | CC BY 4.0 | plants >= 50 MW listed; `mixByCountry` uses every plant (estimated 2017 generation, or capacity x typical capacity factor where missing) and seeds each country's starting energy mix |
| airports.json | OurAirports, type = large_airport | https://ourairports.com/data/ | public domain | |
| ports.json | Natural Earth 10m ports | https://www.naturalearthdata.com/downloads/10m-cultural-vectors/ports/ | public domain | the NGA World Port Index download (msi.nga.mil) returned 503 while baking; Natural Earth ports used instead |

## skipped (login or size), with the open source used instead

- NASA Black Marble VNP46A4 (Earthdata login) -> GIBS Black Marble 2016 rendering
- ERA5 monthly normals (Copernicus CDS account) -> WorldClim 2.1
- ESA WorldCover 10 m (size) -> ESTIMATE classes from climate + GHSL
- GHS-BUILT-H 100 m / 3 arcsec (5.9 GB) -> GHS-BUILT-V / GHS-BUILT-S at 30 arcsec
- NGA World Port Index (503 at bake time) -> Natural Earth ports
