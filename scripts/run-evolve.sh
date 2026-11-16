#!/bin/zsh
# runs evolution from a clean git worktree of the pushed origin/main that lives OUTSIDE the shared project folder
# (default /Users/nyla/hypothetical-runner, or HYP_RUNNER_DIR), so other agents' uncommitted files never reach a
# world and nothing is ever checked out inside the shared folder. the working directory stays the project, so
# data/ (runs, lessons, the ollama lock, everything the api reads) is shared; only the code comes from the commit.
# when evolve exits with 75 (a new sim version was pushed, or the evolve code changed; it stopped at a generation
# boundary), the worktree moves to the new origin/main and evolve starts again.
#
#   nohup caffeinate -i scripts/run-evolve.sh --gens 50 --concurrency 1 > data/evolve.log 2>&1 &
#   npm run evolve -- --gens 50        (same, in the foreground)
#   scripts/launchd/install.sh         (starts it at login and after a crash, plus the 8am digest on wake)
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

# one supervisor and one evolve at a time (launchd starts this at login; a manual start next to it must not run a
# second evolve, and must never move the worktree under a running one). checked before any git command
is_pid() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null && ps -p "$1" -o command= | grep -q "$2" }
SUP=data/.evolve-supervisor.pid
if [ -z "$ADOPT" ]; then
  other=$(cat "$SUP" 2>/dev/null)
  if [ "$other" != "$$" ] && is_pid "$other" "run-evolve.sh"; then note "a supervisor is already running (pid $other); not starting another"; exit 0; fi
  # older supervisors never wrote the pid file: any other run-evolve.sh (not this one, not our caffeinate parent)
  others=$(pgrep -f "scripts/run-evolve.sh" | grep -v -x -e "$$" -e "$PPID" | head -1)
  if [ -n "$others" ]; then note "a supervisor is already running (pid $others); not starting another"; exit 0; fi
  for f in data/.evolve.lock data/evolve-now.json; do
    pid=$(grep -o '"pid": *[0-9]*' "$f" 2>/dev/null | grep -o '[0-9]*$')
    if is_pid "$pid" "scripts/evolve.ts"; then note "evolve is already running (pid $pid) without a supervisor; adopting it"; ADOPT="$pid"; break; fi
  done
fi
echo $$ > "$SUP"
trap '[ "$(cat $SUP 2>/dev/null)" = "$$" ] && rm -f $SUP' EXIT
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
