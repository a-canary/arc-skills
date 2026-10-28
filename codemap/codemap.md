---
generated: 2026-10-28T06:56:30.137Z @9670fcc
project: arc-skills
ecosystems: [unknown]
source_files: 92
test_files: 3
graph_source: madge
graph_analyzed: true
dead_count: 1
untested_count: 1
cycle_count: 0
tool: codemap
---

# Codemap — arc-skills

> Deterministic static snapshot (no LLM). Re-run after changes and diff `codemap.json` to see what moved.

## Module shapes (LOC by module)
_Modules = import communities (Louvain over the import graph)._

- `skills` — 20776 LOC
- `bin` — 518 LOC
- `skills::capacity` — 132 LOC
- `arc-agents` — 12 LOC

## Seams (cross-module import edges)

- skills::capacity -> skills — 2

## Layout vs clustering (dir ↔ community)

_Modules grouped by import community, not folder. Disagreements are architecture leads._

**Directory split across communities** (leaky boundary / candidate split):
- `skills/` → 2 communities: skills, skills::capacity

## Dead code candidates (1)

_Source files with no inbound import and not an entrypoint. Verify before deleting — dynamic/CLI/plugin loads aren't seen._

- `skills/jsonl-db/lib/jsonl-db.ts`

## Untested source (1)

_No test file imports it and no sibling test exists. Heuristic — wire up coverage for precision._

- `skills/jsonl-db/lib/jsonl-db.ts`

## Import cycles (0)

_none detected_

## Possible redundancy

**Same filename in multiple dirs** (low signal — often normal per-package structure):
- `__init__.py` ×9
- `pptx_chart.py` ×3
- `pptx_slide.py` ×3
- `pptx_theme.py` ×3
- `soffice.py` ×3
- `validate.py` ×3
- `base.py` ×3
- `docx.py` ×3
- `pptx.py` ×3
- `redlining.py` ×3


## Config files (3)

- `.beads/.gitignore`
- `.gitignore`
- `skills/fresh-deploy-friction/scripts/Dockerfile`

## Top external deps

- `pathlib` — 47 imports
- `sys` — 43 imports
- `re` — 39 imports
- `tempfile` — 31 imports
- `json` — 25 imports
- `argparse` — 24 imports
- `zipfile` — 24 imports
- `os` — 15 imports
- `subprocess` — 15 imports
- `helpers` — 15 imports
- `defusedxml.minidom` — 10 imports
- `__future__` — 9 imports
- `lxml.etree` — 9 imports
- `typing` — 8 imports
- `posixpath` — 8 imports
- `datetime` — 7 imports
- `office.soffice` — 6 imports
- `defusedxml.common` — 6 imports
- `defusedxml.ElementTree` — 6 imports
- `node:fs` — 5 imports
- `time` — 5 imports
- `shutil` — 5 imports
- `office.helpers` — 5 imports
- `random` — 5 imports
- `node:path` — 4 imports

## Docs with frontmatter (118)

- `.agents/skills/beads/SKILL.md` — name=beads, description=Use when working in a repository that us
- `skills/adaptation-review/SKILL.md` — name=adaptation-review, description=Read-only review of the last N days of s, allowed-tools=Read, Write, Glob, Task, Bash
- `skills/adaptation-review/agents/regression-reviewer.md` — name=regression-reviewer, description=Review the last N days of dream/token-wa, tools=Read, Glob, Grep, Bash, model=opus
- `skills/agent-mode/SKILL.md` — name=agent-mode, description=Declares an explicit role mode (director
- `skills/anti-sycophancy/SKILL.md` — name=anti-sycophancy, description=Strip validating, hedging, and flatterin
- `skills/api-providers/SKILL.md` — name=api-providers, description=LLM/API provider registry — pass-store k
- `skills/apply-mission/SKILL.md` — name=apply-mission, description=Gap-analyse all axes in ~/vault/missions
- `skills/ask-claude/SKILL.md` — name=ask-claude, description=Thin cross-model Opus call — no tools, n
- `skills/auto-oversight/SKILL.md` — name=auto-oversight, description=One headless oversight pass over the NEX
- `skills/berzerk/SKILL.md` — name=berzerk, description=Relentless autonomous goal-pursuit mode 
- `skills/blockdoc/SKILL.md` — name=blockdoc, description=Edit long nested files (HTML, JSON, YAML
- `skills/blog/SKILL.md` — name=blog, description=Pre-PR. Draft a blog entry and write it 
- `skills/cam/SKILL.md` — name=cam, description=Design a Collector/Adaptor/Monitor judgm
- `skills/capacity/SKILL.md` — name=capacity, description=Shared-capacity ledger + advisory router
- `skills/caveman/SKILL.md` — name=caveman, description=>
- `skills/champion-challenger/SKILL.md` — name=champion-challenger, description=Design and run a champion/challenger loo
- `skills/cli-proxy/SKILL.md` — name=cli-proxy, description=Local OpenAI-compatible LLM endpoint htt
- `skills/code-review/SKILL.md` — name=code-review, description=Review changes since a fixed point (comm
- `skills/codebase-design/SKILL.md` — name=codebase-design, description=Shared vocabulary for designing deep mod
- `skills/codemap/SKILL.md` — name=codemap, description=Generate a deterministic PlantUML map + 
- `skills/coding-standards/SKILL.md` — name=coding-standards, description=Default language-routing, strictness, di, license=MIT
- `skills/continue/SKILL.md` — name=continue, description=Resume protocol — reconstruct work state
- `skills/counsel/SKILL.md` — name=counsel, description=Adversarial counsel session with 5 exper
- `skills/craft-defaults/SKILL.md` — name=craft-defaults, description=Default engineering posture for AI agent
- `skills/dart/SKILL.md` — name=dart, description=Frame the system before you act. Run a D
- `skills/decompose-skill/SKILL.md` — name=decompose-skill, description=Split a SKILL.md over 100 lines into foc
- `skills/defend/SKILL.md` — name=defend, description=The Defend* gate family — named critical
- `skills/define-mission/SKILL.md` — name=define-mission, description=HITL interview that defines or refines a
- `skills/design-an-interface/SKILL.md` — name=design-an-interface, description=Generate multiple radically different in
- `skills/design-taste-frontend/SKILL.md` — name=design-taste-frontend, description=Anti-slop frontend skill for landing pag
- `skills/diagnose/SKILL.md` — name=diagnose, description=Disciplined diagnosis loop for hard bugs
- `skills/director/SKILL.md` — name=director, description=HITL mission interface. The user's prima
- `skills/docker/SKILL.md` — name=docker, description=Docker discipline for mission automation, disable-model-invocation=true
- `skills/domain-modeling/SKILL.md` — name=domain-modeling, description=Build and sharpen a project's domain mod
- `skills/dream-insights/SKILL.md` — name=dream-insights, description=Show the latest dream journal and adapta, allowed-tools=Read, Glob, Bash
- `skills/dream-status/SKILL.md` — name=dream-status, description=Show dream processing state and today's , allowed-tools=Read, Glob, Bash
- `skills/dream/SKILL.md` — name=dream, description=Mine conversation history for Claude's o, allowed-tools=Read, Write, Glob, Task, Bash
- `skills/dream/agents/adapter.md` — name=adapter, description=Read the daily journal and make one syst, tools=Read, Glob, Grep, Edit, Write, Bash, model=opus
- `skills/dream/agents/collector.md` — name=collector, description=Page through a conversation session and , tools=Bash, Read, Glob, Task, model=haiku
- `skills/driver/SKILL.md` — name=driver, description=AFK-capable mission driver that reads MI
