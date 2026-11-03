#!/usr/bin/env bash
# test_learn_recall.sh — learn-recall.sh stop: blocks only non-trivial turns that banked nothing.
set -u
H="$(dirname "$0")/learn-recall.sh"
D="$(mktemp -d)"; fail=0
p() { printf '{"type":"user","message":{"content":"%s"}}\n' "$1"; }
tool() { printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"%s","input":{"command":"%s"}}]}}\n' "$1" "$2"
  printf '{"type":"user","message":{"content":[{"type":"tool_result","content":"x"}]}}\n'; }
say() { printf '{"type":"assistant","message":{"content":[{"type":"text","text":"%s"}]}}\n' "$1"; }
run() { printf '{"transcript_path":"%s","stop_hook_active":%s}' "$D/t" "${3:-false}" | bash "$H" stop | grep -q block && got=block || got=ok
  [ "$got" = "$1" ] && echo "pass: $2" || { echo "FAIL: $2 (want $1 got $got)"; fail=1; }; }
five() { for i in 1 2 3 4 5; do tool Bash "ls"; done; }

{ p "old task"; five; p "check status"; tool Bash "ls"; say "fine"; } > "$D/t"; run ok "trivial turn (1 tool) allowed; earlier turn ignored"
{ p "do work"; five; say "done"; } > "$D/t"; run block "5 tools, nothing banked -> block"
run ok "stop_hook_active -> allow (loop guard)" true
{ p "do work"; five; tool Bash "ke learn 'x'"; say "done"; } > "$D/t"; run ok "ke learn banks"
{ p "do work"; five; tool Bash "cd r && bd create 'f'"; say "done"; } > "$D/t"; run ok "bd create banks"
{ p "do work"; five; tool Bash 'for c in \"bd remember\"; do :; done'; say "done"; } > "$D/t"; run block "quoted mention is not banking"
{ p "do work"; tool Edit ""; say "done"; } > "$D/t"; run block "one Edit, nothing banked -> block"
{ p "do work"; five; say "done. learn: none"; } > "$D/t"; run ok "learn: none opt-out"
bash "$H" start </dev/null | grep -q 'ke research' && echo "pass: start reminder" || { echo "FAIL: start reminder"; fail=1; }
mv "$D" "${TMPDIR:-/tmp}/learn-recall-test.$$.done" 2>/dev/null
exit $fail
