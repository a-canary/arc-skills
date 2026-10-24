#!/usr/bin/env bash
# defend-merge-guard.sh — PreToolUse(Bash): block `gh pr merge` unless the PR head
# carries a `defend/merge` success status, posted by bin/defend-receipt on the SHA the
# DefendMerge reviewer saw. A push after review leaves head without a receipt → blocked.
#
# ponytail: enforces that the review step happened, not that it was honest — the author
#   shares gh creds and could post the status itself. Adversarial-proof = reviewer-only token.
# ponytail: not covered: `gh api .../merge`, `git push origin main`, `eval`/variables holding
#   the command. Add pre-merge.sh / director-reconcile when those paths show up.
# ponytail: check→merge race on a push between the two; `--match-head-commit` closes it.
# ponytail: quoted strings collapse to one token (no spaces/separators) — paths with spaces
#   misparse; a quoted `gh pr merge` outside a git command (sh -c, --body) fails closed.
set -uo pipefail
payload="$(cat)"
p=${payload//[\"\'\\]/}; [[ $p == *merge* ]] || exit 0   # hot path: most Bash calls never mention merge
command -v jq >/dev/null 2>&1 && command -v perl >/dev/null 2>&1 \
  || { grep -Eq 'gh.*merge' <<<"$payload" && { echo "defend-merge-guard: jq/perl missing — refusing merge" >&2; exit 2; }; exit 0; }
[ "$(jq -r '.tool_name // empty' <<<"$payload")" = Bash ] || exit 0
cmd=$(jq -r '.tool_input.command // empty' <<<"$payload")
dir=$(jq -r '.cwd // empty' <<<"$payload"); dir=${dir:-$PWD}

block() { echo "defend-merge-guard: $*" >&2; exit 2; }

check() {   # $1 selector (may be empty = current branch), $2 repo (may be empty), $3 dir
  local info sha url p state
  info=$({ cd "$3" 2>/dev/null || [ -n "$2" ]; } && gh pr view ${1:+"$1"} ${2:+-R "$2"} --json headRefOid,url 2>/dev/null) \
    || block "cannot resolve PR '${1:-<current branch>}' from $3 — add -R owner/repo; merge one literal PR per command"
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

# tokenize left→right like bash: \x escape | $'ansi' | 'single' | "double" (with \ escapes).
# Escapes join continuations and can't desync quote pairing; each quoted string collapses to
# one inert token so quoted text (commit messages, --body, paths) can't split a segment or
# pose as a merge. "$(…)" runs even inside a git command, so a mention there blocks outright.
norm=$(perl -0pe 's{\\(.)|\$\x27((?:[^\x27\\]|\\.)*)\x27|\x27([^\x27]*)\x27|"((?:[^"\\]|\\.)*)"}{
  defined $1 ? ($1 eq "\n" ? " " : $1 =~ m#[\s;&|()`"\x27\\]# ? "_" : $1)
  : do { my $s = $2 // $3 // $4;
         defined $4 && $s =~ m#\$\(|`# && $s =~ m#gh|merge# ? " __SUBST_MERGE__ "
         : $s =~ m#gh\s+pr\s+merge# ? " __QUOTED_MERGE__ " : ($s =~ s#[\s;&|()`]##gr) }
}gse' <<<"$cmd")
[[ $norm == *__SUBST_MERGE__* ]] && block "gh/merge inside \"\$(…)\" — run gh pr merge directly so it can be checked"

# segments split on ; & | ( ) ` and newlines; track `cd` so a bare `gh pr merge 5` resolves in the right repo
xrepo=
while IFS= read -r seg; do
  read -ra w <<<"$seg"
  case ${w[0]:-} in
    cd) d=${w[1]:-$HOME}; d=${d/#\~/$HOME}; d=${d/#\$HOME/$HOME}
        case $d in /*) dir=$d ;; *) dir=$dir/$d ;; esac
        continue ;;
    export) for a in "${w[@]:1}"; do [[ $a == GH_REPO=* ]] && xrepo=${a#GH_REPO=}; done
        continue ;;   # export GH_REPO=… sticks for later segments
  esac
  [[ " ${w[*]} " == *" __QUOTED_MERGE__ "* && ${w[0]:-} != git ]] \
    && block "quoted 'gh pr merge' (sh -c / eval / body?) — run gh pr merge directly so it can be checked"
  # gh may follow keywords/wrappers (do, then, timeout, env, {, !, command, /abs/gh).
  # One scan after `pr`: 1st bare word = subcommand, 2nd = selector; -R may sit either side.
  g=-1
  for ((i = 0; i + 2 < ${#w[@]}; i++)); do
    [[ ${w[i]##*/} = gh && ${w[i+1]} = pr ]] || continue
    sub= sel= flagrepo= j=$((i + 2))
    while [ $j -lt ${#w[@]} ]; do
      a=${w[j]}
      case $a in
        -R|--repo) flagrepo=${w[j+1]:-}; j=$((j + 2)) ;;
        --repo=*) flagrepo=${a#*=}; j=$((j + 1)) ;;
        -b|--body|-F|--body-file|-t|--subject|-A|--author-email|--match-head-commit) j=$((j + 2)) ;;
        -*) j=$((j + 1)) ;;
        *) if [ -z "$sub" ]; then sub=$a; elif [ -z "$sel" ]; then sel=$a; fi; j=$((j + 1)) ;;
      esac
    done
    [ "$sub" = merge ] && { g=$i; break; }
  done
  [ $g -ge 0 ] || continue
  prefixrepo=
  for ((i = 0; i < g; i++)); do
    case ${w[i]} in
      GH_REPO=*) prefixrepo=${w[i]#GH_REPO=} ;;
      xargs) block "gh pr merge via xargs — PR comes from stdin and can't be checked; merge one PR per command" ;;
    esac
  done
  repo=${flagrepo:-${prefixrepo:-$xrepo}}   # gh precedence: -R > inline GH_REPO= > exported
  [[ $sel$repo == *[\$\`]* ]] && block "non-literal PR/repo ('$sel' '$repo') — merge one literal PR per command"
  check "$sel" "$repo" "$dir"
done < <(printf '%s\n' "$norm" | sed 's/[;&|()`]/\n/g')
exit 0
