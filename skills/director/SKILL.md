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

Triggers when the parent repo has no `AGENTS.md`, or has one with no `## Director
bindings` section. Runs once, before the normal boot sequence, then falls through
into it.

1. Run the discovery script — deterministic, no guessing:
   ```
   bash skills/director/scripts/discover-setup.sh
   ```
   Prints `repo-root`, `agents-md-exists`, `director-bindings-exist`,
   `git-remote`, `arc-agents-available`, `arc-agents-config`, `vault-path`,
   `directors-registry`, `repo-already-registered` — each `<key>\t<value>`,
   `-` for absent.

2. Ask the user (one batched set of questions), pre-filling suggestions from
   step 1's output — never silently apply a suggestion:
   - **Which repo should this Director manage?** Default: `repo-root` from
     discovery. If `repo-already-registered: yes`, warn and ask whether to
     reconfigure the existing entry or pick a different repo.
   - **Where should Director's memory/state live?** Default: `.arc/director`
     (in-repo, git-tracked, zero deps). Offer `vault-path` from discovery as
     an alternative only if it isn't `-`. A custom path is always allowed.
   - **Weekly token cap for this repo?** Default: `500k`. Mention the
     bypass list (`critical-failure`, `security`) always applies regardless
     of cap.
   - **Backstop tick cadence, in hours?** Default: `12`. Explain: director is
     event-driven and sleeps between events; this is only the dead-man's-switch
     interval, not a poll loop.
   - **Each remaining binding** (`event-bus`, `task-delegation`, `workspace`,
     `on-task-verified`, `todo-list`, `feedback-sink`, `planning-target`,
     `model`, `scheduler.mode`): suggest the flat-file/harness-native default for each
     (see [BINDINGS.md](BINDINGS.md)), but if `arc-agents-available: yes`,
     also surface the arc-agents-backed alternative as a selectable option
     (e.g. `task-delegation: arc-agents`, `scheduler.mode: arc-agents`) rather
     than silently preferring it — the habitual default always wins unless
     the user opts in.

3. Write `AGENTS.md` at the target repo root from
   `skills/director/AGENTS.md.template`, filling in the answers. If
   `AGENTS.md` already exists (just missing the bindings section), append the
   `## Director bindings` block rather than overwriting the file.

4. Register the repo in `~/.config/arc/directors.json` (create if absent):
   ```jsonc
   {
     "directors": {
       "<parent-repo-root>": {
         "memory": ".arc/director",         // resolved path from step 2
         "manages": ["<parent-repo-root>"], // this repo + any delegation targets added later
         "registered_at": "<ISO date>"
       }
     }
   }
   ```
   One entry per parent repo. `manages` starts as just the parent repo itself —
   additional managed repos are appended here only when this repo's `AGENTS.md`
   later declares them as delegation targets, not during onboarding.

5. Fall through into the normal boot sequence below — onboarding does not
   itself confirm or run a tick; boot step 4's confirmation gate still applies.

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

```
check budget (binding may delegate to a repo's own governor, e.g. arc-agents'
  bin/director-governor.ts — per-repo weekly threshold, never-fatal)
  → at weekly limit? restrict to critical-only: only qa.failed with
    dimension critical-failure or security may still dispatch; all other
    gap-delegation pauses until budget resets or a human raises it
  → bypass triggers run at full priority regardless of budget state
check capacity (capacity binding, if bound — ADVISORY: any CLI error →
  proceed unbound + emit capacity.failopen; never blocks a dispatch)
  → route per dispatch (lane: bypass work = critical, exploratory = research,
    else standard): run → dispatch; park → re-queue + emit capacity.parked
    (carry vast_stop); escalate → dispatch on best alternative provider
  → record every provider response back (tokens + ok|429)
gap-analysis (reads .arc/director/gaps.md + event log; under planning-target:
  prd-file, gaps.md is derived from the current PRD.md's acceptance criteria)
  → open gaps? → delegate via task-delegation binding
  → no gaps, inflight/pending-QA? → sleep (event-driven)
  → no gaps, no inflight, no pending-QA? → idle; sleep until next feedback event
watch event bus (event-bus binding)
  → task.completed  → validate evidence paths exist → dispatch /qa
  → task.completed, no evidence → reject, re-queue
  → qa.passed (no phase field) → non-production surface: close gap; rewrite
                      .arc/director/gaps.md, inflight.md. Production surface: do
                      NOT close the gap at merge — merge per on-task-verified
                      binding, deploy, then dispatch /qa again against the LIVE
                      surface (hard-merge §6) WITH phase:post-deploy on its emitted
                      event so this branch and the next are mechanically distinct.
  → qa.passed (phase:post-deploy) → the live-surface result: close gap. Route its
                      findings to the next gap tick; a critical/truthfulness one
                      triggers rollback, then re-gap from findings.
  → qa.failed       → check bypass triggers; emit task.assigned (retry or new slice)
  → task.failed     → rewrite .arc/director/blocked.md; re-gap or surface to user
  → user.feedback   → append to feedback-sink; batch by (feature, version, resource)
                       when count ≥ threshold → dispatch /qa with batch context
heartbeat (every 5 min in --afk mode; scheduler.backstop-hours cron wakes idle directors regardless)
  → tasks open > TTL with no update → mark blocked; rewrite .arc/director/blocked.md
end of every tick
  → regenerate .arc/local-dev-dash/main.html from director working files
```

## Director states (reported each tick, written to .arc/director/gaps.md header)

| State | Meaning |
|---|---|
| **delegating** | Open gaps exist; emitting task.assigned events |
| **waiting:inflight** | Tasks assigned; no results yet |
| **waiting:qa** | Tasks completed; QA dispatched |
| **idle** | No gaps, no inflight, no pending QA; sleeping until next feedback event |
| **paused** | `.arc/director/director.paused` sentinel present; no ticks until `/director resume` |
| **budget-exceeded** | Weekly token limit reached; restricted to critical-failure/security dispatch only until budget resets or a human raises it |

## Epistemic gates (prove-before-scale)

- `task.completed` without `evidence:[{path,description}]` → rejected, re-queued
- `qa.passed` without `evidence` → rejected, re-queued
- `qa.failed` without `reproduction` → rejected, re-queued
- User feedback → never creates a task directly; dispatches `/qa` first
- User feedback batched by `(feature, version, resource)` — count increases trust, QA still required

## What director does NOT own

- How worker agents are spawned (declared in `AGENTS.md` bindings)
- Worktree/workspace creation (owned by `/task`)
- QA execution (owned by `/qa`)
- Feedback injection (owned by `/feedback`)
- Ledger tracking (owned by `arc-agents` if installed)
- Dashboard display (owned by `arc-webui` if installed)
