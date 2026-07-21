---
name: apply-mission
description: Propose, for user approval, how a mission axis applies to ONE repo — a CHOICES.md "## Axis:" interpretation, phase-ordered objectives, and one hillclimb(scope, metric, gate) eval per phase — landed via the apply-on-approve CHOICES.md PR lane. Use when a repo lacks an interpretation for a relevant axis, after /define-mission's repo walk, or when the user says "apply the mission to this repo", "propose objectives", or "add metric gates".
---

# Apply-Mission (repo-level)

Specializes a global axis (`~/vault/missions/<slug>.md`) into one repo's
objectives and gates. Metric-design method =
[mission-metrics](../mission-metrics/SKILL.md) §2–5; this skill is the
per-repo orchestrator. Output is a PROPOSAL — the user approves.

## 1. Ground

Read the axis file + repo state (README, CHOICES.md, ADRs, recent work).
Relevance check first: if the axis genuinely doesn't apply, record an `n/a`
verdict (one line, where the dispatcher tracks the walk) and stop.
Stale-premise gate: grep the live repo before proposing anything as
"missing".

## 2. Draft the interpretation

A `## Axis: <slug>` section for the repo's CHOICES.md:

- **Interpretation** — 2-4 sentences: how this repo serves the axis, which
  axis values bind here and how (vetoes made concrete, skews named).
- **Objectives** — per mission-metrics method: direct metric of the value
  first, nearest proxy where speed demands (name the Goodhart gap and the
  eventual confirmation), phase order (phase 1 = proves core value
  soonest; later gates keep earlier metrics in the conjunction).
- **One eval line per phase**:
  `phase N: hillclimb(scope=…, metric=…, gate=…)` — scope is what a
  challenger may change; gates compose so no phase regresses a prior win.

Every objective/metric row NAMES the axis slug — dashboards aggregate by
axis; an untagged objective is a lint gap.

## 3. Objectives fence (current phase only)

CHOICES.md ```objectives``` fence rows `goal | provenance | metric | gate`,
evalGate-parseable (band `N-M[%]` or count `N @ …`). Provenance:
`user-directed` when from a live interview, else `inferred`. **No recorder,
no metric** — name the writer + cadence for each metric's
`objective_metrics` samples in the same change. Advancing a phase is a
later PR that swaps the rows.

## 4. Propose for approval

Land via the apply-on-approve Lane-2 (webui) or a direct PR to the repo's
CHOICES.md — never merge the interpretation yourself; the user approves.
Batch with sibling repo proposals from the same walk when possible. Until
approved, the axis shows "uninterpreted" for this repo and only global
vetoes bind.

## 5. Baseline

Record the baseline sample for each phase-1 metric before any climb
(measure-before-change). Then the phase is climbable via
[/hillclimb](../hillclimb/SKILL.md).
