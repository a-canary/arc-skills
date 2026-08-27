---
surveyed_at_sha: 0ee383652a56756f1883ceef75f25985eec30120
scope: [skills/, bin/, docs/, AGENTS.md]
status: stable
---

# arc-skills — Ontology Overview

Low-res index. An ontology is a **hint to verify, never ground truth** — check
any claim against live reality before acting on it; run
`bun skills/map-ontology/scripts/ontology-check.ts .` to test freshness
(exit 0 = fresh).

## What this repo is

The shared skill library for the arc agent estate. ~85 skills under
`skills/`, one directory per skill (`SKILL.md` + optional scripts), consumed
by pi, claude, and the arc-agents factory workers. Plus `bin/` hygiene
scripts and `docs/` (ADR, AXI contract, proposals).

## Topic files

| File | Covers |
|---|---|
| `skills-catalog.md` | the skill set itself: clusters, naming, authoring discipline |
| `behavioral-rules.md` | canonical AGENTS.md + harness symlink map |
| `knowledge-and-dream.md` | ke knowledge skills, dream/gap self-improvement loop |
| `scheduling-and-hygiene.md` | bin/ scripts and the cron entries that drive them |
| `factory-consumers.md` | how arc-skills plugs into the arc-agents factory + AXI |

## Placement policy (operator ruling 2026-08-24)

Project-scoped maps live in the repo (`docs/ontology/`); meta maps that span
all/most repos live in `~/vault/ontology/`. This dir is arc-skills' own map.
