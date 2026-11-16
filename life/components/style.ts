// how a city looks, from the reference notes (life/REFERENCE.md). three styles from real photos plus a generic one.
// every color here is from what the photos show (painted plaster bands, rusted tin, red earth, teal balconies).
export type StyleKind = 'swahili' | 'tana' | 'musseque' | 'generic'
export type CityStyle = {
  kind: StyleKind
  ground: string; groundPatch: string // street surface and its patches (dirt + earth, or pavers)
  paved: boolean
  walls: string[]; bands: string[]; doors: string[]; roofs: string[]
  storeys: [number, number] // min, max storeys for houses
  balconies: boolean // wooden upper verandas (tana)
  stoops: boolean // concrete stoop / bench along the front (swahili)
  haze: string // the warm dusty air
  vehicles: { bajaji: number; boda: number; minibus: number; car: number }
  minibus: [string, string] // body, band
  clothes: string[] // what people wear (bright for the coast, darker jackets in the highlands)
  jackets: boolean
}

const SWAHILI: CityStyle = {
  kind: 'swahili', ground: '#9C8A74', groundPatch: '#B9805A', paved: false,
  walls: ['#D8B98A', '#EFE7D8', '#E9DDC0', '#E8C9C4', '#EADFA6', '#DCCBB0'],
  bands: ['#3E9C93', '#4E8FB8', '#5BA486', '#8FB8D8', '#C2876C', '#3E7F8F'],
  doors: ['#3E6FA8', '#3E8C6A', '#2F6F84', '#7A4E3A'],
  roofs: ['#8A4E33', '#9A5C3A', '#7E8085', '#A0663F', '#6F7276'],
  storeys: [1, 1], balconies: false, stoops: true, haze: '#E9D6B4',
  vehicles: { bajaji: 0.35, boda: 0.35, minibus: 0.15, car: 0.15 }, minibus: ['#E8E2D6', '#3E9C93'],
  clothes: ['#D9483B', '#E8A13A', '#2F7F6F', '#3E6FA8', '#F2D16B', '#8E3B6E', '#E8E2D6', '#4A8F3F', '#C2575F', '#1F5C8A'], jackets: false,
}
const TANA: CityStyle = {
  kind: 'tana', ground: '#B59472', groundPatch: '#9E7C5C', paved: true,
  walls: ['#A65B3F', '#B5674A', '#9A5038', '#C98B6E', '#E2C9B5', '#D9B8A0'],
  bands: ['#3E8F86', '#2F7F78', '#4E9E8E', '#6E9E5E'],
  doors: ['#3E8F86', '#2F6F6A', '#6E4A36'],
  roofs: ['#7E5A48', '#6F7276', '#8A5A44', '#5E5A58'],
  storeys: [2, 2], balconies: true, stoops: false, haze: '#DCD3C8',
  vehicles: { bajaji: 0.05, boda: 0.15, minibus: 0.3, car: 0.5 }, minibus: ['#E8E2D6', '#5E7FA0'],
  clothes: ['#5E5A58', '#3E4A5E', '#7E3B3B', '#8A6E4A', '#2F5F4F', '#C2575F', '#E8E2D6', '#4E5E7E'], jackets: true,
}
const MUSSEQUE: CityStyle = {
  kind: 'musseque', ground: '#B8714F', groundPatch: '#C98A62', paved: false,
  walls: ['#E8A6B8', '#8FC1E3', '#F2D16B', '#A8DCC4', '#F4F0E6', '#B9B4AA', '#F0B98C'],
  bands: ['#C25A7A', '#3E7FB8', '#C9A046', '#3E9C7A', '#9A9690'],
  doors: ['#3E6FA8', '#7A4E3A', '#3E8C6A', '#C25A3A'],
  roofs: ['#A9ABAF', '#8A5A3E', '#9C9EA2', '#7E4E35'],
  storeys: [1, 1], balconies: false, stoops: false, haze: '#EBCBB2',
  vehicles: { bajaji: 0.1, boda: 0.3, minibus: 0.3, car: 0.3 }, minibus: ['#F4F0E6', '#3E6FB8'],
  clothes: ['#D9483B', '#E8A13A', '#3E6FA8', '#F2D16B', '#8E3B6E', '#E8E2D6', '#2F7F6F', '#C2575F'], jackets: false,
}
const GENERIC: CityStyle = {
  kind: 'generic', ground: '#A89E8E', groundPatch: '#B59F86', paved: true,
  walls: ['#E6D7C2', '#D9C9AF', '#C9D3D6', '#E8D9B0', '#D8C2B8', '#EFE6D6'],
  bands: ['#8FA3B0', '#B98F72', '#8FAE84', '#C2A46A'],
  doors: ['#5E6E7E', '#7A5A44', '#3E6F7A'],
  roofs: ['#8A6E5A', '#7E8085', '#9A6A4E'],
  storeys: [1, 3], balconies: false, stoops: false, haze: '#DAD6CC',
  vehicles: { bajaji: 0.15, boda: 0.25, minibus: 0.2, car: 0.4 }, minibus: ['#E8E2D6', '#C9A046'],
  clothes: ['#5F7FA0', '#C9A046', '#6F9A6A', '#8873B0', '#4F8A8E', '#A65D57', '#E8E2D6', '#3E4A5E'], jackets: false,
}

// which style a country gets (by where the reference photos apply)
const SWAHILI_COAST = new Set(['TZA', 'KEN', 'MOZ', 'UGA', 'SOM', 'ETH'])
const HIGHLAND_BRICK = new Set(['MDG'])
const WEST_CENTRAL = new Set(['AGO', 'COD', 'NGA', 'GHA', 'CIV', 'CMR', 'MLI', 'NER', 'BFA', 'TCD', 'ZAF'])
export function cityStyle(countryId: string): CityStyle {
  if (SWAHILI_COAST.has(countryId)) return SWAHILI
  if (HIGHLAND_BRICK.has(countryId)) return TANA
  if (WEST_CENTRAL.has(countryId)) return MUSSEQUE
  return GENERIC
}
