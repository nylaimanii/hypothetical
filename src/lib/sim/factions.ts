// organized interests. they gain or lose power from laws and budgets and push back: strikes, lawsuits,
// sabotage of projects, stirring crowds. ESTIMATE mechanics modeled on how such groups have acted historically
// (labor: general strikes like France 2023; business: litigation against regulation; old energy: lobbying and
// project delays; nationalists: regional mobilization, e.g. Catalonia 2017).
import type { Faction } from '../types'
import { BASELINE_BUDGET } from './constants'
import { addCrowd } from './behavior'
import { clamp, event, type World } from './state'

// how each policy kind moves each faction's hostility (positive = angrier). ESTIMATE
const KIND_HOSTILITY: Record<string, Partial<Record<Faction['kind'], number>>> = {
  carbon_tax: { old_energy: 0.3, business: 0.1, labor: 0.05, science: -0.05 },
  energy_tax: { old_energy: 0.2, labor: 0.15 },
  fuel_subsidy_cut: { old_energy: 0.1, labor: 0.25 },
  food_subsidy_cut: { labor: 0.25, religious: 0.05 },
  grid_integration: { old_energy: 0.15, science: -0.05 },
  electrification: { old_energy: 0.15, science: -0.05 },
  religion_suppression: { religious: 0.5 },
  secular_state: { religious: 0.25 },
  state_religion: { religious: -0.2, science: 0.15 },
  conscription: { labor: 0.15, military: -0.15 },
  assembly_limit: { labor: 0.15, regional_nationalist: 0.1, military: -0.1 },
  relocation: { regional_nationalist: 0.3 },
  language_reform: { regional_nationalist: 0.4 },
  wealth_tax: { business: 0.35 },
  head_tax: { labor: 0.35 },
  pension_cut: { labor: 0.35 },
  basic_income: { business: 0.1, labor: -0.1 },
  research_push: { science: -0.15 },
  big_project: { science: -0.1, business: -0.05, regional_nationalist: 0.05 },
  school_reform: { religious: 0.05, science: -0.05 },
  collectivization: { business: 0.4, regional_nationalist: 0.2 },
  pronatal: { religious: -0.1 },
  birth_limit: { religious: 0.4 },
  lockdown: { business: 0.2, labor: 0.1 },
}

export function onLawEnacted(w: World, policyKind: string) {
  const delta = KIND_HOSTILITY[policyKind]
  if (!delta) return
  for (const f of w.factions) {
    const d = delta[f.kind]
    if (d) f.hostility = clamp(f.hostility + d)
  }
}

export function stepFactions(w: World) {
  const b = w.budget
  for (const f of w.factions) {
    // budget grievances
    if (f.kind === 'military') f.hostility = clamp(f.hostility + 0.01 * Math.max(0, BASELINE_BUDGET.security - b.security) / BASELINE_BUDGET.security)
    if (f.kind === 'science') f.hostility = clamp(f.hostility + 0.01 * Math.max(0, BASELINE_BUDGET.research - b.research) / BASELINE_BUDGET.research - 0.003 * Math.max(0, b.research - BASELINE_BUDGET.research) / BASELINE_BUDGET.research)
    if (f.kind === 'labor') f.hostility = clamp(f.hostility + 0.008 * Math.max(0, BASELINE_BUDGET.welfare - b.welfare) / BASELINE_BUDGET.welfare)
    if (f.kind === 'old_energy') f.power = clamp(f.power - 0.0008 * w.requirements.filter(r => ['grid_storage', 'advanced_fission', 'fusion_power', 'hvdc_global_grid'].includes(r.id)).reduce((a, r) => a + r.progress, 0))
    if (f.kind === 'science') f.power = clamp(f.power + 0.0005 * (b.research / BASELINE_BUDGET.research - 1))
    // hostility relaxes toward 0.2; organized anger slowly builds power (mobilization)
    f.hostility = clamp(f.hostility + (0.2 - f.hostility) * 0.02)
    f.power = clamp(f.power + 0.001 * (f.hostility - 0.3))
    // push back: chance per month = power x hostility^2 x 0.1
    const p = f.power * f.hostility * f.hostility * 0.1
    const x = w.rng.factions(), y = w.rng.factions()
    if (x >= p) continue
    const regions = w.regions.filter(r => f.regionIds.includes(r.r.id) && !r.seceded)
    if (!regions.length) continue
    const target = regions[Math.floor(y * regions.length) % regions.length]
    switch (f.kind) {
      case 'labor':
        for (const r of regions) r.strikeBoost += 0.02 * f.power
        event(w, { regionId: target.r.id, kind: 'revolt', text: `${f.name} calls a general strike`, severity: 0.4 * f.power })
        break
      case 'business': {
        const law = w.laws.filter(l => !l.vetoed && (l.hatedBy.includes('business') || l.hatedBy.includes('high income'))).slice(-1)[0]
        if (law) { w.lawsuits[law.id] = w.tick + 6; event(w, { kind: 'law', text: `${f.name} sues to block "${law.title}", enforcement paused for six months`, severity: 0.25 }) }
        break
      }
      case 'old_energy': {
        // sabotage: delay grid projects in one region by six months, or set back an energy node
        for (const pl of target.pipeline) pl.readyTick += 6
        const node = w.requirements.find(r => r.id === 'hvdc_global_grid' || r.id === 'grid_storage')
        if (node && node.progress < 1) node.progress = Math.max(0, node.progress - 0.02)
        event(w, { regionId: target.r.id, kind: 'disaster', text: `${f.name} stalls new power projects in ${target.r.name} with permits, lawsuits and mysteriously cut cables`, severity: 0.3 })
        break
      }
      case 'regional_nationalist':
        addCrowd(target, w, { topic: 'home rule', peak: 0.5 * f.power + 0.2, outrageMonths: 4 })
        target.shock += 0.04
        event(w, { regionId: target.r.id, kind: 'revolt', text: `${f.name} fill the squares in ${target.r.name} demanding home rule`, severity: 0.35 })
        break
      case 'religious':
        addCrowd(target, w, { topic: 'what the schools are teaching', peak: 0.4 * f.power + 0.2, outrageMonths: 3 })
        event(w, { regionId: target.r.id, kind: 'revolt', text: `${f.name} calls the faithful into the streets of ${target.r.name}`, severity: 0.3 })
        break
      case 'military':
        if (f.hostility > 0.6) {
          w.warTension += 0.1
          for (const r of regions) { r.shock += 0.05; r.r.compliance = clamp(r.r.compliance - 0.03) }
          event(w, { regionId: target.r.id, kind: 'war', text: `${f.name} officers in ${target.r.name} refuse orders, rumors of a coup`, severity: 0.5 })
        }
        break
      case 'science':
        if (f.hostility > 0.5) {
          for (const r of regions) r.r.techLevel = clamp(r.r.techLevel - 0.003)
          event(w, { regionId: target.r.id, kind: 'migration', text: `${f.name}: labs in ${target.r.name} lose staff as researchers walk out over budget cuts`, severity: 0.2 })
        }
        break
    }
  }
}
