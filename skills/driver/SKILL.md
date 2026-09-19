---
name: driver
description: AFK-capable mission driver that reads MISSION.md / AGENTS.md / CHOICES.md, runs a gap-analysis loop, delegates to worker agents via the event bus, and gates progress on verified evidence. Spawned by director in a persistent herdr pane to drive a repo toward mission completion. Do NOT invoke directly — use /director to delegate.
---

# driver

Framework-agnostic AFK mission driver. Reads goals, identifies gaps, delegates work, watches for results, gates on evidence. Runs in a persistent herdr pane until work is complete or blocked.

## Invocation

Spawned by director via: `herdr tab create --label "driver-[repo]" --cwd [repo-path]`
with system prompt: `<skill>/sys_driver.md`

```
/driver [spec-file]       # run gap-analysis loop on spec
/driver --afk             # run until idle (no confirmation)
/driver pause             # write .arc/driver/driver.paused, halt after current tick
/driver resume            # clear .arc/driver/driver.paused, resume loop
```

## Boot sequence

1. Read (first found): `MISSION.md`, `AGENTS.md`, `CHOICES.md`, `objective.md`
2. Restate objective — what done looks like, what the constraints are
3. Read `AGENTS.md` bindings section; if missing, report to director via beads
4. Replay `.arc/events.jsonl` (full scan) to reconstruct open/inflight/pending-QA task set
5. Enter the driver loop

## Driver loop

Each tick: **budget** (governor binding; at weekly limit → critical-only) → **capacity** (advisory binding; CLI error → proceed unbound) → **gap-analysis** (read gaps.md state header + open rows; open gaps → delegate; none + inflight → sleep; none at all → idle) → **watch event bus** → **heartbeat** (5 min; backstop cron wakes idle) → **end**: regenerate dashboard.

**Tick read discipline — never dump state files whole.** `gaps.md` is append-only: only the top `state:`/`prev-state:` header and any open-gap rows drive a tick.

Read the header with the **Read tool, `offset: 1, limit: 12`** — never through Bash. On 20260725 six Bash pokes at `gaps.md` burned ~28k tokens.

`grep` `blocked.md` for open rows rather than `cat`; parse `feedback.jsonl`/`events.jsonl` by redirecting to `/tmp` and grepping OPEN rows.

**Event routing (never relax):**
- `task.completed` → evidence paths must exist, else reject + re-queue → dispatch `/qa`
- `qa.passed` non-production → close gap. **Production → do NOT close at merge**: deploy, re-dispatch `/qa` against LIVE surface; only post-deploy pass closes the gap
- `qa.failed` → check bypass triggers; retry or new slice
- `task.failed` → blocked.md; re-gap or surface to director via beads

State (written to gaps.md header): delegating · waiting:inflight · waiting:qa · idle · paused · budget-exceeded

## Blocking protocol

When blocked:
1. Write block reason to `blocked.md`
2. Create beads issue in repo `.bd/` describing the block
3. Sleep and wait for unblock (director or overseer will handle)

## What driver does NOT do

- Make scope or mission decisions (that's director's job)
- Run indefinitely without heartbeat (overseer will detect stall)
- Make unilateral production decisions (gate via beads to director)
