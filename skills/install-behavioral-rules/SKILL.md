---
name: install-behavioral-rules
description: Symlink every harness's user-level config (CLAUDE.md, pi.md, …) to the canonical AGENTS.md at the arc-skills repo root. Use when setting up a machine, or when a harness config has drifted from the canonical rules. Idempotent — safe to re-run.
---

# install-behavioral-rules

The always-on behavioral rules (concision, no-reread, recency-gate, subagent-distill, diagnostics-tier, prove-before-scale, TDD baseline) must apply on **every** turn across **every** harness. They can't be situational skills, so each harness's user-level config is a **symlink** to one canonical file.

Situational rules ship as skills instead (`vast-compute`, `ke-memory`) — those load only when relevant. This installer is only for the always-on set.

## Source of truth

`AGENTS.md` at the **arc-skills repo root**. Edit it once; every symlinked harness sees the change immediately — no re-sync step. Personal/private overlay lives in `~/vault/USER.md`, which AGENTS.md tells every agent to read first.

## Install / re-link

```
bash skills/install-behavioral-rules/inject.sh
```

The injector symlinks each target to the canonical `AGENTS.md`:
- For each harness whose config dir exists (`~/.claude/`, `~/.pi/`, …), points it at the repo-root `AGENTS.md`.
- Any pre-existing real file (or wrong-target symlink) is moved to `~/trash/` first — never clobbered.
- Idempotent: a target already linked correctly is left untouched.

To add a harness, add its user-config path to the `TARGETS` array in `inject.sh`.

## Reversal

Replace each symlink with a real file: `rm ~/.claude/CLAUDE.md && cp ~/repos/arc-skills/AGENTS.md ~/.claude/CLAUDE.md` (or restore the backup from `~/trash/`).
