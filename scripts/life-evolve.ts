// npx tsx scripts/life-evolve.ts [--worlds 3] [--hours 10] [--telegram]
// overnight: lives across the best worlds of the CURRENT sim version, round robin, each inheriting every lesson so
// far. lowest priority on ollama: every milestone call waits until C's evolve has no world waiting and holds the lock
// for that one call only (src/lib/life/decide.ts politeLlm). the world list is re-picked before every life, so when
// a new sim version lands the next life starts a fresh series in that version's best world; old lessons carry
// forward marked unverified until a life on the new version gains with them.
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })
import { arg } from './args'

const flag = (n: string) => process.argv.includes(`--${n}`)

async function main() {
  const { assertLlmReady, provider } = await import('../src/lib/agent/llm')
  const { WorldEnv } = await import('../src/lib/life/env')
  const { bestWorlds } = await import('../src/lib/life/worlds')
  const { runLife } = await import('../src/lib/life/run')
  const { readIndex } = await import('../src/lib/life/store')
  const { startLifeCommands } = await import('../src/lib/life/telegram')
  const { evolveRunning, describeLife } = await import('../src/lib/life/report')

  // overnight lives run on ollama only (groq has a daily limit). --provider-ok overrides, for a deliberate test
  if (provider() !== 'ollama' && !flag('provider-ok')) { console.error(`life-evolve runs on ollama at lowest priority; LLM_PROVIDER=${provider()} refused (pass --provider-ok to override)`); process.exit(1) }
  const k = Number(arg('worlds', '3'))
  const until = Date.now() + Number(arg('hours', '10')) * 3600_000
  const stopCommands = flag('telegram') ? startLifeCommands(evolveRunning) : () => {}
  let stopping = false
  process.on('SIGINT', () => { if (stopping) process.exit(130); stopping = true; console.log('stopping after this life (ctrl-c again to force)') })

  const cache = new Map<string, InstanceType<typeof WorldEnv>>()
  for (let round = 0; !stopping && Date.now() < until; round++) {
    await assertLlmReady()
    const picks = bestWorlds(k)
    if (!picks.length) { console.error('no finished world to live in'); break }
    const pick = picks[round % picks.length]
    const world = cache.get(pick.record.runId) ?? new WorldEnv(pick.record)
    cache.set(world.id, world)
    const lifeNo = readIndex(world.id).filter(l => l.status === 'done').length + 1
    console.log(`[${new Date().toISOString()}] world ${world.id} (${pick.why}), life #${lifeNo}, llm ${provider()}`)
    const t0 = Date.now()
    const r = await runLife({ world, worldVersion: pick.version, lifeNo, telegram: flag('telegram'), log: l => console.log(`  ${l}`) })
    console.log(describeLife(r, (Date.now() - t0) / 1000))
  }
  stopCommands()
}

main().catch(e => { console.error(e); process.exit(1) })
