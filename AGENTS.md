# arc-skills — repo context

Global always-on behavioral rules live in `GLOBAL-RULES.md` (this repo's root)
and load once per session via each harness's user-level config symlink — do not
copy them here or into any other AGENTS.md. This file exists so path references
to `~/AGENTS.md` / `arc-skills/AGENTS.md` keep resolving.

Add arc-skills-specific rules below this line only.

## Repo rules

- Skills are the unit of distribution: one skill per directory under `skills/`,
  SKILL.md ≤ ~100 lines (split via /decompose-skill beyond that).
- The live tree IS the running state — pi loads skills from this checkout, so
  uncommitted drift changes behavior. Commit or revert deliberately.
