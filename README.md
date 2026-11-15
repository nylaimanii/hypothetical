# hypothetical

One AI runs a single world government starting November 2026. Its mission is to prolong humanity: longer healthy
lives, a population that endures, and a civilization on more than one planet. A crewed moon landing is one milestone on the way.
The AI writes policy: laws, budgets, migration, the religion stance, what school is for. Everything else
is plain TypeScript: physics, biology, demography, the economy and rocket math. Many worlds run under
competing constitutions, and the constitutions evolve between runs.

## the deterministic-sim rule

- All world state comes from code in `src/lib/sim`, seeded with mulberry32. Same seed plus same decisions means the same world.
- The LLM never produces a number that becomes world state, apart from policy choices (budget fractions, migration counts, law text). The sim clamps those to physical limits.
- Every seeded statistic carries provenance: `SOURCED` with a url, or `ESTIMATE`.
- 1 tick is 1 month. The governor decides every 12 ticks. A world runs to the horizon (tick 1200, 2126) and ends `complete`, unless it is `destroyed` first or reaches `goal_achieved`: a self-sustaining Mars civilization, global period life expectancy of at least 200, and a population that has not declined for 10 years.
- The score measures mission progress only. Human cost is never part of the score, but it is always reported up front.
- Every run also simulates a no-AI twin on the same seed with 2026 policies frozen. It shows only in the PDF reports (and an advanced UI toggle).

## run it locally

```bash
npm install
npm run seed                    # data folders, starting constitutions, starting world data
npm run dev                     # the site, http://localhost:3000
npm run evolve -- --gens 10 --concurrency 2
npm run run-one -- --seed 1 --constitution technocrat
npm run live -- --runId mylive --seed 7 --constitution-file path/to/constitution.txt
```

Secrets go in `.env.local` only and are never committed. Variables, by name:

| name | used for |
| --- | --- |
| `GROQ_API_KEY` | the governor and constitution mutation (llama 3.3 70b on groq) |
| `GROQ_MODEL` | optional, overrides the mutation model |
| `TELEGRAM_BOT_TOKEN` | telegram notifications and commands |
| `TELEGRAM_CHAT_ID` | the only chat the bot talks to |
| `GMAIL_USER` | the gmail account that sends reports |
| `GMAIL_APP_PASSWORD` | a gmail app password for that account |
| `EMAIL_TO` | where reports are sent |
| `READ_ONLY` | set to `1` to serve showcase worlds only, as on a deploy |

If any of these is missing, that feature logs once and is skipped. Nothing crashes.

## how evolution works

- Generation 1 starts with seven constitutions. Six take different philosophies to the same mission: technocratic, federal, utilitarian, market liberal, communitarian and space-first. The seventh is the long now charter, which is protected: it competes with its original text every generation and is never mutated in place, though mutations of it can enter as separate constitutions.
- A generation runs every constitution on the same 2 seeds and scores it by its average.
- The top 2 constitutions carry over unchanged. The rest of the population is refilled with:
  - **mutations**: groq rewrites a parent, given what killed it, its biggest events and the known lessons. It fixes what failed and keeps what worked.
  - **crossovers**: section by section splices of two parents (values, religion, school, migration, priorities).
- Output:
  - `data/generations/gen-<n>.json` for each generation
  - `data/leaderboard.json` with the top 20 of all time
  - showcase worlds in `data/showcase/` (gzipped, with an `index.json`): the best world of every generation and any goal-achieving world. This folder is committed so the deployed site can replay real worlds.
- **The learning loop:**
  - Every destroyed world adds lessons (mistake, consequence, rule) to `data/lessons.json`.
  - A lesson that matches an existing rule bumps that rule's `timesRelevant` count instead of being duplicated.
  - Later governors get the most relevant lessons in their prompt.
  - A death whose cause matches a lesson that already existed counts as a repeat mistake.
  - `data/learning.json` tracks, per generation: best score, lessons known, and the repeat-mistake rate. It is served at `GET /api/learning`.
- **Agents:**
  - Every constitution is an agent with an original name, kept in `data/agents.json`.
  - The seeds are long now (the charter), meridian, atlas, solace, halcyon, vesper and kestrel.
  - Mutations count up (`halcyon ii`, `halcyon iii`) and crossovers join names (`meridian × kestrel`).
  - Each agent tracks its worlds, deaths, scores, best frontier and best lifespan.
  - The champion is the active agent with the best average. Agents dropped from evolution are retired.
- **Fairness:** every active agent runs the same 2 seeds each generation, so compare mode always has like-for-like worlds.
- **Hall of history:** `data/hall.json` records firsts (moon, a Mars city, an eradicated disease, 150 and 200 year lifespans), records (population, lifespan, fastest moon), catastrophes (biggest collapse, deadliest famine) and milestones. Each entry links to its world and tick, and every hall world is showcased.
- Evolution keeps going, generation after generation, until a world achieves the goal. Then it finishes that generation and stops. Use `--gens n` to stop sooner.
- Evolution is resumable: rerunning `npm run evolve` continues the unfinished generation.
- Rate limits are not deaths. A world that fails on a 429, a timeout or a network error is marked interrupted. It is not scored, and it is retried after 30s, then 2m, then 10m, then at the next hour. If 3 worlds in a row are interrupted, the whole generation pauses, sends one telegram message, and resumes on its own.
- LLM calls and tokens per world are logged to `data/reports/usage-<date>.json`.

## telegram

- **Every destroyed world:** world number, generation, date and cause; what it got wrong and the lesson it added; how far it got (frontier, period life expectancy, population); and its human cost.
- **End of each generation:** the champion, the best score, lessons known, and the repeat-mistake rate.
- **Every new hall of history entry:** its own message, e.g. "🏆 first mars city ever: halcyon ii, 2071".
- **Goal achieved:** a big celebration.
- **Commands while evolve runs** (answered only in `TELEGRAM_CHAT_ID`):

| command | what it does |
| --- | --- |
| `/status` | progress, plus today's LLM calls and finished and interrupted worlds |
| `/best` | the best constitution so far |
| `/agents` | the top 5 agents |
| `/pause`, `/resume` | stop and restart new worlds being started |
| `/ask <question>` | asks the governor about the current best world |

## email reports

PDFs styled like the site go out over gmail and are always saved to `data/reports/`:

- **Generation digest, after every generation:**
  - the learning curve
  - new lessons
  - the best world: its human cost up front, then its story year by year
  - a requirements table for the two goal tracks, Mars and 200 years
  - the crowd's finest moments
  - every death and its cause
  - the agents leaderboard, the family tree, and new hall of history entries
  - the leaderboard
  - the best constitution in full
  - how the constitutions changed
  - AI vs the no-AI twin (the reports are the one place the twin appears)
- **Goal report, the moment a world achieves the goal:** the winning world's full story.

## api

| route | returns |
| --- | --- |
| `GET /api/runs` | `RunSummary[]` (leaderboard best worlds and showcase) |
| `GET /api/learning` | one row per generation: best score, lessons known, repeat-mistake rate |
| `GET /api/agents` | `Agent[]` |
| `GET /api/agents/[id]` | `{ agent, runs }` |
| `GET /api/compare?agents=a,b,c,d` | `{ seed, runs, divergences, pending, note? }`: each agent's best world on their most shared seed, plus divergences for every pair. Missing worlds are started in the background (local only) |
| `GET /api/hall` | `HallEntry[]` |
| `POST /api/branch` `{ runId, tick, agentId }` | `{ runId }`, a new live world from that moment, governed by that agent |
| `GET /api/runs/[id]` | `RunRecord` |
| `POST /api/live/start` `{ constitution?, seed? }` | `{ runId }`, spawns a live world at 1 second per month |
| `GET /api/live/[id]` | the live `RunRecord` so far |
| `POST /api/override` `{ runId, override }` | `{ ok: true }`, the governor sees it on the next tick |
| `POST /api/ask` `{ runId, question }` | `{ answer }` |

## deploying

The site deploys to vercel as a normal Next.js app. A deployed copy has no writable disk, so it detects read-only mode (or `READ_ONLY=1`):

- `/api/runs` and `/api/runs/[id]` serve only the committed worlds in `data/showcase/`. Agents, compare, hall and learning read whatever data is committed.
- live, override, ask and branch return `503 {"error":"runner offline, local only"}`.

Evolution and live worlds run on your own machine.
