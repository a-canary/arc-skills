#!/bin/bash
# Low-disk relief (operator ruling repos-eupy, 2026-10-27): when / has < MIN_FREE free,
# an LLM picks entries under ~/trash and /tmp to delete until ~TARGET is freed.
# The LLM only chooses; this script enforces the allowlist and does the deletes.
# Cron: */10. Env: MIN_FREE_GB (1), TARGET_GB (5), DRY=1 to log picks without deleting.
set -uo pipefail
MIN_FREE_GB=${MIN_FREE_GB:-1}
TARGET_GB=${TARGET_GB:-5}
TRASH=${TRASH:-$HOME/trash}
TMPD=${TMPD:-/tmp}
LOG=${LOG:-$HOME/.cache/trash-pressure.log}
cd / || exit 1   # never let a relative path resolve against cron's cwd
mkdir -p "$HOME/.cache"; exec 9>"$HOME/.cache/trash-pressure.lock"; flock -n 9 || exit 0   # lock outside $TMPD so it is never a candidate
log() { echo "$(date -Is) $*" >> "$LOG"; }

free_kb=$(df --output=avail -k / | tail -1 | tr -d ' ')
case $free_kb in ''|*[!0-9]*) log "df failed: '$free_kb'"; exit 1;; esac
[ "$free_kb" -ge $((MIN_FREE_GB * 1024 * 1024)) ] && [ -z "${FORCE:-}" ] && exit 0
log "low disk: free=${free_kb}K; target ${TARGET_GB}G"

# A /tmp entry is live if it is a socket/pipe, a known session/service dir, or holds anything touched <24h.
live() {
  case ${1##*/} in tmux-*|ssh-*|claude-*|systemd-*|.X11-unix|.ICE-unix|*.lock|*.sock|*.pid) return 0;; esac
  [ -S "$1" ] || [ -p "$1" ] && return 0
  [ -n "$(find "$1" -mmin -1440 -print -quit 2>/dev/null)" ]
}

# Candidates: direct children of ~/trash (any age) and /tmp entries we own, untouched >24h.
# NUL-delimited; names with tab/newline are skipped so the tab/newline candidate table stays unambiguous.
cands=$( { find "$TRASH" -mindepth 1 -maxdepth 1 ! -name '*.REASON' -print0 2>/dev/null
           find "$TMPD" -mindepth 1 -maxdepth 1 -user "$(id -u)" -mmin +1440 -print0 2>/dev/null; } |
  while IFS= read -r -d '' p; do
    case $p in *$'\n'*|*$'\t'*) continue;; esac
    case $p in "$TMPD"/*) live "$p" && continue;; esac
    kb=$(du -sk -- "$p" 2>/dev/null | cut -f1)
    reason=$(head -c 200 "$p.REASON" 2>/dev/null | tr '\n\t' '  ')
    printf '%s\t%sK\t%s\t%s\n' "$p" "${kb:-0}" "$(date -r "$p" +%F)" "$reason"
  done | sort -t$'\t' -k2 -rn | head -200)
[ -z "$cands" ] && { log "no candidates"; exit 0; }
paths=$(cut -f1 <<<"$cands")

prompt="Disk / is nearly full. Pick paths to permanently delete, freeing about ${TARGET_GB}G.
Prefer: oldest ~/trash entries, then stale /tmp build/test dirs, worktree copies, caches, logs.
Avoid: anything that looks live or shared with other programs.
Candidates (path<TAB>size<TAB>mtime<TAB>reason):
$cands

Reply with ONLY the chosen paths, one per line, exactly as listed. No prose."
picks=$(printf '%s' "$prompt" | timeout 300 claude -p --model haiku --allowedTools "" 2>>"$LOG")

freed=0
while IFS= read -r p; do
  [ -z "$p" ] && continue
  # Allowlist: exact candidate path, and a direct child of TRASH or TMPD.
  grep -qxF -- "$p" <<<"$paths" || { log "reject non-candidate: $p"; continue; }
  case $p in "$TRASH"/*|"$TMPD"/*) ;; *) log "reject outside roots: $p"; continue;; esac
  case $p in "$TMPD"/*) live "$p" && { log "skip now-live: $p"; continue; };; esac
  kb=$(du -sk -- "$p" 2>/dev/null | cut -f1); kb=${kb:-0}
  extra=(); case $p in "$TRASH"/*) [ -e "$p.REASON" ] && extra=("$p.REASON");; esac
  if [ -n "${DRY:-}" ]; then log "dry: would delete $p (${kb}K)"
  elif rm -rf --one-file-system -- "$p" "${extra[@]}" 2>>"$LOG"; then log "deleted $p (${kb}K)"
  else log "delete failed: $p"; continue; fi
  freed=$((freed + kb))
  [ "$freed" -ge $((TARGET_GB * 1024 * 1024)) ] && break
done <<<"$picks"
log "done: freed ${freed}K; free now $(df --output=avail -k / | tail -1 | tr -d ' ')K"
