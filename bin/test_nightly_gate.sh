#!/usr/bin/env bash
# Self-check for the nightly gate: a non-CLEAR verdict reverts ONLY the stage's
# edits. Pre-existing uncommitted + untracked work must survive (the old
# `reset --hard` + `checkout -- .` wiped it 08-29..09-22). Runs the real script
# against a throwaway repo with a stub pi. Run: bash bin/test_nightly_gate.sh
# SCRIPT=<path> runs another copy (e.g. the pre-fix one, to watch it fail).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${SCRIPT:-$REPO_ROOT/bin/nightly-self-improve.sh}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# Stub pi: the /dream stage edits the repo the way a sloppy adapter would
# (commits with `add -A`, sweeping a pre-existing untracked file in); the gate
# prompt answers $STUB_VERDICT. Every other stage is a no-op.
cat > "$T/pi" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"/dream"*) cd "$STUB_REPO" && echo stage > a.txt && echo new > new.txt \
                && git add -A && git commit -qm stage && echo stage > b.txt ;;
  *"defense gate"*) printf '%b' "$STUB_VERDICT" ;;
esac
EOF
chmod +x "$T/pi"

check() {  # check <verdict> <expected log word>
  local R="$T/repo-$2" H="$T/home-$2"
  mkdir -p "$R" "$H"
  git -C "$R" init -q && printf 'orig\n' > "$R/a.txt" && printf 'orig\n' > "$R/b.txt"
  git -C "$R" add -A && git -C "$R" commit -qm init
  local pre; pre=$(git -C "$R" rev-parse HEAD)
  echo mine > "$R/a.txt"; echo keep > "$R/keep.txt"   # operator's pre-existing work
  HOME="$H" PI="$T/pi" STUB_REPO="$R" STUB_VERDICT="$1" GATE_REPOS="$R" \
    LOG_DIR="$T/log-$2" GAPS=/bin/true bash "$SCRIPT"
  fail() { echo "FAIL [$2]: $1" >&2; exit 1; }
  if [ "$2" = CLEAR ]; then
    [ "$(cat "$R/a.txt")" = stage ] && [ -f "$R/new.txt" ] || fail "CLEAR edits did not stand" "$2"
    return
  fi
  [ "$(git -C "$R" rev-parse HEAD)" = "$pre" ] || fail "HEAD not reverted" "$2"
  [ "$(cat "$R/a.txt")" = mine ] || fail "pre-existing edit lost: a.txt=$(cat "$R/a.txt")" "$2"
  [ "$(cat "$R/keep.txt" 2>/dev/null)" = keep ] || fail "pre-existing untracked keep.txt lost" "$2"
  [ "$(cat "$R/b.txt")" = orig ] || fail "stage edit b.txt not reverted" "$2"
  [ ! -e "$R/new.txt" ] || fail "stage file new.txt left in repo" "$2"
  ls "$H"/trash/*/*/new.txt >/dev/null 2>&1 || fail "new.txt not quarantined to ~/trash" "$2"
  grep -q "$2 — stage edits reverted" "$T/log-$2/nightly.log" || fail "no $2 log line" "$2"
}

check 'review...\nVERDICT: ATTACKS\n' ATTACKS
check 'Error: model not found\n' GATE_ERROR   # infra failure: no verdict line
check 'fine\nVERDICT: CLEAR\n' CLEAR
echo ok
