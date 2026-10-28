# DefendMerge — worker diff → git merge (workhorse, fresh context)

DefendMerge **is** /hard-merge. Same procedure, named here so the family is
complete: the gate between Worker (qwen|bonsai thin tasks) and `git merge`.

## Tier + independence

- Reviewer = freshly spawned agent, disjoint context (hard-merge's existing
  rule). Workhorse tier — no counsel: merges are frequent and git-reversible.
- Cross-*model* independence only when the worker tier ≠ reviewer model
  (e.g. bonsai worker → qwen reviewer). Qwen worker → qwen reviewer is
  context-independence only. Accepted trade-off, recorded here on purpose.

## Mandatory lenses (align with hard-merge §1–4)

- **Untested paths** — diff lines no test executes; baseline: did the tests
  fail before the change?
- **Edge cases** — boundaries, empty inputs, concurrency, retries.
- **Failure modes** — what breaks when the dependency/network/user misbehaves?
- **Scope drift** — files or hunks the ticket never mentioned.
- **Trust boundaries** — untrusted input reaching a write, exec, or external call.

## Attack shapes (expected)

- "Need test D for this path."
- "Edge case E: <input> produces <wrong behavior>."
- "Failure mode F: when <dependency> times out, the code <silently drops / double-writes>."

## Verdict routing

`CLEAR | BLOCK + findings` → author (Driver). Production surfaces keep
hard-merge's second-disjoint-reviewer rule. Override = ledger note row.

**Receipt (mechanical).** After verifying the verdict, the author posts it on the
*reviewed* SHA: `~/.claude/skills/defend/bin/defend-receipt CLEAR|BLOCK <pr> <sha> -R owner/repo "<summary>"`
(a `defend/merge` commit status). Enforcement is GitHub branch protection on `main`
requiring the `defend/merge` status (enforce_admins on), so every merge path — `gh pr merge`,
`gh api`, web UI, `git push` — needs head to carry a success; a push after review voids it.
Not a command-text hook: those leak and over-block (repos-76u counsel, 2026-10-27).
The status is self-attested: anyone with write access can post it, so it stops careless
skips, not deliberate forgery.

**Champion check (repos with a bench).** "Results meet or exceed the champion" lives in the
repo's own `scripts/merge-gate.sh` (paste the snippet below; nothing ships it). A CLEAR
runs that script on the reviewed SHA, but only from the repo's own checkout and only if the
script exists there: run elsewhere, or with the script deleted, defend-receipt prints
"project gate skipped" and still posts success — on a bench repo, that line is a BLOCK.
The champion is one number in `bench/CHAMPION`, read from the freshly fetched base branch
so the PR under review cannot lower it; the PR's own file counts only on first adoption
(base exists but has no `bench/CHAMPION`). `bench/run.sh` prints the score as a bare
decimal on its last line.

```sh
set -euo pipefail
base=${BASE:-main}                         # the PR's base branch
git fetch -q origin "$base"                # unreachable base -> exit (fail closed)
ref=refs/remotes/origin/$base; git rev-parse -q --verify "$ref^{commit}" >/dev/null
if git cat-file -e "$ref:bench/CHAMPION" 2>/dev/null; then champ=$(git show "$ref:bench/CHAMPION")
else champ=$(cat bench/CHAMPION); fi       # first adoption only
score=$(bench/run.sh | tail -n 1)          # higher = better
num='^-?[0-9]+(\.[0-9]+)?$'
[[ $score =~ $num && $champ =~ $num ]] || { echo "bench: non-numeric score '$score' or champion '$champ'" >&2; exit 1; }
awk -v s="$score" -v c="$champ" 'BEGIN{exit !(s+0>=c+0)}' || { echo "bench: $score < champion $champ" >&2; exit 1; }
```

Lower-is-better metric: flip to `s+0<=c+0`. The gate runs the PR's own code, so the
reviewer diffs everything under `bench/` and `scripts/merge-gate.sh` against base; a PR
that beats the champion raises `bench/CHAMPION` to its score.

Enable per repo (operator). PUT replaces the whole protection object, so first merge in any
contexts the repo already requires (`gh api repos/<owner>/<repo>/branches/main/protection`):

```sh
gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input - <<'EOF'
{"required_status_checks":{"strict":false,"contexts":["defend/merge"]},
 "enforce_admins":true,"required_pull_request_reviews":null,"restrictions":null}
EOF
```
