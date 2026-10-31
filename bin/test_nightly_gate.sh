#!/usr/bin/env bash
# Self-check for the nightly gate: a non-CLEAR verdict reverts ONLY the stage's
# own commits and never touches operator work (the old `reset --hard` +
# `checkout -- .` wiped it 08-29..09-22). Runs the real script against
# throwaway repos with a stub pi. Run: bash bin/test_nightly_gate.sh
# SCRIPT=<path> runs another copy (e.g. the pre-fix one, to watch it fail).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${SCRIPT:-$REPO_ROOT/bin/nightly-self-improve.sh}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=op GIT_AUTHOR_EMAIL=op@x GIT_COMMITTER_NAME=op GIT_COMMITTER_EMAIL=op@x

# Stub pi. The /dream stage, in every repo, commits one edit (b.txt) the way
# adapters do, leaves an uncommitted scratch file, and commits with the
# operator's -c identity; the gate prompt eats stdin like real pi, then answers
# $STUB_VERDICT plus hook chatter after it. Every other stage is a no-op.
cat > "$T/pi" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"/dream"*) for r in $STUB_REPOS; do
                cd "$r" && echo stage > b.txt && echo scratch > new.txt \
                  && git -c user.name=op commit -qm stage -- b.txt
              done ;;
  *"defense gate"*) [ -t 0 ] || cat > /dev/null; printf '%b' "$STUB_VERDICT\nKE update reminder\n" ;;
esac
EOF
chmod +x "$T/pi"

mkrepo() {  # mkrepo <dir>: committed a.txt b.txt, then operator dirt
  mkdir -p "$1" && git -C "$1" init -q
  printf 'orig\n' > "$1/a.txt"; printf 'orig\n' > "$1/b.txt"
  git -C "$1" add -A && git -C "$1" commit -qm init
  echo mine > "$1/a.txt"; echo keep > "$1/keep.txt"   # unstaged edit + untracked file
}

check() {  # check <verdict> <label>
  local R1="$T/$2/r1" R2="$T/$2/r2" L="$T/$2/log"
  mkrepo "$R1"; mkrepo "$R2"
  echo staged > "$R2/s.txt"; git -C "$R2" add s.txt    # staged work: revert must refuse
  HOME="$T/$2" PI="$T/pi" STUB_REPOS="$R1 $R2" STUB_VERDICT="$1" GATE_REPOS="$R1 $R2" \
    LOG_DIR="$L" GAPS=/bin/true bash "$SCRIPT"
  fail() { echo "FAIL [$2]: $1" >&2; exit 1; }
  for r in "$R1" "$R2"; do  # operator work survives every outcome
    [ "$(cat "$r/a.txt")" = mine ] || fail "operator edit lost in $(basename "$r")" "$2"
    [ "$(cat "$r/keep.txt" 2>/dev/null)" = keep ] || fail "operator untracked lost in $(basename "$r")" "$2"
    [ -f "$r/new.txt" ] || fail "unattributed file touched in $(basename "$r")" "$2"
  done
  [ "$(git -C "$R2" diff --cached --name-only)" = s.txt ] || fail "operator staging lost" "$2"
  grep -q "r1 ALERT uncommitted" "$L/nightly.log" || fail "no ALERT for new.txt" "$2"
  if [ "$2" = CLEAR ]; then
    [ "$(cat "$R1/b.txt")" = stage ] || fail "CLEAR edit did not stand" "$2"
    return
  fi
  [ "$(cat "$R1/b.txt")" = orig ] || fail "stage commit not reverted" "$2"
  grep -q "r1 $2 — reverted stage commits" "$L/nightly.log" || fail "no $2 revert line" "$2"
  # r2 is gated too (stdin not eaten), and its revert refuses rather than touch staged work
  grep -q "r2 $2 — REVERT_FAILED" "$L/nightly.log" || fail "r2 not gated / no REVERT_FAILED" "$2"
  [ "$(cat "$R2/b.txt")" = stage ] || fail "r2 changed despite REVERT_FAILED" "$2"
}

check 'review...\nVERDICT: ATTACKS' ATTACKS
check 'Error: model not found' GATE_ERROR   # infra failure: no verdict line
check 'fine\nVERDICT: CLEAR' CLEAR
echo ok
