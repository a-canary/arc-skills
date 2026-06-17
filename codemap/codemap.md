---
generated: 2026-06-17T10:07:46.565Z @26d8996
project: codemap-skill
ecosystems: [unknown]
source_files: 7
test_files: 2
dead_count: 0
untested_count: 0
cycle_count: 0
tool: codemap
---

# Codemap — codemap-skill

> Deterministic static snapshot (no LLM). Re-run after changes and diff `codemap.json` to see what moved.

## Module shapes (LOC by module)

- `skills` — 2647 LOC

## Seams (cross-module import edges)

_none detected_

## Dead code candidates (0)

_Source files with no inbound import and not an entrypoint. Verify before deleting — dynamic/CLI/plugin loads aren't seen._


## Untested source (0)

_No test file imports it and no sibling test exists. Heuristic — wire up coverage for precision._


## Import cycles (0)

_none detected_

## Possible redundancy

_none detected_

## Config files (2)

- `.gitignore`
- `skills/fresh-deploy-friction/scripts/Dockerfile`

## Top external deps

- `sys` — 7 imports
- `json` — 6 imports
- `pathlib` — 6 imports
- `argparse` — 5 imports
- `datetime` — 3 imports
- `re` — 3 imports
- `subprocess` — 3 imports
- `collections` — 2 imports
- `tempfile` — 2 imports
- `pytest` — 2 imports
- `os` — 1 imports
- `node:child_process` — 1 imports
- `node:fs` — 1 imports
- `node:os` — 1 imports
- `node:path` — 1 imports
- `node:url` — 1 imports
- `fs` — 1 imports
- `typing` — 1 imports
- `extract` — 1 imports
- `scripts` — 1 imports
- `contextlib` — 1 imports
- `io` — 1 imports
- `hashlib` — 1 imports

## Docs with frontmatter (47)

- `skills/adaptation-review/SKILL.md` — name=adaptation-review, description=Review the last N days (default 10) of s, allowed-tools=Read, Write, Glob, Task, Bash
- `skills/adaptation-review/agents/regression-reviewer.md` — name=regression-reviewer, description=Review the last N days of dream/token-wa, tools=Read, Glob, Grep, Bash, model=opus
- `skills/anti-sycophancy/SKILL.md` — name=anti-sycophancy, description=Strip validating, hedging, and flatterin
- `skills/berzerk/SKILL.md` — name=berzerk, description=>
- `skills/blog/SKILL.md` — name=blog, description=Pre-PR. Draft a blog entry and write it 
- `skills/cam/SKILL.md` — name=cam, description=Design a Collector/Adaptor/Monitor (CAM)
- `skills/caveman/SKILL.md` — name=caveman, description=>
- `skills/champion-challenger/SKILL.md` — name=champion-challenger, description=Design and run a champion/challenger sel
- `skills/codemap/SKILL.md` — name=codemap, description=Generate a deterministic PlantUML map + 
- `skills/coding-standards/SKILL.md` — name=coding-standards, description=Default language-routing, strictness, di, license=MIT
- `skills/counsel/SKILL.md` — name=counsel, description=Run an adversarial counsel session with 
- `skills/decompose-skill/SKILL.md` — name=decompose-skill, description=Split a SKILL.md over 100 lines into foc
- `skills/diagnose/SKILL.md` — name=diagnose, description=Disciplined diagnosis loop for hard bugs
- `skills/dream-insights/SKILL.md` — name=dream-insights, description=Show the latest dream journal and adapta, allowed-tools=Read, Glob, Bash
- `skills/dream-status/SKILL.md` — name=dream-status, description=Show dream processing state and today's , allowed-tools=Read, Glob, Bash
- `skills/dream/SKILL.md` — name=dream, description=Mine conversation history for Claude's o, allowed-tools=Read, Write, Glob, Task, Bash
- `skills/dream/agents/adapter.md` — name=adapter, description=Read the daily journal and make one syst, tools=Read, Glob, Grep, Edit, Write, Bash, model=opus
- `skills/dream/agents/collector.md` — name=collector, description=Page through a conversation session and , tools=Bash, Read, Glob, Task, model=haiku
- `skills/fresh-deploy-friction/SKILL.md` — name=fresh-deploy-friction, description=Spin up a throwaway fresh-user container
- `skills/git-guardrails-claude-code/SKILL.md` — name=git-guardrails-claude-code, description=Set up Claude Code hooks to block danger
- `skills/grill-me/SKILL.md` — name=grill-me, description=Interview the user relentlessly about a 
- `skills/grill-with-docs/SKILL.md` — name=grill-with-docs, description=Grilling session that challenges your pl
- `skills/handoff/SKILL.md` — name=handoff, description=Compact the current conversation into a , argument-hint=What will the next session be used for?
- `skills/improve-codebase-architecture/SKILL.md` — name=improve-codebase-architecture, description=Find deepening opportunities in a codeba
- `skills/install-anti-sycophancy/SKILL.md` — name=install-anti-sycophancy, description=Install a UserPromptSubmit + Stop hook p
- `skills/install-to-trash/SKILL.md` — name=install-to-trash, description=Install a PreToolUse hook that intercept
- `skills/karpathy-guidelines/SKILL.md` — name=karpathy-guidelines, description=Behavioral guidelines to reduce common L, license=MIT
- `skills/migrate-to-shoehorn/SKILL.md` — name=migrate-to-shoehorn, description=Migrate test files from `as` type assert
- `skills/profiling-ladder/SKILL.md` — name=profiling-ladder, description=Pick the right optimization rung. Move d
- `skills/prototype/SKILL.md` — name=prototype, description=Build a throwaway prototype to flesh out
- `skills/scaffold-exercises/SKILL.md` — name=scaffold-exercises, description=Create exercise directory structures wit
- `skills/schedule-hygiene/SKILL.md` — name=schedule-hygiene, description=Write cron / systemd-timer entries that 
- `skills/select-models/SKILL.md` — name=select-models, description=One-time setup that discovers reachable 
- `skills/setup-pre-commit/SKILL.md` — name=setup-pre-commit, description=Set up Husky pre-commit hooks with lint-
- `skills/task-priority/SKILL.md` — name=task-priority, description=When two concerns conflict, sort by UX >
- `skills/tdd/SKILL.md` — name=tdd, description=Test-driven development with red-green-r
- `skills/to-issues/SKILL.md` — name=to-issues, description=Break a plan, spec, or PRD into independ
- `skills/to-prd/SKILL.md` — name=to-prd, description=Turn the current conversation context in
- `skills/token-waste/SKILL.md` — name=token-waste, description=Analyze the day's conversations for toke, allowed-tools=Read, Write, Glob, Task, Bash
- `skills/token-waste/agents/adapter.md` — name=waste-adapter, description=Read the day's token-waste analysis and , tools=Read, Glob, Grep, Edit, Write, Bash, model=opus
