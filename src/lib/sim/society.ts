// political realism. every law gets per-region support from that region's culture (faith, education,
// unrest, income). low support means low compliance: the law is mostly ignored and breeds unrest.
// regions can slide into revolt and attempt secession. the governor cannot simply order things.
import { A } from './assumptions'
import type { Law, Layer, ReligionPolicy } from '../types'
import {
  EDUCATION_LAG_TICKS, EDUCATION_TURNOVER_MONTHS, REVOLT_END_UNREST, REVOLT_ONSET_MONTHS, REVOLT_UNREST,
  REVENUE_SHARE, REVENUE_SHARE_MAX, SECESSION_MONTHS, SURVIVAL_KCAL, WORLD_RD_USD,
} from './constants'
import { clamp, event, incomeIdx, regionPop, sum, why, type RegionState, type World } from './state'
import { labelShare } from './behavior'

// ---------- law classification ----------
// deterministic keyword reading of the law text. the llm writes the text; only this code decides what it does.
export type LawFeatures = {
  coercive: number; tax: number; redistributive: number; religionRestrict: number; religionPromote: number
  science: number; family: number; familyLimit: number; energy: number; food: number; education: number; security: number
}
const has = (t: string, re: RegExp) => (re.test(t) ? 1 : 0)
export function classifyLaw(law: Pick<Law, 'title' | 'text' | 'layer'>): LawFeatures {
  const t = `${law.title} ${law.text}`.toLowerCase()
  const L = (l: Layer) => (law.layer === l ? 1 : 0)
  const religious = /relig|faith|church|mosque|temple|worship|prayer|clergy/.test(t)
  return {
    coercive: has(t, /\b(ban|bans|banned|prohibit|mandatory|compulsory|forced|force|conscript|curfew|censor|confiscat|seiz|relocat|deport|must)\b/),
    tax: has(t, /\b(tax|taxes|levy|tariff|surcharge)\b/),
    redistributive: has(t, /(welfare|basic income|subsid|free (school|health|meal|food)|healthcare|health care|pension|food aid|universal|cash transfer)/),
    religionRestrict: religious && /(ban|restrict|limit|discourag|secular|close|prohibit|regulat)/.test(t) ? 1 : 0,
    religionPromote: religious && /(official|state (faith|religion)|promot|establish|fund|mandatory prayer)/.test(t) ? 1 : 0,
    science: Math.max(L('tech'), has(t, /(research|science|space|lunar|moon|rocket|engineer|technolog|laborator)/)),
    family: Math.max(L('family'), has(t, /(child|fertility|birth|parental|maternity|family)/)),
    familyLimit: has(t, /(limit|cap|restrict|reduce).{0,20}(birth|child|famil)|one.child|two.child/),
    energy: Math.max(L('physics'), has(t, /(energy|power|grid|nuclear|solar|wind|electric|fusion)/)),
    food: has(t, /(food|agricultur|farm|crop|irrigat|ration|harvest|fertili[sz]er)/),
    education: has(t, /(school|education|literacy|universit|teacher|curricul)/),
    security: has(t, /(police|security|army|military|enforce|militia|guard)/),
  }
}

// ESTIMATE: support model. base 0.55, coercion and taxes cost support (more in educated / richer regions),
// redistribution is popular where people are poor, religious laws split by faith share, unrest
// makes every government law less popular.
export function lawSupport(f: LawFeatures, rs: RegionState): number {
  const r = rs.r
  const inc = incomeIdx(r.gdpUsd / Math.max(r.population, 1))
  let s = 0.55
  s -= 0.25 * f.coercive * (0.5 + 0.5 * r.education)
  s -= 0.15 * f.tax * inc
  s += 0.2 * f.redistributive * (1 - inc) - 0.05 * f.redistributive * inc
  s += 0.8 * f.religionPromote * (r.faith - 0.5)
  s -= 0.8 * f.religionRestrict * (r.faith - 0.3)
  s += 0.3 * f.science * (r.education - 0.3)
  s += 0.2 * f.family * (r.faith - 0.5)
  s -= 0.3 * f.familyLimit * (0.3 + r.faith)
  s += 0.1 * f.food * clamp((2600 - r.foodKcalPerCapita) / 800)
  s -= 0.1 * f.security * (1 - r.compliance)
  s -= 0.35 * (r.unrest - 0.2)
  if (rs.inRevolt) s -= 0.15
  return clamp(s, 0.02, 0.98)
}

export type LawEffects = { science: number; energy: number; food: number; education: number; family: number; redistributive: number; security: number; tax: number; backlash: number; health: number }

// recompute support and compliance for every active law, and the per-region effect strength.
// each effect channel takes the strongest single law, not the sum, so spamming laws does nothing.
export function stepLaws(w: World): Record<string, LawEffects> {
  const fx: Record<string, LawEffects> = {}
  const active = w.laws.filter(l => !l.vetoed)
  const feats = new Map(active.map(l => [l.id, classifyLaw(l)]))
  for (const rs of w.regions) {
    const e: LawEffects = { science: 0, energy: 0, food: 0, education: 0, family: 0, redistributive: 0, security: 0, tax: 0, backlash: 0, health: 0 }
    for (const l of active) {
      const f = feats.get(l.id)!
      // social identity: support shifts with how much of the region sits in the groups that win or lose
      const meta = w.lawMeta[l.id]
      const loved = meta ? Math.min(0.8, meta.lovedBy.reduce((a, g) => a + labelShare(w, rs, g), 0)) : 0
      const hated = meta ? Math.min(0.8, meta.hatedBy.reduce((a, g) => a + labelShare(w, rs, g), 0)) : 0
      const s = rs.seceded ? 0.05 : clamp(lawSupport(f, rs) + 0.2 * loved - 0.3 * hated, 0.02, 0.98)
      // compliance with this law = region's general compliance x support (people ignore laws they reject);
      // a pending lawsuit pauses most enforcement
      const sued = (w.lawsuits[l.id] ?? -1) > w.tick ? 0.4 : 1
      // coercive policies can be enforced by force: a large security budget makes people comply whether or not they
      // agree (collectivization, birth limits, religious bans, conscription were all enforced this way). ESTIMATE
      const enforceable = f.coercive || ['collectivization', 'birth_limit', 'religion_suppression', 'conscription', 'assembly_limit', 'relocation', 'lockdown', 'slum_clearance'].includes(meta?.policyKind ?? '')
      const secRatio = Math.max(rs.spend.security * 12 / Math.max(rs.r.population, 1), 1) / Math.max(rs.pc0.security, 1)
      // a big enough security apparatus enforces past ordinary compliance (soviet collectivization reached >90% of
      // households by 1937: https://en.wikipedia.org/wiki/Collectivization_in_the_Soviet_Union)
      const forced = enforceable ? (0.5 + 0.5 * rs.r.compliance) * clamp((secRatio - 1) / 2) : 0
      // the core administers every law: its compute, legitimacy and resistance scale compliance (power.ts)
      const c = rs.seceded ? 0 : clamp(Math.max(rs.r.compliance * (0.25 + 0.75 * s), forced) * sued * (rs.powerMult ?? 1) * (rs.peopleMult ?? 1))
      rs.lawSupport[l.id] = s
      rs.lawCompliance[l.id] = c
      e.science = Math.max(e.science, f.science * c)
      e.energy = Math.max(e.energy, f.energy * c)
      e.food = Math.max(e.food, f.food * c)
      e.education = Math.max(e.education, f.education * c)
      // family channel is signed: pro-natal laws push fertility up, limits push it down. strongest law wins
      const fam = f.familyLimit ? -2 * c : f.family * c
      if (Math.abs(fam) > Math.abs(e.family)) e.family = fam
      e.redistributive = Math.max(e.redistributive, f.redistributive * c)
      e.security = Math.max(e.security, f.security * c)
      e.tax = Math.max(e.tax, f.tax * c)
      if (meta && (meta.policyKind === 'healthcare_expansion' || meta.policyKind === 'vaccination')) e.health = Math.max(e.health, c)
      // ESTIMATE: every law with under 50% support adds unrest in proportion to how disliked it is. people get used to
      // most laws: anger fades over ~3 years to a 30% residual (support for Ireland's 2004 smoke-free law rose from ~67%
      // to ~93% among the public within a year of it taking effect, Fong et al. 2006,
      // https://doi.org/10.1136/tc.2005.013649); deeply coercive laws keep more of their sting
      const age = Math.max(0, w.tick - (l.enactedTick ?? w.tick))
      const resid = A(w, 'law_backlash_residual')
      const habit = (resid + resid * Math.min(1, f.coercive)) + (1 - resid - resid * Math.min(1, f.coercive)) * Math.exp(-age / A(w, 'law_habituation_months'))
      e.backlash += Math.max(0, 0.5 - s) * A(w, 'law_backlash') * (1 + f.coercive) * habit
    }
    e.backlash = Math.min(e.backlash, 0.3)
    fx[rs.r.id] = e
  }
  // publish population-weighted support and compliance on each law
  const pops = w.regions.map(regionPop)
  const tot = sum(pops) || 1
  for (const l of w.laws) {
    if (l.vetoed) continue
    l.support = sum(w.regions.map((r, i) => (r.lawSupport[l.id] ?? 0) * pops[i])) / tot
    l.compliance = sum(w.regions.map((r, i) => (r.lawCompliance[l.id] ?? 0) * pops[i])) / tot
  }
  // tax laws raise revenue share, scaled by compliance
  const taxC = sum(w.regions.map((r, i) => fx[r.r.id].tax * pops[i])) / tot
  w.revenueShare = clamp(A(w, 'revenue_share') + 0.08 * taxC, 0, REVENUE_SHARE_MAX)
  return fx
}

// ESTIMATE: backlash against religion policy vs local faith share
export function religionBacklash(policy: ReligionPolicy, faith: number): number {
  switch (policy) {
    case 'discouraged': return 0.35 * faith * faith // heavy in high-faith regions
    case 'state_faith': return 0.25 * (1 - faith) * (1 - faith) + 0.05 // secular regions resent it, minorities everywhere
    case 'state_neutral': return 0.02 * faith
    default: return 0
  }
}

const fWelfare = (pc: number) => 1 - Math.exp(-pc / 3000)

export function stepSociety(w: World, fx: Record<string, LawEffects>, researchUsd: number, outrage: Record<string, number> = {}) {
  const curriculum = w.schoolPolicy.curriculum.map(c => c.toLowerCase())
  const stem = curriculum.filter(c => /(math|science|engineer|technolog|computer|physics|chemistry|biology)/.test(c)).length
  const religiousCurriculum = curriculum.some(c => /(relig|scripture|faith|theolog)/.test(c))
  const maxTech = Math.max(...w.regions.filter(r => !r.seceded).map(r => r.r.techLevel))
  const research = Math.log2(1 + researchUsd * 12 / WORLD_RD_USD)

  for (const rs of w.regions) {
    const r = rs.r
    const pop = Math.max(regionPop(rs), 1)
    const e = fx[r.id]
    // ---------- unrest ----------
    const kcal = r.foodKcalPerCapita
    const food = 0.5 * clamp((2100 - kcal) / 900) + (rs.foodMonthsUnder > 6 ? 0.1 : 0)
    const energy = 0.2 * (1 - rs.energyRatio)
    const recession = 1.5 * Math.max(0, -rs.growth)
    const welfare = -0.15 * (fWelfare(rs.spend.welfare * 12 / pop) - fWelfare(rs.pc0.welfare))
    const secRatio = Math.max(rs.spend.security * 12 / pop, 1) / Math.max(rs.pc0.security, 1)
    // security suppresses unrest a little, but heavy policing in low-compliance regions breeds resentment
    const security = clamp(-0.04 * Math.log2(secRatio), -0.08, 0.08) + (secRatio > 1.5 ? clamp(0.03 * (secRatio - 1) * (1 - r.compliance), 0, 0.1) : 0)
    const religion = religionBacklash(w.religionPolicy, r.faith) + (religiousCurriculum ? 0.04 * (1 - r.faith) : 0)
    const crowd = Math.min(0.25, 0.12 * (outrage[r.id] ?? 0))
    const redistrib = -0.03 * e.redistributive * (1 - incomeIdx(r.gdpUsd / pop))
    const target = clamp(rs.base.unrest + food + energy + recession + welfare + security + religion + e.backlash + redistrib + crowd + rs.shock + rs.migrationShock)
    // whys: each driver's pull on unrest this month
    const k = 0.08
    const U = 'https://www.worldbank.org/en/publication/worldwide-governance-indicators'
    why(rs, 'unrest', 'hunger', food * k, 'https://www.fao.org/3/i4646e/i4646e.pdf')
    why(rs, 'unrest', 'power shortages', energy * k)
    why(rs, 'unrest', 'recession', recession * k)
    why(rs, 'unrest', 'welfare vs 2026', welfare * k)
    why(rs, 'unrest', 'policing', security * k)
    why(rs, 'unrest', 'religion policy', religion * k)
    why(rs, 'unrest', 'unpopular laws', e.backlash * k)
    why(rs, 'unrest', 'crowd outrage', crowd * k, 'https://www.nationalaffairs.com/public_interest/detail/up-and-down-with-ecologythe-issue-attention-cycle')
    why(rs, 'unrest', 'recent shocks', (rs.shock + rs.migrationShock) * k)
    why(rs, 'unrest', 'settling back', -(r.unrest - rs.base.unrest) * k, U)
    r.unrest = clamp(r.unrest + (target - r.unrest) * 0.08)
    rs.shock *= 0.9
    rs.migrationShock *= 0.92

    // ---------- compliance ----------
    let cTarget = rs.base.compliance * (1 - 0.6 * Math.max(0, r.unrest - rs.base.unrest)) + 0.05 * e.security
    if (rs.inRevolt) cTarget *= 0.5
    if (rs.seceded) cTarget = 0.05
    r.compliance = clamp(r.compliance + (cTarget - r.compliance) * 0.05)

    // ---------- revolt and secession ----------
    if (!rs.seceded) {
      if (r.unrest > A(w, 'revolt_unrest')) rs.revoltPressure++
      else rs.revoltPressure = Math.max(0, rs.revoltPressure - 1)
      if (!rs.inRevolt && rs.revoltPressure >= REVOLT_ONSET_MONTHS) {
        rs.inRevolt = true
        rs.revoltMonths = 0
        event(w, { regionId: r.id, kind: 'revolt', text: `${r.name} is in open revolt against the world government`, severity: r.unrest })
      }
      if (rs.inRevolt) {
        rs.revoltMonths++
        if (r.unrest < REVOLT_END_UNREST) rs.calmMonths++
        else rs.calmMonths = 0
        if (rs.calmMonths >= 6) {
          rs.inRevolt = false
          rs.revoltPressure = 0
          event(w, { regionId: r.id, kind: 'revolt', text: `the revolt in ${r.name} has ended`, severity: 0.1 })
        }
        // secession attempt after 24 months of revolt with unrest still very high
        if (rs.inRevolt && rs.revoltMonths >= SECESSION_MONTHS && r.unrest > 0.75 && w.tick - rs.lastSecessionTick >= 24) {
          rs.lastSecessionTick = w.tick
          // ESTIMATE: success odds fall with the security budget relative to today
          const pSuccess = clamp(0.35 - 0.1 * Math.log2(secRatio), 0.1, 0.6)
          if (w.rng.society() < pSuccess) {
            rs.seceded = true
            rs.inRevolt = false
            r.compliance = 0.05
            rs.base.unrest = Math.max(rs.base.unrest, 0.3)
            event(w, { regionId: r.id, kind: 'revolt', text: `${r.name} has seceded: world laws and budgets no longer reach it`, severity: 0.8 })
          } else {
            w.warTension += 0.3
            rs.shock += 0.1
            event(w, { regionId: r.id, kind: 'war', text: `secession attempt in ${r.name} crushed by force, fighting continues`, severity: clamp(w.warTension) })
          }
        }
        // crackdowns on a revolting region slowly raise the risk of open war
        if (secRatio > 1.3) w.warTension += 0.004 * (secRatio - 1)
      }
    }

    // ---------- faith drifts slowly under religion policy (ESTIMATE, ~0.3%/yr at full compliance) ----------
    if (!rs.seceded) {
      if (w.religionPolicy === 'discouraged') r.faith = clamp(r.faith - 0.003 / 12 * r.compliance)
      if (w.religionPolicy === 'state_faith') r.faith = clamp(r.faith + 0.002 / 12 * r.compliance)
    }

    // ---------- education with a 10+ year lag ----------
    const eduRatio = Math.max(rs.spend.education * 12 / pop, 1) / Math.max(rs.pc0.education, 1)
    const eduTarget = clamp(rs.base.education * Math.pow(eduRatio, 0.3)
      * (1 + 0.03 * (w.schoolPolicy.yearsRequired - 10) * r.compliance)
      + 0.02 * Math.min(stem, 3) + 0.05 * e.education, 0, 1)
    rs.eduTargets[w.tick] = rs.seceded ? r.education : eduTarget
    const lagged = w.tick >= EDUCATION_LAG_TICKS ? rs.eduTargets[w.tick - EDUCATION_LAG_TICKS] : rs.base.education
    const de = (lagged - r.education) / EDUCATION_TURNOVER_MONTHS
    r.education = clamp(r.education + de)
    why(rs, 'education', w.tick >= EDUCATION_LAG_TICKS ? 'school policy from 10 years ago' : 'schools already running', de)

    // ---------- tech ----------
    // ESTIMATE: 0.3%/yr baseline drift, research (log of spend vs world R&D today), education pulling tech up,
    // diffusion from the most advanced region, minus unrest
    let dt = 0.003 + 0.006 * research + 0.004 * e.science + 0.02 * Math.max(0, r.education - r.techLevel)
      + 0.01 * (maxTech - r.techLevel) * r.compliance - 0.02 * Math.max(0, r.unrest - 0.5)
    if (rs.seceded) dt = Math.min(dt, 0.002)
    r.techLevel = clamp(r.techLevel + dt / 12)
    why(rs, 'techLevel', 'research and diffusion', dt / 12, 'https://uis.unesco.org/en/topic/research-and-development')
  }

  // war tension decays; open war when it crosses 1
  w.warTension = Math.max(0, w.warTension - 0.01)
  const revolts = w.regions.filter(r => r.inRevolt).length
  if (revolts >= 2) w.warTension += 0.003 * (revolts - 1)
  if (w.warTension >= 0.6) {
    const sev = clamp(w.warTension)
    if (sev > w.maxWarSeverity + 0.1 || sev >= 1) {
      w.maxWarSeverity = sev
      event(w, { kind: 'war', text: sev >= 1 ? 'open war between the world government and breakaway regions' : 'armed conflict is spreading between regions', severity: sev })
    }
  }
}

export function survivalThreshold() { return SURVIVAL_KCAL }
