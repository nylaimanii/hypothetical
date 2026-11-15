@AGENTS.md

# hypothetical

one ai runs a single world government starting 2026-11. physics, biology, economics are enforced by deterministic code. the ai only makes policy. goal of every world: a crewed moon landing.

## rules

- determinism: all physics, biology, demography, economy, rocket math lives in TypeScript in src/lib/sim. the LLM never produces numbers that become world state except policy choices (budget fractions, migration counts, law text). sim clamps everything to physical limits.
- every seeded number carries provenance SOURCED (with url) or ESTIMATE. never invent a stat and present it as real.
- seeded rng only (mulberry32). same seed + same decisions = same world.
- 1 tick = 1 month, tick 0 = 2026-11. governor decides every 12 ticks. world ends on destroyed, moon (crewed landing), or stagnated (tick 600).
- baseline twin: every run also simulates a no-ai twin on the same seed with 2026 policies frozen, so the ui can show what the ai changed.
- citizens: diversity comes from skin tone (Monk scale 1-10), hair, age, height, build only. one shared base mesh for every face and body. never exaggerate facial features, never assign ethnic costume. every region is mixed.
- user overrides (veto, inject, force budget) are real inputs the governor sees and must react to.
- boundaries: A = ui/3d + types, B = sim + agent, C = evolve + notify + api. never edit another agent's folders. only A edits src/lib/types.ts, others request changes in their report.
- contract: B exports runWorld(opts: RunOptions): Promise<RunSummary> from src/lib/sim/run.ts and askCore(record: RunRecord, question: string): Promise<string> from src/lib/agent/ask.ts. C imports only those plus types.
- secrets only in .env.local, never in code, never in commits. my email address only lives in EMAIL_TO.
- writing: no em-dashes anywhere. commits lowercase always.
- look: bone + ink base, Fraunces display, JetBrains Mono for every number, ember ONLY for danger/death. hide empty elements instead of showing zeros or blanks. every character and object is an ORIGINAL design, never recreate an existing youtube, game, or brand character.

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
