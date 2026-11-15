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
npm run evolve -- --gens 10 --concurrency 1   # one gpu: keep it at 1
# overnight, without the mac sleeping:
nohup caffeinate -i npx tsx scripts/evolve.ts --gens 50 --concurrency 1 > data/evolve.log 2>&1 &
npm run run-one -- --seed 1 --constitution technocrat
npm run live -- --runId mylive --seed 7 --constitution-file path/to/constitution.txt
```

Secrets go in `.env.local` only and are never committed. Variables, by name:

| name | used for |
| --- | --- |
| `LLM_PROVIDER` | `ollama` (default), `groq`, or `offline` (tests only) |
| `LLM_MODEL` | optional, defaults to `gpt-oss:20b` on ollama |
| `OLLAMA_URL` | optional, the local ollama endpoint (default `http://localhost:11434/v1`) |
| `GROQ_API_KEY` | only for `LLM_PROVIDER=groq` |
| `TELEGRAM_BOT_TOKEN` | telegram notifications and commands |
| `TELEGRAM_CHAT_ID` | the only chat the bot talks to |
| `GMAIL_USER` | the gmail account that sends reports |
| `GMAIL_APP_PASSWORD` | a gmail app password for that account |
| `EMAIL_TO` | where reports are sent |
| `READ_ONLY` | set to `1` to serve showcase worlds only, as on a deploy |

If any of these is missing, that feature logs once and is skipped. Nothing crashes.

## how evolution works

- Generation 1 starts with seven constitutions. Six take different philosophies to the same mission: technocratic, federal, utilitarian, market liberal, communitarian and space-first. The seventh is the long now charter, which is protected: it competes with its original text every generation and is never mutated in place, though mutations of it can enter as separate constitutions.
- **Two-stage evaluation, every generation:**
  - **Screening:** every constitution runs the same 2 seeds for 50 years (to tick 600) and is scored by its average.
  - **Finals:** the top 2 also get one full 100-year run (to tick 1200). The champion, the hall of history and the showcase come from those full runs.
- **Uncertainty:** each agent that enters its sim version's top 3 (by best full run) also runs 5 extra seeds, as full 100-year runs on the same seeds for every agent. Wherever an agent has several full runs, reports, telegram and `/api/agents/[id]` show ranges, e.g. "mars crewed by 2068-2081 in 4 of 5 runs", instead of single numbers.
- The top 2 constitutions carry over unchanged. The rest of the population is refilled with:
  - **mutations**: the LLM rewrites a parent, given what killed it, its biggest events and the known lessons. It fixes what failed and keeps what worked.
  - **crossovers**: section by section splices of two parents (values, religion, school, migration, priorities).
- Output:
  - `data/generations/gen-<n>.json` for each generation
  - `data/leaderboard.json` with the top 20 of all time
  - showcase worlds in `data/showcase/` (gzipped, with an `index.json`), committed so the deployed site can replay them:
    - at most 20 worlds: goal worlds, hall of history worlds, and the best world of each lineage
    - only from real LLM runs, never worlds the governor ran on its offline fallback
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
  - The champion is the active agent with the best full 100-year world. An agent's average is over its 50-year screening worlds, so every agent is compared on the same horizon. Agents dropped from evolution are retired.
- **Fairness:** every active agent runs the same 2 screening seeds each generation, so compare mode always has like-for-like worlds.
- **Hall of history:** `data/hall.json` records firsts (moon, a Mars city, an eradicated disease, 150 and 200 year lifespans), records (population, lifespan, fastest moon), catastrophes (biggest collapse, deadliest famine) and milestones. Each entry links to its world and the exact tick of the event behind it.
- Evolution keeps going, generation after generation, until a world achieves the goal. Then it finishes that generation and stops. Use `--gens n` to stop sooner.
- Evolution is resumable: rerunning `npm run evolve` continues the unfinished generation.
- **Sim versions:**
  - Every world records the sim version that ran it: B's `SIM_VERSION`, or a hash of the sim and agent source if there is none.
  - The leaderboard, steps, hall and learning curve are kept per version. When the version changes, the old files move to `data/versions/<version>/` and the new version starts clean.
  - Lessons carry forward but are unverified until a world on the new version dies of the mistake a lesson names, or applies the lesson and survives.
  - A running evolve checks for a new version at every generation boundary and restarts itself on it, still under caffeinate.
  - `GET /api/versions` lists the versions; steps, hall and learning take `?version=`.
- An unreachable LLM is never a death:
  - **Ollama down before a world starts:** the generation pauses, sends one telegram ("paused: ollama not running"), checks every 60s, and resumes on its own.
  - **Ollama dies mid-world** (so the governor fell back to offline decisions): the world is marked interrupted, is not scored, and runs again once ollama is back.
  - **Other transient errors:** retried after 30s, 2m, 10m, then at the next hour.
- LLM calls, tokens, wall time and cost ($0 on ollama) per world are logged to `data/reports/usage-<date>.json`. `/status` shows the average minutes per world and how many more fit before 7am.

## telegram

- **Every destroyed world:** world number, generation, date, its epitaph and cause; what it got wrong and the lesson it added; how far it got (frontier, period life expectancy, population); and its human cost.
- **End of each generation:** the champion, the best score, lessons known, the repeat-mistake rate, the top step so far, and the deadliest step so far.
- **New hall of history entries:** one message per generation, one line each, e.g. "🏆 first mars city ever: halcyon ii, 2071".
- **Goal achieved:** a big celebration.
- **Every hour:** a heartbeat, e.g. "alive · gen 3 · world 9/16 · 41 min per world · 12 deaths so far · best score 0.61".
- **No world finished for 90 minutes:** a warning with the last lines of `data/evolve.log`.
- **After a restart:** "evolution restarted", with the first world's minutes and the estimated worlds per day.
- The command listener runs inside the evolve process, so it stops and restarts with evolution.
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

- **Generation digest, after every generation.** It uses the same report structure as `/api/report`, so the site and the inbox read the same. Each digest has:
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
| `GET /api/agents/[id]` | `{ agent, runs, ranges? }`. `ranges` covers the agent's full runs on the current version, when it has 2 or more |
| `GET /api/compare?agents=a,b,c,d` | `{ seed, runs, divergences, pending, note? }`: each agent's best world on their most shared seed, slim (`SlimRun`: summary, one stat row per year, decision rows), plus divergences for every pair. Missing worlds are started in the background (local only) |
| `GET /api/evolve/now` | mission control: the running generation, current world and its latest frame, `lastHeartbeat` (refreshed every minute), the queue, the last 5 worlds, new lessons, stats (worlds lost, lessons known, best score, champion, minutes per world, worlds by morning), with `running: true`. When idle: 200 `{ running: false, lastHeartbeat }` |
| `GET /api/runs/[id]/frames?from=&to=` | `FramesResponse` `{ runId, from, to, frames }`: full frames in an inclusive tick range, for lazy loading |
| `GET /api/hall` | `HallEntry[]` |
| `GET /api/steps[?runs=a,b]` | `Step[]`, the cross-world recipe over real LLM worlds: up to 15 steps found in the worlds that did best for everyone (effect > 0), then up to 15 found in the dead ones. Each has plain-words text, effect, confidence (by sample size), and helped/hurt world ids as proof. Recomputed after every generation into `data/steps.json`; `?runs` restricts it to those worlds |
| `GET /api/report/[runId]` | one world in plain words: a summary (5 lines max), then what it decided and why, what people felt, who moved and why, what it cost in lives, what it learned from earlier worlds, what killed it (or how far it got), and the steps it got right or wrong. Every claim carries refs: an event tick, a source url, or another world |
| `GET /api/report/learning` | the cross-world story: every world in order, its cause of death, the lesson it added, and whether later worlds avoided that mistake |
| `POST /api/branch` `{ runId, tick, agentId }` | `{ runId }`, a new live world from that moment, governed by that agent |
| `GET /api/runs/[id]` | `RunRecord`; with `?slim=1` a `SlimRun` (no frames, yearly rows and decision rows) |
| `POST /api/live/start` `{ constitution?, seed? }` | `{ runId }`, spawns a live world at 1 second per month |
| `GET /api/live/[id]` | the live `RunRecord` so far |
| `POST /api/override` `{ runId, override }` | `{ ok: true }`, the governor sees it on the next tick |
| `POST /api/ask` `{ runId, question }` | `{ answer }` |

## deploying

The site deploys to vercel as a normal Next.js app. A deployed copy has no writable disk, so it detects read-only mode (or `READ_ONLY=1`):

- `/api/runs` and `/api/runs/[id]` serve only the committed worlds in `data/showcase/`. Agents, compare, hall and learning read whatever data is committed.
- live, override, ask and branch return `503 {"error":"runner offline, local only"}`.

Evolution and live worlds run on your own machine.
