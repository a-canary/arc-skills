#!/usr/bin/env bash
# Reconcile .arc/director/inflight.md against GitHub truth before gap analysis.
# Any row mentioning "PR #N" where gh reports N as MERGED gets rewritten into a
# "## Recently closed" section instead of sitting under "Pending operator action".
# Fail-open: if gh is unavailable or unauthenticated, exit 0 leaving the file
# untouched — the tick proceeds as if reconcile hadn't run.
#
# Usage: reconcile.sh <repo-root>
# Prints one reconcile event line (jsonl) per row it moved, for the caller to
# append to .arc/events.jsonl. Prints nothing on a no-op tick.

set -uo pipefail

repo_root="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
inflight="$repo_root/.arc/director/inflight.md"

[ -f "$inflight" ] || exit 0
command -v gh >/dev/null 2>&1 || exit 0
gh auth status >/dev/null 2>&1 || exit 0

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

moved_any=0
closed_lines=""

while IFS= read -r line; do
  pr_num="$(printf '%s' "$line" | grep -oE '#[0-9]+' | head -1 | tr -d '#')"
  if [ -n "$pr_num" ] && printf '%s' "$line" | grep -qi 'OPEN\|pending.*operator\|awaiting.*merge'; then
    state="$(gh pr view "$pr_num" --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)" --json state,mergedAt -q '.state' 2>/dev/null || echo "")"
    if [ "$state" = "MERGED" ]; then
      merged_at="$(gh pr view "$pr_num" --json mergedAt -q '.mergedAt' 2>/dev/null || echo "")"
      closed_lines="${closed_lines}- PR #${pr_num} MERGED ${merged_at} — reconciled from stale row: ${line}\n"
      ts="$(date -u -Is 2>/dev/null || echo unknown)"
      echo "{\"type\":\"reconcile.moved\",\"ts\":\"${ts}\",\"pr\":${pr_num},\"before\":$(printf '%s' "$line" | jq -Rs . 2>/dev/null || printf '"%s"' "$line")}"
      moved_any=1
      continue
    fi
  fi
  printf '%s\n' "$line" >> "$tmp"
done < "$inflight"

[ "$moved_any" -eq 1 ] || exit 0

if grep -q '^## Recently closed' "$tmp"; then
  awk -v add="$closed_lines" '
    /^## Recently closed/ { print; printf "%s", add; next }
    { print }
  ' "$tmp" > "${tmp}.2" && mv "${tmp}.2" "$tmp"
else
  {
    cat "$tmp"
    printf '\n## Recently closed\n%b' "$closed_lines"
  } > "${tmp}.2"
  mv "${tmp}.2" "$tmp"
fi

mv "$tmp" "$inflight"
trap - EXIT
