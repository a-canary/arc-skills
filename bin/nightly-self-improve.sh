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
# v2 routing (operator verdict arc-1d4 / bead arc-p81): each stage's attributed
# commits are classified by path. rule edits (GLOBAL-RULES/AGENTS/CLAUDE/CHOICES,
# rules/) are constitutional => always reverted. skill-only edits (every path a
# skills/<n>/SKILL.md or agents/<n>.md) must PROMOTE under skillopt-lite on that
# skill's frozen test split, else reverted; no split => fail closed (reverted).
# Everything else keeps the DefendGate. Plus ONE full harness-bench run per night.
SKILLOPT="${SKILLOPT:-$SCRIPT_DIR/../skills/skillopt-lite/skillopt.ts}"
SKILLOPT_DATA="${SKILLOPT_DATA:-$HOME/vault/skillopt}"  # <data>/<skill>/test.jsonl = frozen eval split
SKILLOPT_BASE="${SKILLOPT_BASE:-http://127.0.0.1:8099/v1/chat/completions}"  # laneproxy (:7890 retired)
SKILLOPT_REPLAY_MODEL="${SKILLOPT_REPLAY_MODEL:-$HYGIENE_MODEL}"
SKILLOPT_JUDGE_MODEL="${SKILLOPT_JUDGE_MODEL:-smart}"  # must differ from replay model (skillopt-lite rule)
HARNESS_BENCH="${HARNESS_BENCH:-$HOME/repos/harness-bench}"
BENCH="${BENCH:-$HARNESS_BENCH/bin/bench}"   # overridable for stub tests
BENCH_SUITE="${BENCH_SUITE:-core}"           # 68 tasks; 97-117 min on v100/local (runs.jsonl 10-28..10-31)
BENCH_MODEL="${BENCH_MODEL:-v100/local}"     # same model/suite stack-upgrade.py benches
DRY_RUN=0; [ "${1:-}" = --dry-run ] && { DRY_RUN=1; DRY_PATHS="${2:-}"; }

classify() {  # classify <repo-relative path> -> rule|skill|other
  case "$1" in
    GLOBAL-RULES.md|*/GLOBAL-RULES.md|AGENTS.md|*/AGENTS.md|CLAUDE.md|*/CLAUDE.md|CHOICES.md|*/CHOICES.md \
      |rules/*|*/rules/*|missions.md|user.md|USER.md) echo rule ;;
    skills/*/SKILL.md|agents/*.md|*/agents/*.md) echo skill ;;
    *) echo other ;;
  esac
}
skill_name() {  # skills/<n>/SKILL.md -> n ; .../agents/<n>.md -> n
  local p
  case "$1" in
    skills/*/SKILL.md) p="${1#skills/}"; echo "${p%%/*}" ;;
    *) p="${1##*/}"; echo "${p%.md}" ;;
  esac
}

if [ "$DRY_RUN" = 1 ]; then  # plan only: no model calls, no commits, no lock
  echo "nightly-self-improve v2 --dry-run $(date -Is)"
  echo "stages (model $HYGIENE_MODEL, 240m each): dream, token-waste -> adaptation-review (read-only) -> agent-gaps -> gap-remediate"
  echo "per editing stage: snap_heads -> run -> attribute -> route: rule=REVERT | skill-only=skillopt-lite | other=DefendGate($GATE_MODEL)"
  echo "repos: $GATE_REPOS"
  n=0; have=0
  for s in "$SCRIPT_DIR"/../skills/*/SKILL.md; do
    n=$((n+1)); [ -s "$SKILLOPT_DATA/$(basename "$(dirname "$s")")/test.jsonl" ] && have=$((have+1))
  done
  echo "skillopt eval splits: $have/$n arc-skills skills have $SKILLOPT_DATA/<skill>/test.jsonl (missing => fail closed)"
  if [ -n "$DRY_PATHS" ]; then
    echo "--- classify $DRY_PATHS (stage repo kind path -> action) ---"
    while IFS=$'\t' read -r st rp p; do
      [ -n "$p" ] || continue
      k=$(classify "$p")
      case "$k" in
        rule)  act="REVERT (rule edit, operator-gated)" ;;
        skill) sk=$(skill_name "$p")
               if [ -s "$SKILLOPT_DATA/$sk/test.jsonl" ]; then
                 act="skillopt: replay x2 ($SKILLOPT_REPLAY_MODEL) + judge ($SKILLOPT_JUDGE_MODEL) + gate on $(wc -l < "$SKILLOPT_DATA/$sk/test.jsonl") rows"
               else act="REVERT (no eval split for '$sk', fail closed)"; fi ;;
        *)     act="DefendGate $GATE_MODEL (30m)" ;;
      esac
      printf '%-14s %-11s %-6s %s -> %s\n' "$st" "$rp" "$k" "$p" "$act"
    done < "$DRY_PATHS"
  fi
  echo "bench (1/night, after stages): cd $HARNESS_BENCH && $BENCH run $BENCH_SUITE --model $BENCH_MODEL --label nightly-$(date +%Y%m%d)  [timeout 150m]"
  [ -x "$BENCH" ] && echo "bench binary: ok" || echo "bench binary: MISSING ($BENCH)"
  command -v bun > /dev/null && echo "bun: ok" || echo "bun: MISSING"
  exit 0
fi

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
  # Committer = nightly-<stage> marks any commit the stage makes itself, so gate()
  # can tell it from the operator's (env beats `-c user.name`; author untouched).
  GIT_COMMITTER_NAME="nightly-$1" GIT_COMMITTER_EMAIL="nightly@localhost" \
    timeout 240m "$PI" -p --model "$HYGIENE_MODEL" --tools $TOOLS "/$1" \
    < /dev/null >> "$LOG_DIR/$2" 2>&1
  local c=$?
  log_event "$NIGHTLY_LOG" "$1 exit=$c"
  [ "$c" -ne 0 ] && log_fail "$NIGHTLY_LOG" "$1" "$c"
  return 0
}

# Defense gate (defend skill, DefendMerge tier): independent fresh-context model
# attacks the stage's edits before they stand. Not CLEAR => `git revert` ONLY the
# stage's commits. Revert is additive and refuses rather than overwrite, so
# operator work and other writers are never destroyed (the old `reset --hard` +
# `checkout -- .` wiped uncommitted work 08-29..09-22).
# Attribution: adapters leave edits uncommitted, so attribute() commits, as
# committer nightly-<stage>, exactly the paths that were clean at the snapshot and
# dirty after the stage (`git commit -- <paths>` leaves other staged work alone).
# Paths the operator already had dirty can't be attributed: a change to them is
# logged ALERT and never touched. The revert runs on a scratch index, so the
# operator's staged work neither blocks it nor gets swept in. No VERDICT line = GATE_ERROR (infra), logged
# apart from ATTACKS. Rewritten history or an in-progress merge/rebase/cherry-pick
# => REVERT_REFUSED, left for a human.
# ponytail: another writer's edit to a clean path during the stage window is
# attributed to the stage too (worst case: reverted, still in history). Paths are
# line-delimited in the fingerprint, so a path containing a newline is mis-tracked.
dirt_paths() {  # dirt_paths <repo> — NUL-separated paths differing from HEAD, incl. untracked
  local e
  git -C "$1" status --porcelain -z -uall | while IFS= read -r -d '' e; do
    printf '%s\0' "${e:3}"
    case "${e:0:1}" in R|C) IFS= read -r -d '' _ ;; esac  # rename/copy: skip the old path
  done
}
fingerprint() {  # fingerprint <repo> — "hash<TAB>path" per dirty path, sorted
  local p
  dirt_paths "$1" | while IFS= read -r -d '' p; do
    printf '%s\t%s\n' "$(git -C "$1" hash-object -- "$p" 2>/dev/null || echo MISSING)" "$p"
  done | sort
}
busy() {  # busy <repo> — operator mid merge/rebase/cherry-pick/revert or holding the index lock
  local g; g=$(git -C "$1" rev-parse --absolute-git-dir)
  [ -e "$g/index.lock" ] || [ -e "$g/MERGE_HEAD" ] || [ -e "$g/CHERRY_PICK_HEAD" ] \
    || [ -e "$g/REVERT_HEAD" ] || [ -d "$g/rebase-merge" ] || [ -d "$g/rebase-apply" ]
}
snap_file() { echo "${SNAP_FILE}.$(printf '%s' "$1" | cksum | cut -d' ' -f1)"; }
snap_heads() {
  local repo
  for repo in $GATE_REPOS; do
    [ -d "$repo/.git" ] || continue
    echo "$repo $(git -C "$repo" rev-parse HEAD)"
    fingerprint "$repo" > "$(snap_file "$repo")"
  done > "${SNAP_FILE}"
}
attribute() {  # attribute <stage> — call after run(): commit the stage's edits to clean paths
  local stage="$1" repo pre name before now
  while read -r repo pre; do
    name=$(basename "$repo")
    before=$(snap_file "$repo"); now=$(fingerprint "$repo")
    # pre-existing dirt that changed or vanished: not attributable, never touched
    comm -23 "$before" <(printf '%s\n' "$now" | grep .) | cut -f2- | sort -u | grep . > "$before.alert"
    [ -s "$before.alert" ] && log_event "$NIGHTLY_LOG" "gate $stage: $name ALERT operator's uncommitted files changed during the stage (not reverted): $(head -5 "$before.alert" | tr '\n' ' ')"
    # paths clean at the snapshot and dirty now: the stage's
    printf '%s\n' "$now" | grep . | cut -f2- | sort | comm -13 <(cut -f2- "$before" | sort) - > "$before.new"
    [ -s "$before.new" ] || continue
    if busy "$repo"; then
      log_event "$NIGHTLY_LOG" "gate $stage: $name ALERT repo busy (merge/rebase/lock); stage edits left uncommitted and unreviewed: $(head -5 "$before.new" | tr '\n' ' ')"
      continue
    fi
    tr '\n' '\0' < "$before.new" | xargs -0 git -C "$repo" add -A -- \
      && tr '\n' '\0' < "$before.new" | GIT_COMMITTER_NAME="nightly-$stage" GIT_COMMITTER_EMAIL="nightly@localhost" \
           xargs -0 git -C "$repo" commit -q --no-verify -m "nightly $stage: stage edits (auto-attributed)" -- \
      || log_event "$NIGHTLY_LOG" "gate $stage: $name ALERT could not commit stage edits; left uncommitted and unreviewed"
  done < "${SNAP_FILE}"
}
revert_commits() {  # revert_commits <stage> <repo> <kind> <log> <commit...> — newest first
  local stage="$1" repo="$2" kind="$3" out="$4" name idx mine; shift 4
  mine="$*"; name=$(basename "$repo")
  log_fail "$NIGHTLY_LOG" "gate-$stage-$name" 1
  if busy "$repo"; then
    log_event "$NIGHTLY_LOG" "gate $stage: $name $kind — REVERT_REFUSED (repo busy: merge/rebase/cherry-pick/lock); commits left for a human: $mine"
    return
  fi
  # Revert on a scratch index = HEAD, so the operator's staged work neither blocks
  # the revert nor lands in it; then re-sync only the reverted paths in the real index.
  idx=$(mktemp)
  if GIT_INDEX_FILE="$idx" git -C "$repo" read-tree HEAD \
     && GIT_INDEX_FILE="$idx" git -C "$repo" revert --no-edit $mine > "$out.revert" 2>&1; then
    git -C "$repo" show --name-only --format= $mine | sort -u | tr '\n' '\0' \
      | xargs -0 git -C "$repo" reset -q HEAD -- 2>/dev/null
    log_event "$NIGHTLY_LOG" "gate $stage: $name $kind — reverted stage commits $mine. $(tail -c 300 "$out" 2>/dev/null | tr '\n' ' ')"
  else
    # abort only the sequence this revert started (busy() ruled out an operator's)
    [ -e "$(git -C "$repo" rev-parse --absolute-git-dir)/REVERT_HEAD" ] && GIT_INDEX_FILE="$idx" git -C "$repo" revert --abort
    log_event "$NIGHTLY_LOG" "gate $stage: $name $kind — REVERT_FAILED (see $out.revert); commits left for a human: $mine"
  fi
  rm -f "$idx"
}
skillopt_gate() {  # skillopt_gate <stage> <repo> <pre> <paths> <commit...> — every skill must PROMOTE
  local stage="$1" repo="$2" pre="$3" paths="$4" name p sk data w v arm fail="" out rows ntag t; shift 4
  name=$(basename "$repo"); out="$LOG_DIR/skillopt-$stage-$name.log"; : > "$out"
  w=$(mktemp -d)
  while IFS= read -r p; do
    sk=$(skill_name "$p"); data="$SKILLOPT_DATA/$sk/test.jsonl"
    if [ ! -s "$data" ]; then
      log_event "$NIGHTLY_LOG" "skillopt $stage: $name $sk NO_EVALSET ($data) — fail closed"; fail=1; continue
    fi
    if ! git -C "$repo" show "$pre:$p" > "$w/champion.md" 2>/dev/null; then
      log_event "$NIGHTLY_LOG" "skillopt $stage: $name $sk NEW_SKILL (no champion) — fail closed"; fail=1; continue
    fi
    cp "$repo/$p" "$w/challenger.md"
    # option C (arc-3or): cases come from the INCUMBENT spec (edit must not write its own tests); real uses first, cached synthetic cases top up to 16; on error fall back to real-only
    rows="$data"; ntag="real n=$(wc -l < "$data")"
    if t=$(bun "$SKILLOPT" topup --spec "$w/champion.md" --rows "$data" --out "$w/rows.jsonl" --target 16 \
        --cache-dir "$SKILLOPT_DATA/synthetic/$sk" --model "$SKILLOPT_REPLAY_MODEL" --base "$SKILLOPT_BASE" < /dev/null 2>&1 \
        | tee -a "$out" | grep -o 'real n=[0-9]* synthetic n=[0-9]*') && [ -n "$t" ]; then rows="$w/rows.jsonl"; ntag="$t"; fi
    for arm in champion challenger; do
      timeout 60m bun "$SKILLOPT" replay --spec "$w/$arm.md" --rows "$rows" --out "$w/r-$arm.jsonl" \
        --model "$SKILLOPT_REPLAY_MODEL" --base "$SKILLOPT_BASE" < /dev/null >> "$out" 2>&1
    done
    timeout 60m bun "$SKILLOPT" judge --rows "$rows" --a "$w/r-champion.jsonl" --b "$w/r-challenger.jsonl" \
      --model "$SKILLOPT_JUDGE_MODEL" --base "$SKILLOPT_BASE" --out "$w/verdicts.jsonl" < /dev/null >> "$out" 2>&1
    v=$(bun "$SKILLOPT" gate --verdicts "$w/verdicts.jsonl" 2>> "$out" | tee -a "$out" | grep -o '^\(PROMOTE\|HOLD\).*' | tail -1)
    log_event "$NIGHTLY_LOG" "skillopt $stage: $name $sk ${v:-GATE_ERROR} ($ntag)"
    case "$v" in PROMOTE*) ;; *) fail=1 ;; esac
    rm -f "$w"/*.md "$w"/*.jsonl
  done <<< "$paths"
  rm -f "$w"/*; rmdir "$w"
  if [ -z "$fail" ]; then log_event "$NIGHTLY_LOG" "gate $stage: $name SKILLOPT_PROMOTE — kept"
  else revert_commits "$stage" "$repo" SKILLOPT_HOLD "$out" "$@"; fi
}
route() {  # route <stage> — call after attribute(): rule=revert, skill-only=skillopt, rest=gate()
  local stage="$1" repo pre name mine paths kinds p
  : > "$SNAP_FILE.defend"
  while read -r repo pre; do
    name=$(basename "$repo")
    mine=$(git -C "$repo" log --format=%H --committer="^nightly-$stage <" "$pre..HEAD" 2>/dev/null)
    if ! git -C "$repo" merge-base --is-ancestor "$pre" HEAD || [ -z "$mine" ]; then
      echo "$repo $pre" >> "$SNAP_FILE.defend"; continue   # gate() owns the ALERT / no-op
    fi
    paths=$(git -C "$repo" show --name-only --format= $mine | sort -u | grep .)
    kinds=$(while IFS= read -r p; do classify "$p"; done <<< "$paths" | sort -u | tr '\n' ' ')
    case "$kinds" in
      *rule*)   log_event "$NIGHTLY_LOG" "route $stage: $name RULE_EDIT — rejected (rules are operator-gated): $(echo $paths)"
                revert_commits "$stage" "$repo" RULE_EDIT "$NIGHTLY_LOG" $mine ;;
      "skill ") log_event "$NIGHTLY_LOG" "route $stage: $name skill-only — skillopt-lite gate: $(echo $paths)"
                skillopt_gate "$stage" "$repo" "$pre" "$paths" $mine ;;
      *)        echo "$repo $pre" >> "$SNAP_FILE.defend" ;;
    esac
  done < "${SNAP_FILE}"
  gate "$stage" "$SNAP_FILE.defend"
}
bench_night() {  # ONE full harness-bench run per night (operator verdict arc-1d4); record-only
  local out="$LOG_DIR/bench.log" c q
  echo "== $(date -Is) bench $BENCH_SUITE $BENCH_MODEL" >> "$out"
  (cd "$HARNESS_BENCH" && timeout 150m "$BENCH" run "$BENCH_SUITE" --model "$BENCH_MODEL" \
     --label "nightly-$(date +%Y%m%d)" < /dev/null >> "$out" 2>&1)
  c=$?
  q=$(grep 'passed.*quality' "$out" | tail -1)
  log_event "$NIGHTLY_LOG" "bench exit=$c ${q:-NO_QUALITY}"
  { [ "$c" -ne 0 ] || [ -z "$q" ]; } && log_fail "$NIGHTLY_LOG" bench "$c"
  return 0
}
gate() {  # gate <stage> [snapfile] — call after attribute(); no-op when the stage committed nothing
  local stage="$1" repo pre mine name out verdict kind
  while read -r repo pre; do
    name=$(basename "$repo")
    mine=$(git -C "$repo" log --format=%H --committer="^nightly-$stage <" "$pre..HEAD")
    if ! git -C "$repo" merge-base --is-ancestor "$pre" HEAD; then
      log_event "$NIGHTLY_LOG" "gate $stage: $name ALERT history rewritten or branch moved during the stage (pre $pre not in HEAD); nothing reverted"
      log_fail "$NIGHTLY_LOG" "gate-$stage-$name" 1
      continue
    fi
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
    revert_commits "$stage" "$repo" "$kind" "$out" $mine
  done < "${2:-$SNAP_FILE}"
}

# Order matters: dream first, then token-waste — same daily journal.
log_event "$NIGHTLY_LOG" "nightly start"
SNAP_FILE="/tmp/gate-snap.$$"
snap_heads; run dream dream.log; attribute dream; route dream
export WASTE_DAY="$(date -d yesterday +%Y%m%d)"
snap_heads; run token-waste token-waste.log; attribute token-waste; route token-waste
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
attribute gap-remediate
route gap-remediate
rm -f "${SNAP_FILE}" "${SNAP_FILE}".*

# One full harness-bench run per night, AFTER all edits, so the score reflects
# tonight's stack (operator verdict arc-1d4). Record-only for now.
bench_night

log_event "$NIGHTLY_LOG" "nightly done (WASTE_DAY=$WASTE_DAY)"
