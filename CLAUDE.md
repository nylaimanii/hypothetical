@AGENTS.md

# hypothetical

one ai runs a single world government starting 2026-11. physics, biology, economics are enforced by deterministic code. the ai only makes policy. the mission of every world: prolong humanity. the moon landing is now one milestone on the way.

## rules

- determinism: all physics, biology, demography, economy, rocket math lives in TypeScript in src/lib/sim. the LLM never produces numbers that become world state except policy choices (budget fractions, migration counts, law text). sim clamps everything to physical limits.
- every seeded number carries provenance SOURCED (with url) or ESTIMATE. never invent a stat and present it as real.
- seeded rng only (mulberry32). same seed + same decisions = same world.
- 1 tick = 1 month, tick 0 = 2026-11. governor decides every 12 ticks. see horizon below for when a world ends.
- baseline twin: every run also simulates a no-ai twin on the same seed with 2026 policies frozen. see the v2 rule below for where it shows.
- citizens: diversity comes from skin tone (Monk scale 1-10), hair, age, height, build only. one shared base mesh for every face and body. never exaggerate facial features, never assign ethnic costume. every region is mixed.
- user overrides (veto, inject, force budget) are real inputs the governor sees and must react to.
- boundaries: A = ui/3d + types, B = sim + agent, C = evolve + notify + api. never edit another agent's folders. only A edits src/lib/types.ts, others request changes in their report.
- contract: B exports runWorld(opts: RunOptions): Promise<RunSummary> from src/lib/sim/run.ts and askCore(record: RunRecord, question: string): Promise<string> from src/lib/agent/ask.ts. C imports only those plus types.
- secrets only in .env.local, never in code, never in commits. my email address only lives in EMAIL_TO.
- writing: no em-dashes anywhere. commits lowercase always.
- look: bone + ink base, Fraunces display, JetBrains Mono for every number, ember ONLY for danger/death. hide empty elements instead of showing zeros or blanks. every character and object is an ORIGINAL design, never recreate an existing youtube, game, or brand character.

## v2 rules

- mission: prolong humanity. maximize healthy lifespan and long-term population, and get humanity off-planet (mars and beyond) so one planet's disaster can't end it. the governor optimizes the mission, not approval
- realism: public behavior is calibrated to real historical precedents (cited) and real social science. no utopia bias. early worlds should mostly fail
- people feel many emotions, not just anger. behavior emerges from emotion + archetype + group. crowds overreact, panic, follow trends, perform outrage, then lose interest (issue-attention cycle). satire targets behaviors and institutions, NEVER race, ethnicity, religion as identity, sex, or disability
- every number shown in the ui has a "why" chain from the sim. every real-world claim has a url
- score = mission progress only. human cost is never in the score, but it's always shown up front
- horizon: tick 1200 (2126). runs continue past milestones and end only on destroyed or horizon. status 'complete' = reached the horizon, 'goal_achieved' = frontier mars_self_sustaining AND global period life expectancy >= 200 AND global population not declining over the last 10 years
- learning: every death adds lessons to data/lessons.json, and later governors get the most relevant lessons in their prompt
- the no-ai twin is still computed but hidden in the ui (reports + an advanced settings toggle only)

## v2.1 rules

- every run belongs to an Agent. agent names are original sci-fi names, never real people, brands, or existing fictional characters. seed names: long now, meridian, halcyon, vesper, atlas, solace, kestrel. mutants are "<parent> ii/iii/...", crossovers are "<a> × <b>".

## ownership

- A: scaffold, CLAUDE.md, src/lib/types.ts, src/lib/mock/**, src/app/** (except src/app/api/**), src/components/**
- B: src/lib/sim/**, src/lib/agent/**
- C: src/lib/evolve/**, src/lib/notify/**, src/app/api/**, scripts/**, data/

## api the ui expects (C implements)

- GET /api/runs -> RunSummary[]
- GET /api/runs/[id] -> RunRecord
- POST /api/ask { runId, question } -> { answer: string }
- POST /api/live/start { constitution?, seed? } -> { runId }
- GET /api/live/[id] -> RunRecord (live: true, frames so far)
- POST /api/override { runId, override: Override } -> { ok: true }
- GET /api/learning -> { generation: number; bestScore: number; lessonsKnown?: number; lineage?: string }[] (one row per generation per lineage; lineage = the seed agent id it descends from)
- GET /api/agents -> Agent[]
- GET /api/compare?agents=<id,id,...> -> CompareResponse (slim: one SlimRun per agent, same seed when possible, plus divergences)
- GET /api/runs/[id]?slim=1 -> SlimRun (no frames, for long runs)
- GET /api/runs/[id]/frames?from=<tick>&to=<tick> -> FramesResponse (inclusive range; the ui prefetches about 5 years either side of the scrubber)
- GET /api/hall -> HallEntry[]
- POST /api/branch { runId, tick, agentId } -> { runId } (a new live world from that run's snapshot at tick, governed by agentId)
