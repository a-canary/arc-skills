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

## Boot sequence

1. Read (first found): `MISSION.md`, `AGENTS.md`, `CHOICES.md`, `objective.md`
2. Restate objective — what done looks like, what the constraints are
3. Read `AGENTS.md` bindings section; if missing or incomplete, prompt once and write answers in
4. If not `--afk`: block for user confirmation or edit before proceeding
5. Replay `.arc/events.jsonl` (full scan) to reconstruct open/inflight/pending-QA task set
6. Enter the director loop

## Idle backstop

Director is event-driven, not polling — `idle` state sleeps until the next feedback
event. A **12hr cron backstop** (installed via the harness's scheduler, e.g.
`ScheduleWakeup`/cron) wakes a fresh tick regardless of events, so a missed or
dropped event-bus notification can't silently stall the mission past half a day.
The backstop tick runs the same loop as any other — if there's nothing to do, it
goes straight back to idle.

## Bindings

Declared in `AGENTS.md`. Director prompts on first boot for any missing binding, writes the answer back.

```md
## Director bindings
event-bus: jsonl              # jsonl | db | <skill-name>
task-delegation: native       # native (harness tool) | arc-agents | <skill-name>
workspace: worktree           # worktree | treehouse | <skill-name>
on-task-verified: merge       # merge | draft-pr | <skill-name>
todo-list: native             # native | arc-agents | <skill-name>
feedback-sink: jsonl          # jsonl | <api-endpoint> | <skill-name>
planning-target: prd-file     # prd-file | arc-agents-ledger | kanban | <skill-name>
scheduler: cron               # cron (self-installed 12hr backstop) | arc-agents | <skill-name>
budget:
  weekly: 500k                # tokens/week per repo; resets Monday 00:00 UTC
  bypass:
    - critical-failure        # qa.failed with dimension: critical-failure
    - security                # qa.failed with dimension: security
```

### `planning-target`

How director plans the *next* unit of work, independent of how `/task` executes it.

- **`prd-file`** (default) — one `PRD.md` at repo root, addressing only the single
  most important open gap. On completion, `/director` replaces it with the next
  PRD rather than accumulating a backlog file. Flat-file, sequential, zero deps.
- **`arc-agents-ledger`** — delegates planning to arc-agents' `kind=prd` ledger
  queue (`bin/plan.ts` mints a PRD row at the human-approval gate; arc-agents'
  `agent=director` profile claims it, runs intake, decomposes into ledger task
  rows). Useful when a repo already runs arc-agents and wants a queryable,
  multi-PRD-in-flight backlog instead of one-at-a-time. This is arc-agents'
  pre-existing PRD-intake pathway — not `/director`'s own interviewer role,
  which `/director`'s non-AFK mode (grill-me + research, pause/steer/resume)
  already covers standalone.
- **`kanban`** / `<skill-name>` — any other planning surface a binding wires up.

### `scheduler`

How `/director` gets re-invoked to drive the AFK loop forward.

- **`cron`** (default) — `/director` is self-sufficient: on first `--afk` boot it
  installs its own feedback watcher and a 12hr cron entry that re-runs
  `<harness> /director <repo-root> --afk`. Each invocation reads `.arc/director/`
  state and resumes where it left off — no daemon, no external scheduler.
- **`arc-agents`** — if installed, arc-agents' factory can schedule and execute
  the tick instead of a bare cron entry (its existing supervisor/reaper loop
  substitutes for the self-installed cron). Optional, not required.

## Director loop

```
check budget (binding may delegate to a repo's own governor, e.g. arc-agents'
  bin/director-governor.ts — per-repo weekly threshold, never-fatal)
  → at weekly limit? restrict to critical-only: only qa.failed with
    dimension critical-failure or security may still dispatch; all other
    gap-delegation pauses until budget resets or a human raises it
  → bypass triggers run at full priority regardless of budget state
gap-analysis (reads .arc/director/gaps.md + event log; under planning-target:
  prd-file, gaps.md is derived from the current PRD.md's acceptance criteria)
  → open gaps? → delegate via task-delegation binding
  → no gaps, inflight/pending-QA? → sleep (event-driven)
  → no gaps, no inflight, no pending-QA? → idle; sleep until next feedback event
watch event bus (event-bus binding)
  → task.completed  → validate evidence paths exist → dispatch /qa
  → task.completed, no evidence → reject, re-queue
  → qa.passed       → close gap; rewrite .arc/director/gaps.md, inflight.md
  → qa.failed       → check bypass triggers; emit task.assigned (retry or new slice)
  → task.failed     → rewrite .arc/director/blocked.md; re-gap or surface to user
  → user.feedback   → append to feedback-sink; batch by (feature, version, resource)
                       when count ≥ threshold → dispatch /qa with batch context
heartbeat (every 5 min in --afk mode; 12hr cron backstop wakes idle directors regardless)
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

## `.arc/` layout

`PRD.md` itself lives at the parent repo's root, not under `.arc/` — it's a
human-readable planning artifact (`planning-target: prd-file`, the default),
replaced wholesale when its gap closes. Everything under `.arc/` is director's
own working state, derived from whatever the current PRD says.

```
.arc/
  events.jsonl              # IPC event bus (gitignored by default)
  feedback.jsonl            # user feedback sink (git-tracked)
  director/                 # director working files (git-tracked)
    gaps.md                 # current gap list + state header (rewritten each tick)
    inflight.md             # tasks assigned, not yet completed (rewritten each tick)
    blocked.md              # stuck tasks with reason (rewritten each tick)
    director.paused         # sentinel; presence = paused (deleted on resume)
    specs/<slice>.md        # written by /task before TDD loop
    qa/<ref>.md             # written by /qa after verification
  local-dev-dash/           # webui contract (git-tracked; director generates each tick)
    main.html               # entry point — renders mission, gaps, metrics, lanes
    mission.md              # restated objective
    metrics.svg             # KPI chart toward mission completion
    lanes.json              # roadmap lanes (gaps → tasks → done)
```

`local-dev-dash/main.html` is the dashboard contract. Webui iframes or links to it; the repo
owns what's inside. Inspectable with a plain browser — no server required. Director regenerates
it at the end of every tick from its working files. arc-webui sidebar chat annotates against
`main.html` anchors and writes annotations to the `feedback-sink` binding — no ledger touch.

## Epistemic gates (prove-before-scale)

- `task.completed` without `evidence:[{path,description}]` → rejected, re-queued
- `qa.passed` without `evidence` → rejected, re-queued
- `qa.failed` without `reproduction` → rejected, re-queued
- User feedback → never creates a task directly; dispatches `/qa` first
- User feedback batched by `(feature, version, resource)` — count increases trust, QA still required

## Event schema

```jsonl
{"id":"evt_01","type":"task.assigned","status":"open","ts":1751234567,"slice":"auth/login","acceptance":"all edge cases green","worker_id":"tdd-agent"}
{"id":"evt_02","type":"task.completed","status":"resolved","ts":1751234890,"ref":"evt_01","worker_id":"tdd-agent","evidence":[{"path":"tests/auth.test.ts","description":"12/12 green"},{"path":"src/auth/login.ts","description":"matches spec"}]}
{"id":"evt_03","type":"qa.passed","status":"resolved","ts":1751235000,"ref":"evt_02","evidence":[{"path":"qa/screenshots/login-2.1.0.png","description":"happy path, no friction"}]}
{"id":"fb_01","type":"user.feedback","status":"open","ts":1751235100,"feature":"auth/login","version":"2.1.0","resource":"/login","description":"submit button unresponsive on mobile"}
```

## What director does NOT own

- How worker agents are spawned (declared in `AGENTS.md` bindings)
- Worktree/workspace creation (owned by `/task`)
- QA execution (owned by `/qa`)
- Feedback injection (owned by `/feedback`)
- Ledger tracking (owned by `arc-agents` if installed)
- Dashboard display (owned by `arc-webui` if installed)
