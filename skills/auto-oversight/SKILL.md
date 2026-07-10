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

Any PR/deploy/dispatch sitting in a holding pattern: **always hard-merge and
deploy to its test/prod surface — never leave holding**. Standing order (Aaron
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
        values ("ao-<mission>-<rand>","allmissions","direct","auto-oversight",<body>,"OPEN",<now-iso>)'
```

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
