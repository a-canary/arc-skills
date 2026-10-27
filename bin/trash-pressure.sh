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
exec 9>"${TMPDIR:-/tmp}/trash-pressure.lock"; flock -n 9 || exit 0
log() { echo "$(date -Is) $*" >> "$LOG"; }

free_kb=$(df --output=avail -k / | tail -1 | tr -d ' ')
[ "$free_kb" -ge $((MIN_FREE_GB * 1024 * 1024)) ] && [ -z "${FORCE:-}" ] && exit 0
log "low disk: free=${free_kb}K < ${MIN_FREE_GB}G; target ${TARGET_GB}G"

# Candidates: direct children of ~/trash (any age) and /tmp entries we own, untouched >24h.
cands=$( { find "$TRASH" -mindepth 1 -maxdepth 1 -printf '%p\n' 2>/dev/null
           find "$TMPD" -mindepth 1 -maxdepth 1 -user "$(id -u)" -mmin +1440 -printf '%p\n' 2>/dev/null; } |
  while read -r p; do
    kb=$(du -sk -- "$p" 2>/dev/null | cut -f1)
    reason=$(head -c 200 "$p.REASON" 2>/dev/null | tr '\n' ' ')
    printf '%s\t%sK\t%s\t%s\n' "$p" "$kb" "$(date -r "$p" +%F)" "$reason"
  done | sort -t$'\t' -k2 -rn | head -200)
[ -z "$cands" ] && { log "no candidates"; exit 0; }

prompt="Disk / is nearly full. Pick paths to permanently delete, freeing about ${TARGET_GB}G.
Prefer: oldest ~/trash entries, then stale /tmp build/test dirs, worktree copies, caches, logs.
Avoid: sockets, lock files, anything that looks live (recent date, *.sock, *.lock, tmux/ssh/systemd dirs).
Candidates (path<TAB>size<TAB>mtime<TAB>reason):
$cands

Reply with ONLY the chosen paths, one per line, exactly as listed. No prose."
picks=$(printf '%s' "$prompt" | timeout 300 claude -p --model haiku --allowedTools "" 2>>"$LOG")

freed=0
while read -r p; do
  [ -z "$p" ] && continue
  # Allowlist: must be an exact candidate path (blocks hallucinated or traversal paths).
  grep -qxF -- "$p" <(cut -f1 <<<"$cands") || { log "reject non-candidate: $p"; continue; }
  kb=$(du -sk -- "$p" 2>/dev/null | cut -f1)
  if [ -n "${DRY:-}" ]; then log "dry: would delete $p (${kb}K)"
  else rm -rf -- "$p" "$p.REASON" && log "deleted $p (${kb}K)"; fi
  freed=$((freed + ${kb:-0}))
  [ "$freed" -ge $((TARGET_GB * 1024 * 1024)) ] && break
done <<<"$picks"
log "done: freed ${freed}K; free now $(df --output=avail -k / | tail -1 | tr -d ' ')K"
