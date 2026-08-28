---
surveyed_at_sha: 0121082b8e5cfc53226e40b30337972a839783da
scope: [bin/, skills/schedule-hygiene/, skills/api-providers/]
status: volatile
---

# Scheduling & hygiene surface

`bin/` holds the repo's own cron-driven scripts (plus `lib/` and tests).
Cron entries are installed as fenced blocks (`# >>> arc-skills:<name> >>>`)
by `skills/schedule-hygiene/`, which detects the scheduler and installs
idempotently.

## Live cron entries touching this repo (certified against crontab)

| Schedule | Command | Purpose |
|---|---|---|
| `cron: 0 3 * * * nightly-self-improve.sh` | runs directly from `/home/aaron/repos/arc-skills/bin/nightly-self-improve.sh` (the old ~/.config/arc-hygiene mirror copy no longer exists) | dream/token-waste self-improvement pass via `pi -p` on `alias: hygiene` |
| `cron: 30 7 * * * selfimprove-monitor.sh` | `/home/aaron/repos/arc-skills/bin/selfimprove-monitor.sh` | monitors the nightly pass, logs to vault oversight |
| `cron: 17 */2 * * * api-providers/refresh.ts` | `bun $HOME/repos/arc-skills/skills/api-providers/refresh.ts` | refreshes the provider/model registry doc (no LLM in the cron line itself) |
| `cron: 40 6 * * 1 prune-merged-branches.sh` | `/home/aaron/repos/arc-skills/bin/prune-merged-branches.sh` | weekly merged-branch GC, log at `/home/aaron/vault/oversight/branch-gc.log` |

## Gotchas (certified)

- **Cron runs `bin/` directly.** The nightly-self-improve entry points at
  `bin/nightly-self-improve.sh`; edits land on the next run. (The old
  ~/.config/arc-hygiene mirror copy is gone; the script's header comment
  about symlink deployment is stale.)
- **PATH pinning is per-entry and inconsistent** across the ~50-line crontab.
  A bun script in cron needs an explicit PATH (recovery-sweep rc=127 incident,
  2026-08). The recovery-sweep tick (arc-agents block, see below) is the
  pinned-PATH pattern to copy.
- LLM access from cron goes through `pi -p --model arc-proxy/<alias>` (e.g.
  `alias: planning`, `alias: hygiene`) → arc-llm-proxy :8091 → e103
  Bonsai-27B. Never `claude` directly in new cron entries (cutover stranding,
  failure pattern 1).

## Sibling crons worth knowing (arc-agents block, same patterns)

- `cron: */5 * * * * recovery-sweep-tick.sh` — every 5 min, PATH-pinned
  (the rc=127 incident fix); log at `/home/aaron/.cache/arc-recovery-sweep-tick.log`.
- `alias: planning` and `alias: hygiene` are the two aliases cron actually
  uses; both currently fail over e103 → Veles (Qwen3.8) per the switchboard.
