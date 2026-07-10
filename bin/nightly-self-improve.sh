#!/usr/bin/env bash
# arc-skills nightly self-improvement: dream + token-waste + adaptation-review.
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
LOG_DIR="${LOG_DIR:-$HOME/.cache/arc-hygiene}"   # overridable for stub tests
mkdir -p "$LOG_DIR"
CLAUDE="${CLAUDE:-$HOME/.local/bin/claude}"      # overridable for stub tests
TOOLS="Read Write Edit Glob Grep Bash Task"

# One instance at a time — a hung run must not stack with the next cron fire.
exec 9>"/tmp/nightly-self-improve.lock"
if ! flock -n 9; then
  echo "[$(date -u +%FT%TZ)] SELFIMPROVE_FAIL stage=lock exit=locked (previous run still holds the lock)" >> "$LOG_DIR/nightly.log"
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
  echo "[$(date -u +%FT%TZ)] $1 exit=$c" >> "$LOG_DIR/nightly.log"
  if [ "$c" -ne 0 ]; then
    echo "[$(date -u +%FT%TZ)] SELFIMPROVE_FAIL stage=$1 exit=$c" >> "$LOG_DIR/nightly.log"
  fi
}

# Order matters: dream first, then token-waste — same daily journal.
echo "[$(date -u +%FT%TZ)] nightly start" >> "$LOG_DIR/nightly.log"
run dream dream.log
export WASTE_DAY="$(date -d yesterday +%Y%m%d)"
run token-waste token-waste.log
# Safety net LAST: audit the trailing window (incl. tonight's two edits) for
# regressions. Read-only — spawns a reviewer subagent, makes no edits itself.
export REVIEW_DAY="$(date -d yesterday +%F)"
run adaptation-review adaptation-review.log
echo "[$(date -u +%FT%TZ)] nightly done (WASTE_DAY=$WASTE_DAY)" >> "$LOG_DIR/nightly.log"
