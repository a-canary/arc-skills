#!/usr/bin/env bash
# Self-check for the nightly gate: a non-CLEAR verdict reverts ONLY the stage's
# own edits and never touches operator work (the old `reset --hard` +
# `checkout -- .` wiped it 08-29..09-22). Runs the real script against
# throwaway repos with a stub pi. Run: bash bin/test_nightly_gate.sh
# SCRIPT=<path> runs another copy (e.g. the pre-fix one, to watch it fail).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${SCRIPT:-$REPO_ROOT/bin/nightly-self-improve.sh}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=op GIT_AUTHOR_EMAIL=op@x GIT_COMMITTER_NAME=op GIT_COMMITTER_EMAIL=op@x

# Stub pi. The /dream stage, in every repo, edits b.txt, creates new.txt and
# appends to the operator's untracked op.txt WITHOUT committing, as the real
# adapters do. STUB_MODE=amend also rewrites the operator's HEAD commit. The gate
# prompt eats stdin like real pi, then answers $STUB_VERDICT plus hook chatter
# after it. Every other stage is a no-op.
cat > "$T/pi" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"/dream"*) for r in $STUB_REPOS; do
                cd "$r" && echo stage > b.txt && echo scratch > new.txt && echo x >> op.txt
                [ "${STUB_MODE:-}" = amend ] && git commit -q --amend -m rewritten -- b.txt
              done ;;
  *"defense gate"*) [ -t 0 ] || cat > /dev/null; printf '%b' "$STUB_VERDICT\nKE update reminder\n" ;;
esac
exit 0
EOF
chmod +x "$T/pi"

mkrepo() {  # mkrepo <dir>: committed a.txt b.txt, then operator dirt
  mkdir -p "$1" && git -C "$1" init -q
  printf 'orig\n' > "$1/a.txt"; printf 'orig\n' > "$1/b.txt"
  git -C "$1" add -A && git -C "$1" commit -qm init
  echo mine > "$1/a.txt"; echo keep > "$1/keep.txt"; echo op > "$1/op.txt"  # unstaged edit + untracked
  echo staged > "$1/s.txt"; git -C "$1" add s.txt                            # staged work
}

fail() { echo "FAIL [$2]: $1" >&2; exit 1; }
run_case() {  # run_case <label> <verdict> [mode]: sets R1 R2 L
  R1="$T/$1/r1" R2="$T/$1/r2" L="$T/$1/log"
  mkrepo "$R1"; mkrepo "$R2"
  [ "${3:-}" = busy ] && git -C "$R2" rev-parse HEAD > "$R2/.git/CHERRY_PICK_HEAD"  # operator mid cherry-pick
  HOME="$T/$1" PI="$T/pi" STUB_REPOS="$R1 $R2" STUB_VERDICT="$2" STUB_MODE="${3:-}" GATE_REPOS="$R1 $R2" \
    LOG_DIR="$L" GAPS=/bin/true BENCH=/bin/true HARNESS_BENCH=/tmp bash "$SCRIPT"
  for r in "$R1" "$R2"; do  # operator work survives every outcome
    [ "$(cat "$r/a.txt")" = mine ] || fail "operator edit lost in $(basename "$r")" "$1"
    [ "$(cat "$r/keep.txt" 2>/dev/null)" = keep ] || fail "operator untracked lost in $(basename "$r")" "$1"
    [ "$(cat "$r/op.txt" 2>/dev/null)" = "$(printf 'op\nx')" ] || fail "operator's dirty file reverted/lost in $(basename "$r")" "$1"
    [ "$(git -C "$r" diff --cached --name-only)" = s.txt ] || fail "operator staging changed in $(basename "$r")" "$1"
    [ "$(git -C "$r" show HEAD:s.txt 2>/dev/null)" = "" ] || fail "operator staged file swept into a commit in $(basename "$r")" "$1"
  done
  grep -q "r1 ALERT operator's uncommitted files changed.*op.txt" "$L/nightly.log" || fail "no ALERT for op.txt" "$1"
}

check() {  # check <verdict> <label>
  run_case "$2" "$1"
  for r in "$R1" "$R2"; do
    n=$(basename "$r")
    [ "$(git -C "$r" log --format=%cn -1 --skip="$([ "$2" = CLEAR ] && echo 0 || echo 1)")" = nightly-dream ] \
      || fail "stage edits not attributed to nightly-dream in $n" "$2"
    if [ "$2" = CLEAR ]; then
      [ "$(cat "$r/b.txt")" = stage ] && [ -f "$r/new.txt" ] || fail "CLEAR edit did not stand in $n" "$2"
      continue
    fi
    [ "$(cat "$r/b.txt")" = orig ] || fail "stage edit not reverted in $n" "$2"
    [ ! -e "$r/new.txt" ] || fail "stage's new file not reverted in $n" "$2"
    grep -q "$n $2 — reverted stage commits" "$L/nightly.log" || fail "no $2 revert line for $n" "$2"
  done
}

check 'review...\nVERDICT: ATTACKS' ATTACKS
check 'Error: model not found' GATE_ERROR   # infra failure: no verdict line
check 'fine\nVERDICT: CLEAR' CLEAR

# stage rewrote history (amend of the operator's commit): nothing reverted, ALERT
run_case AMEND 'VERDICT: ATTACKS' amend
grep -q "r1 ALERT history rewritten" "$L/nightly.log" || fail "no ALERT for rewritten history" AMEND
! grep -q "reverted stage commits" "$L/nightly.log" || fail "reverted on rewritten history" AMEND

# operator mid cherry-pick in r2: stage edits there left alone, operator state untouched
run_case BUSY 'VERDICT: ATTACKS' busy
grep -q "r2 ALERT repo busy" "$L/nightly.log" || fail "no busy ALERT for r2" BUSY
[ -e "$R2/.git/CHERRY_PICK_HEAD" ] || fail "operator's cherry-pick state removed" BUSY
[ "$(cat "$R2/b.txt")" = stage ] || fail "busy repo touched" BUSY
grep -q "r1 ATTACKS — reverted stage commits" "$L/nightly.log" || fail "r1 not gated beside busy r2" BUSY
echo ok
