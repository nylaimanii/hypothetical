#!/bin/zsh
# runs evolution from a clean git worktree of the pushed origin/main that lives OUTSIDE the shared project folder
# (default /Users/nyla/hypothetical-runner, or HYP_RUNNER_DIR), so other agents' uncommitted files never reach a
# world and nothing is ever checked out inside the shared folder. the working directory stays the project, so
# data/ (runs, lessons, the ollama lock, everything the api reads) is shared; only the code comes from the commit.
# when evolve exits with 75 (a new sim version was pushed, or the evolve code changed; it stopped at a generation
# boundary), the worktree moves to the new origin/main and evolve starts again.
#
#   nohup caffeinate -i scripts/run-evolve.sh --gens 50 --concurrency 1 > data/evolve.log 2>&1 &
#
# --adopt <pid>: take over an evolve process that is already running (e.g. from an older supervisor). keeps the mac
# awake on it, waits for it to stop at its generation boundary, then carries on as above. if that process stopped
# for any other reason (crash, manual stop), this ends too.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUNNER="${HYP_RUNNER_DIR:-$(dirname "$ROOT")/hypothetical-runner}"
cd "$ROOT"
note() { echo "$(date '+%F %T') $1" | tee -a data/evolve-restart.log }

ADOPT=""
if [ "${1:-}" = "--adopt" ]; then ADOPT="$2"; shift 2; fi
if [ -n "$ADOPT" ]; then
  note "adopting running evolve pid $ADOPT; the next runs come from $RUNNER"
  caffeinate -i -w "$ADOPT" &
  while kill -0 "$ADOPT" 2>/dev/null; do sleep 10; done
  if ! tail -5 data/evolve.log | grep -qE "restarting on sim version|evolve code updated"; then
    note "adopted evolve pid $ADOPT stopped without a planned restart; not restarting"
    exit 0
  fi
  note "adopted evolve stopped at a generation boundary for a planned restart"
fi

while true; do
  git fetch -q origin main || { note "git fetch failed, retrying in 60s"; sleep 60; continue }
  if [ -d "$RUNNER" ]; then
    git -C "$RUNNER" checkout -q --detach origin/main || { note "could not update the runner worktree at $RUNNER"; exit 1 }
  else
    git worktree add -q --detach "$RUNNER" origin/main || { note "could not create the runner worktree at $RUNNER"; exit 1 }
  fi
  # same dependencies as the project (the worktree only holds committed code)
  ln -sfn "$ROOT/node_modules" "$RUNNER/node_modules"
  if ! git -C "$ROOT" diff --quiet "$(git -C "$RUNNER" rev-parse HEAD)" -- package-lock.json 2>/dev/null; then
    note "warning: package-lock.json at origin/main differs from the installed node_modules"
  fi
  note "evolve starting from origin/main $(git -C "$RUNNER" log --oneline -1 | cut -c1-70)"
  HYP_CODE_ROOT="$RUNNER" node "$RUNNER/node_modules/tsx/dist/cli.mjs" --tsconfig "$RUNNER/tsconfig.json" "$RUNNER/scripts/evolve.ts" "$@"
  code=$?
  if [ $code -eq 75 ]; then note "planned restart (new sim version or evolve code), continuing from the new origin/main"; continue; fi
  note "evolve exited with code $code"
  exit $code
done
