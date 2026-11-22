# DefendMerge — worker diff → git merge (defend-attack: screener, then Opus high)

DefendMerge **is** /hard-merge. Same procedure, named here so the family is
complete: the gate is between Worker and `git merge`, run by `defend-attack`.

## Tier + independence

- The reviewer is `defend-attack` (`~/.claude/skills/defend/bin/defend-attack`). Run it with `defend-attack <pr> -R owner/repo` or `defend-attack --diff <file>`.
- Independence: `defend-attack` is a separate model call with no author context.
- Flow: criteria are numbered C1..Cn. Repo criteria (`.defend/criteria`, one per line, blank and `#` lines skipped) come first, then the built-in lenses, which are always included so a diff author cannot drop one. In PR mode the repo file is read from the PR base commit via the GitHub API, never from the head; a missing file means built-ins only. With `--diff` the working tree file is used.
- A screener checks the diff against them: JEV (`DEFEND_JEV_CMD`, default laneproxy `/v1/systemone`, timeout `DEFEND_JEV_TIMEOUT`, default 30s), else Haiku (`DEFEND_HAIKU_CMD`), else none. Output line: `Screener: <jev|haiku|none> fails=<N>`. The screener uses `x-lane: fast` on purpose: its calls are short, one per diff.
- Opus (`DEFEND_OPUS_CMD`, default `claude -p --model opus --effort xhigh`) always decides. It confirms or refutes each screener flag, or deep-verifies every criterion when nothing was flagged. The screener never clears a diff. Screener reasons are passed to Opus fenced and labelled untrusted. Rulings: the default reviewer is **Opus at xhigh effort** (operator ruling 2026-11-20, feeds into opus/xhigh — 'elevate all defense gates to use Opus XHigh'). History: 2026-11-17 Opus at high; 2026-11-13 Fable at low effort; 2026-11-09 every gate through Opus.
- Exit 2 means no verdict. Do not post a receipt. Do not merge. Fix the cause and re-run.
- Known gap: the Opus leg runs a headless `claude -p` (DEFEND_OPUS_CMD) and needs a working headless login on the host. Until the GateKeeper (repos-v6m7) takes the Opus tier over, a failed Opus call exits 2 and blocks the merge.

## Mandatory lenses (align with hard-merge §1–4)

- **Untested paths** — diff lines no test executes; baseline: did the tests
  fail before the change?
- **Edge cases** — boundaries, empty inputs, concurrency, retries.
- **Failure modes** — what breaks when the dependency/network/user misbehaves?
- **Scope drift** — files or hunks the ticket never mentioned.
- **Trust boundaries** — untrusted input reaching a write, exec, or external call.
- **Legacy** — hard-merge §2's bounded check: what did this diff make dead or
  superseded? Author removes that in-PR (`ke learn` first); other legacy on the
  topic → a filed bead, advisory, never a scope blocker.

## Attack shapes (expected)

- "Need test D for this path."
- "Edge case E: <input> produces <wrong behavior>."
- "Failure mode F: when <dependency> times out, the code <silently drops / double-writes>."

## Verdict routing

The author posts the receipt after `defend-attack` prints CLEAR. Production surfaces keep
hard-merge's second-disjoint-reviewer rule. Override = ledger note row.

**Receipt (mechanical).** Record the head before the attack:
`sha=$(gh pr view <pr> -R owner/repo --json headRefOid -q .headRefOid)`. Never re-read it after
the attack: a push in between must get no receipt. After verifying the verdict, the author
posts it on that *reviewed* SHA: `~/.claude/skills/defend/bin/defend-receipt CLEAR|BLOCK <pr> <sha> -R owner/repo --by <model> "<summary>"`
(a `defend/merge` commit status). The `--by` flag records which model decided (e.g. `--by opus`),
making the audit trail visible at the seam rather than buried in local session logs.
Enforcement is GitHub branch protection on `main`
requiring the `defend/merge` status (enforce_admins on), so every merge path — `gh pr merge`,
`gh api`, web UI, `git push` — needs head to carry a success; a push after review voids it.
Not a command-text hook: those leak and over-block (repos-76u counsel, 2026-10-27).
The status is self-attested: anyone with write access can post it, so it stops careless
skips, not deliberate forgery.

**Merge (mechanical).** After the receipt, merge with the helper, not with a hand-typed
`gh pr merge`: `~/.claude/skills/defend/bin/defended-merge <pr> -R owner/repo`. It re-reads the
PR head, refuses unless that head is OPEN and every status on it is `success` with
`defend/merge` among them, then runs `gh pr merge --squash --match-head-commit <head>` — the one
merge shape the session guard allows (never `--admin`). Two shapes are refused by the guard and
end up with the operator holding a reviewed PR: a bare `gh pr merge` with no
`--match-head-commit`, and a receipt chained into the same call. `defend-receipt` prints the
exact command on a CLEAR, so the next line is copy-paste either way.

**Champion check (repos with a bench).** A CLEAR also runs `bin/champion-check <PR base>` when
the PR's base or head has `bench/CHAMPION` per the GitHub API (never a possibly-stale local ref or
checkout); the checkout must then be at the reviewed SHA. A lookup error other than 404 refuses. Deleting `scripts/merge-gate.sh` or
`bench/` does not skip it. Contract: `bench/run.sh` prints the score as a bare
decimal on its last line (higher = better; negate a lower-is-better metric), and
`bench/CHAMPION` holds the champion. The bar is the base branch's `bench/CHAMPION`, fetched
fresh into a private ref. The PR's own `bench/CHAMPION` must sit between that bar and its
measured score: a PR may raise the bar to what it measured, and may not lower it. On first
adoption the PR's file is the bar. The check runs the PR's own `bench/run.sh`, so the reviewer
still diffs what it executes. In a bench repo, defend-receipt refuses unless it runs from a clean
checkout of the reviewed SHA whose `origin` is the PR's repo. The verdict holds for the base as of
CLEAR: if the champion rises before merge, require up-to-date branches or re-run CLEAR.

Enable per repo (operator). PUT replaces the whole protection object, so first merge in any
contexts the repo already requires (`gh api repos/<owner>/<repo>/branches/main/protection`):

```sh
gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input - <<'EOF'
{"required_status_checks":{"strict":false,"contexts":["defend/merge"]},
 "enforce_admins":true,"required_pull_request_reviews":null,"restrictions":null}
EOF
```
