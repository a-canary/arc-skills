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
Enable per repo (operator). PUT replaces the whole protection object, so first merge in any
contexts the repo already requires (`gh api repos/<owner>/<repo>/branches/main/protection`):

```sh
gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input - <<'EOF'
{"required_status_checks":{"strict":false,"contexts":["defend/merge"]},
 "enforce_admins":true,"required_pull_request_reviews":null,"restrictions":null}
EOF
```
