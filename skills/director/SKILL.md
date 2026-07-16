---
name: director
description: AFK-capable mission driver that reads MISSION.md / AGENTS.md / CHOICES.md, restates the objective, runs a gap-analysis loop, delegates work to worker agents via the event bus, and gates progress on verified evidence. Use when you want an autonomous agent to drive a repo toward mission completion without constant human steering. Do NOT use for single-task execution — use /task instead.
---

# director

Framework-agnostic mission driver. Reads goals, identifies gaps, delegates work, watches for results, gates on evidence. Depends only on flat files — no arc-agents, no DB required.

## Invocation

```
/director [repo-root]        # infers repo root if omitted; prompts for binding confirmation
/director --afk              # skip confirmation, run until idle
/director pause              # write .arc/director/director.paused, halt after current tick
/director resume             # clear .arc/director/director.paused, replay events since pause, resume loop
```

This repo root is the **parent repo** — where director state lives (`.arc/director/`)
and whose `AGENTS.md` declares the bindings for itself and any other repos it manages.
One `/director` instance owns one parent repo; managing multiple repos means declaring
them as delegation targets in this repo's `AGENTS.md`, not running multiple directors
against a shared vault path.

## Onboarding (first run)

Only runs once, when the parent repo has no `AGENTS.md` (or one with no `## Director
bindings` section). The full procedure — discovery script, batched setup questions,
`AGENTS.md` write, `directors.json` registration — lives in
[`ONBOARDING.md`](ONBOARDING.md). Load it only on that first unconfigured boot;
steady-state ticks never need it. It ends by falling through into the boot sequence
below (boot step 4's confirmation gate still applies).

## Boot sequence

1. Read (first found): `MISSION.md`, `AGENTS.md`, `CHOICES.md`, `objective.md`
2. Restate objective — what done looks like, what the constraints are
3. Read `AGENTS.md` bindings section; if missing or incomplete, run
   [Onboarding](#onboarding-first-run) instead of prompting ad hoc
4. If not `--afk`: block for user confirmation or edit before proceeding
5. Replay `.arc/events.jsonl` (full scan) to reconstruct open/inflight/pending-QA task set
6. Enter the director loop

## Idle backstop

Director is event-driven, not polling — `idle` state sleeps until the next feedback
event. A **cron backstop** (`scheduler.backstop-hours` in `AGENTS.md`, default 12hr;
installed via the harness's scheduler, e.g. `ScheduleWakeup`/cron) wakes a fresh
tick regardless of events, so a missed or dropped event-bus notification can't
silently stall the mission past that interval. Lower values catch stalls sooner
at the cost of a higher token floor (more idle-tick wakeups); higher values are
cheaper but widen the worst-case silent-stall window. The backstop tick runs the
same loop as any other — if there's nothing to do, it goes straight back to idle.

## Reference

Bindings, the `.arc/` working-file layout, and the event-bus schema are in [`BINDINGS.md`](BINDINGS.md). Read it when you need to know what a binding accepts, where state lives, or what shape events take; read this file for the operator procedure below.

## Director loop

Each tick: **budget** (governor binding; at weekly limit → critical-only:
qa.failed critical-failure/security still dispatch, all else pauses; bypass
triggers ignore budget) → **capacity** (advisory binding; CLI error → proceed
unbound + capacity.failopen; route run/park/escalate, record every provider
response) → **gap-analysis** (reads gaps.md + event log; open gaps → delegate;
none + inflight/pending-QA → sleep; none at all → idle) → **watch event bus** →
**heartbeat** (5 min in --afk; backstop cron wakes idle) → **end**: regenerate
`.arc/local-dev-dash/main.html`.

Full event-bus routing and event schema are in [`BINDINGS.md`](BINDINGS.md).
The load-bearing gates that never relax:

- `task.completed` → evidence paths must exist, else reject + re-queue → dispatch `/qa`
- `qa.passed` non-production → close gap. **Production → do NOT close at merge**:
  merge per on-task-verified binding, deploy, re-dispatch `/qa` against the LIVE
  surface (hard-merge §6) with `phase:post-deploy`; only that post-deploy pass
  closes the gap (critical/truthfulness finding → rollback, re-gap).
- `qa.failed` → check bypass triggers; retry or new slice. `task.failed` →
  blocked.md; re-gap or surface. `user.feedback` → sink + batch by
  (feature, version, resource); at threshold → `/qa`, never a direct task.

State (written to gaps.md header): delegating · waiting:inflight · waiting:qa ·
idle · paused (sentinel) · budget-exceeded (critical-only until reset/raised).

## What director does NOT own

- How worker agents are spawned (declared in `AGENTS.md` bindings)
- Worktree/workspace creation (owned by `/task`)
- QA execution (owned by `/qa`)
- Feedback injection (owned by `/feedback`)
- Ledger tracking (owned by `arc-agents` if installed)
- Dashboard display (owned by `arc-webui` if installed)
