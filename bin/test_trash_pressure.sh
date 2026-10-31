#!/usr/bin/env bash
# test_trash_pressure.sh — age floor + incomplete-entry exclusion for trash-pressure.sh (DRY, fake claude picks everything offered).
set -u
BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/trash-pressure.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home" "$T/trash" "$T/tmp" "$T/shim"
printf '#!/usr/bin/env bash\nawk -F"\\t" "NF>=4 {print \\$1}"\n' > "$T/shim/claude"; chmod +x "$T/shim/claude"

entry() {  # entry <name> <age-days> [reason.md line]
  mkdir -p "$T/trash/$1"; head -c 4096 /dev/zero > "$T/trash/$1/item"
  [ -n "${3:-}" ] && echo "$3" > "$T/trash/$1/reason.md"
  touch -d "$2 days ago" "$T/trash/$1"
}
entry old 10; entry young 0; entry partial 10 "status: incomplete (mv failed mid-move)"
head -c 65536 /dev/zero >> "$T/trash/young/item"   # bigger young: size order alone would put it first

run() {  # run <TARGET_GB> -> log text
  : > "$T/log"
  HOME="$T/home" TRASH="$T/trash" TMPD="$T/tmp" LOG="$T/log" FORCE=1 DRY=1 TARGET_GB="$1" \
    PATH="$T/shim:$PATH" bash "$BIN"
  cat "$T/log"
}
failed=0; fail() { echo "FAIL: $*"; failed=1; }

log=$(run 0)   # older entries already cover the target: young stays out
grep -q "would delete $T/trash/old " <<<"$log" || fail "old entry not offered"
grep -q "/trash/young " <<<"$log" && fail "young entry offered though old entries cover the target"

log=$(run 1)   # 1G target, old entries hold KB: floor relaxes
grep -q "would delete $T/trash/young " <<<"$log" || fail "young entry not offered after relaxing"
grep -q "age floor relaxed" <<<"$log" || fail "relaxing not logged"
order=$(grep -o "would delete $T/trash/[a-z]*" <<<"$log" | sed 's|.*/||' | tr '\n' ' ')
[ "$order" = "old young " ] || fail "old entries not offered before young ones (got: $order)"

grep -q "/trash/partial " <<<"$(run 0; run 1)" && fail "incomplete entry offered"

[ "$failed" -eq 0 ] && echo "trash-pressure: ok"
exit "$failed"
