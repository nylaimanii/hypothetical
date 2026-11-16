// autopsy: when a world dies, walk the cause chains backward from the death to the first decision that started it
// (budget cut -> grid fails -> famine -> revolt), with dates, places and numbers. each step says whether it is
// linked by cause (the cause chain itself) or only by timing (the decision in force when the chain began, when the
// chain stops short of a decision). stored on the run record as record.autopsy.
import { link } from './causes'
import type { CauseLink } from './causes'
import type { World } from './state'

export type AutopsyStep = { tick: number; date: string; place: string; what: string; because: string; value: number; byWhom: string; how: 'cause' | 'timing'; lawId?: string }
export type Autopsy = { tick: number; date: string; death: string; chain: AutopsyStep[] }

const dateOf = (t: number) => `${2026 + Math.floor((10 + t) / 12)}-${String(((10 + t) % 12) + 1).padStart(2, '0')}`
const isDecision = (c: CauseLink) => c.byWhom === 'core' && (!!c.lawId || /^the core (cut|raised)/.test(c.what) || /^enacted/.test(c.what))
const step = (c: CauseLink, how: AutopsyStep['how']): AutopsyStep => ({ tick: c.tick, date: dateOf(c.tick), place: c.placeId, what: c.what, because: c.because, value: Math.round(c.value * 1000) / 1000, byWhom: c.byWhom, how, ...(c.lawId ? { lawId: c.lawId } : {}) })

export function autopsyOf(w: World): Autopsy | undefined {
  if (w.status !== 'destroyed' || !w.causeOfDeath) return undefined
  const byId = new Map(w.causes.map(c => [c.id, c]))
  // the death links to the most significant things of its last two years
  // the death links to the most significant things of its last two years that are of its own kind
  const kind = /revolt|war|crackdown/i.test(w.causeOfDeath) ? /revolt|protest|crackdown|war|seced|rule by a machine|approval/i
    : /food|starv|famine/i.test(w.causeOfDeath) ? /hunger|famine|food|harvest|drought|kcal|breadbasket/i
    : /dead|died|deaths|pandemic|population|collapse/i
  const pool = w.causes.filter(c => w.tick - c.tick <= 24 && (c.sig ?? 0) >= 0.4)
  const matching = pool.filter(c => kind.test(c.what))
  // the most direct kinds first (a revolt explains a war better than an approval dip), then significance, then recency
  const rank = (c: CauseLink) => (/revolt|war|crackdown|seced|famine in|starv|pandemic|dead/i.test(c.what) ? 2 : /protest|rule by a machine|hunger/i.test(c.what) ? 1 : 0) + (c.sig ?? 0) + (c.causeIds.length ? 0.3 : 0)
  const recent = (matching.length ? matching : pool).sort((a, b) => rank(b) - rank(a) || b.tick - a.tick).slice(0, 3)
  const death = link(w, { placeId: 'world', what: w.causeOfDeath, value: 1, because: recent[0]?.what ?? 'collapse', byWhom: 'nature', causeIds: recent.map(c => c.id), sig: 1 })
  const chain: AutopsyStep[] = [step(death, 'cause')]
  const seen = new Set([death.id])
  let cur: CauseLink | undefined = death
  // backward through each link's strongest cause until a decision (or the start of the record)
  while (cur && chain.length < 12) {
    const parents = cur.causeIds.map(id => byId.get(id)).filter((c): c is CauseLink => !!c && !seen.has(c.id))
    if (!parents.length) break
    const next: CauseLink = parents.find(isDecision) ?? parents.sort((a, b) => (b.sig ?? 0) - (a.sig ?? 0))[0]
    seen.add(next.id)
    chain.push(step(next, 'cause'))
    if (isDecision(next)) { cur = undefined; break }
    cur = next
  }
  // the chain stopped short of a decision: name the decision in force when it began, marked as linked by timing
  const root = chain[chain.length - 1]
  if (!isDecision(byId.get(w.causes.find(c => c.what === root.what && c.tick === root.tick)?.id ?? '') ?? death)) {
    const before = w.causes.filter(c => isDecision(c) && c.tick <= root.tick).sort((a, b) => b.tick - a.tick)[0]
    if (before) chain.push(step(before, 'timing'))
  }
  return { tick: w.tick, date: dateOf(w.tick), death: w.causeOfDeath, chain: chain.reverse() }
}
