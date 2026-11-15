// npx tsx scripts/life-run.ts [--world <runId>] [--lives 3] [--telegram] [--offline]
// runs N successive chosen people in one finished world. each life gets the lessons every earlier life left.
// without --world: the best world of the current sim version (src/lib/life/worlds.ts).
// --offline: no llm (LLM_PROVIDER=offline). every adult choice is the rule choice, marked decidedBy 'rule'. only
// for testing the rules; the real series always uses the llm and fails loudly when it is down.
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })
import { arg } from './args'

const flag = (n: string) => process.argv.includes(`--${n}`)
if (flag('offline')) process.env.LLM_PROVIDER = 'offline'

async function main() {
  const { assertLlmReady, provider } = await import('../src/lib/agent/llm')
  const { WorldEnv } = await import('../src/lib/life/env')
  const { bestWorld } = await import('../src/lib/life/worlds')
  const { runLife } = await import('../src/lib/life/run')
  const { readIndex } = await import('../src/lib/life/store')
  const { startLifeCommands } = await import('../src/lib/life/telegram')
  const { evolveRunning, describeLife } = await import('../src/lib/life/report')

  if (provider() !== 'offline') await assertLlmReady()
  const pick = bestWorld(arg('world'))
  if (!pick) { console.error(arg('world') ? `world ${arg('world')} not found` : 'no finished world to live in'); process.exit(1) }
  const world = new WorldEnv(pick.record)
  const n = Number(arg('lives', '3'))
  console.log(`world ${world.id}: ${pick.why}. sim version ${pick.version} (current ${pick.current}). llm: ${provider()}`)
  const stopCommands = flag('telegram') ? startLifeCommands(evolveRunning) : () => {}

  const start = readIndex(world.id).filter(l => l.status === 'done').length + 1
  for (let i = 0; i < n; i++) {
    const lifeNo = start + i
    const t0 = Date.now()
    const r = await runLife({ world, worldVersion: pick.version, lifeNo, telegram: flag('telegram'), log: l => console.log(`  ${l}`) })
    console.log(describeLife(r, (Date.now() - t0) / 1000))
  }
  stopCommands()
}

main().catch(e => { console.error(e); process.exit(1) })
