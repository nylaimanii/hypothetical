// real historical reactions to policy. every law is classified into a policyKind and matched to 1-3
// precedents. the precedents set how big the public reaction is (magnitude 0..1 = size of backlash),
// how long it takes to start (delay) and how long it lasts. no match = ESTIMATE defaults, logged.
// facts are summarized from the linked articles; magnitude/delay are ESTIMATE readings of those accounts.
import type { Law, Precedent } from '../types'

const W = 'https://en.wikipedia.org/wiki/'

type P = Precedent & { delayMonths: number; tfrEffect?: number }

export const PRECEDENTS: P[] = [
  // fuel and subsidy cuts
  { id: 'yellow_vests', event: 'fuel tax rise triggers the yellow vests protests', year: 2018, country: 'France', policyKind: 'energy_tax', reaction: 'weekly mass protests for months, the tax rise was suspended', magnitude: 0.7, durationMonths: 12, delayMonths: 1, url: `${W}Yellow_vests_protests` },
  { id: 'occupy_nigeria', event: 'fuel subsidy removal doubles petrol prices overnight', year: 2012, country: 'Nigeria', policyKind: 'fuel_subsidy_cut', reaction: 'general strike, subsidy partly restored within two weeks', magnitude: 0.8, durationMonths: 1, delayMonths: 0, url: `${W}Occupy_Nigeria` },
  { id: 'ecuador_2019', event: 'fuel subsidy removal sparks nationwide protests', year: 2019, country: 'Ecuador', policyKind: 'fuel_subsidy_cut', reaction: 'general strike, decree withdrawn within two weeks', magnitude: 0.8, durationMonths: 1, delayMonths: 0, url: `${W}2019_Ecuadorian_protests` },
  { id: 'kazakhstan_2022', event: 'price cap on liquefied gas lifted', year: 2022, country: 'Kazakhstan', policyKind: 'fuel_subsidy_cut', reaction: 'unrest across the country, government resigned, over 200 dead', magnitude: 0.9, durationMonths: 1, delayMonths: 0, url: `${W}2022_Kazakh_unrest` },
  { id: 'iran_2019', event: 'gasoline price raised up to 300 percent', year: 2019, country: 'Iran', policyKind: 'fuel_subsidy_cut', reaction: 'nationwide protests met with a deadly crackdown', magnitude: 0.9, durationMonths: 1, delayMonths: 0, url: `${W}2019%E2%80%932020_Iranian_protests` },
  { id: 'egypt_1977', event: 'subsidies on bread and staples cut', year: 1977, country: 'Egypt', policyKind: 'food_subsidy_cut', reaction: 'bread riots in many cities, cuts reversed within two days', magnitude: 0.85, durationMonths: 1, delayMonths: 0, url: `${W}1977_Egyptian_bread_riots` },
  // food prices and shortages
  { id: 'food_crisis_2008', event: 'world food prices spike', year: 2008, country: 'world', policyKind: 'food_price', reaction: 'food riots in dozens of countries', magnitude: 0.7, durationMonths: 12, delayMonths: 1, url: `${W}2007%E2%80%932008_world_food_price_crisis` },
  { id: 'arab_spring', event: 'food prices and unemployment boil over in Tunisia', year: 2010, country: 'Tunisia', policyKind: 'food_price', reaction: 'regime fell in weeks, protests spread across the region', magnitude: 0.95, durationMonths: 18, delayMonths: 2, url: `${W}Arab_Spring` },
  { id: 'sri_lanka_2022', event: 'fuel, food and medicine shortages after a currency collapse', year: 2022, country: 'Sri Lanka', policyKind: 'food_price', reaction: 'months of protests, the president fled the country', magnitude: 0.9, durationMonths: 6, delayMonths: 2, url: `${W}2022_Sri_Lankan_protests` },
  // housing
  { id: 'costa_rica_pes', event: 'Costa Rica pays landowners to protect forest', year: 1996, country: 'Costa Rica', policyKind: 'conservation', reaction: 'farmers joined voluntarily, forest cover rose from ~25% to over 50%', magnitude: 0.1, durationMonths: 12, delayMonths: 12, url: `${W}Payment_for_ecosystem_services` },
  { id: 'brazil_ppcdam', event: 'Brazil enforces its Amazon deforestation plan', year: 2004, country: 'Brazil', policyKind: 'conservation', reaction: 'ranchers and loggers protested, deforestation fell ~80% by 2012', magnitude: 0.3, durationMonths: 18, delayMonths: 6, url: `${W}Deforestation_in_Brazil` },
  { id: 'finland_media_literacy', event: 'Finland teaches media literacy from primary school after a wave of disinformation', year: 2014, country: 'Finland', policyKind: 'media_literacy', reaction: 'broad support, Finland tops European media literacy rankings', magnitude: 0.02, durationMonths: 12, delayMonths: 12, url: `${W}Media_literacy` },
  // the physical world
  { id: 'delta_works', event: 'Delta Works dams and storm surge barriers after the 1953 flood', year: 1954, country: 'Netherlands', policyKind: 'sea_wall', reaction: 'broad national support after 1,836 deaths in the flood, built over four decades', magnitude: 0.05, durationMonths: 12, delayMonths: 12, url: `${W}Delta_Works` },
  { id: 'thames_barrier', event: 'Thames Barrier built to protect London from surges', year: 1974, country: 'United Kingdom', policyKind: 'sea_wall', reaction: 'little opposition, closed over 200 times since 1982', magnitude: 0.05, durationMonths: 12, delayMonths: 12, url: `${W}Thames_Barrier` },
  { id: 'earnest_will', event: 'warships escort reflagged tankers through the Gulf', year: 1987, country: 'United States', policyKind: 'naval_escort', reaction: 'clashes with Iranian forces, tanker traffic kept moving', magnitude: 0.2, durationMonths: 12, delayMonths: 1, url: `${W}Operation_Earnest_Will` },
  { id: 'us_spr', event: 'Strategic Petroleum Reserve created after the 1973 embargo', year: 1975, country: 'United States', policyKind: 'strategic_reserve', reaction: 'little public reaction, drawn down in 1991, 2005 and 2022', magnitude: 0.05, durationMonths: 12, delayMonths: 12, url: `${W}Strategic_Petroleum_Reserve_(United_States)` },
  { id: 'hydro_quebec_1989', event: 'a geomagnetic storm blacks out Quebec for nine hours', year: 1989, country: 'Canada', policyKind: 'grid_hardening', reaction: 'utilities added protection against induced currents', magnitude: 0.05, durationMonths: 12, delayMonths: 6, url: `${W}March_1989_geomagnetic_storm` },
  { id: 'dart', event: 'a spacecraft deflects the asteroid moonlet Dimorphos', year: 2022, country: 'United States', policyKind: 'planetary_defense', reaction: 'widely celebrated, cheap insurance', magnitude: 0.02, durationMonths: 6, delayMonths: 6, url: `${W}Double_Asteroid_Redirection_Test` },
  { id: 'eu_crma', event: 'EU Critical Raw Materials Act sets targets for mining, refining and recycling', year: 2024, country: 'European Union', policyKind: 'recycling', reaction: 'industry welcomed it, mining projects met local opposition', magnitude: 0.1, durationMonths: 12, delayMonths: 12, url: `${W}Critical_Raw_Materials_Act` },
  // power and the premise
  { id: 'dublin_dc_moratorium', event: 'Dublin grid operator halts new data center connections', year: 2022, country: 'Ireland', policyKind: 'data_center', reaction: 'data centers used ~18% of national power; residents blamed them for price rises and blackout risk', magnitude: 0.3, durationMonths: 24, delayMonths: 6, url: 'https://www.cso.ie/en/releasesandpublications/ep/p-dcmec/datacentresmeteredelectricityconsumption2023/' },
  { id: 'uganda_school_grants', event: 'Uganda publishes school grant amounts in newspapers', year: 1996, country: 'Uganda', policyKind: 'transparency', reaction: 'grant capture fell from ~80% to ~20%, broadly welcomed', magnitude: 0.05, durationMonths: 12, delayMonths: 12, url: 'https://doi.org/10.1162/jeea.2005.3.2-3.259' },
  { id: 'indonesia_audits', event: 'audits of village road projects announced in advance', year: 2004, country: 'Indonesia', policyKind: 'anticorruption', reaction: 'missing funds fell ~8 points, officials resented the scrutiny', magnitude: 0.1, durationMonths: 12, delayMonths: 6, url: 'https://doi.org/10.1086/517935' },
  { id: 'georgia_police_2004', event: 'Georgia fires its entire traffic police force overnight', year: 2004, country: 'Georgia', policyKind: 'anticorruption', reaction: 'bribery collapsed, trust in police rose sharply, fired officers protested', magnitude: 0.3, durationMonths: 12, delayMonths: 0, url: `${W}Corruption_in_Georgia` },
  { id: 'ireland_citizens_assembly', event: '99 randomly chosen citizens deliberate on the constitution', year: 2016, country: 'Ireland', policyKind: 'citizens_assembly', reaction: 'recommendations passed by referendum, wide trust in the process', magnitude: 0.05, durationMonths: 24, delayMonths: 6, url: `${W}Citizens%27_Assembly_(Ireland)` },
  { id: 'vtaiwan', event: 'vTaiwan online deliberation on digital laws', year: 2015, country: 'Taiwan', policyKind: 'citizens_assembly', reaction: 'consensus on ride-hailing and online alcohol rules, used as a model abroad', magnitude: 0.05, durationMonths: 12, delayMonths: 3, url: `${W}Pol.is` },
  { id: 'swiss_referendums', event: 'binding national referendums several times a year', year: 1891, country: 'Switzerland', policyKind: 'referendum', reaction: 'high acceptance of outcomes even by losing sides', magnitude: 0.05, durationMonths: 12, delayMonths: 3, url: `${W}Politics_of_Switzerland` },
  { id: 'soviet_propaganda', event: 'state media monopoly on news', year: 1922, country: 'Soviet Union', policyKind: 'propaganda', reaction: 'public compliance with private cynicism; trust collapsed once alternatives appeared', magnitude: 0.2, durationMonths: 60, delayMonths: 12, url: `${W}Propaganda_in_the_Soviet_Union` },
  { id: 'luddites', event: 'machine breakers smash textile frames', year: 1811, country: 'United Kingdom', policyKind: 'automation_limit', reaction: 'frame-breaking made a capital crime, ~12,000 troops deployed', magnitude: 0.6, durationMonths: 60, delayMonths: 0, url: `${W}Luddite` },
  { id: 'korea_robot_tax', event: 'South Korea trims tax breaks for automation investment', year: 2017, country: 'South Korea', policyKind: 'robot_tax', reaction: 'industry complained of lost competitiveness, labor groups approved', magnitude: 0.15, durationMonths: 12, delayMonths: 6, url: 'https://en.wikipedia.org/wiki/Robot_tax' },
  { id: 'denmark_flexicurity', event: 'easy hiring and firing paired with generous retraining', year: 1994, country: 'Denmark', policyKind: 'retraining', reaction: 'low long-term unemployment, broad support from unions and employers', magnitude: 0.05, durationMonths: 24, delayMonths: 12, url: `${W}Flexicurity` },
  { id: 'india_nrega', event: 'guaranteed 100 days of paid rural work per household', year: 2005, country: 'India', policyKind: 'job_guarantee', reaction: 'popular with rural workers, criticized for leakage', magnitude: 0.1, durationMonths: 24, delayMonths: 6, url: `${W}National_Rural_Employment_Guarantee_Act,_2005` },
  { id: 'iceland_short_week', event: 'shorter working week trials for public workers', year: 2015, country: 'Iceland', policyKind: 'shorter_week', reaction: 'wellbeing up, output held, most workers moved to shorter hours by 2021', magnitude: 0.05, durationMonths: 12, delayMonths: 6, url: 'https://autonomy.work/portfolio/icelandsww/' },
  { id: 'finland_ubi', event: 'basic income paid to 2,000 unemployed people', year: 2017, country: 'Finland', policyKind: 'basic_income', reaction: 'wellbeing rose, employment barely changed, the trial was not extended', magnitude: 0.1, durationMonths: 24, delayMonths: 6, url: `${W}Universal_basic_income_pilots` },
  { id: 'norway_wealth_tax_2022', event: 'Norway raises its wealth tax', year: 2022, country: 'Norway', policyKind: 'wealth_tax', reaction: 'dozens of the richest moved to Switzerland, public support held', magnitude: 0.2, durationMonths: 24, delayMonths: 6, url: 'https://en.wikipedia.org/wiki/Wealth_tax' },
  { id: 'malaysia_capital_controls', event: 'Malaysia imposes capital controls in the asian financial crisis', year: 1998, country: 'Malaysia', policyKind: 'capital_controls', reaction: 'outflows stopped, investors and the IMF objected, controls eased within a year', magnitude: 0.2, durationMonths: 12, delayMonths: 0, url: `${W}1997_Asian_financial_crisis` },
  { id: 'venezuela_expropriation', event: 'wave of nationalizations and expropriations', year: 2007, country: 'Venezuela', policyKind: 'expropriation', reaction: 'capital flight and emigration of professionals, output collapsed over a decade', magnitude: 0.5, durationMonths: 48, delayMonths: 3, url: `${W}Economy_of_Venezuela` },
  { id: 'vienna_gemeindebau', event: 'Red Vienna builds 64,000 council flats funded by a housing tax', year: 1923, country: 'Austria', policyKind: 'social_housing', reaction: 'broad support among workers, landlords and the right opposed the tax; the flats are still lived in', magnitude: 0.2, durationMonths: 24, delayMonths: 12, url: `${W}Gemeindebau` },
  { id: 'singapore_hdb', event: 'Housing and Development Board builds mass public flats', year: 1960, country: 'Singapore', policyKind: 'social_housing', reaction: 'early resistance to moving from kampongs, then near universal uptake; ~80% now live in HDB flats', magnitude: 0.25, durationMonths: 24, delayMonths: 6, url: `${W}Housing_and_Development_Board` },
  { id: 'berlin_mietendeckel', event: 'Berlin freezes and caps rents for five years', year: 2020, country: 'Germany', policyKind: 'rent_control', reaction: 'tenants cheered, landlords sued; rental listings roughly halved and the court struck the law down in 2021', magnitude: 0.35, durationMonths: 14, delayMonths: 2, url: 'https://de.wikipedia.org/wiki/Mietendeckel' },
  { id: 'sf_rent_control_1994', event: 'San Francisco extends rent control to small multifamily buildings', year: 1994, country: 'United States', policyKind: 'rent_control', reaction: 'tenants stayed longer, landlords converted units to condos; rental supply fell ~15%', magnitude: 0.25, durationMonths: 18, delayMonths: 6, url: 'https://doi.org/10.1257/aer.20181289' },
  { id: 'auckland_upzoning', event: 'Auckland Unitary Plan upzones three quarters of residential land', year: 2016, country: 'New Zealand', policyKind: 'upzoning', reaction: 'homeowner groups objected to density; building consents roughly doubled in upzoned areas', magnitude: 0.3, durationMonths: 18, delayMonths: 6, url: 'https://doi.org/10.1016/j.jue.2023.103555' },
  { id: 'minneapolis_2040', event: 'Minneapolis ends single-family-only zoning', year: 2019, country: 'United States', policyKind: 'upzoning', reaction: 'loud neighborhood opposition and lawsuits, rents rose slower than in the region afterward', magnitude: 0.3, durationMonths: 24, delayMonths: 3, url: 'https://minneapolis2040.com/' },
  { id: 'kampung_improvement', event: 'Kampung Improvement Program brings roads, water and drains to informal neighborhoods', year: 1969, country: 'Indonesia', policyKind: 'slum_upgrading', reaction: 'widely welcomed, ~5 million residents reached over two decades', magnitude: 0.1, durationMonths: 12, delayMonths: 12, url: `${W}History_of_Jakarta` },
  { id: 'favela_bairro', event: 'Favela-Bairro upgrades Rio de Janeiro favelas in place', year: 1994, country: 'Brazil', policyKind: 'slum_upgrading', reaction: 'residents supported upgrades over removal, some complaints about rising rents after', magnitude: 0.1, durationMonths: 12, delayMonths: 12, url: `${W}Favela` },
  { id: 'murambatsvina', event: 'Operation Murambatsvina demolishes informal homes and markets', year: 2005, country: 'Zimbabwe', policyKind: 'slum_clearance', reaction: 'about 700,000 lost homes or livelihoods in weeks, UN condemnation, deep lasting anger', magnitude: 0.8, durationMonths: 24, delayMonths: 0, url: `${W}Operation_Murambatsvina` },
  { id: 'peru_cofopri', event: 'Peru gives property titles to informal settlers', year: 1996, country: 'Peru', policyKind: 'land_titling', reaction: 'popular; ~1.2 million titles in four years, titled families worked more outside the home', magnitude: 0.1, durationMonths: 12, delayMonths: 6, url: 'https://doi.org/10.1162/qjec.2007.122.4.1561' },
  { id: 'vancouver_empty_homes', event: 'Vancouver taxes homes left empty', year: 2017, country: 'Canada', policyKind: 'vacancy_tax', reaction: 'owners of second homes objected, most residents supported it; vacant homes fell by about a third', magnitude: 0.15, durationMonths: 12, delayMonths: 6, url: 'https://vancouver.ca/home-property-development/empty-homes-tax.aspx' },
  { id: 'uk_rationing', event: 'wartime food rationing', year: 1940, country: 'United Kingdom', policyKind: 'rationing', reaction: 'broad compliance while the threat was visible, growing resentment once the war ended', magnitude: 0.3, durationMonths: 168, delayMonths: 6, url: `${W}Rationing_in_the_United_Kingdom` },
  { id: 'india_pds', event: 'public distribution system for staple grain', year: 1965, country: 'India', policyKind: 'food_reserve', reaction: 'broad support, persistent leakage and queues', magnitude: 0.15, durationMonths: 600, delayMonths: 3, url: `${W}Public_distribution_system_(India)` },
  { id: 'green_revolution_india', event: 'high-yield seeds, fertilizer and irrigation push', year: 1966, country: 'India', policyKind: 'agriculture_push', reaction: 'large yield gains, little public resistance, later water and soil concerns', magnitude: 0.1, durationMonths: 120, delayMonths: 12, url: `${W}Green_Revolution_in_India` },
  { id: 'great_leap', event: 'forced collectivization of farms', year: 1958, country: 'China', policyKind: 'collectivization', reaction: 'output collapsed, famine killed tens of millions', magnitude: 0.95, durationMonths: 36, delayMonths: 6, url: `${W}Great_Leap_Forward` },
  // relocation and big projects
  { id: 'three_gorges', event: 'dam project relocates about 1.3 million people', year: 1994, country: 'China', policyKind: 'relocation', reaction: 'local grievances and petitions for decades', magnitude: 0.5, durationMonths: 200, delayMonths: 6, url: `${W}Three_Gorges_Dam` },
  { id: 'tva', event: 'regional dam and electrification program', year: 1933, country: 'United States', policyKind: 'electrification', reaction: 'popular overall, thousands of displaced families resented it', magnitude: 0.2, durationMonths: 120, delayMonths: 6, url: `${W}Tennessee_Valley_Authority` },
  { id: 'apollo_opinion', event: 'crewed moon program funded at its peak', year: 1965, country: 'United States', policyKind: 'big_project', reaction: 'public support for the spending often sat below half, except right after the landing', magnitude: 0.35, durationMonths: 96, delayMonths: 12, url: `${W}Apollo_program` },
  { id: 'big_dig', event: 'highway tunnel megaproject runs far over budget', year: 1991, country: 'United States', policyKind: 'big_project', reaction: 'years of anger over cost, then quiet acceptance', magnitude: 0.25, durationMonths: 180, delayMonths: 24, url: `${W}Big_Dig` },
  { id: 'entsoe', event: 'national grids synchronized into one continental grid', year: 1958, country: 'Europe', policyKind: 'grid_integration', reaction: 'low public attention, steady reliability gains', magnitude: 0.05, durationMonths: 400, delayMonths: 12, url: `${W}Synchronous_grid_of_Continental_Europe` },
  { id: 'dagen_h', event: 'whole country switches to driving on the right', year: 1967, country: 'Sweden', policyKind: 'big_change', reaction: 'most voters had rejected it in a referendum, the switch itself went smoothly', magnitude: 0.3, durationMonths: 3, delayMonths: 0, url: `${W}Dagen_H` },
  // religion
  { id: 'soviet_religion', event: 'decades of state campaigns against religion', year: 1928, country: 'Soviet Union', policyKind: 'religion_suppression', reaction: 'open practice fell, private belief persisted and revived after 1991', magnitude: 0.6, durationMonths: 240, delayMonths: 3, url: `${W}Religion_in_the_Soviet_Union` },
  { id: 'albania_1967', event: 'religion banned outright, country declared atheist', year: 1967, country: 'Albania', policyKind: 'religion_suppression', reaction: 'enforced by terror, faith returned quickly once allowed', magnitude: 0.5, durationMonths: 280, delayMonths: 1, url: `${W}Religion_in_Albania` },
  { id: 'france_1905', event: 'law separating churches and the state', year: 1905, country: 'France', policyKind: 'secular_state', reaction: 'bitter conflict for a decade, then a settled norm', magnitude: 0.5, durationMonths: 120, delayMonths: 2, url: `${W}1905_French_law_on_the_Separation_of_the_Churches_and_the_State` },
  { id: 'ataturk_reforms', event: 'secular reforms including the hat law', year: 1925, country: 'Turkey', policyKind: 'secular_state', reaction: 'local revolts and executions, reforms held in cities', magnitude: 0.55, durationMonths: 60, delayMonths: 1, url: `${W}Atat%C3%BCrk%27s_reforms` },
  { id: 'iran_1979', event: 'state religion imposed after a revolution', year: 1979, country: 'Iran', policyKind: 'state_religion', reaction: 'secular and minority groups resisted for decades, periodic mass protests', magnitude: 0.6, durationMonths: 240, delayMonths: 6, url: `${W}Iranian_Revolution` },
  // money
  { id: 'india_2016', event: '86 percent of cash in circulation invalidated overnight', year: 2016, country: 'India', policyKind: 'currency_shock', reaction: 'weeks of bank queues and lost wages, surprisingly little organized protest', magnitude: 0.5, durationMonths: 3, delayMonths: 0, url: `${W}2016_Indian_banknote_demonetisation` },
  { id: 'corralito', event: 'bank deposits frozen', year: 2001, country: 'Argentina', policyKind: 'currency_shock', reaction: 'riots and pot-banging protests, the president resigned', magnitude: 0.9, durationMonths: 6, delayMonths: 0, url: `${W}Corralito` },
  { id: 'poll_tax', event: 'flat per-person local tax introduced', year: 1990, country: 'United Kingdom', policyKind: 'head_tax', reaction: 'mass non-payment and riots, tax scrapped, prime minister fell', magnitude: 0.8, durationMonths: 12, delayMonths: 3, url: `${W}Poll_tax_riots` },
  { id: 'france_pension_2023', event: 'retirement age raised from 62 to 64', year: 2023, country: 'France', policyKind: 'pension_cut', reaction: 'months of strikes, the reform passed anyway', magnitude: 0.7, durationMonths: 6, delayMonths: 0, url: `${W}2023_French_pension_reform_unrest` },
  { id: 'alaska_pfd', event: 'permanent fund dividend paid to every resident', year: 1982, country: 'United States', policyKind: 'basic_income', reaction: 'very popular, politically hard to cut', magnitude: 0.1, durationMonths: 500, delayMonths: 6, url: `${W}Alaska_Permanent_Fund` },
  { id: 'mincome', event: 'guaranteed annual income experiment in Dauphin', year: 1974, country: 'Canada', policyKind: 'basic_income', reaction: 'hospital visits fell, work hours barely changed', magnitude: 0.15, durationMonths: 48, delayMonths: 6, url: `${W}Mincome` },
  // carbon pricing
  { id: 'australia_carbon', event: 'carbon price introduced', year: 2012, country: 'Australia', policyKind: 'carbon_tax', reaction: 'axe the tax campaign won an election, repealed in 2014', magnitude: 0.5, durationMonths: 24, delayMonths: 3, url: `${W}Carbon_pricing_in_Australia` },
  { id: 'canada_carbon', event: 'revenue neutral carbon tax with rebates', year: 2008, country: 'Canada', policyKind: 'carbon_tax', reaction: 'initial opposition faded while rebates were visible', magnitude: 0.25, durationMonths: 24, delayMonths: 3, url: `${W}Carbon_pricing_in_Canada` },
  // lockdowns and assembly limits
  { id: 'covid_protests', event: 'pandemic lockdowns and mandates', year: 2020, country: 'world', policyKind: 'lockdown', reaction: 'compliance high at first, protests grew as months passed', magnitude: 0.45, durationMonths: 12, delayMonths: 2, url: `${W}Protests_against_responses_to_the_COVID-19_pandemic` },
  { id: 'china_2022', event: 'zero covid lockdowns in their third year', year: 2022, country: 'China', policyKind: 'lockdown', reaction: 'rare nationwide protests, policy dropped within weeks', magnitude: 0.7, durationMonths: 2, delayMonths: 1, url: `${W}2022_COVID-19_protests_in_China` },
  { id: 'hk_mask', event: 'emergency ban on face coverings at protests', year: 2019, country: 'Hong Kong', policyKind: 'assembly_limit', reaction: 'protests grew the same weekend', magnitude: 0.8, durationMonths: 6, delayMonths: 0, url: `${W}Prohibition_on_Face_Covering_Regulation` },
  { id: 'us_prohibition', event: 'nationwide ban on alcohol', year: 1920, country: 'United States', policyKind: 'prohibition', reaction: 'mass quiet noncompliance and organized crime, repealed in 1933', magnitude: 0.5, durationMonths: 156, delayMonths: 6, url: `${W}Prohibition_in_the_United_States` },
  // service and conscription
  { id: 'vietnam_draft', event: 'conscription for an unpopular war', year: 1965, country: 'United States', policyKind: 'conscription', reaction: 'draft card burnings and campus protests for years', magnitude: 0.7, durationMonths: 72, delayMonths: 6, url: `${W}Opposition_to_United_States_involvement_in_the_Vietnam_War` },
  { id: 'russia_2022', event: 'partial military mobilization', year: 2022, country: 'Russia', policyKind: 'conscription', reaction: 'hundreds of thousands left the country within weeks', magnitude: 0.7, durationMonths: 3, delayMonths: 0, url: `${W}2022_Russian_mobilization` },
  { id: 'canada_1917', event: 'overseas conscription imposed', year: 1917, country: 'Canada', policyKind: 'conscription', reaction: 'riots in Quebec, a lasting regional split', magnitude: 0.6, durationMonths: 12, delayMonths: 3, url: `${W}Conscription_Crisis_of_1917` },
  { id: 'zivildienst', event: 'civilian service as an alternative to conscription', year: 1961, country: 'West Germany', policyKind: 'national_service', reaction: 'became normal, the care sector came to rely on it', magnitude: 0.2, durationMonths: 600, delayMonths: 12, url: `${W}Zivildienst` },
  // schools and language
  { id: 'finland_school', event: 'comprehensive school reform', year: 1972, country: 'Finland', policyKind: 'school_reform', reaction: 'slow, then large long-term attainment gains', magnitude: 0.2, durationMonths: 120, delayMonths: 12, url: `${W}Education_in_Finland` },
  { id: 'soweto_1976', event: 'Afrikaans imposed as a medium of instruction', year: 1976, country: 'South Africa', policyKind: 'language_reform', reaction: 'student uprising, hundreds killed', magnitude: 0.9, durationMonths: 12, delayMonths: 2, url: `${W}Soweto_uprising` },
  { id: 'bengali_1952', event: 'Urdu declared the only state language', year: 1952, country: 'Pakistan', policyKind: 'language_reform', reaction: 'student protests and deaths, Bengali later made official', magnitude: 0.8, durationMonths: 48, delayMonths: 3, url: `${W}Bengali_language_movement` },
  { id: 'tamil_1965', event: 'Hindi set to become the sole official language', year: 1965, country: 'India', policyKind: 'language_reform', reaction: 'weeks of riots, English kept alongside Hindi', magnitude: 0.7, durationMonths: 3, delayMonths: 0, url: `${W}Anti-Hindi_agitations_of_Tamil_Nadu` },
  // families
  { id: 'hungary_family', event: 'family tax breaks, loans and housing grants for parents', year: 2011, country: 'Hungary', policyKind: 'pronatal', reaction: 'fertility rose from 1.23 to about 1.6 by 2021, then slipped back', magnitude: 0.1, durationMonths: 120, delayMonths: 24, tfrEffect: 0.25, url: `${W}Demographics_of_Hungary` },
  { id: 'korea_pronatal', event: 'two decades of spending to raise births', year: 2006, country: 'South Korea', policyKind: 'pronatal', reaction: 'fertility kept falling, to 0.72 in 2023', magnitude: 0.05, durationMonths: 200, delayMonths: 24, tfrEffect: 0.0, url: `${W}Demographics_of_South_Korea` },
  { id: 'france_family', event: 'long-running family allowances and childcare', year: 1946, country: 'France', policyKind: 'pronatal', reaction: 'among the highest fertility in Europe for decades', magnitude: 0.05, durationMonths: 600, delayMonths: 36, tfrEffect: 0.2, url: `${W}Demographics_of_France` },
  { id: 'one_child', event: 'one child limit per family', year: 1980, country: 'China', policyKind: 'birth_limit', reaction: 'coercion, rural resistance, lasting sex ratio and aging problems', magnitude: 0.6, durationMonths: 420, delayMonths: 6, tfrEffect: -0.6, url: `${W}One-child_policy` },
  { id: 'india_emergency', event: 'forced sterilization drive during emergency rule', year: 1976, country: 'India', policyKind: 'birth_limit', reaction: 'fury that cost the government the next election', magnitude: 0.85, durationMonths: 21, delayMonths: 3, tfrEffect: -0.1, url: `${W}The_Emergency_(India)` },
  // health
  { id: 'nhs_1948', event: 'free universal health service', year: 1948, country: 'United Kingdom', policyKind: 'healthcare_expansion', reaction: 'became the most popular public institution in the country', magnitude: 0.1, durationMonths: 600, delayMonths: 6, url: `${W}National_Health_Service` },
  { id: 'aca_2010', event: 'health insurance expansion with a mandate', year: 2010, country: 'United States', policyKind: 'healthcare_expansion', reaction: 'polarized and unpopular for years, majority support by 2017', magnitude: 0.4, durationMonths: 84, delayMonths: 3, url: `${W}Affordable_Care_Act` },
  { id: 'smallpox', event: 'global smallpox vaccination campaign', year: 1967, country: 'world', policyKind: 'vaccination', reaction: 'local resistance in places, disease eradicated by 1980', magnitude: 0.15, durationMonths: 156, delayMonths: 6, url: `${W}Smallpox#Eradication` },
]

export const precedentById = new Map(PRECEDENTS.map(p => [p.id, p]))

// ---------- classification ----------
// keyword rules in priority order. the llm writes the text; this code decides what kind of policy it is.
const RULES: [string, RegExp][] = [
  ['fuel_subsidy_cut', /(cut|remove|end|phase out|abolish).{0,30}(fuel|energy|gas|petrol|electricity).{0,15}subsid|subsid.{0,30}(fuel|energy|petrol).{0,30}(cut|remov|end|phase)/],
  ['food_subsidy_cut', /(cut|remove|end|phase out).{0,30}(food|bread|grain).{0,15}subsid/],
  ['slum_clearance', /(clear|demolish|raze|bulldoz|evict|remov).{0,30}(slum|informal settlement|shanty|squatter|favela)/],
  ['slum_upgrading', /(slum|informal settlement|favela|shanty|squatter).{0,30}(upgrad|improv|servic|water|sanitation|sewer)|upgrad.{0,20}(slum|informal|favela)/],
  ['land_titling', /land titl|property titl|title deed|formali[sz].{0,20}(land|propert|tenure)/],
  ['vacancy_tax', /vacan(cy|t).{0,15}tax|empty home.{0,10}tax|tax.{0,20}(empty|vacant) (home|house|propert)/],
  ['rent_control', /rent (control|freeze|cap|ceiling|stabili)|cap.{0,10}rents|freez.{0,10}rents|tenant protect/],
  ['upzoning', /upzon|zoning reform|rezon|densif|(relax|loosen|reform).{0,20}(zoning|building permit|planning rule)/],
  ['social_housing', /(social|public|council|affordable|state) (housing|homes|flats|apartments)|housing (program|programme|project|estate|construction|authority)|build.{0,20}(homes|houses|housing|flats)/],
  ['media_literacy', /media literacy|critical thinking|fact.?check|news literacy/],
  ['sea_wall', /sea ?wall|\bdikes?\b|\bdykes?\b|levee|storm surge barrier|coastal defen|flood barrier|delta works/],
  ['naval_escort', /naval escort|escort.{0,10}(tankers|ships|shipping|convoys)|protect shipping|freedom of navigation/],
  ['strategic_reserve', /strategic (petroleum|oil|fuel|energy) reserve|oil reserve|fuel stockpile/],
  ['alt_route', /bypass pipeline|pipeline.{0,15}(around|bypass)|alternative (shipping )?routes?|overland route|land bridge/],
  ['grid_hardening', /grid hardening|harden.{0,20}grid|transformer (reserve|stockpile)|geomagnetic|space weather/],
  ['planetary_defense', /planetary defen|asteroid (deflection|detection|defen)|near.earth object/],
  ['recycling', /recycl|urban mining|circular economy|critical (raw )?minerals?/],
  ['data_center', /data cent|compute (farm|capacity|buildout|build.out)|server farm|ai infrastructure/],
  ['citizens_assembly', /citizens'? assembl|sortition|deliberative|participatory budget/],
  ['referendum', /referend|plebiscite|ballot initiative|popular vote on/],
  ['transparency', /transparen|open budget|publish.{0,20}(budget|spending|decision|reasoning)|freedom of information/],
  ['anticorruption', /corrupt|audit|anti.graft|bribe|embezzl/],
  ['propaganda', /propaganda|state media|messaging campaign|information campaign|public relations/],
  ['robot_tax', /robot tax|automation tax|tax.{0,10}(robots|automation)/],
  ['automation_limit', /(ban|limit|slow|restrict|pause).{0,20}(automation|robots|\bai\b|artificial intelligence)/],
  ['retraining', /retrain|reskill|job training|apprenticeship|flexicurity/],
  ['job_guarantee', /job guarantee|employment guarantee|public works program|guaranteed (work|employment)/],
  ['shorter_week', /four.day|4.day|shorter (work|working) week|reduced (working|work) hours|working week/],
  ['capital_controls', /capital control|exit tax|ban.{0,20}(capital|money).{0,10}(transfer|outflow|flight)/],
  ['conservation', /protected area|national park|nature conservation|conservation area|wildlife|biodiversity|rewild|30x30|nature reserve/],
  ['carbon_tax', /carbon (tax|price|pricing|levy)|emissions? (tax|levy)/],
  ['energy_tax', /(tax|levy|surcharge).{0,30}(fuel|petrol|gasoline|diesel|energy)|(fuel|energy|petrol).{0,15}(tax|levy)/],
  ['birth_limit', /(limit|cap|restrict|reduce).{0,25}(birth|child|famil)|one.child|two.child|steriliz/],
  ['pronatal', /(child|family|parent|baby|birth).{0,25}(benefit|allowance|bonus|grant|leave|credit|support)|fertility|childcare|maternity|paternity/],
  ['religion_suppression', /(ban|restrict|limit|discourag|prohibit|close|suppress).{0,40}(relig|worship|church|mosque|temple|faith|clergy)|(relig|worship|faith).{0,30}(ban|restrict|limit|prohibit)/],
  ['state_religion', /(state|official|national) (faith|religion|church)|mandatory prayer/],
  ['secular_state', /secular|separat.{0,20}(church|religion)|religious neutrality/],
  ['currency_shock', /currency|banknote|demoneti|cash (ban|withdraw)|digital currency|deposit freeze/],
  ['lockdown', /lockdown|quarantine|stay.at.home|mask mandate/],
  ['assembly_limit', /assembl|protest ban|curfew|censor|press control|internet shutdown/],
  ['conscription', /conscript|draft|military service|mobiliz/],
  ['national_service', /national service|civil(ian)? service year|community service/],
  ['language_reform', /language|lingua franca|official tongue/],
  ['school_reform', /school|curricul|education|literacy|universit|teacher/],
  ['relocation', /relocat|resettl|evacuat|move .{0,20}(people|population|residents)/],
  ['collectivization', /collectiv|nationaliz.{0,20}(farm|land)|state farm/],
  ['expropriation', /expropriat|confiscat|seize.{0,20}(assets|wealth|property|fortunes)/],
  ['rationing', /\bration(s|ing|ed)?\b/],
  ['food_reserve', /(food|grain) (reserve|aid|bank|security)|famine relief/],
  ['agriculture_push', /agricultur|farm|crop|irrigat|fertili[sz]er|yield|seed/],
  ['vaccination', /vaccin|immuniz|eradicat/],
  ['healthcare_expansion', /health|hospital|clinic|medical|medicine/],
  ['pension_cut', /(retirement|pension) age|(cut|reduce).{0,20}pension/],
  ['head_tax', /poll tax|head tax|flat tax|per.person tax/],
  ['wealth_tax', /wealth tax|income tax|tax on (the )?(rich|wealth|income)|progressive tax/],
  ['basic_income', /basic income|cash transfer|dividend|guaranteed income/],
  ['prohibition', /(ban|prohibit).{0,20}(alcohol|drug|tobacco|meat|car)/],
  ['grid_integration', /grid|transmission|power line|interconnect/],
  ['electrification', /electrif|solar|\bwind\b|nuclear|power plant|\bfusion|energy/],
  ['big_project', /space|lunar|moon|\bmars\b|rocket|launch|orbit|\bdams?\b|megaproject|\brail|canal|\bcit(y|ies)\b|settlement|habitat|exploration/],
  ['research_push', /research|science|laborator|technolog|innovation/],
]

export type LawMeta = { policyKind: string; precedentIds: string[]; magnitude: number; delayMonths: number; durationMonths: number; tfrEffect: number; estimate: boolean; lovedBy: string[]; hatedBy: string[] }

export function classifyPolicy(law: Pick<Law, 'title' | 'text' | 'layer'>): string {
  const t = `${law.title} ${law.text}`.toLowerCase()
  for (const [kind, re] of RULES) if (re.test(t)) return kind
  return 'other'
}

// who tends to win and lose under each kind of policy (in-group / out-group, Tajfel & Turner 1979).
// labels are group descriptions matched against citizens' GroupKey, or faction ids. ESTIMATE readings.
export const GROUP_STAKES: Record<string, { lovedBy: string[]; hatedBy: string[] }> = {
  fuel_subsidy_cut: { lovedBy: ['science'], hatedBy: ['low income', 'labor', 'old_energy'] },
  food_subsidy_cut: { lovedBy: ['business'], hatedBy: ['low income', 'elders', 'labor'] },
  carbon_tax: { lovedBy: ['science', 'young'], hatedBy: ['old_energy', 'low income', 'industry workers'] },
  energy_tax: { lovedBy: ['science'], hatedBy: ['low income', 'old_energy', 'industry workers'] },
  birth_limit: { lovedBy: ['bureaucrats'], hatedBy: ['religious', 'young', 'religious_faction'] },
  pronatal: { lovedBy: ['young', 'religious'], hatedBy: ['high income', 'business'] },
  religion_suppression: { lovedBy: ['secular'], hatedBy: ['religious', 'religious_faction', 'elders'] },
  state_religion: { lovedBy: ['religious', 'religious_faction'], hatedBy: ['secular', 'science'] },
  secular_state: { lovedBy: ['secular', 'science'], hatedBy: ['religious', 'religious_faction'] },
  currency_shock: { lovedBy: ['bureaucrats'], hatedBy: ['low income', 'farm workers', 'business'] },
  lockdown: { lovedBy: ['elders'], hatedBy: ['young', 'business', 'service workers'] },
  assembly_limit: { lovedBy: ['military'], hatedBy: ['young', 'labor', 'secular'] },
  conscription: { lovedBy: ['military', 'elders'], hatedBy: ['young', 'labor'] },
  national_service: { lovedBy: ['elders'], hatedBy: ['young'] },
  language_reform: { lovedBy: ['bureaucrats'], hatedBy: ['regional_nationalist', 'kids', 'elders'] },
  school_reform: { lovedBy: ['kids', 'science', 'young'], hatedBy: ['religious_faction'] },
  relocation: { lovedBy: ['business'], hatedBy: ['regional_nationalist', 'farm workers', 'elders'] },
  collectivization: { lovedBy: ['bureaucrats'], hatedBy: ['farm workers', 'business', 'religious'] },
  media_literacy: { lovedBy: ['science', 'young'], hatedBy: [] },
  sea_wall: { lovedBy: ['elders', 'business'], hatedBy: [] },
  naval_escort: { lovedBy: ['military', 'business'], hatedBy: [] },
  strategic_reserve: { lovedBy: ['business'], hatedBy: [] },
  alt_route: { lovedBy: ['business', 'industry workers'], hatedBy: [] },
  grid_hardening: { lovedBy: ['science'], hatedBy: [] },
  planetary_defense: { lovedBy: ['science'], hatedBy: [] },
  recycling: { lovedBy: ['science', 'young'], hatedBy: [] },
  data_center: { lovedBy: ['science', 'business'], hatedBy: ['low income'] },
  citizens_assembly: { lovedBy: ['young', 'secular', 'science'], hatedBy: ['bureaucrats'] },
  referendum: { lovedBy: ['elders', 'low income'], hatedBy: ['bureaucrats'] },
  transparency: { lovedBy: ['young', 'science', 'low income'], hatedBy: ['bureaucrats'] },
  anticorruption: { lovedBy: ['low income', 'young', 'business'], hatedBy: ['bureaucrats'] },
  propaganda: { lovedBy: ['bureaucrats'], hatedBy: ['young', 'science'] },
  robot_tax: { lovedBy: ['labor', 'industry workers'], hatedBy: ['business', 'science'] },
  automation_limit: { lovedBy: ['labor', 'industry workers', 'elders'], hatedBy: ['business', 'science'] },
  retraining: { lovedBy: ['labor', 'young'], hatedBy: [] },
  job_guarantee: { lovedBy: ['labor', 'low income'], hatedBy: ['business'] },
  shorter_week: { lovedBy: ['labor', 'young'], hatedBy: ['business'] },
  capital_controls: { lovedBy: ['labor'], hatedBy: ['business', 'high income'] },
  expropriation: { lovedBy: ['low income'], hatedBy: ['business', 'high income'] },
  conservation: { lovedBy: ['science', 'young'], hatedBy: ['business', 'old_energy'] },
  social_housing: { lovedBy: ['low income', 'young', 'labor'], hatedBy: ['high income'] },
  rent_control: { lovedBy: ['low income', 'young'], hatedBy: ['high income', 'business'] },
  upzoning: { lovedBy: ['young', 'business'], hatedBy: ['elders', 'high income'] },
  slum_upgrading: { lovedBy: ['low income'], hatedBy: [] },
  slum_clearance: { lovedBy: ['business', 'bureaucrats'], hatedBy: ['low income', 'labor', 'young'] },
  land_titling: { lovedBy: ['low income', 'business'], hatedBy: [] },
  vacancy_tax: { lovedBy: ['young', 'low income'], hatedBy: ['high income'] },
  rationing: { lovedBy: ['low income'], hatedBy: ['high income', 'business'] },
  food_reserve: { lovedBy: ['low income', 'elders'], hatedBy: ['business'] },
  agriculture_push: { lovedBy: ['farm workers', 'business'], hatedBy: [] },
  vaccination: { lovedBy: ['science', 'elders'], hatedBy: ['conspiracy'] },
  healthcare_expansion: { lovedBy: ['low income', 'elders'], hatedBy: ['high income'] },
  pension_cut: { lovedBy: ['business'], hatedBy: ['elders', 'labor', 'adults'] },
  head_tax: { lovedBy: ['high income'], hatedBy: ['low income', 'labor'] },
  wealth_tax: { lovedBy: ['low income', 'labor'], hatedBy: ['high income', 'business'] },
  basic_income: { lovedBy: ['low income', 'young'], hatedBy: ['high income'] },
  prohibition: { lovedBy: ['religious'], hatedBy: ['young', 'business'] },
  grid_integration: { lovedBy: ['science', 'business'], hatedBy: ['old_energy'] },
  electrification: { lovedBy: ['science', 'low income'], hatedBy: ['old_energy'] },
  big_project: { lovedBy: ['science', 'business', 'industry workers'], hatedBy: ['low income', 'regional_nationalist'] },
  research_push: { lovedBy: ['science', 'young'], hatedBy: [] },
  big_change: { lovedBy: ['bureaucrats'], hatedBy: ['elders'] },
  other: { lovedBy: [], hatedBy: [] },
}

// precedent defaults when nothing matches (ESTIMATE)
const DEFAULT_META = { magnitude: 0.3, delayMonths: 3, durationMonths: 12, tfrEffect: 0 }
export const unmatchedLog: string[] = []

export function lawMeta(law: Pick<Law, 'title' | 'text' | 'layer'>): LawMeta {
  const policyKind = classifyPolicy(law)
  const matches = PRECEDENTS.filter(p => p.policyKind === policyKind)
  // pick up to 3 precedents, closest by shared title words, stable order
  const words = new Set(`${law.title} ${law.text}`.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  const ranked = matches
    .map(p => ({ p, s: p.event.toLowerCase().split(/\W+/).filter(w => words.has(w)).length }))
    .sort((a, b) => b.s - a.s || a.p.year - b.p.year)
    .slice(0, 3).map(x => x.p)
  const stakes = GROUP_STAKES[policyKind] ?? GROUP_STAKES.other
  if (!ranked.length) {
    unmatchedLog.push(`ESTIMATE: no precedent for "${law.title}" (${policyKind})`)
    return { policyKind, precedentIds: [], ...DEFAULT_META, estimate: true, ...stakes }
  }
  const avg = (f: (p: P) => number) => ranked.reduce((a, p) => a + f(p), 0) / ranked.length
  return {
    policyKind, precedentIds: ranked.map(p => p.id), estimate: false,
    magnitude: avg(p => p.magnitude), delayMonths: Math.round(Math.min(...ranked.map(p => p.delayMonths))),
    durationMonths: Math.round(Math.min(48, avg(p => p.durationMonths))), tfrEffect: avg(p => p.tfrEffect ?? 0),
    ...stakes,
  }
}

export function publicPrecedents(ids: Iterable<string>): Precedent[] {
  const out: Precedent[] = []
  for (const id of new Set(ids)) {
    const p = precedentById.get(id)
    if (p) out.push({ id: p.id, event: p.event, year: p.year, country: p.country, policyKind: p.policyKind, reaction: p.reaction, magnitude: p.magnitude, durationMonths: p.durationMonths, url: p.url })
  }
  return out
}
