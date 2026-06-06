---
name: schedule-hygiene
description: Write cron / systemd-timer entries that fire hygiene skills on a schedule via `claude -p`. Detects scheduler, idempotent install.
---

# schedule-hygiene

Hygiene skills only help if they actually run. This skill installs the scheduler entries that fire them.

## What it installs

| When | Skill | Why |
|---|---|---|
| Daily 04:00 | `trash-retired-files` (project-wide scan) | Catch dead code and stale artifacts before they accumulate |
| Hourly | Disk-pressure guard | If `df ~` > 90%, purge `~/trash/` entries older than 30d and old `/tmp` files |
| Weekly Sun 05:00 | `decompose-skill` (scan SKILL.md > 100 lines) | Keep skills focused as they evolve |
| Weekly Sun 05:30 | `improve-codebase-architecture` per repo | Surface drift before it becomes debt |
| Monthly 1st | `profiling-ladder` audit | Catch over-engineering and premature optimization |

The schedule is the **default**. Users override with `--schedule custom.yaml`.

## Detection

```
1. Check for systemd: `systemctl --user status` → if available, use systemd-timer
2. Else check for cron: `crontab -l` → if available, use cron
3. Else: print the entries and ask the user to install manually
```

## Invocation pattern

Each entry shells out to:

```bash
claude -p "/$SKILL_NAME" --permission-mode acceptEdits --allowedTools "$TOOLS" \
  > ~/.cache/arc-hygiene/<name>.log 2>&1
```

`-p` = print (headless, no TTY required) — fires the skill as a one-shot
non-interactive turn. The skill writes its report to the log; a human reviews
when convenient. Nothing auto-applies.

## Idempotent install

All entries live inside a marker block so reruns are clean:

```cron
# >>> arc-skills:schedule-hygiene >>>
0 4 * * *  claude -p /trash-retired-files > ~/.cache/arc-hygiene/trash-retired-files.log 2>&1
0 * * * *  /usr/local/bin/arc-disk-guard.sh
0 5 * * 0  claude -p /decompose-skill > ~/.cache/arc-hygiene/decompose-skill.log 2>&1
30 5 * * 0 claude -p /improve-codebase-architecture > ~/.cache/arc-hygiene/improve-codebase-architecture.log 2>&1
0 6 1 * *  claude -p /profiling-ladder > ~/.cache/arc-hygiene/profiling-ladder.log 2>&1
# <<< arc-skills:schedule-hygiene <<<
```

systemd version uses a single `arc-hygiene.target` pulling in per-skill `.timer` units, all named `arc-hygiene-*.timer` for the same idempotency.

## CLI

```bash
schedule-hygiene install              # detect scheduler + write entries (dry-run preview first)
schedule-hygiene install --apply      # actually write
schedule-hygiene install --apply --scheduler cron|systemd
schedule-hygiene uninstall            # remove the marker block
schedule-hygiene status               # show installed entries + last run + last exit code
```

## Disk-pressure guard (the hourly job)

This one is small enough to inline. The hourly entry runs:

```bash
#!/usr/bin/env bash
# /usr/local/bin/arc-disk-guard.sh
set -euo pipefail
usage=$(df ~ --output=pcent | tail -1 | tr -dc '0-9')
[[ $usage -lt 90 ]] && exit 0
# Over threshold: purge ~/trash entries > 30d, /tmp entries > 7d
find ~/trash -mindepth 1 -maxdepth 1 -mtime +30 -exec rm -rf {} + 2>/dev/null
find /tmp -mindepth 1 -maxdepth 1 -mtime +7 -uid "$(id -u)" -exec rm -rf {} + 2>/dev/null
echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"action\":\"disk-guard\",\"usage_pct\":$usage}" >> ~/.cache/arc-hygiene/disk-guard.log
```

The guard never touches `~/trash` entries newer than 30d — restores stay possible.

## Guards on the installer itself

- Refuse to install if marker block already exists with different contents (require `--force` or `uninstall` first)
- Refuse to install systemd entries if `~/.config/systemd/user/` is read-only
- Always show a dry-run preview before writing
- Log the install action to `~/.cache/arc-hygiene/install.log` so an uninstall can be audited

## What it does NOT do

- It does not auto-apply hygiene skill *output*. Skills produce reports; humans (or a separate review skill) decide what to act on.
- It does not run for repos that don't opt in. The `improve-codebase-architecture` and per-repo `decompose-skill` entries iterate a list at `~/.config/arc-hygiene/repos.txt` — empty by default.
