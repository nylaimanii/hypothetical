# hypothetical

One AI runs a single world government starting November 2026. Its only goal is a crewed moon landing.
The AI writes policy: laws, budgets, migration, the religion stance, what school is for. Everything else
is plain TypeScript: physics, biology, demography, the economy and rocket math. Many worlds run under
competing constitutions, and the constitutions evolve between runs.

## the deterministic-sim rule

- All world state comes from code in `src/lib/sim`, seeded with mulberry32. Same seed plus same decisions means the same world.
- The LLM never produces a number that becomes world state, apart from policy choices (budget fractions, migration counts, law text). The sim clamps those to physical limits.
- Every seeded statistic carries provenance: `SOURCED` with a url, or `ESTIMATE`.
- 1 tick is 1 month. The governor decides every 12 ticks. A world ends as `destroyed`, `moon` (crewed landing) or `stagnated` (tick 600).
- Every run also simulates a no-AI twin on the same seed with 2026 policies frozen, so you can see what the AI changed.

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

- A generation runs every constitution on the same 2 seeds and scores it by its average.
- The top 2 constitutions carry over unchanged. The rest of the population is refilled with:
  - **mutations**: groq rewrites a parent, given what killed it and its biggest events. It fixes what failed and keeps what worked.
  - **crossovers**: section by section splices of two parents (values, religion, school, migration, priorities).
- Output:
  - `data/generations/gen-<n>.json` for each generation
  - `data/leaderboard.json` with the top 20 of all time
  - moon worlds copied to `data/showcase/`, which is committed so the deployed site can replay them
- Evolution is resumable: rerunning `npm run evolve` continues the unfinished generation.
- Rate limits are not deaths. A world that fails on a 429, a timeout or a network error is marked interrupted. It is not scored, and it is retried after 30s, then 2m, then 10m, then at the next hour. If 3 worlds in a row are interrupted, the whole generation pauses, sends one telegram message, and resumes on its own.
- LLM calls and tokens per world are logged to `data/reports/usage-<date>.json`.

## telegram

- **Every destroyed world:** date, cause, the 3 biggest events, the least obeyed law, the religion and school policy, the score, peak population, and how the no-AI twin did.
- **Every moon landing:** a celebration message.
- **End of each generation:** one summary line.
- **Commands while evolve runs** (answered only in `TELEGRAM_CHAT_ID`):

| command | what it does |
| --- | --- |
| `/status` | progress, plus today's LLM calls and finished and interrupted worlds |
| `/best` | the best constitution so far |
| `/pause`, `/resume` | stop and restart new worlds being started |
| `/ask <question>` | asks the governor about the current best world |

## email reports

PDFs styled like the site go out over gmail and are always saved to `data/reports/`:

- **Generation digest, after every generation:**
  - the best world
  - every death and its cause
  - the top 5 of the leaderboard
  - the best constitution in full
  - AI vs no-AI by region
  - how the constitutions changed
- **Moon report, the moment a world lands:** the winning world's story year by year.

## api

| route | returns |
| --- | --- |
| `GET /api/runs` | `RunSummary[]` (leaderboard best worlds and showcase) |
| `GET /api/runs/[id]` | `RunRecord` |
| `POST /api/live/start` `{ constitution?, seed? }` | `{ runId }`, spawns a live world at 1 second per month |
| `GET /api/live/[id]` | the live `RunRecord` so far |
| `POST /api/override` `{ runId, override }` | `{ ok: true }`, the governor sees it on the next tick |
| `POST /api/ask` `{ runId, question }` | `{ answer }` |

## deploying

The site deploys to vercel as a normal Next.js app. A deployed copy has no writable disk, so it detects read-only mode (or `READ_ONLY=1`):

- `/api/runs` and `/api/runs/[id]` serve only the committed worlds in `data/showcase/`.
- live, override and ask return `503 {"error":"runner offline, local only"}`.

Evolution and live worlds run on your own machine.
