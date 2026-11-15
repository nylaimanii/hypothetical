#!/bin/zsh
# runs evolution from a clean git worktree of the pushed origin/main, so other agents' uncommitted files never
# reach a world. the working directory stays this project, so data/ (runs, lessons, the ollama lock, everything
# the api reads) is shared; only the code comes from the commit. when evolve exits with 75 (B pushed a new sim
# version, it stopped at a generation boundary), the worktree moves to the new origin/main and evolve starts again.
#
#   nohup caffeinate -i scripts/run-evolve.sh --gens 50 --concurrency 1 > data/evolve.log 2>&1 &
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUNNER="$ROOT/.runner"
cd "$ROOT"
note() { echo "$(date '+%F %T') $1" | tee -a data/evolve-restart.log }

# keep the worktree out of everyone's git status (local only, not a tracked .gitignore change)
grep -qxF '/.runner/' .git/info/exclude 2>/dev/null || echo '/.runner/' >> .git/info/exclude

while true; do
  git fetch -q origin main || { note "git fetch failed, retrying in 60s"; sleep 60; continue }
  if [ -d "$RUNNER" ]; then
    git -C "$RUNNER" checkout -q --detach origin/main || { note "could not update the runner worktree"; exit 1 }
  else
    git worktree add -q --detach "$RUNNER" origin/main || { note "could not create the runner worktree"; exit 1 }
  fi
  # same dependencies as the project (the worktree only holds committed code)
  ln -sfn "$ROOT/node_modules" "$RUNNER/node_modules"
  if ! git -C "$ROOT" diff --quiet "$(git -C "$RUNNER" rev-parse HEAD)" -- package-lock.json 2>/dev/null; then
    note "warning: package-lock.json at origin/main differs from the installed node_modules"
  fi
  note "evolve starting from origin/main $(git -C "$RUNNER" log --oneline -1 | cut -c1-70)"
  HYP_CODE_ROOT="$RUNNER" node "$RUNNER/node_modules/tsx/dist/cli.mjs" --tsconfig "$RUNNER/tsconfig.json" "$RUNNER/scripts/evolve.ts" "$@"
  code=$?
  if [ $code -eq 75 ]; then note "new sim version pushed, restarting at the generation boundary"; continue; fi
  note "evolve exited with code $code"
  exit $code
done
