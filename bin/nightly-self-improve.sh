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
  # Committer = nightly-<stage>: how gate() tells the stage's commits from the
  # operator's and other crons' (env beats `-c user.name`; author is left alone).
  GIT_COMMITTER_NAME="nightly-$1" GIT_COMMITTER_EMAIL="nightly@localhost" \
    timeout 240m "$PI" -p --model "$HYGIENE_MODEL" --tools $TOOLS "/$1" \
    < /dev/null >> "$LOG_DIR/$2" 2>&1
  local c=$?
  log_event "$NIGHTLY_LOG" "$1 exit=$c"
  [ "$c" -ne 0 ] && log_fail "$NIGHTLY_LOG" "$1" "$c"
  return 0
}

# Defense gate (defend skill, DefendMerge tier): independent fresh-context model
# attacks the stage's commits before they stand. Not CLEAR => `git revert` ONLY
# the commits the stage made (committer nightly-<stage>). Revert is additive and
# refuses rather than overwrite anything, so operator work and other writers are
# never touched (the old `reset --hard` + `checkout -- .` wiped uncommitted work
# 08-29..09-22). Anything that cannot be reverted cleanly is left in place and
# logged REVERT_FAILED / REVERT_REFUSED for a human. Uncommitted or untracked
# changes that appear during a stage are not attributable: logged as ALERT, never
# touched. No VERDICT line = GATE_ERROR (infra), logged apart from ATTACKS.
# ponytail: an adapter that `git add -A`s sweeps operator dirt into its commit;
# reverting that commit drops the dirt from the tree (it stays in the commit, sha logged).
snap_heads() {
  local repo
  for repo in $GATE_REPOS; do
    [ -d "$repo/.git" ] || continue
    echo "$repo $(git -C "$repo" rev-parse HEAD) $(branch_of "$repo")"
    git -C "$repo" status --porcelain | sort > "$(dirt_list "$repo")"
  done > "${SNAP_FILE}"
}
branch_of() { git -C "$1" symbolic-ref -q --short HEAD || echo DETACHED; }
dirt_list() { echo "${SNAP_FILE}.d.$(printf '%s' "$1" | cksum | cut -d' ' -f1)"; }
gate() {  # gate <stage> — call after run(); no-op when the stage edited nothing
  local stage="$1" repo pre branch mine new name out verdict kind
  while read -r repo pre branch; do
    name=$(basename "$repo")
    mine=$(git -C "$repo" log --format=%H --committer="^nightly-$stage <" "$pre..HEAD")
    new=$(git -C "$repo" status --porcelain | sort | comm -13 "$(dirt_list "$repo")" -)
    [ -n "$new" ] && log_event "$NIGHTLY_LOG" "gate $stage: $name ALERT uncommitted changes appeared during the stage (not attributable, not reverted): $(printf '%s' "$new" | head -5 | tr '\n' ' ')"
    [ -n "$mine" ] || continue
    log_event "$NIGHTLY_LOG" "gate $stage: $(echo "$mine" | wc -l) commit(s) in $name — dispatching DefendGate ($GATE_MODEL)"
    out="$LOG_DIR/gate-$stage-$name.log"
    timeout 30m "$PI" -p --model "$GATE_MODEL" --tools read,bash \
      "You are an independent defense gate (DefendMerge tier, defend skill). The nightly self-heal stage '$stage' just made these commits in $repo. Contract: at most ONE narrow system improvement; no regression to documented behavior; no rule bloat.\nCOMMITS (truncated 20k): $(git -C "$repo" show $mine | head -c 20000)\nMandatory lenses — answer each explicitly, 'no findings' is valid per lens: (1) does it break existing documented behavior? (2) is it more than one narrow change? (3) does it contradict AGENTS.md rules? Then free attack on anything else. Your final line must be exactly: VERDICT: CLEAR  or  VERDICT: ATTACKS" \
      < /dev/null > "$out" 2>&1
    # last VERDICT anywhere: hook chatter after it must not turn a verdict into an error
    verdict=$(grep -o 'VERDICT: \(CLEAR\|ATTACKS\)' "$out" | tail -1)
    case "$verdict" in
      "VERDICT: CLEAR") log_event "$NIGHTLY_LOG" "gate $stage: $name CLEAR"; continue ;;
      "VERDICT: ATTACKS") kind=ATTACKS ;;
      *) kind=GATE_ERROR ;;
    esac
    log_fail "$NIGHTLY_LOG" "gate-$stage-$name" 1
    if [ "$(branch_of "$repo")" != "$branch" ]; then
      log_event "$NIGHTLY_LOG" "gate $stage: $name $kind — REVERT_REFUSED (branch $branch -> $(branch_of "$repo")); commits left for a human: $(echo $mine)"
    elif git -C "$repo" revert --no-edit $mine > "$out.revert" 2>&1; then  # newest first
      log_event "$NIGHTLY_LOG" "gate $stage: $name $kind — reverted stage commits $(echo $mine). $(tail -c 300 "$out" | tr '\n' ' ')"
    else
      git -C "$repo" revert --abort 2>/dev/null
      log_event "$NIGHTLY_LOG" "gate $stage: $name $kind — REVERT_FAILED (see $out.revert); commits left for a human: $(echo $mine)"
    fi
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
rm -f "${SNAP_FILE}" "${SNAP_FILE}".d.*

log_event "$NIGHTLY_LOG" "nightly done (WASTE_DAY=$WASTE_DAY)"
