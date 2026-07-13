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
# Unattended, so it runs with --permission-mode acceptEdits and a scoped
# --allowedTools list (NOT --dangerously-skip-permissions). Review output via the
# daily journal (~/.claude/dream/journal/YYYY-MM-DD.md) and ~/.cache/arc-hygiene/*.log.
#
# Canonical copy: ~/repos/arc-skills/bin/nightly-self-improve.sh
# Deployed via symlink from ~/.config/arc-hygiene/nightly-self-improve.sh —
# edit here, never the symlink target's directory.
set -uo pipefail
_lib="$(dirname "$(readlink -f "$0")")/lib/log-event.sh"
. "$_lib" || { echo "FATAL: cannot source $_lib" >&2; exit 1; }
LOG_DIR="${LOG_DIR:-$HOME/.cache/arc-hygiene}"   # overridable for stub tests
mkdir -p "$LOG_DIR"
NIGHTLY_LOG="$LOG_DIR/nightly.log"
CLAUDE="${CLAUDE:-$HOME/.local/bin/claude}"      # overridable for stub tests
TOOLS="Read Write Edit Glob Grep Bash Task"

# One instance at a time — a hung run must not stack with the next cron fire.
exec 9>"/tmp/nightly-self-improve.lock"
if ! flock -n 9; then
  log_event "$NIGHTLY_LOG" "$SELFIMPROVE_FAIL stage=lock exit=locked (previous run still holds the lock)"
  exit 0
fi

run() {  # run() <skill> <logfile>
  echo "== $(date -Is) /$1" >> "$LOG_DIR/$2"
  # 90m = ~3.5x observed max stage duration (dream p-max 25m over 6 nights to 2026-07-06).
  # dream is incremental (processed.json) so a timeout-killed run resumes next night.
  timeout 90m "$CLAUDE" -p "/$1" \
    --permission-mode acceptEdits \
    --allowedTools $TOOLS \
    >> "$LOG_DIR/$2" 2>&1
  local c=$?
  log_event "$NIGHTLY_LOG" "$1 exit=$c"
  [ "$c" -ne 0 ] && log_fail "$NIGHTLY_LOG" "$1" "$c"
  return 0
}

# Order matters: dream first, then token-waste — same daily journal.
log_event "$NIGHTLY_LOG" "nightly start"
run dream dream.log
export WASTE_DAY="$(date -d yesterday +%Y%m%d)"
run token-waste token-waste.log
# Safety net LAST: audit the trailing window (incl. tonight's two edits) for
# regressions. Read-only — spawns a reviewer subagent, makes no edits itself.
export REVIEW_DAY="$(date -d yesterday +%F)"
run adaptation-review adaptation-review.log

# Knowledge-gap loop (CAM): the AGENT's own confusion — facts it got wrong, was
# uncertain on, or the user had to correct — mined nightly and remediated.
#   stage 1 (collector, featherless Qwen3-32B): extract-agent-gaps.py reads
#     yesterday's sessions, appends dense gap lines to ~/.claude/dream/agent-gaps.log.
#     Its own timeout — run() wraps claude only. Slow-burn, non-urgent.
#   stage 2+3 (adaptor, Opus): /gap-remediate ranks the log by severity×frequency,
#     picks the top gap, checks AGENTS.md/MEMORY.md/ke, and makes ONE add-or-clarify
#     edit, logging the decision back. Runs via run() (claude -p, acceptEdits).
GAPS="${GAPS:-$HOME/.config/arc-hygiene/extract-agent-gaps.py}"
echo "== $(date -Is) agent-gaps (featherless)" >> "$LOG_DIR/agent-gaps.log"
timeout 30m python3 "$GAPS" >> "$LOG_DIR/agent-gaps.log" 2>&1
gc=$?
log_event "$NIGHTLY_LOG" "agent-gaps exit=$gc"
[ "$gc" -ne 0 ] && log_fail "$NIGHTLY_LOG" agent-gaps "$gc"
run gap-remediate gap-remediate.log

log_event "$NIGHTLY_LOG" "nightly done (WASTE_DAY=$WASTE_DAY)"
