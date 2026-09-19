---
name: overseer
description: Hourly herdr pane observer. Runs on 15-min cron, detects blocked or stalled panes, nudges agents to resume, reports bugs to repo beads, escalates HITL issues to director, maintains pane hygiene. Never invoked directly by user.
---

# overseer

Automated herdr pane observer. Runs every 15 minutes via cron (`overseer.sh`). Observes all panes, detects issues, takes minimal-intervention actions.

## Cadence

15-minute cron: `*/15 * * * * bash <skill>/overseer.sh >> ~/vault/director/overseer.log 2>&1`

## Observation protocol

For each herdr pane:
1. Capture recent output (tail 50 lines)
2. Compare to previous state (diff stored in `/tmp/overseer-state/`)
3. Grep for error patterns and problem indicators

## Problem detection

**Stalled pane:** Same tail output for 3+ consecutive checks
- Action: Nudge with `herdr pane send-keys <pane> enter`
- If still stalled after 2 nudges: Escalate to director via beads

**Error pattern:** grep for:
- `Error:` / `error:` / `ERROR`
- `failed` / `Failed` / `FAILED`
- `timeout` / `Timeout`
- `cannot` / `Cannot` / `Cannot find`
- `denied` / `Denied` / `permission`
- `panic` / `Panic`
- `segfault` / `core dump`

**Block indicators:** grep for:
- `waiting` / `Waiting`
- `blocked` / `Blocked`
- `need` / `Need` (human attention)
- `please` / `Please`

## Action hierarchy (minimal interruption)

1. **Nudge** — send enter or wake signal to stalled pane
2. **Notify** — send text to pane with relevant context
3. **Beads** — create issue in repo `.bd/` or `~/vault/director/.bd/`
4. **Spawn** — start new driver pane if bug is in an owned repo
5. **Escalate** — create director beads issue for HITL attention

## Bug routing

If errors indicate a bug in an owned service (e.g., arc-llm-proxy):
1. Create beads issue in that repo's `.bd/`
2. Check if driver pane is running for that repo
3. If not running: spawn new driver pane with the bug report
4. Log the action in `~/vault/director/overseer.log`

## Hygiene

- Close panes that are idle for 2+ hours with no active tasks
- Report pane count and layout suggestions to director weekly
- Clean up `/tmp/overseer-state/` files older than 24h

## State storage

- `/tmp/overseer-state/<pane-id>.txt` — last observed output per pane
- `~/vault/director/overseer.log` — action log
- `~/vault/director/.bd/` — escalation beads
