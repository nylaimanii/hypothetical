// visible citizens ("pips"): 1 per ~40M people, min 3, max 48 per region, re-synced every year. appearance comes only from data/demographics.json weights via the
// seeded citizens stream: skin tone, hair, hair color, height, build, age. one shared base mesh in the ui.
// new citizens draw their ancestry from the region's current origin mix, so migration mixes regions over time.
// thoughts are flavor text: they never feed back into any sim number.
import { nameFor } from './names'
import { countriesOf, countryPop } from './places'
import type { Citizen, Law } from '../types'
import { chat, llmEnabled } from '../agent/llm'
import { hashString, mulberry32, normal, pick, pickWeighted, type Rng } from './rng'
import { BAND_MID, DEMOGRAPHICS, clamp, incomeIdx, regionPop, type RegionState, type World } from './state'
import { yearOf, ppl } from './causes'
import { placeCitizen } from './world-layer'
import { groupMatches } from './behavior'
import { addLifeEvent, citizenGroup, pickArchetype, satiricalThought, stepCitizens, valence } from './behavior'

export const PEOPLE_PER_PIP = 40e6
export const MIN_PIPS = 3
export const MAX_PIPS = 48
// thoughts are templates by default; only the most recently affected pips per region get a fresh llm thought
// each year: 3 per region, or 8 with LLM_THOUGHTS=1
export const llmThoughtsPerRegion = () => (process.env.LLM_THOUGHTS === '1' ? 8 : 3)

export function pipCount(population: number): number {
  return Math.max(MIN_PIPS, Math.min(MAX_PIPS, Math.round(population / PEOPLE_PER_PIP)))
}

const HAIR = ['bald', 'buzz', 'short_straight', 'short_wavy', 'short_coily', 'afro', 'locs', 'braids', 'long_straight', 'long_wavy', 'bun', 'ponytail'] as const
type Hair = Citizen['hair']


const JOBS_LOW = ['farmer', 'market trader', 'builder', 'driver', 'tailor', 'fisher', 'mechanic', 'nurse', 'teacher', 'student', 'shopkeeper', 'cook']
const JOBS_HIGH = ['software engineer', 'nurse', 'teacher', 'accountant', 'electrician', 'student', 'retail worker', 'doctor', 'designer', 'lab technician', 'logistics manager', 'civil servant']

// WHO child growth standards, median length/height at ages 0-4 (cm), both sexes averaged. ESTIMATE scaled
// to each region by the NCD-RisC age-5 height. https://www.who.int/tools/child-growth-standards
const WHO_0_4 = [50, 75, 87, 95.5, 103]
const WHO_5 = 110

// a stable unit value derived from a citizen's personality seed and a salt
const unit = (seed: number, salt: string) => mulberry32((seed ^ hashString(salt)) >>> 0)()
const z = (seed: number, salt: string) => { const r = mulberry32((seed ^ hashString(salt)) >>> 0); return normal(r) }

export function heightFor(regionId: string, sex: Citizen['sex'], age: number, seed: number): number {
  const d = DEMOGRAPHICS[regionId]
  const sd = sex === 'female' ? d.heightCm.sd.female : d.heightCm.sd.male
  const zz = clamp(z(seed, 'height'), -2.5, 2.5)
  const curve = sex === 'female' ? d.childHeightCm.female : d.childHeightCm.male
  let h: number
  if (age < 5) h = WHO_0_4[Math.max(0, Math.floor(age))] * curve[0] / WHO_5 + zz * 3
  else if (age < 19) h = curve[Math.floor(age) - 5] + zz * sd * (0.5 + 0.5 * age / 19)
  else {
    h = (sex === 'female' ? d.heightCm.female : d.heightCm.male) + zz * sd
    if (age > 60) h -= 0.1 * (age - 60) // ESTIMATE: ~1 cm per decade of height loss after 60
  }
  return Math.round(h * 10) / 10
}

function hairWeights(regionId: string, sex: Citizen['sex'], age: number): Record<string, number> {
  const base = DEMOGRAPHICS[regionId].hairType.weights
  const w: Record<string, number> = {}
  for (const h of HAIR) {
    let x = base[h] ?? 0.01
    // ESTIMATE: sex and age adjustments to style frequency
    if (sex === 'female') {
      if (h === 'bald') x *= 0.03
      if (h === 'buzz') x *= 0.3
      if (h.startsWith('long') || h === 'bun' || h === 'ponytail') x *= 1.8
      if (h === 'braids') x *= 1.5
    } else {
      if (h.startsWith('long')) x *= 0.35
      if (h === 'bun' || h === 'ponytail') x *= 0.4
      if (h === 'braids') x *= 0.6
      if (h === 'bald') x *= 1 + Math.max(0, age - 25) / 12
      if (h === 'buzz') x *= 1.5
    }
    if (age < 12 && h === 'bald') x = 0
    w[h] = x
  }
  return w
}

export function hairColorFor(regionId: string, age: number, seed: number, base: Citizen['hairColor']): Citizen['hairColor'] {
  // ESTIMATE: graying starts mid 30s, most people gray by 75, white after 60. stable per person and monotone with age.
  const g = unit(seed, 'gray')
  if (g < clamp((age - 60) / 40)) return 'white'
  if (g < clamp((age - 35) / 40)) return 'gray'
  return base
}

function sampleAge(rs: RegionState, rng: Rng): number {
  const band = pickWeighted<number>(rng, rs.bands)
  const lo = band * 5
  const span = band === 16 ? 15 : 5
  return Math.floor(lo + rng() * span)
}

export function makeCitizen(w: World, rs: RegionState, rng: Rng, age?: number): Citizen {
  const origin = pickWeighted<string>(rng, rs.originMix)
  const d = DEMOGRAPHICS[origin]
  const sex: Citizen['sex'] = rng() < 0.5 ? 'female' : 'male'
  const a = age ?? sampleAge(rs, rng)
  const personalitySeed = Math.floor(rng() * 2 ** 31)
  const skinTone = pickWeighted<number>(rng, d.skinTone.weights) + 1
  const hair = pickWeighted<string>(rng, hairWeights(origin, sex, a)) as Hair
  const baseColor = pickWeighted<string>(rng, d.hairColor.weights) as Citizen['hairColor']
  // (names come after placement: they follow the country and naming group someone comes from, names.ts)
  rng()
  const name = ''
  const kcal = rs.r.foodKcalPerCapita
  const build = pickWeighted<string>(rng, { slim: 0.3 + 0.3 * clamp((2600 - kcal) / 800), average: 0.5, broad: 0.2 + 0.15 * clamp((kcal - 2800) / 800) }) as Citizen['build']
  const inc = incomeIdx(rs.r.gdpUsd / Math.max(rs.r.population, 1))
  const job = a < 6 ? 'child' : a < 18 ? 'student' : a >= 67 ? 'retired' : pick(rng, rng() < inc ? JOBS_HIGH : JOBS_LOW)
  const f = rs.r.faith
  const belief = pickWeighted<string>(rng, { religious: 0.85 * f, spiritual: 0.15 * f + 0.15 * (1 - f), secular: 0.85 * (1 - f) }) as Citizen['belief']
  w.citizenSeq++
  const archetype = pickArchetype(rng, a)
  const c: Citizen = {
    id: `c${w.citizenSeq}`, regionId: rs.r.id, name, age: a, sex, skinTone, hair, hairColor: baseColor,
    heightCm: 0, build, personalitySeed, job, belief, thought: '',
    archetype, group: citizenGroup(w, rs, { age: a, job, belief, personalitySeed }), mood: { ...rs.mood }, behavior: 'working',
    lifeEvents: [], opinionOfCore: 0, family: { kids: a >= 25 ? Math.floor(rng() * Math.min(4, (rs.tfr || 2) + 0.5)) : 0 },
  }
  placeCitizen(w, c)
  // born once: birth month spread over the year, age derived from it from now on (truth.ts personAt)
  const cb = c as Citizen & { birthTick: number; countryId?: string; nameGroup?: string; givenName?: string; familyName?: string }
  cb.birthTick = w.tick - 12 * a - (personalitySeed % 12)
  // a pip from another region was named where it grew up: a country there, drawn by its seed
  const originCountry = origin === rs.r.id ? cb.countryId : bornIn(w, origin, personalitySeed)
  const nm = nameFor(w.names, personalitySeed, { countryId: originCountry, regionId: origin, sex })
  c.name = nm.full; cb.nameGroup = nm.group; cb.givenName = nm.given; cb.familyName = nm.family
  // hidden per-citizen attributes kept outside the public Citizen shape
  w.citizenMeta[c.id] = { origin, baseHair: baseColor, affectedTick: w.tick, prevMood: 0.5, sinceTick: w.tick }
  c.hairColor = hairColorFor(origin, a, personalitySeed, baseColor)
  c.heightCm = heightFor(origin, sex, a, personalitySeed)
  return c
}

export function initCitizens(w: World) {
  w.citizens = []
  for (const rs of w.regions) for (let i = 0; i < pipCount(rs.r.population); i++) w.citizens.push(makeCitizen(w, rs, w.rng.citizens))
  updateMoods(w)
}

// yearly: grow or shrink each region's pips to match its population. new pips come from the current
// origin mix; removed pips are the ones least recently affected (ties: oldest id), migrants are kept.
export function syncCitizenCounts(w: World) {
  const rng = w.rng.citizens
  for (const rs of w.regions) {
    const want = pipCount(rs.r.population)
    const here = w.citizens.filter(c => c.regionId === rs.r.id)
    if (here.length < want) {
      for (let i = here.length; i < want; i++) w.citizens.push(makeCitizen(w, rs, rng))
    } else if (here.length > want) {
      const drop = new Set(here
        .slice()
        .sort((a, b) => {
          const ma = w.citizenMeta[a.id], mb = w.citizenMeta[b.id]
          const la = (ma?.origin ?? rs.r.id) !== rs.r.id ? 1 : 0, lb = (mb?.origin ?? rs.r.id) !== rs.r.id ? 1 : 0
          return la - lb || (ma?.affectedTick ?? 0) - (mb?.affectedTick ?? 0) || Number(a.id.slice(1)) - Number(b.id.slice(1))
        })
        .slice(0, here.length - want)
        .map(c => c.id))
      w.citizens = w.citizens.filter(c => !drop.has(c.id))
      for (const id of drop) delete w.citizenMeta[id]
    }
  }
}

// yearly: birthdays, deaths (replaced by a new resident drawn from the current mix)
export function ageCitizens(w: World) {
  const rng = w.rng.citizens
  w.citizens = w.citizens.map(c => {
    // a death is stored once, with its date and age (truth.ts reads it everywhere)
    const die = (cause: string) => {
      const cb = c as Citizen & { birthTick?: number; countryId?: string; cityId?: string }
      const arc = (w.lifeArchive[c.id] ??= { name: c.name, regionId: c.regionId, events: [] })
      const ageAtDeath = cb.birthTick !== undefined ? Math.floor((w.tick - cb.birthTick) / 12) : c.age
      Object.assign(arc, { death: { tick: w.tick, ageAtDeath, cause }, birthTick: cb.birthTick, countryId: cb.countryId, cityId: cb.cityId })
      arc.events.push({ tick: w.tick, text: `died at ${ageAtDeath}` })
      return makeCitizen(w, rs, rng)
    }
    const rs = w.regions.find(r => r.r.id === c.regionId)!
    const bt = (c as Citizen & { birthTick?: number }).birthTick
    const age = bt !== undefined ? Math.floor((w.tick - bt) / 12) : c.age + 1
    const band = Math.min(16, Math.floor(age / 5))
    const pDeath = 1 - Math.exp(-(rs.gompertzA * Math.exp(0.09 * (BAND_MID[band] - 60))))
    if (rng() < pDeath || age > 105) return die(age > 105 ? 'old age' : 'illness or age')
    const meta = w.citizenMeta[c.id]
    const origin = meta?.origin ?? c.regionId
    const job = age === 6 && c.job === 'child' ? 'student' : age === 18 && c.job === 'student' ? pick(rng, rng() < 0.5 ? JOBS_HIGH : JOBS_LOW) : age === 67 ? 'retired' : c.job
    return { ...c, age, job, hairColor: hairColorFor(origin, age, c.personalitySeed, meta?.baseHair ?? c.hairColor), heightCm: heightFor(origin, c.sex, age, c.personalitySeed) }
  })
}

// a relocation of `people` from -> to may carry visible citizens along. they keep their appearance.
export function migrateCitizens(w: World, from: string, to: string, people: number) {
  const rng = w.rng.citizens
  const src = w.regions.find(r => r.r.id === from)
  const dst = w.regions.find(r => r.r.id === to)
  if (!src || !dst) return
  const p = clamp(400 * people / Math.max(regionPop(src), 1))
  if (rng() >= p) return
  const movers = w.citizens.filter(c => c.regionId === from && c.age >= 16)
  if (!movers.length) return
  const mover = pick(rng, movers)
  // the mover keeps their appearance; counts are rebalanced at the next yearly sync
  w.citizens = w.citizens.map(c => (c === mover ? { ...c, regionId: to } : c))
  const moved = w.citizens.find(c => c.id === mover.id)
  if (moved) placeCitizen(w, moved)
  if (moved) addLifeEvent(w, moved, `relocated from ${src.r.name} to ${dst.r.name}`)
}

// monthly: moods, behaviors, opinions (behavior.ts). yearly: partners for unpartnered adults in the same region
export function updateMoods(w: World) {
  stepCitizens(w)
}

export function pairPartners(w: World) {
  const rng = w.rng.citizens
  for (const rs of w.regions) {
    // partners live in the same city (or the same country where the city has one pip), never across borders
    const place = (c: Citizen) => { const x = c as Citizen & { cityId?: string; countryId?: string }; return x.cityId ?? x.countryId ?? rs.r.id }
    const single = w.citizens.filter(c => c.regionId === rs.r.id && c.age >= 20 && c.age <= 60 && !c.family.partnerId).sort((a, b) => place(a) < place(b) ? -1 : place(a) > place(b) ? 1 : 0)
    for (let i = 0; i + 1 < single.length; i += 2) {
      if (place(single[i]) !== place(single[i + 1])) { i--; continue }
      // ESTIMATE: 15% of eligible pairs partner up in a given year
      if (rng() < 0.15 && single[i].sex !== single[i + 1].sex || rng() < 0.03) {
        single[i].family.partnerId = single[i + 1].id
        single[i + 1].family.partnerId = single[i].id
        addLifeEvent(w, single[i], `moved in with ${single[i + 1].name}`)
        addLifeEvent(w, single[i + 1], `moved in with ${single[i].name}`)
      }
    }
  }
}

function lawsHitting(w: World, regionId: string): { law: Law; support: number }[] {
  const rs = w.regions.find(r => r.r.id === regionId)!
  return w.laws.filter(l => !l.vetoed).map(law => ({ law, support: rs.lawSupport[law.id] ?? 0.5 }))
    .sort((a, b) => Math.abs(b.support - 0.5) - Math.abs(a.support - 0.5)).slice(0, 3)
}

export function templateThought(w: World, c: Citizen): string {
  const rs = w.regions.find(r => r.r.id === c.regionId)!
  return satiricalThought(w, c, rs, rngFor(c, w))
}

// stable per citizen and year, independent of the sim rng streams
const rngFor = (c: Citizen, w: World) => mulberry32((c.personalitySeed ^ hashString(`thought${w.tick}`)) >>> 0)

// one batched llm call per year for all citizens. falls back to templates. never touches sim numbers.
export async function refreshThoughts(w: World, useLlm: boolean) {
  // "affected": a pip that is new, just moved, or whose mood shifted since last year
  for (const c of w.citizens) {
    const m = w.citizenMeta[c.id]
    if (m && Math.abs(valence(c.mood) - m.prevMood) > 0.05) m.affectedTick = w.tick
  }
  const chosen = new Set<string>()
  for (const rs of w.regions) {
    w.citizens.filter(c => c.regionId === rs.r.id)
      .sort((a, b) => (w.citizenMeta[b.id]?.affectedTick ?? 0) - (w.citizenMeta[a.id]?.affectedTick ?? 0)
        || Math.abs(valence(b.mood) - (w.citizenMeta[b.id]?.prevMood ?? 0.5)) - Math.abs(valence(a.mood) - (w.citizenMeta[a.id]?.prevMood ?? 0.5))
        || Number(a.id.slice(1)) - Number(b.id.slice(1)))
      .slice(0, llmThoughtsPerRegion())
      .forEach(c => chosen.add(c.id))
  }
  for (const c of w.citizens) {
    c.thought = templateThought(w, c)
    const m = w.citizenMeta[c.id]
    if (m) m.prevMood = valence(c.mood)
  }
  if (!useLlm || !llmEnabled()) return
  const regionBrief = w.regions.map(rs => ({
    id: rs.r.id, name: rs.r.name, foodKcal: Math.round(rs.r.foodKcalPerCapita), unrest: +rs.r.unrest.toFixed(2), inRevolt: rs.inRevolt,
    laws: lawsHitting(w, rs.r.id).map(x => ({ title: x.law.title, localSupport: +x.support.toFixed(2) })),
  }))
  const targets = w.citizens.filter(c => chosen.has(c.id))
  const people = targets.map(c => ({ id: c.id, name: c.name, age: c.age, job: c.job, region: c.regionId, archetype: c.archetype, behavior: c.behavior, mood: +valence(c.mood).toFixed(2), recent: c.lifeEvents.slice(-2).map(e => e.text) }))
  try {
    // one batched call per year for every chosen pip in every region
    const out = await chat({
      json: true, temperature: 0.8, maxTokens: 4000,
      system: 'You write one short first-person thought (max 25 words) for each ordinary person living under a single world government. Dry, deadpan, satirical, in an original voice: react to their actual situation, the laws that hit their region, the crowd topic of the moment, their archetype and what they are doing. Satirize behaviors and institutions, never race, ethnicity, religion as identity, sex or disability. Match their mood (0 miserable, 1 thriving). Plain everyday language, no em-dashes, no real politicians. Return JSON {"thoughts": {"<id>": "<thought>"}}.',
      user: JSON.stringify({ tick: w.tick, religionPolicy: w.religionPolicy, regions: regionBrief.map(r => ({ ...r, crowds: w.regions.find(x => x.r.id === r.id)!.crowds.map(c => `${c.topic} (${c.phase})`) })), people }),
    })
    const parsed = JSON.parse(out) as { thoughts?: Record<string, unknown> }
    for (const c of targets) {
      const t = parsed.thoughts?.[c.id]
      if (typeof t === 'string' && t.trim()) c.thought = t.trim().replace(/[\u2014\u2013]/g, ', ').slice(0, 220)
    }
  } catch {
    // templates already in place
  }
}

// ---------- personal life events ----------
// major cities per region (real places, for flavor until v4 moves pips into real city data)
const CITIES: Record<string, string[]> = {
  na: ['New York', 'Toronto', 'Chicago', 'Houston', 'Los Angeles', 'Montreal'], latam: ['Mexico City', 'Sao Paulo', 'Bogota', 'Lima', 'Buenos Aires', 'Santiago'],
  europe: ['Warsaw', 'Berlin', 'Paris', 'Madrid', 'Milan', 'Kyiv'], rus_ca: ['Moscow', 'Almaty', 'Tashkent', 'Novosibirsk', 'Tbilisi', 'Baku'],
  mideast: ['Istanbul', 'Tehran', 'Baghdad', 'Riyadh', 'Amman', 'Dubai'], nafrica: ['Cairo', 'Algiers', 'Casablanca', 'Khartoum', 'Tunis', 'Alexandria'],
  ssa: ['Lagos', 'Kinshasa', 'Nairobi', 'Addis Ababa', 'Johannesburg', 'Accra'], sasia: ['Mumbai', 'Dhaka', 'Karachi', 'Delhi', 'Lahore', 'Kolkata'],
  easia: ['Shanghai', 'Tokyo', 'Seoul', 'Beijing', 'Osaka', 'Chengdu'], seasia: ['Jakarta', 'Manila', 'Bangkok', 'Ho Chi Minh City', 'Kuala Lumpur', 'Yangon'],
  oceania: ['Sydney', 'Melbourne', 'Auckland', 'Brisbane', 'Perth', 'Adelaide'], carib_pac: ['Port Moresby', 'Santo Domingo', 'Havana', 'Kingston', 'Port-au-Prince', 'Suva'],
}
export function cityOf(c: Citizen): string {
  const list = CITIES[c.regionId] ?? ['the capital']
  return list[Math.floor(unit(c.personalitySeed, `city:${c.regionId}`) * list.length) % list.length]
}

// once a year every pip may gain one personal event, drawn from the cause links that actually hit its region,
// its job and its group. specific: their job, their city, what hit them, what they did, what changed.
export function personalYear(w: World) {
  const since = w.tick - 12
  for (const c of w.citizens) {
    if (c.age < 10) continue
    // a year's events only after a full year lived in this world (no 'quiet year' in someone's first month)
    const since0 = w.citizenMeta[c.id]?.sinceTick
    if (since0 !== undefined && w.tick - since0 < 12) continue
    const rs = w.regions.find(r => r.r.id === c.regionId)!
    const city = cityOf(c)
    const links = w.causes.filter(l => l.tick >= since && l.placeId === c.regionId)
    const r = rngFor(c, w)
    const cands: { score: number; text: string }[] = []
    const priceUp = links.find(l => /^food prices/.test(l.what) && l.value > 0.08)
    const drought = links.find(l => /drought|harvest/.test(l.what))
    const protest = links.filter(l => /protested/.test(l.what)).sort((a, b) => b.value - a.value)[0]
    const pandemic = w.causes.find(l => l.tick >= since && /pandemic/.test(l.what))
    const unrestUp = links.find(l => /^unrest/.test(l.what) && l.value > 0.03)
    const econ = links.find(l => /^the economy/.test(l.what))
    const year = yearOf(w.tick - 1)
    if (drought && /farmer/.test(c.job)) cands.push({ score: 5, text: `lost ${Math.round(20 + 40 * r())}% of the harvest outside ${city} in the ${year} drought and borrowed to plant again` })
    if (priceUp) cands.push({ score: 3 + priceUp.value * 10, text: `paid ${Math.round(priceUp.value * 100)}% more for groceries in ${city}${drought ? ` after the ${year} drought` : ''}, and ${c.family.kids ? 'cut meals for the adults so the kids eat' : 'started skipping lunch'}` })
    for (const l of w.laws.filter(x => !x.vetoed && x.enactedTick >= since)) {
      if (l.hatedBy.some(h => groupMatches(c.group, c.archetype, h))) cands.push({ score: 4, text: `lost out under law ${l.id}, "${l.title}"${c.behavior === 'protesting' ? `, and joined the marches in ${city}` : `, and ${c.archetype === 'hustler' ? 'found a way to profit anyway' : 'complained about it to anyone who would listen'}`}` })
      else if (l.lovedBy.some(h => groupMatches(c.group, c.archetype, h))) cands.push({ score: 3, text: `got help from law ${l.id}, "${l.title}", which ${/food|farm/.test(l.title.toLowerCase()) ? 'put cheaper food on the table' : /health|clinic|care/.test(l.title.toLowerCase()) ? 'paid for a doctor visit' : 'made the job as a ' + c.job + ' a little easier'}` })
    }
    if (protest && (c.behavior === 'protesting' || c.archetype === 'activist')) cands.push({ score: 6, text: `marched with ${ppl(protest.value)} others across ${rs.r.name}, in ${city}, over ${protest.what.split(' over ').slice(1).join(' over ') || 'the new laws'}` })
    if (pandemic) cands.push({ score: 3 + (c.age > 60 ? 2 : 0), text: `caught the ${year} fever in ${city}${c.age > 60 ? ' and spent three weeks in the hospital' : ' and was out of work for two weeks'}` })
    if (unrestUp && (c.archetype === 'worrier' || c.archetype === 'elder')) cands.push({ score: 3, text: `stopped going out after dark in ${city} as unrest climbed to ${rs.r.unrest.toFixed(2)}` })
    if (econ && c.job !== 'retired' && c.job !== 'student' && c.job !== 'child') cands.push({ score: 2, text: econ.value > 0 ? `got a ${Math.max(1, Math.round(econ.value * 60))}% raise as a ${c.job} in ${city} while the economy grew ${Math.round(econ.value * 100)}%` : `had hours cut ${Math.max(5, Math.round(-econ.value * 200))}% at the ${c.job} job in ${city} as the economy shrank` })
    const unlocked = w.requirements.filter(q => q.unlockedTick !== undefined && q.unlockedTick >= since && q.track === 'longevity')
    if (unlocked.length && c.age > 55) cands.push({ score: 4, text: `got the new ${unlocked[0].name} treatment at a clinic in ${city}` })
    const landmark = rs.landmarks.find(lm => lm.tick >= since)
    if (landmark) cands.push({ score: 1.5, text: `watched the ${landmark.kind.replace(/_/g, ' ')} "${landmark.label}" go up near ${city}` })
    // a quiet year, said specifically, and never twice in a row
    const lastQuiet = c.lifeEvents.slice(-2).some(e => e.text.startsWith('a quiet year'))
    if (!cands.length && !lastQuiet && r() < 0.5) {
      const rent = Math.round(2 + 6 * clamp(rs.r.population / Math.max(rs.pop0, 1) - 1 + 0.3 * r()))
      cands.push({ score: 1, text: c.job === 'student' ? `a quiet year: moved up a grade at school in ${city}` : `a quiet year: kept the ${c.job} job in ${city} while rent rose ${rent}%` })
    }
    const best = cands.sort((a, b) => b.score - a.score)[0]
    // about 6 events per decade: always for strong causes, often for mild ones
    if (best && (best.score >= 3 || r() < 0.55)) addLifeEvent(w, c, best.text)
  }
}

// a country in a region, drawn by seed and population (where a migrant pip grew up)
function bornIn(w: World, regionId: string, seed: number): string | undefined {
  const cs = countriesOf(w, regionId)
  const tot = cs.reduce((a, c) => a + countryPop(c), 0)
  let x = ((seed * 2654435761) >>> 0) % 100000 / 100000 * tot
  for (const c of cs) { x -= countryPop(c); if (x <= 0) return c.id }
  return cs[0]?.id
}
