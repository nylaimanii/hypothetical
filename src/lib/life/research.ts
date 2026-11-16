// every effect size the life rules use, with where it comes from. SOURCED = the number is the paper's
// headline estimate (rounded); ESTIMATE = a judgement call informed by the cited work, not a number it reports.
// the life sim never invents a stat and presents it as real: if it isn't here, it isn't used.

export const RESEARCH = {
  // ---- mortality shape ----
  // adult mortality rises roughly exponentially with age (gompertz), doubling about every 8 years, so the
  // slope b is about ln2/8 = 0.087 per year. SOURCED (range 0.07-0.1 across populations)
  // https://doi.org/10.1093/gerona/glv023 (gavrilov & gavrilova, mortality measurement at advanced ages)
  gompertzSlope: 0.087,

  // under-5 deaths per 1000 live births, 2022, by un region. SOURCED, rounded (un igme 2023 report)
  // https://childmortality.org/ . world 37, sub-saharan africa 71, south asia 37, europe + north america 5
  under5PerThousand: { ssa: 71, sasia: 37, nafrica: 23, mideast: 20, seasia: 22, easia: 7, latam: 16, carib_pac: 30, rus_ca: 15, na: 6, europe: 4, oceania: 20 } as Record<string, number>,

  // maternal deaths per 100k live births, 2020. SOURCED, rounded (who et al. 2023)
  // https://www.who.int/publications/i/item/9789240068759 . sub-saharan africa 545, south asia 134, europe ~10
  maternalPer100k: { ssa: 545, sasia: 134, nafrica: 70, mideast: 50, seasia: 115, easia: 20, latam: 88, carib_pac: 190, rus_ca: 25, na: 21, europe: 10, oceania: 30 } as Record<string, number>,

  // ---- behaviors and lifespan ----
  // lifelong smokers lose about 10 years vs never smokers; quitting by 40 avoids ~90% of the excess.
  // SOURCED: doll et al. 2004, bmj https://doi.org/10.1136/bmj.38142.554479.AE . applied as hazard x2.2 (ESTIMATE
  // that reproduces ~10 years with the gompertz slope above)
  smokingHazard: 2.2,
  quitBy40Keeps: 0.1,
  // heavy drinking: ~1.4x all-cause mortality above ~350 g/week. SOURCED: wood et al. 2018, lancet
  // https://doi.org/10.1016/S0140-6736(18)30134-X
  heavyDrinkHazard: 1.4,
  // regular physical activity: ~0.7x all-cause mortality (150+ min/week vs none). SOURCED: arem et al. 2015,
  // jama internal medicine https://doi.org/10.1001/jamainternmed.2015.0533 (hazard 0.61-0.69)
  exerciseHazard: 0.7,

  // ---- social connection ----
  // strong social relationships: ~50% higher odds of survival (or 1.5). SOURCED: holt-lunstad et al. 2010,
  // plos medicine https://doi.org/10.1371/journal.pmed.1000316 . applied as hazard / 1.5 at full connection
  connectionSurvivalOR: 1.5,
  // harvard study of adult development: relationship satisfaction at 50 predicted health at 80 better than
  // cholesterol did; warm relationships are the strongest predictor of a good life. SOURCED (finding, not a
  // coefficient): waldinger & schulz 2023, the good life https://www.adultdevelopmentstudy.org/
  // used as: relationship depth carries the largest wellbeing weight and feeds later-life health (ESTIMATE size)
  relationshipsToHealthAt80: 0.15,
  // loneliness: hazard ~1.26 (meta-analysis). SOURCED: holt-lunstad et al. 2015
  // https://doi.org/10.1177/1745691614568352
  lonelinessHazard: 1.26,
  // purpose in life: highest vs lowest purpose ~2.4x lower mortality over 4 years. SOURCED: alimujiang et al.
  // 2019, jama network open https://doi.org/10.1001/jamanetworkopen.2019.4270 . applied softly: x0.8 (ESTIMATE)
  purposeHazard: 0.8,
  // widowhood effect: ~1.2x mortality in the years after losing a spouse. SOURCED: moon et al. 2011
  // https://doi.org/10.1371/journal.pone.0023465
  widowhoodHazard: 1.2,
  widowhoodMonths: 36,

  // ---- money ----
  // each extra year of schooling raises earnings ~9% worldwide, ~12% in sub-saharan africa. SOURCED:
  // psacharopoulos & patrinos 2018 https://doi.org/10.1080/09645292.2018.1484426
  returnPerSchoolYear: 0.09,
  returnPerSchoolYearSsa: 0.12,
  // income and wellbeing: experienced wellbeing rises with log income with no plateau up to ~$500k.
  // SOURCED: killingsworth 2021, pnas https://doi.org/10.1073/pnas.2016976118 . slope per log2 step ESTIMATE 0.04
  wellbeingPerLog2Income: 0.04,
  // income and lifespan: richest vs poorest 1% in the us live 14.6 (men) / 10.1 (women) years longer.
  // SOURCED: chetty et al. 2016, jama https://doi.org/10.1001/jama.2016.4226 . applied as hazard 1.5 at the bottom
  // quintile and 0.75 at the top (ESTIMATE fit to that gap)
  poorHazard: 1.5, richHazard: 0.75,
  // unemployment lowers life satisfaction more than the income loss alone. SOURCED: clark & oswald 1994
  // https://doi.org/10.2307/2234889 ; also winkelmann & winkelmann 1998 https://doi.org/10.1111/1468-0335.00111
  unemploymentValenceHit: 0.12,
  // migration: the same worker earns ~2-11x more after moving from a poor to a rich country ("place premium").
  // SOURCED: clemens, montenegro & pritchett 2019, world bank economic review https://doi.org/10.1093/wber/lhw016
  // applied as: wage moves 55% of the way to the destination's level in year one, more over time (ESTIMATE)
  migrationWageCatchup: 0.55,
  // migrants send ~$650bn home a year (2023), larger than fdi to low/middle income countries. SOURCED:
  // world bank migration and development brief 39 https://www.knomad.org/publication/migration-and-development-brief-39
  remittanceShare: 0.15, // ESTIMATE share of a migrant's income sent home

  // ---- housing ----
  // ~1.1 billion people live in slums or informal settlements; over half of urban sub-saharan africa.
  // SOURCED: un-habitat world cities report 2022 https://unhabitat.org/wcr/
  informalUrbanShare: { ssa: 0.53, sasia: 0.48, nafrica: 0.2, mideast: 0.22, seasia: 0.24, easia: 0.24, latam: 0.17, carib_pac: 0.3, rus_ca: 0.08, na: 0.02, europe: 0.02, oceania: 0.1 } as Record<string, number>,

  // ---- helping others ----
  // volunteering: ~22% lower mortality in older adults (meta-analysis). SOURCED: okun et al. 2013
  // https://doi.org/10.1037/a0031519 ; prosocial spending raises happiness: dunn et al. 2008
  // https://doi.org/10.1126/science.1150952
  volunteerHazard: 0.8,
  // caregiving for a parent or partner is meaningful but raises stress; net mortality roughly neutral
  // (roth et al. 2015 https://doi.org/10.1093/geront/gnu177). used as: +contribution +meaning, -valence (ESTIMATE)

  // ---- crowds and danger ----
  // protest participation carries injury/arrest risk that scales with how violent the moment is. no global
  // per-person rate exists. ESTIMATE: 0.2% injury per month of protesting at full unrest, 0.02% death
  protestInjury: 0.002, protestDeath: 0.0002,
  // famine: crude death rate rises above 1 per 10,000 per day in an ipc phase 5 famine. SOURCED (threshold):
  // ipc manual 3.1 https://www.ipcinfo.org/ipcinfo-website/resources/ipc-manual/en/ . in a recorded world famine the
  // person's monthly risk is scaled by how short food is and how poor they are (ESTIMATE)
  famineDeathPerMonth: 0.003,

  // ---- children ----
  // having children: life satisfaction roughly flat on average, lower while kids are small, higher where
  // childcare and family support are good. SOURCED: margolis & myrskylä 2011 https://doi.org/10.1111/j.1728-4457.2011.00389.x
  // used as: small dip in valence while kids are under 5, + relationship depth and meaning after (ESTIMATE)
  kidsSmallValenceDip: 0.04,
} as const

// provenance tags the life record carries for the numbers above
export const PROVENANCE = {
  gompertzSlope: { kind: 'SOURCED', url: 'https://doi.org/10.1093/gerona/glv023' },
  under5: { kind: 'SOURCED', url: 'https://childmortality.org/' },
  maternal: { kind: 'SOURCED', url: 'https://www.who.int/publications/i/item/9789240068759' },
  smoking: { kind: 'SOURCED', url: 'https://doi.org/10.1136/bmj.38142.554479.AE' },
  exercise: { kind: 'SOURCED', url: 'https://doi.org/10.1001/jamainternmed.2015.0533' },
  connection: { kind: 'SOURCED', url: 'https://doi.org/10.1371/journal.pmed.1000316' },
  harvardStudy: { kind: 'SOURCED', url: 'https://www.adultdevelopmentstudy.org/' },
  purpose: { kind: 'SOURCED', url: 'https://doi.org/10.1001/jamanetworkopen.2019.4270' },
  education: { kind: 'SOURCED', url: 'https://doi.org/10.1080/09645292.2018.1484426' },
  incomeWellbeing: { kind: 'SOURCED', url: 'https://doi.org/10.1073/pnas.2016976118' },
  incomeLifespan: { kind: 'SOURCED', url: 'https://doi.org/10.1001/jama.2016.4226' },
  migration: { kind: 'SOURCED', url: 'https://doi.org/10.1093/wber/lhw016' },
  slums: { kind: 'SOURCED', url: 'https://unhabitat.org/wcr/' },
  volunteering: { kind: 'SOURCED', url: 'https://doi.org/10.1037/a0031519' },
  births: { kind: 'ESTIMATE', url: 'https://population.un.org/wpp/' },
  protestRisk: { kind: 'ESTIMATE' },
  incomeLevels: { kind: 'ESTIMATE' },
} as const
