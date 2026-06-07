---
name: install-behavioral-rules
description: Inject the always-on behavioral rules into every harness's user-level config (CLAUDE.md, pi.md, …). Use when setting up a machine, after editing behavioral-rules.md, or when the global behavioral rules need to be (re)synced across harnesses. Idempotent — safe to re-run.
---

# install-behavioral-rules

The always-on behavioral rules (concision, no-reread, recency-gate, subagent-distill, diagnostics-tier, prove-before-scale) must apply on **every** turn across **every** harness. They can't be situational skills, so they're injected as a marked block into each harness's user-level config.

Situational rules ship as skills instead (`vast-compute`, `ke-memory`) — those load only when relevant. This installer is only for the always-on set.

## Source of truth

`behavioral-rules.md` (next to this file). The block lives between:

```
<!-- ARC-BEHAVIORAL-RULES:BEGIN -->
…
<!-- ARC-BEHAVIORAL-RULES:END -->
```

Edit that file, then re-run the installer to re-sync everywhere.

## Install / re-sync

```
bash skills/install-behavioral-rules/inject.sh
```

The injector:
- Reads the marked block from `behavioral-rules.md`.
- For each harness whose config dir exists (`~/.claude/`, `~/.pi/`, …), replaces the block **in place** if present, else appends it.
- Idempotent: re-running never duplicates. Updating the source and re-running re-syncs all targets.

To add a harness, add its user-config path to the `TARGETS` array in `inject.sh`.

## Reversal

Delete the block (the two markers and everything between) from each target file. The markers make it trivially greppable: `grep -n ARC-BEHAVIORAL-RULES <file>`.
