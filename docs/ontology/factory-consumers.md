---
surveyed_at_sha: 0ee383652a56756f1883ceef75f25985eec30120
scope: [skills/task/, skills/director/, skills/hillclimb/, skills/counsel/, skills/qa/, docs/]
status: stable
---

# Factory consumers & contracts

How this repo plugs into the arc-agents factory (ledger + workers, separate
repo):

- **`skills/task/`** — the execution unit: isolated workspace, TDD contract,
  adversarial review gate, merge-or-draft-PR. Factory workers run these as
  thin vertical slices of ledger rows.
- **`skills/director/`** — AFK mission driver: reads MISSION/AGENTS/CHOICES,
  gap-analysis loop, delegates via the event bus, gates on evidence. The
  ndivisible director cron (`claude --model opus -p "/director ... --afk"`,
  every 6h) is its live instance.
- **`skills/hillclimb/`** — self-directed improvement loop driving a phase
  gate green while holding previous gates; promotion only on pre-registered
  gate wins (pairs with `champion-challenger/`).
- **`skills/counsel/`** — the decision fork: 5 experts, 2 rounds, one report.
  Always-on rule: /counsel over asking the operator.
- **`skills/qa/`** — user-perspective verification before a gap closes.

## Contracts & process docs (`docs/`)

- `docs/AXI.md` — the AXI contract for CLI design in this estate (exit codes,
  machine-readable output, idempotency). New scripts here should read it.
- `docs/ADR-skills-context-split.md` — why skills split context-heavy
  content out of SKILL.md (progressive disclosure).
- `docs/proposals/` — design proposals awaiting adoption (untracked in git
  as of this survey); the map-ontology proposal there is what this ontology
  implements.

## Routing into the factory

Worker LLM calls route through arc-llm-proxy :8091 with switchboard aliases
(`alias: driver`, `alias: planning`); background/cron work must use slow-lane
aliases (`skills/slow-lane/`) so it queues behind idle slots instead of
stealing interactive capacity. `skills/capacity/` is the advisory
shared-capacity ledger for directors racing the same quotas — fail-open,
never blocks a dispatch.
