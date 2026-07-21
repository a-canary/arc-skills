---
name: define-mission
description: HITL interview that defines or refines a global mission axis in ~/vault/missions/<slug>.md — abstract goal-axis, bounded/unbounded type, values applied to all projects — then walks candidate repos dispatching /apply-mission per repo. Use when a new mission/axis is proposed or detected undefined, when an existing axis needs refinement, or when the user says "define the mission", "new mission", "add an axis", or "refine the axis".
---

# Define-Mission (axis-level)

Axes ARE the missions: one file per axis in `~/vault/missions/<slug>.md`,
global and abstract; repos interpret them locally via `/apply-mission`.
Spec: `~/vault/missions/SPEC.md`.

## Detection triggers (run this skill when…)

- A conversation, PRD, or objective names a goal that maps to **no existing
  axis** (`ls ~/vault/missions/*.md`, check `aliases:` too).
- A new value-dimension is proposed ("we should also care about X").
- An objective/metric row carries no axis tag and none fits.

Never proceed to PRD/issues/implementation on an unmapped goal — define or
extend the axis first.

## 1. Interview

Grilling method = [mission-metrics](../mission-metrics/SKILL.md) rules: one
question at a time, never answer your own question, research between
questions (read repos, mine sessions, web). Converge, in the user's own
words, on:

- **Axis** — the goal-dimension, problem/direction-shaped, not a solution.
  Abstract enough to apply across projects.
- **Slug** — append-only once minted; check collision with existing slugs
  and aliases.
- **Type** — `bounded` (needs a cap + satisficing semantics: at/above cap,
  stop optimizing and yield tiebreaks) or `unbounded` (needs a `mode`:
  `direction` = climbable, or `veto+skew` = NEVER scored — no number to
  Goodhart; it only blocks and tie-breaks).
- **Values** — the rules applied to ALL projects (vetoes, skews,
  preferences). Vetoes apply globally even where a repo has no
  interpretation yet.
- **Aliases** — legacy mission slugs/stamps this axis absorbs.

Push back: solution-shaped axes, scoreable ethics, bounded axes without a
cap, overlap with an existing axis (refine that one instead).

## 2. Write the axis file

`~/vault/missions/<slug>.md` — frontmatter `slug, axis, type, cap|mode,
values, aliases, approved` + prose body (direction + values list).
**`approved: null` always — only the user sets the approval date.** Until
approved, agents do only throw-away/exploratory work on the axis. Commit to
vault.

## 3. Walk the repos

Enumerate candidates: `~/repos/*`, aliases' legacy subscribe lists, repos
whose CHOICES/README plausibly touch the axis. For each, judge relevance in
one line; for each relevant repo dispatch
[/apply-mission](../apply-mission/SKILL.md) (batch the resulting proposals
for one approval pass). The walk may run pre-approval: its outputs are
user-gated proposals, i.e. throw-away until approved. Irrelevant repos get a recorded `n/a` — absence of
an Axis section then reads as "judged n/a", not "gap".

## 4. Persist

Bank the definition + repo-walk verdicts to ke; memory pointer if the axis
changes standing doctrine.
