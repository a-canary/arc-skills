---
name: scheduler
description: Serial lane scheduler for agent estates — beads are the queue, lanes are resources (claude | v100 | free, plus the human lane), priority comes from the mission. Use when deciding what a Driver runs next, routing a bead to a lane, parking on budget, filing an operator decision, or queueing a V100 batch job.
---

# scheduler

One Driver per lane pulls the next ready bead, works it for one timebox, then closes or checkpoints it.
There is no wall-clock timesharing: rotation comes from timebox → checkpoint → requeue.
Design: arc-sl5 (review page http://home-lab-1:8080/review/lane-scheduler-design.html).

## Lanes = resources, not projects

| Lane | How a bead gets there | Consumer |
| --- | --- | --- |
| human | bd label `human` (no `lane:hitl`) | operator via `bd human list` / webui `/decide` |
| claude | default (no lane label) | Claude Driver session |
| v100 | label `lane:v100` | `workbench bin/lane-run` (pi/Qwen via :8099) |
| free | label `lane:free` | 9router free tier, colab, kaggle |

Projects never own a lane; they only set priority.

## Priority (bd `-p`)

- P0 incident
- P1 ndivisible + trading
- P2 hygiene + dream
- P3 R&D (route free-first, V100 at lowest priority)

## The Driver loop

`bash ~/vault/director/scripts/driver-next.sh 3` prints the next ready beads; its header is the full protocol.
It skips human/decided-pending beads, other lanes, epics and decisions.
It emits `[v100-unrouted]` when a repo holds ready `lane:v100` beads that lane-drain does not walk: add that repo to `~/vault/director/scripts/lane-repos.txt`.
Each bead is one Sprint: `bun ~/vault/director/scripts/sprint.ts start|end`.
End states:
- done → `bd close <id> --reason "<evidence>"`
- timebox → `bd note <id> "CHECKPOINT done:… next:… state:… branch:…"` then `bd update <id> -s open -a ""`
- needs operator → one `human` card per human-gate-post-webui §2 (`<decide>` schema, rec first, posted via `lint-card.ts`); `bd dep add <id> <new>` only when no safe assumption exists
- long job → the job is its own bead; `bd dep add`, checkpoint, next

Irreversible steps (destructive delete, force-push, credential/account change, public publish) need the operator's reply to name that step.

## Budget

Meter: `~/.claude/skills/capacity/claude-window.ts` (reads `/api/oauth/usage`, no model call); one meter for all callers.
`budget-hook.sh` injects `[claude-budget] util=… pace=…` after tool calls, at most once per 5 min per session.
pace = util ÷ fraction of the window elapsed, floor 0.1, max over the 5h and 7d windows (operator 2026-10-31: offload on rate, not level).
pace > 0.80 → offload agent work: prepare new beads to the lane-run contract and label `lane:v100`.
util ≥ 0.90 → no new Claude beads; dispatch to V100 or park.
Park = `bash ~/vault/director/scripts/budget-wait.sh` in the background; it exits `BUDGET OK` when util < 0.90.
Never end a turn while driver-next shows work and util < 0.90.
Structural guard: `stop-guard.sh` Stop hook (operator installs via `install-stop-guard.sh`).

## V100 roles (operator 2026-10-31)

In priority order:
1. Agent-work spikes: Claude pace > 0.80 (Budget above).
2. LLM provider for every pipeline and Jev (laneproxy `queue` lane; latency-tolerant).
3. GPU training whenever idle (`v100-jobs.sh` in laneproxy, preemptible). Training backends: V100 first; Kaggle for overflow and parallel sweeps; Colab for interactive debugging only.
   A V100 training job must checkpoint at least every 10 min and resume from its last checkpoint, so preemption costs ≤10 min of progress.

## V100 lane

lane-run bead contract (description header, then a `---` fence, then the task):

```
Branch: <pushed branch named lane/* or v100/*, whose HEAD is a failing test>
Test: <command that goes RED → GREEN>
---
<one goal, exact files, nothing else>
```

Success closes the bead with the GREEN commit; failure labels it `qwen-failed` for re-split, never a blind retry.
Batch jobs go to `v100-jobs.sh` `ready/` (laneproxy); the name prefix sets priority: `1-ndiv-*`, `2-trading-*`, `3-rnd-*`.

## Events

An event is a bead becoming ready: job done, operator decided, recurring task due, window reset.
`wake-director.sh` wakes an idle Driver.
Mid-task preemption only for a P0 incident or window exhaustion (arc-sl5.7, not built).
Recurring work: `~/.scheduler/dispatcher.sh` + `registry.json` (minting beads with a dedup key is arc-sl5.4, not built); trade execution stays plain cron.

## Fail-open

Every scheduler piece is advisory; meter unreachable → treat as near-cap and park.
Never block a P0 on the scheduler.
