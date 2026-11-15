// where the chosen person is born. weighted by where babies are actually born, so most are born in south asia
// and sub-saharan africa, like reality.
//
// births: thousands of live births per year, around 2024, rounded from the un world population prospects 2024
// (https://population.un.org/wpp/). ESTIMATE: rounded by hand, verify against the wpp tables before quoting any
// single country. together these ~60 countries cover ~88% of the ~132 million births a year.
// cities: real cities (natural earth populated places, https://www.naturalearthdata.com). pop is an ESTIMATE of
// metro population in millions, used only to weight which city in the country the baby is born in.
import { pickWeighted, type Rng } from '../sim/rng'

export type BirthCity = { id: string; name: string; lat: number; lon: number; pop: number }
export type BirthCountry = { id: string; name: string; regionId: string; births: number; cities: BirthCity[] }

const c = (id: string, name: string, lat: number, lon: number, pop: number): BirthCity => ({ id, name, lat, lon, pop })

export const COUNTRIES: BirthCountry[] = [
  { id: 'IND', name: 'India', regionId: 'sasia', births: 23000, cities: [c('delhi', 'Delhi', 28.61, 77.21, 33), c('mumbai', 'Mumbai', 19.08, 72.88, 22), c('kolkata', 'Kolkata', 22.57, 88.36, 15), c('patna', 'Patna', 25.59, 85.14, 2.5), c('lucknow', 'Lucknow', 26.85, 80.95, 4), c('bengaluru', 'Bengaluru', 12.97, 77.59, 14), c('chennai', 'Chennai', 13.08, 80.27, 12), c('jaipur', 'Jaipur', 26.91, 75.79, 4)] },
  { id: 'CHN', name: 'China', regionId: 'easia', births: 9000, cities: [c('shanghai', 'Shanghai', 31.23, 121.47, 29), c('beijing', 'Beijing', 39.9, 116.41, 22), c('chongqing', 'Chongqing', 29.56, 106.55, 17), c('guangzhou', 'Guangzhou', 23.13, 113.26, 14), c('chengdu', 'Chengdu', 30.57, 104.07, 10), c('wuhan', 'Wuhan', 30.59, 114.31, 9)] },
  { id: 'NGA', name: 'Nigeria', regionId: 'ssa', births: 7900, cities: [c('lagos', 'Lagos', 6.52, 3.38, 16), c('kano', 'Kano', 12.0, 8.52, 4.5), c('ibadan', 'Ibadan', 7.38, 3.94, 4), c('abuja', 'Abuja', 9.06, 7.5, 4), c('port_harcourt', 'Port Harcourt', 4.82, 7.03, 3.5)] },
  { id: 'PAK', name: 'Pakistan', regionId: 'sasia', births: 6900, cities: [c('karachi', 'Karachi', 24.86, 67.0, 17), c('lahore', 'Lahore', 31.55, 74.34, 14), c('faisalabad', 'Faisalabad', 31.42, 73.08, 3.7), c('peshawar', 'Peshawar', 34.01, 71.58, 2.4)] },
  { id: 'COD', name: 'DR Congo', regionId: 'ssa', births: 4600, cities: [c('kinshasa', 'Kinshasa', -4.44, 15.27, 17), c('lubumbashi', 'Lubumbashi', -11.66, 27.48, 2.7), c('mbuji_mayi', 'Mbuji-Mayi', -6.15, 23.6, 2.5), c('goma', 'Goma', -1.68, 29.22, 1)] },
  { id: 'IDN', name: 'Indonesia', regionId: 'seasia', births: 4500, cities: [c('jakarta', 'Jakarta', -6.21, 106.85, 11), c('surabaya', 'Surabaya', -7.25, 112.75, 3), c('medan', 'Medan', 3.6, 98.67, 2.5), c('bandung', 'Bandung', -6.92, 107.6, 2.6)] },
  { id: 'ETH', name: 'Ethiopia', regionId: 'ssa', births: 4000, cities: [c('addis_ababa', 'Addis Ababa', 9.03, 38.74, 5.5), c('dire_dawa', 'Dire Dawa', 9.6, 41.85, 0.5), c('mekelle', 'Mekelle', 13.5, 39.47, 0.5), c('hawassa', 'Hawassa', 7.06, 38.48, 0.4)] },
  { id: 'USA', name: 'United States', regionId: 'na', births: 3600, cities: [c('new_york', 'New York', 40.71, -74.01, 19), c('los_angeles', 'Los Angeles', 34.05, -118.24, 13), c('chicago', 'Chicago', 41.88, -87.63, 9), c('houston', 'Houston', 29.76, -95.37, 7), c('atlanta', 'Atlanta', 33.75, -84.39, 6)] },
  { id: 'BGD', name: 'Bangladesh', regionId: 'sasia', births: 3000, cities: [c('dhaka', 'Dhaka', 23.81, 90.41, 23), c('chittagong', 'Chittagong', 22.36, 91.78, 5), c('khulna', 'Khulna', 22.85, 89.54, 1)] },
  { id: 'BRA', name: 'Brazil', regionId: 'latam', births: 2500, cities: [c('sao_paulo', 'São Paulo', -23.55, -46.63, 22), c('rio', 'Rio de Janeiro', -22.91, -43.17, 13), c('salvador', 'Salvador', -12.97, -38.5, 4), c('recife', 'Recife', -8.05, -34.88, 4), c('manaus', 'Manaus', -3.12, -60.02, 2.3)] },
  { id: 'TZA', name: 'Tanzania', regionId: 'ssa', births: 2200, cities: [c('dar_es_salaam', 'Dar es Salaam', -6.79, 39.21, 7.5), c('mwanza', 'Mwanza', -2.52, 32.9, 1.2), c('arusha', 'Arusha', -3.37, 36.68, 0.6), c('dodoma', 'Dodoma', -6.16, 35.75, 0.5)] },
  { id: 'EGY', name: 'Egypt', regionId: 'nafrica', births: 2200, cities: [c('cairo', 'Cairo', 30.04, 31.24, 22), c('alexandria', 'Alexandria', 31.2, 29.92, 5.5), c('asyut', 'Asyut', 27.18, 31.18, 0.5)] },
  { id: 'PHL', name: 'Philippines', regionId: 'seasia', births: 2000, cities: [c('manila', 'Manila', 14.6, 120.98, 14), c('davao', 'Davao', 7.19, 125.46, 2), c('cebu', 'Cebu', 10.32, 123.89, 1)] },
  { id: 'MEX', name: 'Mexico', regionId: 'latam', births: 1900, cities: [c('mexico_city', 'Mexico City', 19.43, -99.13, 22), c('guadalajara', 'Guadalajara', 20.67, -103.35, 5.5), c('monterrey', 'Monterrey', 25.69, -100.32, 5.3), c('puebla', 'Puebla', 19.04, -98.2, 3.2)] },
  { id: 'UGA', name: 'Uganda', regionId: 'ssa', births: 1700, cities: [c('kampala', 'Kampala', 0.35, 32.58, 3.9), c('gulu', 'Gulu', 2.78, 32.3, 0.2), c('mbarara', 'Mbarara', -0.61, 30.65, 0.2)] },
  { id: 'KEN', name: 'Kenya', regionId: 'ssa', births: 1500, cities: [c('nairobi', 'Nairobi', -1.29, 36.82, 5.3), c('mombasa', 'Mombasa', -4.04, 39.67, 1.4), c('kisumu', 'Kisumu', -0.09, 34.77, 0.6)] },
  { id: 'SDN', name: 'Sudan', regionId: 'nafrica', births: 1400, cities: [c('khartoum', 'Khartoum', 15.5, 32.56, 6.3), c('nyala', 'Nyala', 12.05, 24.88, 0.9), c('port_sudan', 'Port Sudan', 19.62, 37.22, 0.5)] },
  { id: 'AFG', name: 'Afghanistan', regionId: 'sasia', births: 1400, cities: [c('kabul', 'Kabul', 34.53, 69.17, 4.6), c('kandahar', 'Kandahar', 31.63, 65.71, 0.6), c('herat', 'Herat', 34.35, 62.2, 0.6)] },
  { id: 'VNM', name: 'Vietnam', regionId: 'seasia', births: 1400, cities: [c('ho_chi_minh', 'Ho Chi Minh City', 10.82, 106.63, 9.3), c('hanoi', 'Hanoi', 21.03, 105.85, 5.3), c('da_nang', 'Da Nang', 16.05, 108.2, 1.2)] },
  { id: 'AGO', name: 'Angola', regionId: 'ssa', births: 1300, cities: [c('luanda', 'Luanda', -8.84, 13.23, 9), c('huambo', 'Huambo', -12.78, 15.74, 0.7)] },
  { id: 'RUS', name: 'Russia', regionId: 'rus_ca', births: 1250, cities: [c('moscow', 'Moscow', 55.76, 37.62, 12.6), c('saint_petersburg', 'Saint Petersburg', 59.94, 30.31, 5.4), c('kazan', 'Kazan', 55.8, 49.11, 1.3), c('novosibirsk', 'Novosibirsk', 55.01, 82.93, 1.6)] },
  { id: 'MOZ', name: 'Mozambique', regionId: 'ssa', births: 1200, cities: [c('maputo', 'Maputo', -25.97, 32.57, 2.8), c('beira', 'Beira', -19.84, 34.84, 0.6), c('nampula', 'Nampula', -15.12, 39.27, 0.7)] },
  { id: 'NER', name: 'Niger', regionId: 'ssa', births: 1200, cities: [c('niamey', 'Niamey', 13.51, 2.11, 1.4), c('zinder', 'Zinder', 13.81, 8.99, 0.3), c('maradi', 'Maradi', 13.5, 7.1, 0.3)] },
  { id: 'IRQ', name: 'Iraq', regionId: 'mideast', births: 1100, cities: [c('baghdad', 'Baghdad', 33.31, 44.36, 7.7), c('basra', 'Basra', 30.51, 47.81, 1.4), c('mosul', 'Mosul', 36.34, 43.13, 1.8)] },
  { id: 'IRN', name: 'Iran', regionId: 'mideast', births: 1100, cities: [c('tehran', 'Tehran', 35.69, 51.39, 9.5), c('mashhad', 'Mashhad', 36.3, 59.6, 3.3), c('isfahan', 'Isfahan', 32.65, 51.67, 2.2)] },
  { id: 'ZAF', name: 'South Africa', regionId: 'ssa', births: 1100, cities: [c('johannesburg', 'Johannesburg', -26.2, 28.05, 6.2), c('cape_town', 'Cape Town', -33.92, 18.42, 4.8), c('durban', 'Durban', -29.86, 31.02, 3.2)] },
  { id: 'MLI', name: 'Mali', regionId: 'ssa', births: 1000, cities: [c('bamako', 'Bamako', 12.64, -8.0, 3), c('sikasso', 'Sikasso', 11.32, -5.67, 0.2)] },
  { id: 'TUR', name: 'Türkiye', regionId: 'mideast', births: 1000, cities: [c('istanbul', 'Istanbul', 41.01, 28.98, 15.8), c('ankara', 'Ankara', 39.93, 32.86, 5.3), c('izmir', 'Izmir', 38.42, 27.14, 3)] },
  { id: 'YEM', name: 'Yemen', regionId: 'mideast', births: 950, cities: [c('sanaa', "Sana'a", 15.37, 44.19, 3.2), c('aden', 'Aden', 12.79, 45.02, 1.1), c('taiz', 'Taiz', 13.58, 44.02, 0.6)] },
  { id: 'MDG', name: 'Madagascar', regionId: 'ssa', births: 900, cities: [c('antananarivo', 'Antananarivo', -18.88, 47.51, 3.9), c('toamasina', 'Toamasina', -18.15, 49.4, 0.3)] },
  { id: 'CMR', name: 'Cameroon', regionId: 'ssa', births: 900, cities: [c('douala', 'Douala', 4.05, 9.77, 4), c('yaounde', 'Yaoundé', 3.85, 11.5, 4.3)] },
  { id: 'CIV', name: "Côte d'Ivoire", regionId: 'ssa', births: 900, cities: [c('abidjan', 'Abidjan', 5.36, -4.01, 5.6), c('bouake', 'Bouaké', 7.69, -5.03, 0.8)] },
  { id: 'UZB', name: 'Uzbekistan', regionId: 'rus_ca', births: 900, cities: [c('tashkent', 'Tashkent', 41.3, 69.24, 2.9), c('samarkand', 'Samarkand', 39.65, 66.96, 0.6)] },
  { id: 'MMR', name: 'Myanmar', regionId: 'seasia', births: 850, cities: [c('yangon', 'Yangon', 16.87, 96.2, 5.6), c('mandalay', 'Mandalay', 21.97, 96.08, 1.5)] },
  { id: 'GHA', name: 'Ghana', regionId: 'ssa', births: 850, cities: [c('accra', 'Accra', 5.6, -0.19, 2.6), c('kumasi', 'Kumasi', 6.69, -1.62, 3.6), c('tamale', 'Tamale', 9.4, -0.84, 0.4)] },
  { id: 'SOM', name: 'Somalia', regionId: 'ssa', births: 850, cities: [c('mogadishu', 'Mogadishu', 2.05, 45.32, 2.6), c('hargeisa', 'Hargeisa', 9.56, 44.06, 1.2)] },
  { id: 'DZA', name: 'Algeria', regionId: 'nafrica', births: 800, cities: [c('algiers', 'Algiers', 36.75, 3.06, 2.9), c('oran', 'Oran', 35.7, -0.63, 1.6)] },
  { id: 'BFA', name: 'Burkina Faso', regionId: 'ssa', births: 750, cities: [c('ouagadougou', 'Ouagadougou', 12.37, -1.52, 3), c('bobo_dioulasso', 'Bobo-Dioulasso', 11.18, -4.3, 1)] },
  { id: 'TCD', name: 'Chad', regionId: 'ssa', births: 750, cities: [c('ndjamena', "N'Djamena", 12.13, 15.06, 1.6), c('moundou', 'Moundou', 8.57, 16.08, 0.2)] },
  { id: 'JPN', name: 'Japan', regionId: 'easia', births: 730, cities: [c('tokyo', 'Tokyo', 35.68, 139.69, 37), c('osaka', 'Osaka', 34.69, 135.5, 19), c('fukuoka', 'Fukuoka', 33.59, 130.4, 2.5)] },
  { id: 'DEU', name: 'Germany', regionId: 'europe', births: 690, cities: [c('berlin', 'Berlin', 52.52, 13.4, 3.7), c('hamburg', 'Hamburg', 53.55, 9.99, 1.9), c('cologne', 'Cologne', 50.94, 6.96, 1.1)] },
  { id: 'GBR', name: 'United Kingdom', regionId: 'europe', births: 680, cities: [c('london', 'London', 51.51, -0.13, 9.6), c('birmingham', 'Birmingham', 52.49, -1.89, 2.9), c('manchester', 'Manchester', 53.48, -2.24, 2.8)] },
  { id: 'FRA', name: 'France', regionId: 'europe', births: 670, cities: [c('paris', 'Paris', 48.86, 2.35, 11.2), c('marseille', 'Marseille', 43.3, 5.37, 1.9), c('lyon', 'Lyon', 45.76, 4.84, 2.3)] },
  { id: 'MAR', name: 'Morocco', regionId: 'nafrica', births: 650, cities: [c('casablanca', 'Casablanca', 33.57, -7.59, 3.8), c('marrakesh', 'Marrakesh', 31.63, -8.01, 1.3), c('fes', 'Fes', 34.03, -5.0, 1.3)] },
  { id: 'NPL', name: 'Nepal', regionId: 'sasia', births: 550, cities: [c('kathmandu', 'Kathmandu', 27.71, 85.32, 1.5), c('pokhara', 'Pokhara', 28.21, 83.99, 0.5)] },
  { id: 'SAU', name: 'Saudi Arabia', regionId: 'mideast', births: 550, cities: [c('riyadh', 'Riyadh', 24.71, 46.68, 7.7), c('jeddah', 'Jeddah', 21.49, 39.19, 4.7)] },
  { id: 'THA', name: 'Thailand', regionId: 'seasia', births: 500, cities: [c('bangkok', 'Bangkok', 13.76, 100.5, 11), c('chiang_mai', 'Chiang Mai', 18.79, 98.98, 1.2)] },
  { id: 'COL', name: 'Colombia', regionId: 'latam', births: 500, cities: [c('bogota', 'Bogotá', 4.71, -74.07, 11.5), c('medellin', 'Medellín', 6.24, -75.58, 4.1), c('cali', 'Cali', 3.45, -76.53, 2.8)] },
  { id: 'PER', name: 'Peru', regionId: 'latam', births: 450, cities: [c('lima', 'Lima', -12.05, -77.04, 11.2), c('arequipa', 'Arequipa', -16.41, -71.54, 1.1)] },
  { id: 'MYS', name: 'Malaysia', regionId: 'seasia', births: 450, cities: [c('kuala_lumpur', 'Kuala Lumpur', 3.14, 101.69, 8.6), c('george_town', 'George Town', 5.41, 100.33, 0.8)] },
  { id: 'ARG', name: 'Argentina', regionId: 'latam', births: 450, cities: [c('buenos_aires', 'Buenos Aires', -34.6, -58.38, 15.6), c('cordoba', 'Córdoba', -31.42, -64.18, 1.6)] },
  { id: 'VEN', name: 'Venezuela', regionId: 'latam', births: 420, cities: [c('caracas', 'Caracas', 10.49, -66.88, 3), c('maracaibo', 'Maracaibo', 10.65, -71.64, 2.3)] },
  { id: 'ITA', name: 'Italy', regionId: 'europe', births: 380, cities: [c('rome', 'Rome', 41.9, 12.5, 4.3), c('milan', 'Milan', 45.46, 9.19, 3.2), c('naples', 'Naples', 40.85, 14.27, 3)] },
  { id: 'CAN', name: 'Canada', regionId: 'na', births: 350, cities: [c('toronto', 'Toronto', 43.65, -79.38, 6.4), c('montreal', 'Montreal', 45.5, -73.57, 4.3), c('vancouver', 'Vancouver', 49.28, -123.12, 2.7)] },
  { id: 'ESP', name: 'Spain', regionId: 'europe', births: 320, cities: [c('madrid', 'Madrid', 40.42, -3.7, 6.8), c('barcelona', 'Barcelona', 41.39, 2.17, 5.6)] },
  { id: 'AUS', name: 'Australia', regionId: 'oceania', births: 290, cities: [c('sydney', 'Sydney', -33.87, 151.21, 5.3), c('melbourne', 'Melbourne', -37.81, 144.96, 5.2), c('brisbane', 'Brisbane', -27.47, 153.03, 2.6)] },
  { id: 'HTI', name: 'Haiti', regionId: 'carib_pac', births: 260, cities: [c('port_au_prince', 'Port-au-Prince', 18.59, -72.31, 2.9), c('cap_haitien', 'Cap-Haïtien', 19.76, -72.2, 0.3)] },
  { id: 'PNG', name: 'Papua New Guinea', regionId: 'carib_pac', births: 250, cities: [c('port_moresby', 'Port Moresby', -9.44, 147.18, 0.4), c('lae', 'Lae', -6.72, 146.99, 0.1)] },
  { id: 'KOR', name: 'South Korea', regionId: 'easia', births: 230, cities: [c('seoul', 'Seoul', 37.57, 126.98, 25), c('busan', 'Busan', 35.18, 129.08, 3.4)] },
  { id: 'DOM', name: 'Dominican Republic', regionId: 'carib_pac', births: 200, cities: [c('santo_domingo', 'Santo Domingo', 18.49, -69.93, 3.5), c('santiago_dr', 'Santiago de los Caballeros', 19.45, -70.7, 1)] },
]

export function pickBirthplace(rng: Rng): { country: BirthCountry; city: BirthCity } {
  const country = COUNTRIES[pickWeighted<number>(rng, COUNTRIES.map(c => c.births))]
  const city = country.cities[pickWeighted<number>(rng, country.cities.map(c => c.pop))]
  return { country, city }
}

export const countryById = (id: string) => COUNTRIES.find(c => c.id === id)

// the biggest city in the country: where people move to when they leave a smaller place
export const biggestCity = (country: BirthCountry) => country.cities.reduce((a, b) => (b.pop > a.pop ? b : a))

// migration destinations: real big-city corridors people actually take (world bank / iom corridors), by origin region
// ESTIMATE as a list of plausible corridors, not shares
export const CORRIDORS: Record<string, string[]> = {
  sasia: ['SAU', 'GBR', 'USA', 'CAN', 'MYS'],
  ssa: ['ZAF', 'GBR', 'FRA', 'USA', 'SAU'],
  nafrica: ['FRA', 'ESP', 'ITA', 'SAU', 'DEU'],
  mideast: ['DEU', 'TUR', 'SAU', 'CAN', 'GBR'],
  seasia: ['MYS', 'JPN', 'SAU', 'USA', 'AUS'],
  easia: ['USA', 'CAN', 'AUS', 'JPN', 'KOR'],
  latam: ['USA', 'ESP', 'CAN', 'ARG', 'ITA'],
  carib_pac: ['USA', 'CAN', 'AUS', 'FRA', 'ESP'],
  rus_ca: ['RUS', 'DEU', 'TUR', 'KOR', 'CAN'],
  na: ['CAN', 'GBR', 'AUS', 'DEU', 'JPN'],
  europe: ['DEU', 'GBR', 'USA', 'CAN', 'AUS'],
  oceania: ['GBR', 'USA', 'CAN', 'JPN', 'DEU'],
}

// common given and family names by region. names are ordinary names, never real public people. every region
// list mixes names from the several cultures that live there, because every region is mixed
const GIVEN: Record<string, { f: string[]; m: string[] }> = {
  sasia: { f: ['priya', 'aisha', 'ananya', 'fatima', 'meera', 'sana', 'kavya', 'nusrat', 'zoya', 'lakshmi', 'roshni', 'farah'], m: ['arjun', 'imran', 'rohan', 'ali', 'vikram', 'karan', 'hamza', 'sanjay', 'rahim', 'dev', 'faisal', 'nikhil'] },
  ssa: { f: ['amara', 'chiamaka', 'wanjiru', 'aisha', 'nia', 'zawadi', 'fatou', 'thandiwe', 'adaeze', 'halima', 'esi', 'grace'], m: ['kofi', 'chinedu', 'tendai', 'musa', 'kwame', 'baraka', 'sekou', 'emeka', 'jabari', 'tunde', 'ibrahim', 'daniel'] },
  nafrica: { f: ['yasmin', 'nour', 'salma', 'amira', 'leila', 'mariam', 'hana', 'rania'], m: ['omar', 'youssef', 'karim', 'amir', 'tarek', 'samir', 'khaled', 'adam'] },
  mideast: { f: ['layla', 'zeynep', 'sara', 'noor', 'maryam', 'elif', 'dina', 'shirin'], m: ['ahmed', 'emre', 'reza', 'yusuf', 'hassan', 'kerem', 'ali', 'sami'] },
  seasia: { f: ['siti', 'mai', 'maria', 'linh', 'putri', 'aye', 'nicole', 'dewi'], m: ['budi', 'minh', 'joseph', 'arif', 'thant', 'mark', 'rizal', 'huy'] },
  easia: { f: ['mei', 'yuki', 'jia', 'hana', 'xiu', 'min-ji', 'aiko', 'lan'], m: ['wei', 'haruto', 'jun', 'hao', 'min-jun', 'kenji', 'lei', 'tao'] },
  latam: { f: ['sofia', 'valentina', 'camila', 'ana', 'luciana', 'isabela', 'mariana', 'gabriela'], m: ['mateo', 'santiago', 'diego', 'joão', 'lucas', 'miguel', 'andrés', 'rafael'] },
  carib_pac: { f: ['marie', 'keisha', 'ana', 'lani', 'nadia', 'rose'], m: ['jean', 'andre', 'kai', 'luis', 'marcus', 'tevita'] },
  rus_ca: { f: ['anna', 'dilnoza', 'maria', 'aigerim', 'sofia', 'madina'], m: ['ivan', 'timur', 'alexei', 'aziz', 'nikita', 'rustam'] },
  na: { f: ['olivia', 'maya', 'zoe', 'aaliyah', 'emma', 'sofia', 'grace', 'priya'], m: ['liam', 'noah', 'elijah', 'mateo', 'james', 'ethan', 'jamal', 'daniel'] },
  europe: { f: ['emma', 'lea', 'sofia', 'amelia', 'ines', 'mila', 'chloe', 'nadia'], m: ['luca', 'noah', 'leon', 'hugo', 'oliver', 'mateo', 'samir', 'jonas'] },
  oceania: { f: ['charlotte', 'isla', 'mia', 'aroha', 'grace', 'lily'], m: ['jack', 'oliver', 'leo', 'nikau', 'william', 'sam'] },
}
const FAMILY: Record<string, string[]> = {
  sasia: ['sharma', 'khan', 'patel', 'rahman', 'singh', 'iyer', 'hossain', 'das', 'qureshi', 'reddy', 'mehta', 'chowdhury'],
  ssa: ['okafor', 'mensah', 'kamau', 'diallo', 'nkosi', 'abebe', 'mwangi', 'traore', 'adeyemi', 'banda', 'osei', 'ilunga'],
  nafrica: ['haddad', 'mansour', 'benali', 'saleh', 'farouk', 'idrissi'],
  mideast: ['yilmaz', 'hosseini', 'haddad', 'demir', 'karimi', 'nasser'],
  seasia: ['santos', 'nguyen', 'wijaya', 'tan', 'reyes', 'win'],
  easia: ['wang', 'tanaka', 'kim', 'chen', 'li', 'sato', 'park', 'zhang'],
  latam: ['silva', 'garcía', 'rodríguez', 'santos', 'martínez', 'oliveira', 'lópez', 'gómez'],
  carib_pac: ['joseph', 'pierre', 'fifita', 'pérez', 'charles', 'tui'],
  rus_ca: ['ivanova', 'karimov', 'petrov', 'nurlanova', 'smirnov', 'yusupov'],
  na: ['johnson', 'garcía', 'nguyen', 'williams', 'patel', 'brown', 'okafor', 'kim'],
  europe: ['müller', 'martin', 'rossi', 'novak', 'smith', 'dubois', 'kowalski', 'haddad'],
  oceania: ['smith', 'wilson', 'ngata', 'nguyen', 'taylor', 'singh'],
}

export function nameFor(rng: Rng, regionId: string, sex: 'female' | 'male'): { given: string; family: string } {
  const g = GIVEN[regionId] ?? GIVEN.europe
  const list = sex === 'female' ? g.f : g.m
  const fam = FAMILY[regionId] ?? FAMILY.europe
  return { given: list[Math.floor(rng() * list.length)], family: fam[Math.floor(rng() * fam.length)] }
}
