#!/bin/zsh
# installs two launchd jobs for this user (macOS runs them without a terminal):
#   com.hypothetical.evolve   starts scripts/run-evolve.sh at login and again after a crash (not after a normal
#                             stop: ctrl-c or /pause-and-stop exits 0 and stays stopped). if a supervisor or an
#                             evolve is already running, the new one sees it and exits, so installing is safe anytime
#   com.hypothetical.morning  sends the morning digest at 8:05 if evolve has not (and on wake, if the mac slept
#                             through it; macOS runs a missed calendar job when it wakes). 9:05, 10:05 and 12:05
#                             retry, e.g. when the network was not up yet. it runs from the runner worktree
# undo: scripts/launchd/install.sh --uninstall
# note: launchd jobs start after you log in. with filevault on, a restarted mac waits at the login screen
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RUNNER="${HYP_RUNNER_DIR:-$(dirname "$ROOT")/hypothetical-runner}"
AGENTS="$HOME/Library/LaunchAgents"
P="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
for job in evolve morning; do
  launchctl bootout "gui/$(id -u)/com.hypothetical.$job" 2>/dev/null || true
  rm -f "$AGENTS/com.hypothetical.$job.plist"
done
if [ "${1:-}" = "--uninstall" ]; then echo "removed both jobs"; exit 0; fi
mkdir -p "$AGENTS"
for job in evolve morning; do
  sed -e "s#__ROOT__#$ROOT#g" -e "s#__RUNNER__#$RUNNER#g" -e "s#__PATH__#$P#g" "$ROOT/scripts/launchd/com.hypothetical.$job.plist" > "$AGENTS/com.hypothetical.$job.plist"
  plutil -lint -s "$AGENTS/com.hypothetical.$job.plist"
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/com.hypothetical.$job.plist"
  echo "installed com.hypothetical.$job"
done
