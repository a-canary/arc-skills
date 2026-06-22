#!/usr/bin/env bash
# Symlink each harness's user-level config to the canonical AGENTS.md at the
# arc-skills repo root. Idempotent — re-running fixes drift. Any pre-existing
# real file is moved to ~/trash first (never clobbered). Edit AGENTS.md, the
# symlinks follow automatically — no re-sync needed.
set -euo pipefail

# Canonical lives at the repo root, two levels up from this skill dir.
SRC="$(realpath "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/../../AGENTS.md")"
[ -f "$SRC" ] || { echo "ERROR: canonical not found: $SRC" >&2; exit 1; }

TRASH="$HOME/trash"
mkdir -p "$TRASH"

# Targets: user-level config for each harness.
TARGETS=(
  "$HOME/.claude/CLAUDE.md"
  "$HOME/.pi/pi.md"
  "$HOME/AGENTS.md"
)

for tgt in "${TARGETS[@]}"; do
  dir="$(dirname "$tgt")"
  [ -d "$dir" ] || { echo "skip (no $dir): $tgt"; continue; }

  # Already the right symlink? nothing to do.
  if [ -L "$tgt" ] && [ "$(realpath "$tgt")" = "$SRC" ]; then
    echo "ok:      $tgt"
    continue
  fi

  # Back up any existing real file (or wrong link) before replacing.
  if [ -e "$tgt" ] || [ -L "$tgt" ]; then
    bak="$TRASH/$(date +%s)_$(basename "$tgt").$(basename "$dir").bak"
    mv "$tgt" "$bak"
    echo "backed up old -> $bak"
  fi

  ln -s "$SRC" "$tgt"
  echo "linked:  $tgt -> $SRC"
done
