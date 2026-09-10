#!/usr/bin/env bash
# Check for bin/to-trash: lands inside the arc write-lane, restores, refuses guarded paths.
set -euo pipefail
BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/to-trash"
R="$(mktemp -d)"; trap 'rm -rf "$R"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# --- in-repo path lands in <repo>/.trash, never in a home-level trash dir ---
mkdir -p "$R/repo/sub"; git -C "$R/repo" init -q
echo hello > "$R/repo/sub/doomed.txt"
"$BIN" "$R/repo/sub/doomed.txt" --reason "test" >/dev/null
d="$(echo "$R"/repo/.trash/*_doomed.txt)"
[[ -f "$d/doomed.txt" ]] || fail "not trashed into repo .trash"
[[ "$(cat "$d/doomed.txt")" == "hello" ]] || fail "content lost"
grep -q "^reason: test$" "$d/reason.md" || fail "reason not recorded"
[[ ! -e "$R/repo/sub/doomed.txt" ]] || fail "original still present"

# --- the trash root passes the arc write-lane gate ---
gate="$HOME/repos/arc-director/src/policy/check.ts"
if [[ -f "$gate" ]] && command -v bun >/dev/null; then
  out="$(bun "$gate" --db "$HOME/vault/ledger.db" "$R/repo/.trash/x" 2>&1 || true)"
  [[ "$out" != *LANE_BLOCKED* ]] || fail "trash root out of write-lane: $out"
fi

# --- restore puts it back at the recorded absolute path ---
"$BIN" "$(basename "$d")" --restore --root "$R/repo/.trash" >/dev/null
[[ "$(cat "$R/repo/sub/doomed.txt")" == "hello" ]] || fail "restore did not return the file"

# --- outside any repo falls back to /tmp/trash ---
echo x > "$R/loose.txt"   # mktemp dir is under /tmp, not a repo
"$BIN" "$R/loose.txt" --reason "test" >/dev/null
ls /tmp/trash/*_loose.txt >/dev/null 2>&1 || fail "no /tmp/trash fallback"
rm -rf /tmp/trash/*_loose.txt

# --- guards hold ---
mkdir -p "$R/repo/.git/objects"; echo g > "$R/repo/.git/objects/f"
! "$BIN" "$R/repo/.git/objects/f" --reason "test" 2>/dev/null || fail "should refuse inside .git"
! "$BIN" "$R/nope.txt" --reason "test" 2>/dev/null || fail "should refuse missing path"

echo "PASS: bin/to-trash"
