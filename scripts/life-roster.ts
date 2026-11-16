// npx tsx scripts/life-roster.ts [--dry-run] [--gap-min 5] [--per 2] [--telegram] [--provider-ok]
// keeps at least --per chosen lives per continent (one more in asia and africa: 14 at --per 2) (africa, asia, europe, north america, south america, oceania:
// 12+ lives), each in a DIFFERENT world, preferring a different agent for the two lives on one continent, so the
// same kind of city can be compared under different agents. every life is born in 2026-11, so all of them are alive
// at the same time inside their worlds. birthplaces are drawn by where babies are actually born on that continent.
//
// load: lives run one at a time (staggered, --gap-min minutes apart). every llm call goes through politeLlm
// (src/lib/life/decide.ts): it waits while C's evolve has a world waiting and holds the ollama lock for one call
// only, so evolution is never starved. ollama only, like life-evolve (--provider-ok overrides for a deliberate test).
//
// when there are fewer worlds than slots, worlds are reused, but the lives on one continent never share a world;
// the plan says which slots share a world with another continent.
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })
import { arg } from './args'

const flag = (n: string) => process.argv.includes(`--${n}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  const { CONTINENTS, CONTINENT_NAME, continentOf, pickBirthplace } = await import('../src/lib/life/births')
  const { allWorlds } = await import('../src/lib/life/worlds')
  const { listWorlds, readIndex } = await import('../src/lib/life/store')
  const { stream } = await import('../src/lib/sim/rng')
  type Continent = (typeof CONTINENTS)[number]
  const per = Number(arg('per', '2'))
  // 14 at once: one more in each of the two continents where most babies are born (asia ~55%, africa ~30% of births,
  // un wpp 2024, ESTIMATE rounded), so the biggest share of humanity gets more than one comparison
  const EXTRA: Partial<Record<Continent, number>> = { asia: 1, africa: 1 }
  const want = (c: Continent) => per + (EXTRA[c] ?? 0)
  const dry = flag('dry-run')

  const worlds = allWorlds().filter(w => w.status !== 'destroyed')
  if (!worlds.length) { console.error('no world to live in'); process.exit(1) }

  // who is already alive in the roster: every finished or running life, by continent and world
  type Slot = { continent: Continent; worldId: string; agent: string; name?: string; city?: string; planned: boolean; lifeNo: number }
  const roster: Slot[] = []
  for (const w of listWorlds()) for (const l of readIndex(w)) {
    const c = continentOf(l.birthplace.countryId)
    if (!c || (l.status !== 'done' && l.status !== 'running')) continue
    roster.push({ continent: c, worldId: w, agent: worlds.find(x => x.runId === w)?.agent ?? 'no agent', name: l.name, city: l.birthplace.city, planned: false, lifeNo: l.lifeNo })
  }
  const lifeNoNext = new Map<string, number>()
  const nextNo = (w: string) => { const n = lifeNoNext.get(w) ?? readIndex(w).length + 1; lifeNoNext.set(w, n + 1); return n }

  // plan the missing slots: a world this continent has not used; first a world nobody in the roster uses yet, then
  // an agent this continent does not have yet, then the best world
  const plan: Slot[] = []
  for (const c of CONTINENTS) {
    const mine = () => [...roster, ...plan].filter(s => s.continent === c)
    while (new Set(mine().map(s => s.worldId)).size < want(c)) {
      const used = new Set(mine().map(s => s.worldId)), agents = new Set(mine().map(s => s.agent))
      const taken = new Set([...roster, ...plan].map(s => s.worldId))
      const cands = worlds.filter(w => !used.has(w.runId))
      if (!cands.length) { console.error(`${CONTINENT_NAME[c]}: no world left that this continent has not used`); break }
      const score = (w: (typeof worlds)[number]) => (taken.has(w.runId) ? 0 : 4) + (agents.has(w.agent) ? 0 : 2) + (w.current ? 1 : 0)
      const w = [...cands].sort((a, b) => score(b) - score(a))[0]
      const lifeNo = nextNo(w.runId)
      // the same birth draw runLife will make (createPerson's first draw from the life's birth stream)
      const seed = (stream(w.seed, `life:${w.runId}:${lifeNo}`)() * 2 ** 32) >>> 0
      const { city } = pickBirthplace(stream(seed, 'birth'), c)
      plan.push({ continent: c, worldId: w.runId, agent: w.agent, city: city.name, planned: true, lifeNo })
    }
  }

  const all = [...roster, ...plan]
  const shared = new Map<string, Slot[]>()
  for (const s of all) shared.set(s.worldId, [...(shared.get(s.worldId) ?? []), s])
  console.log(`worlds available: ${worlds.length} (${worlds.filter(w => w.current).length} of the current sim version)`)
  for (const c of CONTINENTS) {
    console.log(`\n${CONTINENT_NAME[c]}`)
    for (const s of all.filter(x => x.continent === c)) {
      const others = (shared.get(s.worldId) ?? []).filter(x => x !== s && x.continent !== c).map(x => CONTINENT_NAME[x.continent])
      console.log(`  ${s.planned ? 'new ' : 'have'}  ${(s.city ?? '?').toLowerCase().padEnd(24)} ${s.worldId.padEnd(20)} ${s.agent.padEnd(10)} life #${s.lifeNo}${s.name ? `  ${s.name}` : ''}${others.length ? `  (world shared with ${[...new Set(others)].join(', ')})` : ''}`)
    }
  }
  const sharedWorlds = [...shared.values()].filter(v => new Set(v.map(s => s.continent)).size > 1).length
  if (sharedWorlds) console.log(`\nnote: ${sharedWorlds} world(s) hold lives from more than one continent, because there are ${worlds.length} worlds for ${all.length} lives. new worlds from evolve get used first on the next run.`)
  console.log(`\n${plan.length} new lives to run, about ${plan.length * 27} llm calls and ${Math.round(plan.length * 19)}k tokens`)
  if (dry || !plan.length) return

  // label every world that holds lives with its agent, for the home page (it never scans data/runs)
  const { writeJsonAtomic, livesFile } = await import('../src/lib/life/store')
  for (const w of new Set(all.map(s => s.worldId))) { const info = worlds.find(x => x.runId === w); if (info) writeJsonAtomic(livesFile(w, 'world.json'), { agent: info.agent, agentId: info.agentId, version: info.version }, true) }

  const { assertLlmReady, provider } = await import('../src/lib/agent/llm')
  if (provider() !== 'ollama' && !flag('provider-ok')) { console.error(`life-roster runs on ollama at lowest priority; LLM_PROVIDER=${provider()} refused (pass --provider-ok to override)`); process.exit(1) }
  const { WorldEnv } = await import('../src/lib/life/env')
  const { loadRecord } = await import('../src/lib/evolve/store')
  const { runLife } = await import('../src/lib/life/run')
  const { describeLife } = await import('../src/lib/life/report')
  const gapMs = Number(arg('gap-min', '5')) * 60_000
  let stopping = false
  process.on('SIGINT', () => { if (stopping) process.exit(130); stopping = true; console.log('stopping after this life (ctrl-c again to force)') })
  for (const [i, s] of plan.entries()) {
    if (stopping) break
    if (i) await sleep(gapMs) // stagger: evolve gets the machine between lives
    await assertLlmReady()
    const rec = loadRecord(s.worldId)
    if (!rec) { console.error(`world ${s.worldId} could not be loaded, skipping`); continue }
    const w = worlds.find(x => x.runId === s.worldId)!
    const lifeNo = readIndex(s.worldId).length + 1 // re-read: something else may have added a life meanwhile
    console.log(`[${new Date().toISOString()}] ${CONTINENT_NAME[s.continent]}: world ${s.worldId} (${w.agent}), life #${lifeNo}`)
    const t0 = Date.now()
    const r = await runLife({ world: new WorldEnv(rec), worldVersion: w.version, lifeNo, continent: s.continent, telegram: flag('telegram'), log: l => console.log(`  ${l}`) })
    console.log(describeLife(r, (Date.now() - t0) / 1000))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
