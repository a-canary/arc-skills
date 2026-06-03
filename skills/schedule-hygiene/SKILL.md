---
name: schedule-hygiene
description: Write cron / systemd-timer entries that fire hygiene skills on a schedule via `claude --bg`. Detects scheduler, idempotent install.
---

# schedule-hygiene (pointer)

> **Status (2026-06-03):** this skill originally described a from-scratch
> `claude --bg --skill <name> --project <repo>` installer that was never the
> actual path in this profile. The real hygiene rotation lives in two
> consumer files; treat *those* as the source of truth and this file as
> a pointer.

## Actual implementation

- **`~/repos/arc-agents/bin/hygiene-tick.ts`** — round-robin cron tick
  (every 6h) that reads `~/.config/arc/hygiene.yaml` (skills + repos list)
  and creates a `type=cron` task the factory dispatches. Skip-not-stack:
  a repo with an OPEN hygiene task is skipped. Created 2026-05-28 per the
  `0 10,16,22,4 * * *` crontab entry; rotation works through 13 repos
  (arc-agents, arc-webui, arc-skills, ke, cli-proxy, pipeliner,
  discord-bridge, expert-horde, conjecture, trading, llm-judge, dream,
  starlight-slm) and 3 skills (improve-architecture, trash-retired-files,
  analyse-recent-sessions).
- **`~/.config/arc-hygiene/nightly-self-improve.sh`** — nightly dream +
  token-waste + adaptation-review run via `claude -p "/$1"
  --permission-mode acceptEdits --allowedTools Read Write Edit Glob Grep
  Bash Task` (NOT `claude --bg`). Marker block in crontab:
  `# >>> arc-skills:nightly-self-improve >>>`. Fires 03:00 local.

## What this skill used to describe

The original SKILL.md (2026-Q2 draft) specified a `claude --bg` cron entry
per skill, idempotent marker blocks, and a `--schedule custom.yaml` override.
The implementation diverged because `bun .../hygiene-tick.ts` + a cron
entry is simpler and lets the factory dispatch the work through the normal
claim path. The original sections (Detection / Invocation pattern /
Idempotent install / CLI / Disk-pressure guard / Guards on the installer)
are preserved in `git log -p skills/schedule-hygiene/SKILL.md` for
historical reference; they do not reflect the current install.

## What this skill does NOT do

- Does not install anything. The two consumer files above are the install.
- Does not run for repos that don't appear in `~/.config/arc/hygiene.yaml`'s
  `repos:` list. Add a repo there to opt in.
- Does not auto-apply skill *output*. The factory worker that claims the
  `type=cron` task produces the PR; humans (or a follow-up review skill)
  decide what to act on.
