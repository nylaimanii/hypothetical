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
# overnight, without the mac sleeping, from a clean worktree of the pushed origin/main:
nohup caffeinate -i scripts/run-evolve.sh --gens 50 --concurrency 1 > data/evolve.log 2>&1 &
npm run run-one -- --seed 1 --constitution technocrat
npm run backup                 # push agents, lessons, steps, hall, leaderboards, learning to origin data-backup now
npm run promote-stable         # origin/main + the real showcase data; if it builds and passes every check, move origin stable (--dry: check only)
npm run consistency            # tests/consistency on the latest real worlds and lives (--nightly: last day, telegram on failure)
npm run hooks:install          # the pre-commit hook: every commit, from any worktree, must pass tests/consistency
npm run morning                # send the morning digest now
npm run retention              # one disk retention pass now (evolve runs it hourly)
npm run reality-check          # the no-ai twin vs real published data, writes data/reality-check.json
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
- **Evolution runs committed code only.** `scripts/run-evolve.sh` keeps a git worktree outside the project folder (`../hypothetical-runner`, or `HYP_RUNNER_DIR`), checked out at the pushed `origin/main`. Nothing is ever checked out inside the shared folder. It runs evolve from that worktree with this project as the working directory:
  - Data (runs, lessons, the ollama lock, everything the api reads) is shared.
  - Code and sim inputs come from the commit, so uncommitted work in the shared tree never reaches a world.
- Evolution is resumable: rerunning `npm run evolve` continues the unfinished generation.
- **Sim versions:**
  - Every world records the sim version that ran it: B's `SIM_VERSION`, or a hash of the sim and agent source if there is none.
  - The leaderboard, steps, hall and learning curve are kept per version. When the version changes, the old files move to `data/versions/<version>/` and the new version starts clean.
  - Lessons carry forward but are unverified until a world on the new version dies of the mistake a lesson names, or applies the lesson and survives.
  - At every generation boundary, the runner compares its commit's version with what B has pushed to `origin/main`. If it changed, evolve exits with code 75, and `run-evolve.sh` moves the worktree to the new commit and starts again under the same caffeinate. `--adopt <pid>` takes over an evolve that is already running and carries on after its generation boundary.
  - `GET /api/versions` lists the versions; steps, hall and learning take `?version=`.
- An unreachable LLM is never a death:
  - **Ollama down before a world starts:** the generation pauses, sends one telegram ("paused: ollama not running"), checks every 60s, and resumes on its own.
  - **Ollama dies mid-world** (so the governor fell back to offline decisions): the world is marked interrupted, is not scored, and runs again once ollama is back.
  - **Other transient errors:** retried after 30s, 2m, 10m, then at the next hour.
- LLM calls, tokens, wall time and cost ($0 on ollama) per world are logged to `data/reports/usage-<date>.json`. `/status` shows the average minutes per world and how many more fit before 7am.

## disk retention

Full records are about 34MB, and evolution makes about 130 a day, so retention runs every hour:

- **Slim payloads:** every world keeps one forever, in `data/runs/slim/`.
- **Full records kept:** only for the hall of history, each sim version's top 20 (per horizon), showcase worlds, and anything a petition, what-if, life, follow list or live branch points at. Those stay plain JSON so the sim can branch from them.
- **Everything else:** gzipped after 6 hours, and deleted once it is 3 days old. Its slim payload stays.
- **Scope:** only worlds evolve itself indexed are touched.
- **Disk report:** in `/status` and the hourly heartbeat, with a telegram warning when free disk drops under 50GB.

## upkeep (scheduled by the evolve watchdog)

- **Backups, daily:** the small files that hold what the AI learned (agents, lessons and life lessons, steps, hall, leaderboards, learning curves, versions) are committed to the `data-backup` branch on origin.
  - The commit is built with a throwaway git index, so the shared working tree is never touched.
  - It is not on `main`, so these files never collide with anyone's untracked copies.
  - Restore with `git checkout origin/data-backup -- data/`.
- **Stable deploys, daily between 3 and 6am:** `stable` is `origin/main` plus one data commit, the snapshot the read-only site serves: the showcase worlds, agents, hall, steps, learning, lessons, older versions and D's lives (src/lib/evolve/deploy.ts). It is built with a throwaway git index, so it never lands on main.
  - In a clean copy of exactly that tree it is typechecked, built read-only (like Vercel), tested, deploy-checked (every listed world opens and its agent exists) and run through `tests/consistency`. If everything passes, `stable` moves to it as a fast-forward.
  - Vercel should deploy production from `stable` (set the production branch in the Vercel project settings).
  - The deployed site has no runner and no llm: `GET /api/capabilities` says what is off (play live, petitions, what-if, branch, override, ask), so the ui hides those controls instead of showing a dead button.
- **Consistency suite (one source of truth):** every name, age, date and number a page, report or telegram shows must agree with the sim records. A, B and D write the checks in `tests/consistency`; C runs them:
  - before every commit, from any worktree (`.git/hooks/pre-commit`, installed by `npm run hooks:install`), on the newest 3 worlds and 3 lives, so the commit stops with the failing check in plain words
  - nightly from 2am (evolve; the 8:05 launchd job catches up after a night asleep), on the last day's worlds and lives, with a telegram only when a check fails
  - before every stable promotion, on the deployed data
  - checks get the ids to look at in `HYP_CONSISTENCY_RUNS` and `HYP_CONSISTENCY_LIVES` (comma lists), and name each check as a plain sentence, so a failure reads like "the chronicle starts in the year the timeline starts: chronicle starts in 2027, the timeline in 2026".
  - `vercel.json` turns off deploys of `main` and `data-backup`.
- **Morning digest, 8am:** one telegram with everything since the last digest: the most interesting world, the tally by sim version, new lessons, deaths, a sim switch if there was one, a short lives section (the most interesting chosen life that ended, 2 lines at most), and disk and health.
  - Evolve's watchdog sends it, and so does the `com.hypothetical.morning` launchd job at 8:05 (retries at 9:05, 10:05 and 12:05). A mac asleep at 8 sends it on wake.
  - A claim file per day (`data/.morning-<date>`) stops a double send. A failed send gives the claim back for the next try. `npm run morning -- --dry` previews it.
- **Lives in the gaps:** B's `runWorld` holds the ollama lock for a whole world, so evolution always comes first. Between two worlds, when D's chosen lives are running, evolve opens a gap (`data/.ollama.gap`, up to `HYP_LIFE_GAP_S`, default 60s, `0` turns it off). It ends early once the lives stop asking. While evolution is paused, the gap stays open.
- **Quality check, weekly:** between worlds, the champion's best full world is replayed with `qwen2.5:14b` (`QUALITY_MODEL`). The report says whether the result holds up against the 7b screening (same survival, score within 20%). It is saved to `data/quality/`.
- **Restarts:** the runner also restarts at a generation boundary when the evolution code itself changes on `origin/main`, with no version rollover.
- **After a reboot:** `scripts/launchd/install.sh` installs `com.hypothetical.evolve`, which starts the runner at login and again after a crash (a normal stop stays stopped). Undo with `scripts/launchd/install.sh --uninstall`.
  - The jobs start after login. With FileVault on, a restarted mac waits at the login screen until someone logs in.
  - Only one supervisor and one evolve run at a time (`data/.evolve-supervisor.pid`, `data/.evolve.lock`). A second start exits, or adopts a running evolve that has no supervisor, before any git command.
  - Locks and queue tickets written before the last boot are cleared at start, since their pids may now belong to other programs.
  - The generation in progress resumes: finished worlds are kept, and the world that was interrupted runs again.
  - `npm run evolve` goes through the runner (a clean worktree of `origin/main`). `npm run evolve:here` runs the working copy directly, for tests only.

## reality check

Once a month, the evolve watchdog compares the no-AI twin with real published data:

- **Sources:** World Bank population (UN-based), and FAOSTAT food supply via Our World in Data.
- **What it compares:** every year from 2026 that has real data. Until such data exists, it checks the starting point against the latest published year.
- **Drift:** past 1% (population) or 3% (food), the matching `ESTIMATE` constants in `src/lib/sim/constants.ts` are flagged for tuning.
- **Not comparable:** life expectancy, GDP and energy, because the twin only records population and food.
- **Output:** results go to `data/reality-check.json`, a section of the PDF digest, and `GET /api/reality-check`. Drift also sends a telegram.

## voice

Telegram, the morning digest and the front of the PDF digest are written by a narrator (`src/lib/notify/story.ts`). It works from the records, with no LLM:

- It finds the most interesting true thing about a world: money spent on a moon it never reached, the core promising "survival" while people starved, a space-first agent that never launched, losing to the 2026-autopilot twin, the decision that turned a world.
- It says it deadpan, in 2 to 4 short lowercase lines, quoting the core's own rationale.
- The joke is always on the AI, its agents or the system, never on the people who suffered.
- Generation summaries end with the champion's fake-wise lesson, marked "probably" so it is never mistaken for something the core said.

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
| `/worlds` | this generation's worlds: agent, seed, status, score and a link (a report for finished worlds, the globe for the running one), then what is queued |
| `/lives` | everyone being lived right now, by continent, with whose world they live in |
| `/life <name>`, `/mute`, `/unmute`, `/quiet`, `/loud` | D's life commands, answered by the same listener (one poller per bot) |
| `/help` | the command list |

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
| `GET /api/reality-check` | the latest monthly twin vs reality comparison, with flagged parameters (null before the first check) |
| `GET /api/report/learning` | the cross-world story: every world in order, its cause of death, the lesson it added, and whether later worlds avoided that mistake |
| `POST /api/branch` `{ runId, tick, agentId }` | `{ runId }`, a new live world from that moment, governed by that agent |
| `POST /api/petition` `{ runId, tick, text }` | the petition, `status: 'pending'`. the core answers in the background from the world as it stood at that tick. until the sim supports petitions the answer changes nothing (`effect: null`, `simulated: false`). 503 in read-only |
| `GET /api/petitions/[runId]` | every petition for that world, oldest first, with the core's answers |
| `POST /api/whatif` `{ runId, tick, change }` | `{ runId, original, appliedAt, exact }`, a new world from that moment with one override flipped (`inject_event`, `veto_law` or `force_budget`), same agent, full speed. a budget forced on a decision tick lands one tick later, since the governor takes a forced budget back at its next decision. `exact: false` until the sim can replay the original decisions. 409 when the original was made by another sim version. 503 in read-only |
| `GET /api/status` | local only (404 on a deploy or a non-local host): evolution progress, the ollama lock, queue and lives gap, lives by continent, disk, the last 10 telegram messages, and each agent's latest commit on `origin/main`. `?view=html` is the page A mounts at `/status`, refreshing every 15s |
| `GET /api/capabilities` | what this deployment can do: `{ readOnly, playLive, petitions, whatIf, branch, override, ask, evolveNow }`, all false on the deployed site, so the ui hides those controls |
| `GET /api/playbook` | what the worlds have learned: each lesson with what was measured (`testedAs`), how many same-seed a/b tests support and contradict it, the confidence that follows ((supported+1)/(tests+2), moving each generation), and the world pairs behind it. `confidence: null` when the sim can't measure it yet. rewritten after every generation |
| `GET /api/leaderboard` | the leaderboard, each entry with `realBaseline` and `explainGap` against the entry below it. `method: 'replay'`: on a seed both agents ran, the lower world replayed with the higher world's decisions swapped in one at a time (B's explainGap), the 3 that close the gap most with the share each explains alone (`npm run explain-gaps`, started after every generation; pure replays, no model). `method: 'pattern'`: until then, the biggest differences in their decisions, marked not yet tested |
| `GET /api/evidence/[runId]` | `{ realBaseline, autopsy }`: the world against UN World Population Prospects 2024 (medium variant, `data/real/un-wpp-2024.json`) at 2076 or its last year, and for a dead world the autopsy walked back along its cause chain. `/api/runs` entries carry `realBaseline` too |
| `GET /api/assumptions` | B's tunable rules (`src/lib/sim/assumptions.ts`): label in plain words, value, unit, source url or "our guess", range. `?runId=` says what that world ran with (`{}` = the defaults). read-only safe |
| `POST /api/rerun` | local only: `{ runId, assumptions: { id: value } }` reruns that world from 2026 on the same seed, agent and constitution with only those rules changed, as a live world kept out of the leaderboard. an unknown rule or a non-number is a 400 with the reason; a value outside a rule's range is clamped and said back ("you asked 3, the limit is 2.1, so the rerun uses 2.1"). the record carries what it used, and the report says so first |
| `GET /api/whatif/[id]` | the what-if and its original side by side (slim), the decisions that diverged from the flip on, and whether it is still running |
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
