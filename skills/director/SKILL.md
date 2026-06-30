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
/director pause              # write .arc/director.paused, halt after current tick
/director resume             # clear .arc/director.paused, replay events since pause, resume loop
```

## Boot sequence

1. Read (first found): `MISSION.md`, `AGENTS.md`, `CHOICES.md`, `objective.md`
2. Restate objective — what done looks like, what the constraints are
3. Read `AGENTS.md` bindings section; if missing or incomplete, prompt once and write answers in
4. If not `--afk`: block for user confirmation or edit before proceeding
5. Replay `.arc/events.jsonl` (full scan) to reconstruct open/inflight/pending-QA task set
6. Enter the director loop

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
budget:
  weekly: 500k                # tokens/week per repo; resets Monday 00:00 UTC
  bypass:
    - critical-failure        # qa.failed with dimension: critical-failure
    - security                # qa.failed with dimension: security
```

## Director loop

```
check budget → at weekly limit? halt and surface to user
  (bypass: qa.failed with dimension critical-failure or security → unlimited for incident)
gap-analysis (reads .arc/gaps.md + event log)
  → open gaps? → delegate via task-delegation binding
  → no gaps, inflight/pending-QA? → sleep (event-driven)
  → no gaps, no inflight, no pending-QA? → idle; sleep until next feedback event
watch event bus (event-bus binding)
  → task.completed  → validate evidence paths exist → dispatch /qa
  → task.completed, no evidence → reject, re-queue
  → qa.passed       → close gap; rewrite .arc/gaps.md, .arc/inflight.md
  → qa.failed       → check bypass triggers; emit task.assigned (retry or new slice)
  → task.failed     → rewrite .arc/blocked.md; re-gap or surface to user
  → user.feedback   → append to feedback-sink; batch by (feature, version, resource)
                       when count ≥ threshold → dispatch /qa with batch context
heartbeat (every 5 min in --afk mode)
  → tasks open > TTL with no update → mark blocked; rewrite .arc/blocked.md
```

## Director states (reported each tick, written to .arc/gaps.md header)

| State | Meaning |
|---|---|
| **delegating** | Open gaps exist; emitting task.assigned events |
| **waiting:inflight** | Tasks assigned; no results yet |
| **waiting:qa** | Tasks completed; QA dispatched |
| **idle** | No gaps, no inflight, no pending QA; sleeping until next feedback event |
| **paused** | `.arc/director.paused` sentinel present; no ticks until `/director resume` |
| **budget-exceeded** | Weekly token limit reached; halted until user adjusts or bypass triggered |

## `.arc/` layout (director owns these files)

```
.arc/
  events.jsonl        # IPC event bus (gitignored by default)
  feedback.jsonl      # user feedback sink (git-tracked)
  gaps.md             # current gap list + director state header (rewritten each tick)
  inflight.md         # tasks assigned, not yet completed (rewritten each tick)
  blocked.md          # stuck tasks with reason (rewritten each tick)
  director.paused     # sentinel; presence = paused (deleted on resume)
  specs/<slice>.md    # written by /task before TDD loop
  qa/<ref>.md         # written by /qa after verification
```

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
