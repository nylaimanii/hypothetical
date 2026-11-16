#!/bin/sh
# installs the consistency pre-commit hook for every worktree of this repo (git keeps hooks in the shared .git).
# the hook itself is versioned in scripts/hooks/pre-commit; this only writes a shim that calls it.
#   scripts/hooks/install.sh             install (an existing different pre-commit hook is kept as pre-commit.local
#                                        and still runs first)
#   scripts/hooks/install.sh --uninstall
set -e
hooks="$(cd "$(git rev-parse --git-common-dir)" && pwd)/hooks"
mkdir -p "$hooks"
if [ "${1:-}" = "--uninstall" ]; then
  grep -q "hypothetical consistency shim" "$hooks/pre-commit" 2>/dev/null && rm -f "$hooks/pre-commit"
  [ -f "$hooks/pre-commit.local" ] && mv "$hooks/pre-commit.local" "$hooks/pre-commit"
  echo "consistency hook removed"; exit 0
fi
if [ -f "$hooks/pre-commit" ] && ! grep -q "hypothetical consistency shim" "$hooks/pre-commit"; then mv "$hooks/pre-commit" "$hooks/pre-commit.local"; fi
cat > "$hooks/pre-commit" <<'SHIM'
#!/bin/sh
# hypothetical consistency shim (scripts/hooks/install.sh): runs scripts/hooks/pre-commit from the committing
# worktree, or the shared project's copy when that worktree is on an older commit
hooks=$(cd "$(dirname "$0")" && pwd)
[ -x "$hooks/pre-commit.local" ] && { "$hooks/pre-commit.local" "$@" || exit 1; }
top=$(git rev-parse --show-toplevel)
hook="$top/scripts/hooks/pre-commit"
[ -f "$hook" ] || hook="$(dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd)")/scripts/hooks/pre-commit"
[ -f "$hook" ] && exec sh "$hook" "$@"
exit 0
SHIM
chmod +x "$hooks/pre-commit"
echo "consistency hook installed in $hooks/pre-commit (every worktree)"
