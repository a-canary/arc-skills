---
surveyed_at_sha: 0ee383652a56756f1883ceef75f25985eec30120
scope: [skills/]
status: stable
---

# Skills catalog

~85 skills in `skills/`, one directory per skill, each a `SKILL.md` with
frontmatter (`name`, `description`; some add `disable-model-invocation`).
Skills are prompt-level procedures — the description is the routing key the
harness matches against.

## Clusters (by job, not by letter)

- **Planning / mission**: `director/`, `wayfinder/`, `mission-metrics/`,
  `apply-mission/`, `define-mission/`, `wargame/`, `execute-wargame/`,
  `grilling/`
- **Execution slices**: `task/`, `ralph/`, `lite/`, `berzerk/`,
  `paper-prototype/`
- **Judgment / gates**: `counsel/`, `objective-counsel-approval/`,
  `champion-challenger/`, `hard-merge/`, `code-review/`, `qa/`,
  `human-gate-post-webui/`
- **Self-improvement loop**: `dream/`, `dream-insights/`, `dream-status/`,
  `token-waste/`, `gap-remediate/`, `analyse-recent-sessions/`,
  `skillopt-lite/`, `adaptation-review/`
- **Knowledge**: `ke/`, `ke-memory/`, `research/`, `youtube-extract/`
- **Routing / capacity**: `api-providers/`, `slow-lane/`, `capacity/`,
  `cli-proxy/` (stale — see findings), `pipeliner/`
- **Hygiene / estate**: `schedule-hygiene/`, `estate-hygiene/`,
  `trash-retired-files/`, `to-trash/`, `clarify-docs` (arc-agents side),
  `fresh-deploy-friction/`
- **Meta-skills about skills**: `write-a-skill/`, `decompose-skill/`,
  `find-skills/`, `map-ontology/`

## Authoring discipline

- Long skill (>~100 lines) → split via `decompose-skill/`.
- New skill shape via `write-a-skill/` (progressive disclosure: SKILL.md
  stays a router; heavy reference moves to sibling files).
- Skills that wrap a CLI encode the gotchas, not the man page.

## Consumption

pi and claude load skills from this repo (symlinked or path-referenced per
harness); arc-agents factory workers receive skill paths in prompts. A skill
is "live" only if some harness or worker actually references it — orphan
skills rot silently (that's what the estate-hygiene audit is for).
