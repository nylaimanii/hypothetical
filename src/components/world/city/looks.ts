// how a real city looks at street level, by region: wall and roof materials, shop signs, trees, vehicles, poles and
// rooftop tanks. colors were sampled (dominant colors, k-means) from street photos on Wikimedia Commons, then lifted
// from photo light to surface color, because the scene lights them again. the photos each look was read from are
// listed with it. looks without a photo list were set by eye from the same kind of photo and are marked so.

export type RoofKind = 'flat' | 'pitched' | 'iron'
export type TreeKind = 'broadleaf' | 'palm' | 'conifer'
export type VehicleKind = 'car' | 'cab' | 'minibus' | 'bus' | 'tuktuk' | 'moto'
export type Look = {
  id: string
  walls: string[] // facade colors, most common first
  trim: string // window frames, cornices, ground floor band
  roofs: { kind: RoofKind; colors: string[]; share: number }[] // share of buildings with each roof type
  street: string; sidewalk: string; ground: string
  unpaved: number // share of side streets that are dirt (laterite, sand)
  dirt: string
  shops: number // share of street-facing buildings with a shop on the ground floor
  signs: string[]; signStyle: 'board' | 'vertical' | 'mixed'
  trees: { kind: TreeKind; leaves: string[]; per: number } // per: trees per street side per block
  deciduous: boolean // bare in winter
  vehicles: { kind: VehicleKind; colors: string[]; share: number }[]
  traffic: number // vehicles per street at the busiest hour
  poles: boolean // overhead power lines on poles along streets
  tanks: { color: string; share: number; kind: 'wood' | 'poly' | 'ac' } | null // rooftop water tanks or units
  umbrellas: string[] | null // street vendors' umbrellas; null where vendors aren't on the street
  shack: { walls: string[]; roofs: string[] } // informal homes: corrugated iron, block, tarps
  lamp: string // street light color
  tall: number // multiplier on how tall towers get (panel slabs, towers in cores)
  refs: string[]
}

const IRON_SHACK = { walls: ['#9A8F80', '#A39C93', '#8B6E57', '#B7AFA2', '#7E8A93'], roofs: ['#8E5B3D', '#9EA2A3', '#7C8287', '#B5B8B4', '#4F6FA8'] }

export const LOOKS: Record<string, Look> = {
  // brownstone and brick rowhouses, limestone, tar roofs with wooden water tanks, yellow cabs
  nyc: {
    id: 'nyc',
    walls: ['#A8857C', '#94675A', '#7E5A4E', '#D6D5D0', '#B9B4AA', '#9C6B58'],
    trim: '#3A3739',
    roofs: [{ kind: 'flat', colors: ['#5B5A5C', '#6A6866'], share: 1 }],
    street: '#5E6670', sidewalk: '#B9B6AE', ground: '#A9A59B', unpaved: 0, dirt: '#8C8070',
    shops: 0.55, signs: ['#2F4F3E', '#7A2E2A', '#22303F', '#C9A23F', '#E8E2D2'], signStyle: 'board',
    trees: { kind: 'broadleaf', leaves: ['#6F8F4E', '#5D7F45'], per: 2 }, deciduous: true,
    vehicles: [{ kind: 'cab', colors: ['#D9A92E'], share: 0.35 }, { kind: 'car', colors: ['#2E3138', '#C9CCD1', '#7B8189', '#3B4B63', '#F2F2EE'], share: 0.55 }, { kind: 'bus', colors: ['#E8EAEC'], share: 0.1 }],
    traffic: 7, poles: false,
    tanks: { color: '#8A6A4A', share: 0.3, kind: 'wood' }, umbrellas: null, shack: IRON_SHACK, lamp: '#FFC98A', tall: 1.2,
    refs: [
      'https://commons.wikimedia.org/wiki/File:206_-_224_Kane_Street_Brooklyn.jpg (Beyond My Ken, CC BY-SA 4.0)',
      'https://commons.wikimedia.org/wiki/File:484_14th_St_museum_jeh.jpg (Jim.henderson, CC0)',
      'https://commons.wikimedia.org/wiki/File:Motorcyclist_in_Midtown_Manhattan-L1002704.jpg (Frank Schulenburg, CC BY-SA 4.0)',
      'brick also from Boston Back Bay, same brick as Manhattan: https://commons.wikimedia.org/wiki/File:Boston_Back_Bay,_Newbury_Street_(brownstone)_Brooks_Brothers_is_the_oldest_men%27s_clothier_in_the_United_States_and_is_headquartered_on_Madison_Avenue_in_Manhattan,_New_York_City.jpg (David Adam Kess, CC BY-SA 4.0)',
    ],
  },
  // painted concrete in cream, peach and teal, rusty and zinc iron roofs, laterite side streets, yellow minibuses,
  // motorbike taxis, umbrellas over street stalls, black water tanks, poles and wires
  westafrica: {
    id: 'westafrica',
    walls: ['#D9CBA9', '#A9A69F', '#D9A88A', '#E0CF8E', '#C9C2B4', '#7FB9B6'],
    trim: '#5C5A55',
    roofs: [{ kind: 'iron', colors: ['#9A5A3C', '#9EA2A3', '#C7C9C4', '#7E4A33'], share: 0.6 }, { kind: 'flat', colors: ['#9C978E'], share: 0.4 }],
    street: '#6E6A62', sidewalk: '#C9B284', ground: '#B9A27E', unpaved: 0.45, dirt: '#C77547',
    shops: 0.7, signs: ['#C14025', '#24BCC9', '#E3B33C', '#2F6FB5', '#F2F2EE', '#2E8B57'], signStyle: 'board',
    trees: { kind: 'palm', leaves: ['#2E7A2E', '#1E5A26', '#4F8A3A'], per: 1 }, deciduous: false,
    vehicles: [{ kind: 'minibus', colors: ['#E3B21F'], share: 0.35 }, { kind: 'moto', colors: ['#2B2B2D', '#8C1E1E'], share: 0.3 }, { kind: 'car', colors: ['#3A3A3C', '#C8C9C6', '#8C1E1E', '#E8E8E4'], share: 0.35 }],
    traffic: 8, poles: true,
    tanks: { color: '#2B2B2D', share: 0.45, kind: 'poly' }, umbrellas: ['#C14025', '#24BCC9', '#E3B33C', '#F2F2EE', '#2F6FB5'],
    shack: IRON_SHACK, lamp: '#FFD08A', tall: 0.9,
    refs: [
      'https://commons.wikimedia.org/wiki/File:Aerial_view_of_a_busy_tomato_market_in_Lagos_Nigeria.jpg (Ayorinde Ogundele, CC BY-SA 4.0)',
      'https://commons.wikimedia.org/wiki/File:Broad_Street,_Lagos_Island,_Lagos.jpg (Yellowcrunchy, CC BY-SA 4.0)',
      'https://commons.wikimedia.org/wiki/File:View_of_a_road_along_Ikeja,_Lagos_State,_May_2023.jpg (Grace789, CC BY-SA 4.0)',
      'https://commons.wikimedia.org/wiki/File:A_walkway_somewhere_in_LADOKE_AKINTOLA_IKEJA_GRA_LAGOS_NIGERIA.jpg (Swantata, CC BY-SA 4.0)',
    ],
  },
  // weathered lime plaster, white arcades, blue balconies, rust and teal iron roofs, sandy side streets,
  // three-wheel taxis, minibuses and motorbikes, mango trees and palms
  eastafrica: {
    id: 'eastafrica',
    walls: ['#B4B2B9', '#ECEBE6', '#D5CDB6', '#C9A9A2', '#A9B7A8', '#D9CFA8'],
    trim: '#4E9BD4',
    roofs: [{ kind: 'iron', colors: ['#8F6247', '#4E7A8A', '#9EA2A3', '#B5B8B4'], share: 0.7 }, { kind: 'flat', colors: ['#A6A29A'], share: 0.3 }],
    street: '#7A776E', sidewalk: '#C1BAA5', ground: '#B9B5A3', unpaved: 0.5, dirt: '#B8A27E',
    shops: 0.65, signs: ['#C8302C', '#4E9BD4', '#E3C23A', '#2E8B57', '#F2F2EE'], signStyle: 'board',
    trees: { kind: 'broadleaf', leaves: ['#2F6B34', '#3E7D3A', '#285A2C'], per: 1 }, deciduous: false,
    vehicles: [{ kind: 'tuktuk', colors: ['#3B6FB6', '#C8302C', '#E3C23A'], share: 0.35 }, { kind: 'minibus', colors: ['#E9E7E0'], share: 0.25 }, { kind: 'moto', colors: ['#2B2B2D', '#C8302C'], share: 0.2 }, { kind: 'car', colors: ['#E8E8E4', '#3A3A3C', '#A9ACAE'], share: 0.2 }],
    traffic: 6, poles: true,
    tanks: { color: '#2B2B2D', share: 0.4, kind: 'poly' }, umbrellas: ['#C8302C', '#4E9BD4', '#E3C23A', '#F2F2EE'],
    shack: IRON_SHACK, lamp: '#FFD08A', tall: 0.8,
    refs: [
      'https://commons.wikimedia.org/wiki/File:Street_Scene_in_Asian_Quarter_-_Dar_es_Salaam_-_Tanzania.jpg (Adam Jones, CC BY-SA 3.0)',
      'https://commons.wikimedia.org/wiki/File:Street_in_Mbweni_ward,_Kinondoni_MC,_Dar_es_Salaam.jpg (Mnazini, CC BY 4.0)',
      'https://commons.wikimedia.org/wiki/File:Kariakoo_market_dar_es_salaam.jpg (Moongateclimber, public domain)',
      'https://commons.wikimedia.org/wiki/File:Dar_es_Salaam_Waterfront_Old_City_numbered.jpg (Kipala, CC BY-SA 4.0)',
    ],
  },
  // off-white tile and grey concrete mid-rises, low houses with grey tile roofs, vertical signs that glow at
  // night, utility poles and wires, white cars, vending machines
  tokyo: {
    id: 'tokyo',
    walls: ['#E4E1DA', '#C9C8C4', '#D6CCBB', '#B0AAAA', '#EFEDE8', '#9E968C'],
    trim: '#5C5D60',
    roofs: [{ kind: 'flat', colors: ['#A9A8A3', '#8E8E8A'], share: 0.7 }, { kind: 'pitched', colors: ['#4F5560', '#5E6168'], share: 0.3 }],
    street: '#6F7074', sidewalk: '#BDBAB2', ground: '#A8A6A0', unpaved: 0, dirt: '#8C8070',
    shops: 0.6, signs: ['#E8463A', '#2FB4C4', '#F2C230', '#4A7BD9', '#F0F0F0', '#E05A9A'], signStyle: 'vertical',
    trees: { kind: 'broadleaf', leaves: ['#5E8A4E', '#4E7A44'], per: 0.5 }, deciduous: false,
    vehicles: [{ kind: 'car', colors: ['#F2F2EE', '#F2F2EE', '#BFC3C7', '#2B2B2D', '#3E5A44'], share: 0.75 }, { kind: 'cab', colors: ['#2B2B2D', '#3E5A44'], share: 0.15 }, { kind: 'bus', colors: ['#E8EAEC'], share: 0.1 }],
    traffic: 6, poles: true,
    tanks: { color: '#D8D8D4', share: 0.3, kind: 'ac' }, umbrellas: null, shack: IRON_SHACK, lamp: '#EAF2FF', tall: 1,
    refs: [
      'https://commons.wikimedia.org/wiki/File:Colorful_neon_street_signs_in_Kabukich%C5%8D,_Shinjuku,_Tokyo.jpg (Basile Morin, CC BY-SA 4.0)',
      'https://commons.wikimedia.org/wiki/File:Buildings_with_colorful_neon_street_signs_at_blue_hour,_Shinjuku,_Tokyo.jpg (Basile Morin, CC BY-SA 4.0)',
      'https://commons.wikimedia.org/wiki/File:DAIBA_1-CHOME_SHOUTENGAI.JPG (CC BY-SA 3.0)',
    ],
  },
  // white tile and grey residential slabs, red and gold signs, plane trees, e-scooters
  china: {
    id: 'china',
    walls: ['#E8E6E2', '#C9C9CD', '#CDB091', '#A79788', '#D9D4CA', '#B8BCC2'],
    trim: '#4A4A4E',
    roofs: [{ kind: 'flat', colors: ['#8E8E8A', '#9A9690'], share: 0.85 }, { kind: 'pitched', colors: ['#5A5C60'], share: 0.15 }],
    street: '#66676A', sidewalk: '#B8B4AA', ground: '#A9A69E', unpaved: 0, dirt: '#8C8070',
    shops: 0.55, signs: ['#C8302C', '#D9A93A', '#2F6FB5', '#F2F2EE'], signStyle: 'mixed',
    trees: { kind: 'broadleaf', leaves: ['#5E8A4E', '#4E7A44'], per: 1.5 }, deciduous: true,
    vehicles: [{ kind: 'car', colors: ['#F2F2EE', '#2B2B2D', '#BFC3C7', '#3B4B63'], share: 0.6 }, { kind: 'moto', colors: ['#3B6FB6', '#F2F2EE', '#C8302C'], share: 0.3 }, { kind: 'bus', colors: ['#3E9C6B'], share: 0.1 }],
    traffic: 7, poles: false,
    tanks: { color: '#D8D8D4', share: 0.2, kind: 'ac' }, umbrellas: null, shack: IRON_SHACK, lamp: '#FFE1B0', tall: 1.3,
    refs: [
      'https://commons.wikimedia.org/wiki/File:Residential_buildings_Shanghai.jpg (kallerna, CC BY-SA 4.0)',
      'https://commons.wikimedia.org/wiki/File:South_Gate_of_Shanghai_Kangcheng_Residential_Complex_in_Xinzhuang,_Minhang,_Shanghai,_China_20251122.jpg (CC BY 4.0)',
      'https://commons.wikimedia.org/wiki/File:Hutong_Jiemen_(Snowyowls).jpg (Snowyowls, CC BY-SA 1.0)',
    ],
  },
  // sandstone, concrete and pastel paint, flat roofs with tanks, blue tarps, dense colored shop boards,
  // three-wheel autos, motorbikes and buses, poles and tangled wires
  sasia: {
    id: 'sasia',
    walls: ['#C0AF97', '#B8A898', '#B5B1AE', '#D9C9A0', '#BFD2C4', '#D8A7A0'],
    trim: '#5E4D3E',
    roofs: [{ kind: 'flat', colors: ['#9F9B9A', '#A89A86'], share: 0.85 }, { kind: 'iron', colors: ['#7C8287', '#4F6FA8'], share: 0.15 }],
    street: '#6E6A64', sidewalk: '#B5A994', ground: '#A89A86', unpaved: 0.3, dirt: '#A89272',
    shops: 0.8, signs: ['#D23A2E', '#F2C230', '#2E7D4F', '#2F5DA8', '#F2F2EE'], signStyle: 'board',
    trees: { kind: 'broadleaf', leaves: ['#4E7A3A', '#3E6A34'], per: 0.7 }, deciduous: false,
    vehicles: [{ kind: 'tuktuk', colors: ['#2F7D3A', '#E3C23A'], share: 0.35 }, { kind: 'moto', colors: ['#2B2B2D', '#C8302C', '#2F5DA8'], share: 0.35 }, { kind: 'car', colors: ['#F2F2EE', '#BFC3C7'], share: 0.2 }, { kind: 'bus', colors: ['#C8302C'], share: 0.1 }],
    traffic: 9, poles: true,
    tanks: { color: '#2B2B2D', share: 0.5, kind: 'poly' }, umbrellas: ['#4F6FA8', '#D23A2E', '#F2C230', '#F2F2EE'],
    shack: { walls: ['#9F8B78', '#B5A994', '#8B7B6A'], roofs: ['#4F6FA8', '#7C8287', '#9EA2A3', '#8E5B3D'] }, lamp: '#FFD08A', tall: 0.9,
    refs: [
      'https://commons.wikimedia.org/wiki/File:Sonargaon_Janapath_09.jpg (Mehediabedin, CC BY-SA 4.0)',
      'https://commons.wikimedia.org/wiki/File:Sonargaon_Janapath_29.jpg (Mehediabedin, CC BY-SA 4.0)',
      'https://commons.wikimedia.org/wiki/File:20191205_Targ_przypraw_w_Starym_Delhi_0703_6755.jpg (Jakub Hałun, CC BY-SA 4.0)',
    ],
  },
  // white and cream shophouses, terracotta tile roofs, motorbikes everywhere, palms, poles and wires
  seasia: {
    id: 'seasia',
    walls: ['#E4E1D7', '#CBCAC8', '#D9B96B', '#C9D3C2', '#E6C9B4', '#B7B6B4'],
    trim: '#5B4E44',
    roofs: [{ kind: 'pitched', colors: ['#A9583C', '#8E4A34'], share: 0.4 }, { kind: 'flat', colors: ['#9E988E'], share: 0.4 }, { kind: 'iron', colors: ['#7C8287', '#8E5B3D'], share: 0.2 }],
    street: '#6A6862', sidewalk: '#BBB7AD', ground: '#A9A396', unpaved: 0.1, dirt: '#A88E6E',
    shops: 0.75, signs: ['#C8302C', '#F2C230', '#1F6FB2', '#F2F2EE', '#2E8B57'], signStyle: 'board',
    trees: { kind: 'palm', leaves: ['#3E7A3A', '#2E6A30'], per: 0.8 }, deciduous: false,
    vehicles: [{ kind: 'moto', colors: ['#2B2B2D', '#C8302C', '#2F5DA8', '#F2F2EE'], share: 0.6 }, { kind: 'car', colors: ['#F2F2EE', '#BFC3C7', '#2B2B2D'], share: 0.3 }, { kind: 'bus', colors: ['#2F5DA8'], share: 0.1 }],
    traffic: 9, poles: true,
    tanks: { color: '#3E6FA8', share: 0.3, kind: 'poly' }, umbrellas: ['#C8302C', '#2F5DA8', '#F2C230', '#F2F2EE'],
    shack: IRON_SHACK, lamp: '#FFD08A', tall: 1,
    refs: [
      'https://commons.wikimedia.org/wiki/File:Dutch_Colonial_Buildings_on_Jalan_Kali_Besar_Barat_(2025)_-_img_02.jpg (Chainwit., CC BY 4.0)',
      'https://commons.wikimedia.org/wiki/File:TMB_Thanachart_Chinatown,_Bangkok_07.23.jpg (CC BY-SA 4.0)',
    ],
  },
  // painted concrete in warm colors, exposed brick, black rooftop water tanks, unfinished upper floors, jacarandas
  latam: {
    id: 'latam',
    walls: ['#C9C1B0', '#A8A69C', '#D96B4A', '#E0B64A', '#5E9BB8', '#B5577A', '#A65B42'],
    trim: '#4B4A43',
    roofs: [{ kind: 'flat', colors: ['#8E8A82', '#9C978E'], share: 0.85 }, { kind: 'pitched', colors: ['#A9583C'], share: 0.15 }],
    street: '#63645D', sidewalk: '#B8B4A8', ground: '#A9A396', unpaved: 0.15, dirt: '#A88E6E',
    shops: 0.6, signs: ['#C8302C', '#249BCB', '#E3C23A', '#2E8B57', '#F2F2EE'], signStyle: 'board',
    trees: { kind: 'broadleaf', leaves: ['#577823', '#3A511E', '#8A6FB8'], per: 1 }, deciduous: false,
    vehicles: [{ kind: 'car', colors: ['#F2F2EE', '#BFC3C7', '#C8302C', '#2B2B2D'], share: 0.6 }, { kind: 'cab', colors: ['#E3C23A'], share: 0.15 }, { kind: 'minibus', colors: ['#3E9C6B', '#F2F2EE'], share: 0.15 }, { kind: 'moto', colors: ['#2B2B2D'], share: 0.1 }],
    traffic: 7, poles: true,
    tanks: { color: '#2B2B2D', share: 0.45, kind: 'poly' }, umbrellas: ['#C8302C', '#249BCB', '#E3C23A'],
    shack: { walls: ['#A65B42', '#B8A898', '#9C8C7C'], roofs: ['#9EA2A3', '#7C8287', '#8E5B3D'] }, lamp: '#FFC98A', tall: 1,
    refs: [
      'https://commons.wikimedia.org/wiki/File:Panor%C3%A1mica_%C3%81lvaro_Obreg%C3%B3n_e_Insurgentes,_colonia_Roma.jpg (ProtoplasmaKid, CC BY-SA 4.0)',
      'https://commons.wikimedia.org/wiki/File:Bogot%C3%A1_Calle_100_entre_11_y_15.JPG (Felipe Restrepo Acosta, CC BY-SA 3.0)',
    ],
  },
  // cream and ochre plaster, red brick, tile and slate roofs, street trees
  europe: {
    id: 'europe',
    walls: ['#DCCDA8', '#C4A86E', '#A65B42', '#E3DCCB', '#B8B4AC', '#D9B9A0'],
    trim: '#51412F',
    roofs: [{ kind: 'pitched', colors: ['#A4553C', '#55575C', '#8E4A34'], share: 0.7 }, { kind: 'flat', colors: ['#8E8A82'], share: 0.3 }],
    street: '#5E5F60', sidewalk: '#B9B4A8', ground: '#A9A59B', unpaved: 0, dirt: '#8C8070',
    shops: 0.5, signs: ['#2F4F3E', '#7A2E2A', '#22303F', '#C9A23F', '#E8E2D2'], signStyle: 'board',
    trees: { kind: 'broadleaf', leaves: ['#5E8A4E', '#4E7A44'], per: 1.5 }, deciduous: true,
    vehicles: [{ kind: 'car', colors: ['#2E3138', '#C9CCD1', '#7B8189', '#3B4B63', '#F2F2EE', '#8C1E1E'], share: 0.85 }, { kind: 'bus', colors: ['#E3C23A'], share: 0.15 }],
    traffic: 6, poles: false,
    tanks: null, umbrellas: null, shack: IRON_SHACK, lamp: '#FFD9A0', tall: 0.8,
    refs: [
      'https://commons.wikimedia.org/wiki/File:Krankenhaus_am_Urban,_Berlin-Altbaugel%C3%A4nde_2014-03.jpg (LezFraniak, CC BY-SA 4.0)',
      'https://commons.wikimedia.org/wiki/File:VLB_Berlin_Altbau_mit_Maulbeerbaum.jpg (Fridolin freudenfett, CC BY-SA 4.0)',
    ],
  },
  // sand, beige and dusty white concrete, red brick infill, flat roofs with tanks and dishes, date palms
  mideast: {
    id: 'mideast',
    walls: ['#CFC2A6', '#BDB49D', '#B8B3A5', '#EBE9DF', '#A8644A', '#D9CDB0'],
    trim: '#5E5949',
    roofs: [{ kind: 'flat', colors: ['#A39C8A', '#9A968F'], share: 1 }],
    street: '#6A675E', sidewalk: '#C2B8A2', ground: '#C9B994', unpaved: 0.15, dirt: '#C2AE84',
    shops: 0.7, signs: ['#2E6F4E', '#B83A2E', '#E3C23A', '#2F5DA8', '#F2F2EE'], signStyle: 'board',
    trees: { kind: 'palm', leaves: ['#5E7A3A', '#4E6A34'], per: 0.6 }, deciduous: false,
    vehicles: [{ kind: 'car', colors: ['#F2F2EE', '#BFC3C7', '#2B2B2D', '#E3C23A'], share: 0.7 }, { kind: 'minibus', colors: ['#F2F2EE'], share: 0.2 }, { kind: 'moto', colors: ['#2B2B2D'], share: 0.1 }],
    traffic: 8, poles: true,
    tanks: { color: '#D8D8D4', share: 0.4, kind: 'poly' }, umbrellas: ['#B83A2E', '#2E6F4E', '#F2F2EE'],
    shack: { walls: ['#A8644A', '#B8A890', '#9C8C7C'], roofs: ['#9EA2A3', '#7C8287'] }, lamp: '#FFD08A', tall: 0.9,
    refs: [
      'https://commons.wikimedia.org/wiki/File:26_Mahmoud_Bassiouny_Street_Cairo_05.jpg (Marsupium, CC BY-SA 4.0)',
      'https://commons.wikimedia.org/wiki/File:26_Mahmoud_Bassiouny_Street_Cairo_04.jpg (Marsupium, CC BY-SA 4.0)',
    ],
  },
  // tall panel blocks in cream, pale yellow and light blue, birches and poplars, wide streets
  rus: {
    id: 'rus',
    walls: ['#D8D2C4', '#CCAE8A', '#D9C27E', '#9DB3C4', '#BBB9B6', '#DECFB9'],
    trim: '#5A5A58',
    roofs: [{ kind: 'flat', colors: ['#8F969F', '#7E8288'], share: 0.9 }, { kind: 'pitched', colors: ['#5A7C98'], share: 0.1 }],
    street: '#5F6164', sidewalk: '#B4B1AA', ground: '#A3A096', unpaved: 0.05, dirt: '#8C8070',
    shops: 0.35, signs: ['#C8302C', '#2F5DA8', '#F2F2EE', '#3E9C6B'], signStyle: 'board',
    trees: { kind: 'broadleaf', leaves: ['#6F8F4E', '#7E9A52'], per: 1.5 }, deciduous: true,
    vehicles: [{ kind: 'car', colors: ['#F2F2EE', '#2B2B2D', '#BFC3C7', '#3B4B63', '#8C1E1E'], share: 0.85 }, { kind: 'bus', colors: ['#3E9C6B', '#E3C23A'], share: 0.15 }],
    traffic: 6, poles: false,
    tanks: null, umbrellas: null, shack: IRON_SHACK, lamp: '#FFD08A', tall: 1.3,
    refs: ['https://commons.wikimedia.org/wiki/File:Moscow_State_University_crop.jpg (Dmitry A. Mottl, CC BY-SA 3.0)'],
  },
  // set by eye, no photo list: north american sprawl, siding and brick houses with shingle roofs, wide streets
  na: {
    id: 'na',
    walls: ['#C9C1B3', '#B7A48C', '#8E9AA6', '#D8D2C6', '#A8857C', '#E8E4DA'],
    trim: '#3E3E40',
    roofs: [{ kind: 'pitched', colors: ['#4E4E52', '#6A5E54'], share: 0.6 }, { kind: 'flat', colors: ['#6A6866'], share: 0.4 }],
    street: '#5E6066', sidewalk: '#BDB9B0', ground: '#9DAA86', unpaved: 0, dirt: '#8C8070',
    shops: 0.3, signs: ['#C8302C', '#2F5DA8', '#F2C230', '#F2F2EE'], signStyle: 'board',
    trees: { kind: 'broadleaf', leaves: ['#5E8A4E', '#4E7A44'], per: 1.5 }, deciduous: true,
    vehicles: [{ kind: 'car', colors: ['#2E3138', '#C9CCD1', '#7B8189', '#3B4B63', '#F2F2EE', '#8C1E1E'], share: 0.9 }, { kind: 'bus', colors: ['#E8EAEC'], share: 0.1 }],
    traffic: 6, poles: true,
    tanks: null, umbrellas: null, shack: IRON_SHACK, lamp: '#FFC98A', tall: 0.9,
    refs: ['https://commons.wikimedia.org/wiki/File:East_Houston_Street_NYC_9183.JPG (Gryffindor, CC BY-SA 3.0)'],
  },
}

// countries whose cities look like a specific look, beyond what their region group gives
const BY_COUNTRY: Record<string, string> = {
  JPN: 'tokyo', KOR: 'china', TWN: 'china', HKG: 'china', MAC: 'china', SGP: 'seasia',
  NGA: 'westafrica', GHA: 'westafrica', BEN: 'westafrica', TGO: 'westafrica', CIV: 'westafrica', SEN: 'westafrica', CMR: 'westafrica',
  LBR: 'westafrica', SLE: 'westafrica', GIN: 'westafrica', MLI: 'westafrica', BFA: 'westafrica', NER: 'westafrica', COD: 'westafrica', COG: 'westafrica', AGO: 'westafrica', GAB: 'westafrica',
  TZA: 'eastafrica', KEN: 'eastafrica', UGA: 'eastafrica', MOZ: 'eastafrica', ETH: 'eastafrica', RWA: 'eastafrica', MWI: 'eastafrica', ZMB: 'eastafrica',
  ZWE: 'eastafrica', MDG: 'eastafrica', SOM: 'eastafrica', SSD: 'eastafrica', SDN: 'mideast', ZAF: 'latam', BWA: 'eastafrica', NAM: 'eastafrica',
  AUS: 'na', NZL: 'na', CAN: 'na', USA: 'na', TUR: 'mideast', IRN: 'mideast', PAK: 'sasia', AFG: 'mideast', MNG: 'rus',
}
const BY_GROUP: Record<string, string> = {
  na: 'na', europe: 'europe', latam: 'latam', carib_pac: 'latam', sasia: 'sasia', seasia: 'seasia', easia: 'china',
  mideast: 'mideast', nafrica: 'mideast', rus_ca: 'rus', oceania: 'na', ssa: 'eastafrica', other: 'europe',
}

export function lookFor(country: string | undefined, group: string | undefined, lat: number, lon: number): Look {
  // the dense northeastern us core (boston to washington) is the brownstone, brick and tower look
  if (country === 'USA' && lat > 38 && lat < 43 && lon > -78) return LOOKS.nyc
  const id = (country && BY_COUNTRY[country]) || (group && BY_GROUP[group]) || (lat > 50 ? 'rus' : 'europe')
  return LOOKS[id] ?? LOOKS.europe
}

// trees are bare in winter in temperate places (month 0..11, by hemisphere)
export function bareTrees(look: Look, lat: number, month: number) {
  if (!look.deciduous || Math.abs(lat) < 30) return false
  const m = lat >= 0 ? month : (month + 6) % 12
  return m === 11 || m <= 2
}
