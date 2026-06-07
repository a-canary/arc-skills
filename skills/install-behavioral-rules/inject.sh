#!/usr/bin/env bash
# Idempotent injector: sync the ARC-BEHAVIORAL-RULES block from behavioral-rules.md
# into each harness's user-level config. Re-runnable — replaces the marked block in
# place, never duplicates. Edit behavioral-rules.md, re-run this to re-sync.
set -euo pipefail

SRC="$(dirname "$(realpath "${BASH_SOURCE[0]}")")/behavioral-rules.md"
BEGIN="<!-- ARC-BEHAVIORAL-RULES:BEGIN -->"
END="<!-- ARC-BEHAVIORAL-RULES:END -->"

# Targets: user-level config for each harness present on this machine.
TARGETS=(
  "$HOME/.claude/CLAUDE.md"
  "$HOME/.pi/pi.md"
)

# Extract the block (inclusive of markers) from the source.
block="$(awk -v b="$BEGIN" -v e="$END" '
  $0 ~ b {p=1} p {print} $0 ~ e {p=0}
' "$SRC")"

if [ -z "$block" ]; then
  echo "ERROR: no ARC-BEHAVIORAL-RULES block found in $SRC" >&2
  exit 1
fi

for tgt in "${TARGETS[@]}"; do
  dir="$(dirname "$tgt")"
  # Only inject where the harness actually lives (its dir exists).
  [ -d "$dir" ] || { echo "skip (no $dir): $tgt"; continue; }
  touch "$tgt"

  if grep -qF "$BEGIN" "$tgt"; then
    # Replace existing block in place.
    awk -v b="$BEGIN" -v e="$END" -v repl="$block" '
      $0 ~ b {print repl; skip=1; next}
      $0 ~ e {skip=0; next}
      !skip {print}
    ' "$tgt" > "$tgt.tmp" && mv "$tgt.tmp" "$tgt"
    echo "updated: $tgt"
  else
    # Append fresh block.
    { [ -s "$tgt" ] && echo ""; echo "$block"; } >> "$tgt"
    echo "added:   $tgt"
  fi
done
