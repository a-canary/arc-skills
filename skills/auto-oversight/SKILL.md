---
name: auto-oversight
description: One headless oversight pass over the NEXT mission in the cycle (trading → onenation → autonomy → local-models) — judge health/safety/alignment, resolve resolvable human-gates, take one small autonomy-improving action, log to webui /m/allmissions. Designed for a */15 cron on a low-effort model.
---

# auto-oversight

One mission per invocation. Rotate via the state file; never audit two missions
in one run ([[one-repo-at-a-time]]).

## 0. Rotate

Read `~/vault/oversight/state.json` (`{"next":"trading"}`; missing → `trading`).
That's THIS run's mission. Immediately write back the next in cycle
`trading → onenation → autonomy → local-models → trading` so a crashed run
never wedges the rotation.

**Compute the write-back from the value you just READ, never from the mission
you expected.** Two loops share this file; if the read value differs from your
prediction, another loop already rotated — your mission is the READ value, and
writing your precomputed "next" re-inserts a mission and double-audits it.
Best shape: one command that cats the file THEN writes read+1, so a stale
prediction can't leak in. Observed 2026-07-11: an interactive run expecting
`trading` read `onenation` (cron took trading minutes earlier) and wrote
`onenation` back — self-cancelling no-op caught only by hand.

**Freshness gate — skip duplicate audits.** After rotating, check the ledger
for a recent audit of this mission:

```
select id from feedback where source='auto-oversight'
  and id like 'ao-<mission-slug>-%' and created_at >= <now minus 90 min ISO>
```

No `sqlite3` binary on this host — run the query (and the step-4 insert) via
`~/.bun/bin/bun -e '…bun:sqlite…'` against `~/vault/ledger.db` (`bun` needs
the full path or `PATH=$HOME/.bun/bin:$PATH`; cron env lacks it). Exit 127
here is a tooling error, NOT a clear gate — never skip the check.

A row exists → another oversight loop (cron vs interactive share the rotation)
already audited this mission; say so, log NOTHING, and end the run. Observed
2026-07-11: cron and an interactive loop double-audited trading (02:08 + 02:33)
and autonomy (04:10 + 04:29) — each duplicate is a full model run producing a
near-identical log row.

Mission → surfaces:
- **trading**: repo `~/repos/trading`, director `.arc/director/*`, crons (shadow rebalance, director-tick), open PRs, `/m/trading`
- **onenation**: repo `/home/aaron/projects/OneNation` (deploy checkout = prod), docker stack, QA journey cron log `.claude/qa-journey-cron.log`, open PRs, `/m/onenation`
- **autonomy**: repos `~/repos/arc-agents`, `~/repos/arc-webui`, `~/repos/arc-skills`; feedback drain cron; webui :8080 up; open PRs
- **local-models**: `~/repos/starlight-slm` (symlink → /mnt/Storage1; unmounted = parked, say so and move on)

## 1. Judge (explore + explain, briefly)

For the mission answer each: **active?** (recent commits/ticks/cron fires) ·
**proving hypothesis?** (what evidence moved) · **high value?** ·
**safe?** (guardrails held) · **efficient?** (no waste/runaways) ·
**hygiene?** (stale branches/worktrees/locks/logs) ·
**aligned to mission + objectives?** (CHOICES/M-00xx) ·
**reflected in webui?** (does /m/<mission> show its real state).
Read facts from tool output; verify before alarming (recency-gate — never
re-flag what's already fixed).

## 2. Resolve human-gates

Any PR/deploy/dispatch sitting in a holding pattern: **hard-merge PRs that meet the merge gate and
deploy to their test/prod surface — never leave holding**. Standing order (Aaron
2026-07-10, [[hard-merge-standing-permission]]): the ONLY human go/no-go gate
is an **Objective or scope delta** (CHOICES-level, mission redefinition,
spend). Merge gate: CI green + independent reviewer where doctrine requires;
re-poll mergeStateStatus at merge time. Docker: own-stack only, obey the
shared-resource discipline rule in AGENTS.md. Gates you cannot resolve
(sudo, secrets, scope deltas): make sure they're visible on the webui
(ledger feedback row → /approvals), then leave them.

## 3. One small autonomy action

One concrete change that removes a check-in or hardens a system substitute
(rule/skill/cron/guard) — per [[autonomy-definition]]: a gate comes off only
with a named substitute. Ship it (branch → PR → merge, worktree for dev,
commit identity from ~/vault/USER.md). Small; prove before scaling.

## 4. Log to /m/allmissions

Append the run's distilled record (mission, verdicts one line each, gates
resolved/remaining, action taken) as a ledger feedback row so the webui
renders it on /m/allmissions (attention axis shows OPEN rows for the
passthrough project):

```
bun -e '…insert into feedback (id,project,source,submitter,body_md,state,created_at)
        values ("ao-<mission>-<rand>","allmissions","auto-oversight","auto-oversight",<body>,"LOG",<now-iso>)'
```

**State rule (2026-07-12, operator directive): `LOG` unless actionable.**
Routine audit rows are journal entries, not feedback — insert them with
`state="LOG"` (a sink every drain/count ignores; all consumers filter
`state='OPEN'`). Insert `state="OPEN"` ONLY when the row demands action a
human or another agent must take (a resolvable gate, a defect, an operator
decision) — and state the required action in the first line of `body_md`.
The freshness gate above is state-agnostic (id+created_at), so LOG rows
still suppress duplicate audits.


`source` MUST be `"auto-oversight"` (untrusted), never `"direct"`: `direct` is a
trusted source, so ONE log row passes the aggregator's confirmation gate, mints
a junk PRD, and the drain flips the row resolved — the log blanks itself and
Aaron's review queue fills with noise (observed 2026-07-10; durable drain-side
exclusion is PRD "Exclude auto-oversight log rows from the Lane-2 feedback
drain"). An untrusted source needs 3 distinct submitters to confirm; this
skill's single stable submitter never does, so rows persist.

Housekeeping in the same run: mark this skill's own `allmissions` rows older
than 7 days `state='resolved'` so the page stays bounded. **NEVER touch rows
younger than 7 days** — OPEN rows ARE the visible log; closing a fresh row
(yours or a prior run's) blanks /m/allmissions. Uppercase `'OPEN'` exactly;
`state='new'` gets drained by the */5 aggregator, other casings don't render.

## Rules

- Fully self-directed: git, cron, systemd, harness edits — no approvals.
- Zero agent trust: verify subagent/reviewer claims against source before acting.
- Under ~10 min of work; park anything bigger as a ledger feedback row for the
  mission's director instead of doing it here.
- **Park budget: at most ONE parked item per run, and NEVER a new PRD/issue
  row.** Before parking, grep `issues`+`feedback` for an existing row on the
  same theme (title keyword) — found → cite it, don't duplicate. Observed
  2026-07-10: runs minted 21 review-state PRDs in one day (11 on allmissions),
  flooding Aaron's review queue — oversight that manufactures human check-ins
  is anti-autonomy. Improvement ideas go in the run's log row `action`/`parked`
  line; only a mission director promotes one to a PRD.
- **Verify a guard is actually missing before adding it.** A comment without a
  command on the *next* line often has its command two lines down; print the
  full surrounding block (`sed -n 'N,Mp'` on the live file) before inserting
  any cron/config line. Observed 2026-07-11: a "missing" log-trim cron was
  present all along — the fix inserted a duplicate that had to be reverted.
