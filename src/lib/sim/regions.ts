// which governor-brief region each country rolls up into: World Bank region, with documented moves.
// shared by scripts/seed.ts and scripts/geo-countries.ts
export type RegionId = 'na' | 'latam' | 'europe' | 'rus_ca' | 'mideast' | 'nafrica' | 'ssa' | 'sasia' | 'easia' | 'seasia' | 'oceania' | 'carib_pac'

// region assignment starts from the World Bank region of each country, with these moves
const CARIBBEAN = new Set(['ABW', 'ATG', 'BHS', 'BRB', 'CUB', 'CUW', 'CYM', 'DMA', 'DOM', 'GRD', 'HTI', 'JAM', 'KNA', 'LCA', 'MAF', 'PRI', 'SXM', 'TCA', 'TTO', 'VCT', 'VGB', 'VIR'])
const RUS_CA = new Set(['RUS', 'KAZ', 'UZB', 'TKM', 'KGZ', 'TJK', 'ARM', 'AZE', 'GEO'])
const NAFRICA = new Set(['DZA', 'EGY', 'LBY', 'MAR', 'TUN', 'SDN'])
const EASIA = new Set(['CHN', 'JPN', 'KOR', 'PRK', 'MNG', 'HKG', 'MAC', 'TWN'])
const SEASIA = new Set(['IDN', 'PHL', 'VNM', 'THA', 'MMR', 'MYS', 'KHM', 'LAO', 'SGP', 'TLS', 'BRN'])
const OCEANIA = new Set(['AUS', 'NZL'])

export function assignRegion(iso3: string, wbRegion: string): RegionId | null {
  if (iso3 === 'TUR') return 'mideast'
  if (iso3 === 'MLT') return 'europe'
  if (iso3 === 'DJI') return 'ssa'
  if (NAFRICA.has(iso3)) return 'nafrica'
  switch (wbRegion) {
    case 'NAC': return 'na'
    case 'SAS': return 'sasia'
    case 'SSF': return 'ssa'
    case 'MEA': return 'mideast'
    case 'ECS': return RUS_CA.has(iso3) ? 'rus_ca' : 'europe'
    case 'LCN': return CARIBBEAN.has(iso3) ? 'carib_pac' : 'latam'
    case 'EAS':
      if (EASIA.has(iso3)) return 'easia'
      if (SEASIA.has(iso3)) return 'seasia'
      if (OCEANIA.has(iso3)) return 'oceania'
      return 'carib_pac' // pacific island states
    default: return null
  }
}

