---
name: mission-metrics
description: Define or refine a mission, its objectives, metrics, dashboard, and hillclimbing loop for a project, module, or feature — wired into the existing substrate (missions.json, CHOICES.md objectives fence, objective_metrics, .arc/dashboard.json). Use when starting a project/module/feature, when a dashboard shows plain chips or empty charts, when an objective has no verdict or no data, or when the user says "define the mission", "what are we optimizing", "add metrics", or "set up hillclimbing".
---

# Mission → Objectives → Metrics → Dashboard → Hillclimb

Definition discipline over the EXISTING substrate. This skill creates no new
infrastructure — it fills in four surfaces that already render:

| Layer | Lives in | Owner |
|---|---|---|
| Mission | `arc-webui/config/missions.json` `{missions: {slug: {problem, subscribes}}}` | webui repo (slugs append-only) |
| Objectives | target repo `CHOICES.md`, one ` ```objectives ` fence | target repo, PR-gated |
| Metric samples | webui SQLite `objective_metrics(project, metric, value, recorded_at)` | the **recorder** you name below |
| Charts | lead repo `.arc/dashboard.json` (rendered at `/m/:project`) | `publish-mission-dashboards.ts` or the recorder |

Hillclimb mechanics are NOT here — gate design is [champion-challenger](../champion-challenger/SKILL.md), recurring evidence⇒decision loops are [cam](../cam/SKILL.md). This skill defines *what* to climb.

## Define (new mission / module / feature)

1. **Mission = a problem, not a solution.** One sentence of who hurts and how. If the repo's mission isn't in `missions.json`, add the slug + `subscribes: [repo-dirname]` (append-only). A module/feature does NOT get its own mission — it gets objective rows under the repo's mission, goal prefixed with the module name (`webui-chat: …`).
2. **1–2 objectives max** per module. More than 2 = pick the two that matter; completion rate halves at 3+. Each objective is one fence row:
   ```
   - goal: <module>: <qualitative direction> | provenance: user-directed | metric: <name> | gate: <shape>
   ```
3. **Outcome, not activity.** A goal/metric describing work shipped ("land PR", "add endpoint") is a task, not an objective — ~half of real-world KRs fail this way. Rewrite as the behavior delta the work should cause.
4. **Metrics come in a triple** per objective:
   - **Output** (the North Star for this module) — lagging, what the mission actually wants moved.
   - **1–3 controllable inputs** — things the module can move *this week*; these are what you hillclimb. Outputs-only dashboards leave no lever to pull.
   - **Guardrail pair** — the counter-metric on the most likely gaming axis (speed↔quality, volume↔churn, pass-rate↔coverage). Target up AND guardrail flat, or no promotion.
   Extra metrics beyond the output go in as their own fence rows (the schema is flat).
5. **Gate must be machine-parseable.** `evalGate` understands exactly two shapes: band `"7-12%"` and count `"8 @ 12.5%"`. A prose gate ("cut at -5/-10") renders as a verdict-less chip forever. Prose belongs in the goal text; the gate field gets a band or count.
6. **No recorder, no metric.** A metric row without a named writer is decoration — the dominant observed failure (declared metrics with zero samples, empty dashboards). Before committing the fence row, name the recorder in the same change: which cron/script/agent appends the `objective_metrics` sample or writes the `.arc/dashboard.json` series, and at what cadence. If you can't name one, either build the one-liner recorder now or delete the metric.
7. **Baseline first.** Record the current value as the first sample before any work (TDD baseline + delta). No baseline = no way to claim the hillclimb helped.

## Refine (existing mission with dead surfaces)

Diagnose from the dashboard, unmeasured looks identical to healthy — check deliberately:

- **Plain chip, no verdict** → gate isn't band/count shaped. Reshape the gate (step 5).
- **Chip but no data / empty chart** → no recorder, or recorder dead. `sqlite3` the `objective_metrics` table for the metric's latest `recorded_at`; stale ⇒ fix or build the recorder (step 6).
- **Metric saturated** (pinned at gate for weeks) → Goodhart expiry: retire it, re-derive the next metric from fresh error analysis, keep the guardrail.
- **Objective with provenance `inferred`** → promote to `user-directed` only via the human-gated PR path; agents propose, never self-promote.
- **>2 active objectives per module** → cut to the two with live recorders.

## Hillclimb loop (per objective)

Error-analysis-first — optimizers only fix known failures; discovery finds new ones:

1. Read real traces/outcomes for the module → name the top failure mode.
2. Make the failure measurable → that's your next **input** metric (add row + recorder).
3. Run one challenger change against the champion, promotion pre-registered per [champion-challenger](../champion-challenger/SKILL.md): input ↑ ∧ output not worse ∧ guardrail flat.
4. Promote or revert, record the sample, go to 1. Recurring/scheduled version of this loop = a [cam](../cam/SKILL.md) gate, with the dashboard as its monitor.

Weekly cadence, same dashboard at every level — the review's purpose is discovering which inputs actually move the output, not status theater.

## Definition-of-done checklist

- [ ] Mission slug exists in `missions.json`, repo in `subscribes`
- [ ] ≤2 objective rows per module in the CHOICES.md fence, goals are outcomes
- [ ] Every metric: output/input/guardrail role stated in goal text
- [ ] Every gate band- or count-shaped (evalGate-parseable)
- [ ] Every metric names its recorder + cadence, first baseline sample recorded
- [ ] `/m/:project` shows verdict chips + live series (not plain chips)
- [ ] Hillclimb gate pre-registered (champion-challenger checklist)
