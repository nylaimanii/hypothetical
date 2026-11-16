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
| housing.json `slumUrbanShare` | UN-Habitat SDG 11.1.1 via World Bank EN.POP.SLUM.UR.ZS | https://data.worldbank.org/indicator/EN.POP.SLUM.UR.ZS | CC BY 4.0 | latest per country (2018-2022); 187 sourced, rest from a log-income fit over those (`slumFit`) |
| housing.json `refugees`, `idps`, `asylumSeekers` | UNHCR population statistics, end 2024, by country of asylum | https://www.unhcr.org/refugee-statistics/ | CC BY 4.0 | via https://api.unhcr.org/population/v1/population/ |
| housing.json `disasterDisplacedYear` | IDMC new disaster displacements via World Bank VC.IDP.NWDS | https://data.worldbank.org/indicator/VC.IDP.NWDS | CC BY 4.0 | |
| housing.json `campResidents`, `householdSize`, `renterShare` | ESTIMATE | https://www.unhcr.org/global-trends | | 22% of refugees in camps (UNHCR) + 25% of IDPs; household size 1.3 + 0.7 tfr + rural share; renters ~0.08 + 0.4 x urban share |
| daily.json (hunger, doctors, primary enrollment, education spending, remittances, safe water, water stress, extreme poverty, internet, protected land) | World Bank WDI: SN.ITK.DEFC.ZS, SH.MED.PHYS.ZS, SE.PRM.NENR, SE.XPD.TOTL.GD.ZS, BX.TRF.PWKR.DT.GD.ZS, SH.H2O.SMDW.ZS, ER.H2O.FWST.ZS, SI.POV.DDAY, IT.NET.USER.ZS, ER.LND.PTLD.ZS | https://data.worldbank.org | CC BY 4.0 | latest per country; missing at the region's population-weighted mean (ESTIMATE, counted in the bake log) |
| daily.json `airDeathsPer100k`, `washDeathsPer100k` | WHO via World Bank SH.STA.AIRP.P5 (household + ambient air pollution) and SH.STA.WASH.P5 (unsafe water, sanitation, hygiene), 2019 | https://data.worldbank.org/indicator/SH.STA.AIRP.P5 | CC BY 4.0 | age-standardized death rates |
| daily.json `faiths` | Pew Research Center, Religious Composition 2010-2020, 2020 shares | https://www.pewresearch.org/religion/2025/06/09/how-the-global-religious-landscape-changed-from-2010-to-2020/ | Pew terms of use | sets worship days and holidays per country |
| daily.json `weekend` | Workweek and weekend by country | https://en.wikipedia.org/wiki/Workweek_and_weekend | CC BY-SA | Friday-Saturday across much of the muslim world and Israel, Friday in Iran, Saturday in Nepal |
| launch-sites.json | active orbital launch sites, main pad coordinates | https://en.wikipedia.org/wiki/List_of_rocket_launch_sites | CC BY-SA | 22 sites |
| holidays (computed, src/lib/sim/calendar.ts) | Gregorian and Orthodox computus, tabular hijri calendar, Meeus moon phases, Gauss' Passover formula, national days | https://en.wikipedia.org/wiki/Date_of_Easter | | checked against 2026-2030 published dates; islamic dates can differ by a day from moon sighting |
| daily.json `lifeExpectancy` | World Bank SP.DYN.LE00.IN, life expectancy at birth, 2024 | https://data.worldbank.org/indicator/SP.DYN.LE00.IN | CC BY 4.0 | each country's mortality level is fitted to it at tick 0 |
| wpp.json | UN World Population Prospects 2024, medium variant, 2026-2100: population, life expectancy, births, deaths per country and world | https://population.un.org/wpp/ | CC BY 3.0 IGO | via Our World in Data grapher exports; the no-ai twin is checked against it |
| grid-025.bin.gz `landClass` | ESTIMATE from WorldClim climate, GHSL built-up and GHS-POP density | | | ESA WorldCover is only published as 10 m tiles (hundreds of GB), too large to bake at this stage; classes: water, ice, tundra, desert, grass/scrub/savanna, forest, tropical forest, cropland, built. koppen-style rules in `scripts/geo-lib.ts` landClassOf (warmest month for ice/tundra, dry months for rainforest vs savanna, people/km2 for cropland); `scripts/geo-landclass.ts` redoes the class byte without a rebake. global shares come out forest+tropical 31% of land (FAO FRA 2020: 31%), cropland 15% (FAO: ~12%, ours includes settled farm mosaic) |
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
