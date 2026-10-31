#!/usr/bin/env bash
# arc-skills nightly self-improvement: dream + token-waste + adaptation-review
# + agent knowledge-gap loop (extract-agent-gaps.py collector → /gap-remediate adaptor).
# Fires at 03:00 local; analyzes the day that just ended.
#   - dream is mtime-incremental (no date arg; picks up everything since last run)
#   - token-waste needs WASTE_DAY=yesterday or it only sees hours since midnight
#   - adaptation-review runs LAST and read-only: audits the trailing 10d of the
#     two adapters' edits for regressions/side-effects. REVIEW_DAY=yesterday so it
#     includes the night's own two changes in the window.
# The two adapters each make ONE edit; adaptation-review makes none (reports only).
# Unattended: runs via `pi -p` (print mode auto-approves tools) with a scoped
# --tools allowlist. Operational structure (captain 2026-08-28): Driver.Qwen +
# Defense Gate — the adapters (driver/workers) run on the private v100 lane
# (v100/queue: Qwen3.8-27B on ai-lab-02 via the :8099 laneproxy; the old
# arc-proxy/driver alias was retired and failed every stage 09-18..09-22), and after each editing stage an independent fresh-context model
# (DefendMerge tier, defend skill) attacks the stage's diff; ATTACKS => reset
# to pre-stage HEAD. Proxy routing per standing plan 2026-08-30 (replaces the
# 2026-08-27 direct-provider plan; the proxy hop is now mandatory for the
# factory lane so slots + audit logging are enforced). opus defense lane is
# dead machine-wide, so the gate runs on the same workhorse in a fresh session
# — GATE_MODEL overrides when opus returns.
# Review output via the daily journal (~/.claude/dream/journal/YYYY-MM-DD.md)
# and ~/.cache/arc-hygiene/*.log.
#
# Canonical + live copy: ~/repos/arc-skills/bin/nightly-self-improve.sh
# Cron invokes this repo path directly (no ~/.config mirror — the old symlink
# mirror was a drift trap and was removed 2026-08-27).
set -uo pipefail
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
_lib="$SCRIPT_DIR/lib/log-event.sh"
. "$_lib" || { echo "FATAL: cannot source $_lib" >&2; exit 1; }
LOG_DIR="${LOG_DIR:-$HOME/.cache/arc-hygiene}"   # overridable for stub tests
mkdir -p "$LOG_DIR"
NIGHTLY_LOG="$LOG_DIR/nightly.log"
PI="${PI:-/usr/local/lib/node_modules/node/bin/pi}"  # overridable for stub tests
HYGIENE_MODEL="${HYGIENE_MODEL:-v100/queue}"  # Driver: private background lane (private repos -> v100 only)
GATE_MODEL="${GATE_MODEL:-v100/queue}"        # DefendMerge tier: fresh context, same private lane
GATE_REPOS="${GATE_REPOS:-$HOME/repos/arc-skills $HOME/repos/arc-agents $HOME/.pi/agent $HOME/vault}"
TOOLS="read,bash,edit,write"

# One instance at a time — a hung run must not stack with the next cron fire.
exec 9>"/tmp/nightly-self-improve.lock"
if ! flock -n 9; then
  log_event "$NIGHTLY_LOG" "$SELFIMPROVE_FAIL stage=lock exit=locked (previous run still holds the lock)"
  exit 0
fi

run() {  # run() <skill> <logfile>
  echo "== $(date -Is) /$1" >> "$LOG_DIR/$2"
  # 240m: slow local lane (single-slot box, minutes per idle prompt, queue-wait
  # when the box is busy). dream is incremental (processed.json) so a
  # timeout-killed run resumes next night.
  timeout 240m "$PI" -p --model "$HYGIENE_MODEL" --tools $TOOLS "/$1" \
    >> "$LOG_DIR/$2" 2>&1
  local c=$?
  log_event "$NIGHTLY_LOG" "$1 exit=$c"
  [ "$c" -ne 0 ] && log_fail "$NIGHTLY_LOG" "$1" "$c"
  return 0
}

# Defense gate (defend skill, DefendMerge tier): independent fresh-context model
# attacks the stage's edits before they stand. Adapters commit their own single
# edit; the gate reviews everything since the snapshot (commits + uncommitted).
# Not CLEAR => revert ONLY the stage's edits: HEAD back to pre, tracked files back
# to the snapshot (pre-existing uncommitted work survives; it lost data 08-29..09-22
# when `checkout -- .` wiped it), and files that appeared during the stage moved to
# ~/trash. No VERDICT line = GATE_ERROR (infra), logged apart from ATTACKS.
# ponytail: a pre-existing untracked file the stage edits or deletes is not restored
# (no content snapshot of untracked files); add a tar of them if that ever bites.
snap_heads() {
  local repo head wip
  for repo in $GATE_REPOS; do
    [ -d "$repo/.git" ] || continue
    head=$(git -C "$repo" rev-parse HEAD)
    # stash create: commit object of the dirty tracked tree, no ref, stash stack untouched
    wip=$(git -C "$repo" stash create)
    echo "$repo $head ${wip:-$head}"
    git -C "$repo" ls-files --others --exclude-standard | sort > "$(untracked_list "$repo")"
  done > "${SNAP_FILE}"
}
untracked_list() { echo "${SNAP_FILE}.u.$(printf '%s' "$1" | cksum | cut -d' ' -f1)"; }
new_untracked() {  # files untracked now that were not untracked at snapshot
  git -C "$1" ls-files --others --exclude-standard | sort | comm -13 "$(untracked_list "$1")" -
}
gate() {  # gate <stage> — call after run(); no-op when the stage edited nothing
  local stage="$1" repo pre base diff verdict untracked kind q f
  while read -r repo pre base; do
    diff=$(git -C "$repo" diff "$base")  # snapshot tree vs working tree: commits + uncommitted
    untracked=$(new_untracked "$repo")
    [ -n "$diff" ] || [ -n "$untracked" ] || continue
    log_event "$NIGHTLY_LOG" "gate $stage: edits in $(basename "$repo") — dispatching DefendGate ($GATE_MODEL)"
    verdict=$(timeout 30m "$PI" -p --model "$GATE_MODEL" --tools read,bash \
      "You are an independent defense gate (DefendMerge tier, defend skill). The nightly self-heal stage '$stage' just made these edits in $repo. Contract: at most ONE narrow system improvement; no regression to documented behavior; no rule bloat.\nDIFF (truncated 20k): $(printf '%s' "$diff" | head -c 20000)\nUNTRACKED ADDED: $(printf '%s' "${untracked:-none}" | head -20)\nMandatory lenses — answer each explicitly, 'no findings' is valid per lens: (1) does it break existing documented behavior? (2) is it more than one narrow change? (3) does it contradict AGENTS.md rules? Then free attack on anything else. Your final line must be exactly: VERDICT: CLEAR  or  VERDICT: ATTACKS" \
      2>&1 | tail -8)
    if printf '%s' "$verdict" | grep -q "VERDICT: CLEAR"; then
      log_event "$NIGHTLY_LOG" "gate $stage: $(basename "$repo") CLEAR"
      continue
    fi
    printf '%s' "$verdict" | grep -q "VERDICT: ATTACKS" && kind=ATTACKS || kind=GATE_ERROR
    git -C "$repo" reset -q "$pre"              # HEAD + index back; working tree untouched
    git -C "$repo" checkout -q "$base" -- .     # tracked files back to the snapshot
    git -C "$repo" reset -q                     # unstage (pre-existing staging becomes unstaged)
    # after the reset, files the stage added (even committed ones) are untracked: move them out
    q="$HOME/trash/$(date +%s)_gate-quarantine-$stage/$(basename "$repo")"
    new_untracked "$repo" | while IFS= read -r f; do
      mkdir -p "$q/$(dirname "$f")" && mv -- "$repo/$f" "$q/$f"
    done
    [ -d "$q" ] && log_event "$NIGHTLY_LOG" "gate $stage: $(basename "$repo") new files quarantined to $q"
    log_fail "$NIGHTLY_LOG" "gate-$stage-$(basename "$repo")" 1
    log_event "$NIGHTLY_LOG" "gate $stage: $(basename "$repo") $kind — stage edits reverted. $(printf '%s' "$verdict" | tr '\n' ' ' | tail -c 400)"
  done < "${SNAP_FILE}"
}

# Order matters: dream first, then token-waste — same daily journal.
log_event "$NIGHTLY_LOG" "nightly start"
SNAP_FILE="/tmp/gate-snap.$$"
snap_heads; run dream dream.log; gate dream
export WASTE_DAY="$(date -d yesterday +%Y%m%d)"
snap_heads; run token-waste token-waste.log; gate token-waste
# Safety net LAST: audit the trailing window (incl. tonight's two edits) for
# regressions. Read-only — spawns a reviewer subagent, makes no edits itself.
export REVIEW_DAY="$(date -d yesterday +%F)"
run adaptation-review adaptation-review.log

# Knowledge-gap loop (CAM): the AGENT's own confusion — facts it got wrong, was
# uncertain on, or the user had to correct — mined nightly and remediated.
#   stage 1 (collector, slow lane via arc-llm-proxy :8091): extract-agent-gaps.py
#     reads yesterday's sessions (claude + pi), appends dense gap lines to
#     ~/.claude/dream/agent-gaps.log. Its own timeout — run() wraps pi only.
#     Slow-burn, non-urgent.
#   stage 2+3 (adaptor, hygiene alias): /gap-remediate ranks the log by
#     severity×frequency, picks the top gap, checks AGENTS.md/MEMORY.md/ke, and
#     makes ONE add-or-clarify edit, logging the decision back. Runs via run().
GAPS="${GAPS:-$SCRIPT_DIR/extract-agent-gaps.py}"
echo "== $(date -Is) agent-gaps (slow lane)" >> "$LOG_DIR/agent-gaps.log"
timeout 120m python3 "$GAPS" >> "$LOG_DIR/agent-gaps.log" 2>&1
gc=$?
log_event "$NIGHTLY_LOG" "agent-gaps exit=$gc"
[ "$gc" -ne 0 ] && log_fail "$NIGHTLY_LOG" agent-gaps "$gc"
# gap-remediate is the second editing stage — same gate treatment.
snap_heads
run gap-remediate gap-remediate.log
gate gap-remediate
rm -f "${SNAP_FILE}" "${SNAP_FILE}".u.*

log_event "$NIGHTLY_LOG" "nightly done (WASTE_DAY=$WASTE_DAY)"
