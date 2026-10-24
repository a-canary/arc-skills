#!/usr/bin/env bash
# defend-merge-guard.sh — PreToolUse(Bash): block `gh pr merge` unless the PR head
# carries a `defend/merge` success status, posted by bin/defend-receipt on the SHA the
# DefendMerge reviewer saw. A push after review leaves head without a receipt → blocked.
#
# ponytail: enforces that the review step happened, not that it was honest — the author
#   shares gh creds and could post the status itself. Adversarial-proof = reviewer-only token.
# ponytail: not covered: `gh api .../merge`, `git push origin main`, `command gh`, absolute-path
#   gh, xargs. Add pre-merge.sh / director-reconcile when those paths show up.
# ponytail: check→merge race on a push between the two; `--match-head-commit` closes it.
# ponytail: naive word split — quoted values with spaces can misparse; most such cases fail closed.
set -uo pipefail
payload="$(cat)"
command -v jq >/dev/null 2>&1 || { grep -q 'gh pr merge' <<<"$payload" && { echo "defend-merge-guard: jq missing — refusing merge" >&2; exit 2; }; exit 0; }
[ "$(jq -r '.tool_name // empty' <<<"$payload")" = Bash ] || exit 0
cmd=$(jq -r '.tool_input.command // empty' <<<"$payload")
dir=$(jq -r '.cwd // empty' <<<"$payload"); dir=${dir:-$PWD}

block() { echo "defend-merge-guard: $*" >&2; exit 2; }

check() {   # $1 selector (may be empty = current branch), $2 repo (may be empty), $3 dir
  local info sha url p state
  info=$(cd "$3" 2>/dev/null && gh pr view ${1:+"$1"} ${2:+-R "$2"} --json headRefOid,url 2>/dev/null) \
    || block "cannot resolve PR '${1:-<current branch>}' from $3 — add -R owner/repo"
  sha=$(jq -r '.headRefOid // empty' <<<"$info"); url=$(jq -r '.url // empty' <<<"$info")
  [ -n "$sha" ] && [ -n "$url" ] || block "gh pr view returned no head/url for '${1:-<current branch>}'"
  p=${url#https://github.com/}; p=${p%/pull/*}
  state=$(gh api "repos/$p/commits/$sha/status" 2>/dev/null \
    | jq -r '[.statuses[]? | select(.context=="defend/merge") | .state][0] // empty') \
    || block "cannot read commit status for $url — refusing merge"
  [ "$state" = success ] || block "$url head ${sha:0:7} has no defend/merge success receipt (state=${state:-none}).
Run DefendMerge (/hard-merge) with an independent reviewer; on CLEAR post:
  skills/defend/bin/defend-receipt CLEAR <pr> <reviewed-sha> -R $p \"<summary>\""
}

# segments split on ; & | ( ) and newlines; track `cd` so a bare `gh pr merge 5` resolves in the right repo
while IFS= read -r seg; do
  read -ra w <<<"$seg"
  envrepo=
  while [[ ${w[0]:-} =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do
    [[ ${w[0]} == GH_REPO=* ]] && envrepo=${w[0]#GH_REPO=}
    w=("${w[@]:1}")
  done
  if [ "${w[0]:-}" = cd ]; then
    d=${w[1]:-$HOME}; d=${d/#\~/$HOME}
    case $d in /*) dir=$d ;; *) dir=$dir/$d ;; esac
    continue
  fi
  [ "${w[0]:-} ${w[1]:-} ${w[2]:-}" = "gh pr merge" ] || continue
  sel= repo=$envrepo i=3
  while [ $i -lt ${#w[@]} ]; do
    a=${w[$i]}
    case $a in
      -R|--repo) repo=${w[$((i+1))]:-}; i=$((i+2)) ;;
      --repo=*) repo=${a#*=}; i=$((i+1)) ;;
      -b|--body|-F|--body-file|-t|--subject|-A|--author-email|--match-head-commit) i=$((i+2)) ;;
      -*) i=$((i+1)) ;;
      *) [ -n "$sel" ] || sel=$a; i=$((i+1)) ;;
    esac
  done
  check "$sel" "$repo" "$dir"
done < <(printf '%s\n' "$cmd" | sed 's/[;&|()]/\n/g')
exit 0
