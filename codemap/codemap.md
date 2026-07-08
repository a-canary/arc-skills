---
generated: 2026-07-08T10:02:33.264Z @c9408a0
project: arc-skills
ecosystems: [unknown]
source_files: 8
test_files: 0
graph_source: madge
graph_analyzed: false
dead_count: null
untested_count: null
cycle_count: null
tool: codemap
---

# Codemap — arc-skills

> Deterministic static snapshot (no LLM). Re-run after changes and diff `codemap.json` to see what moved.

## Module shapes (LOC by module)
_Modules = directories (no import graph to cluster)._

- `skills` — 2813 LOC

## Seams (cross-module import edges)

_none detected_

## Signals — dead / untested / cycles

_Not computed: the import graph is JS/TS-only and this repo's source is another language (Python/Go/Rust/unknown). Inventory, module shapes, configs and docs above are still accurate; treat dead/untested/cycle as **unmeasured**, not zero._

## Possible redundancy

_none detected_

## Config files (2)

- `.gitignore`
- `skills/fresh-deploy-friction/scripts/Dockerfile`

## Top external deps

- `argparse` — 5 imports
- `sys` — 5 imports
- `json` — 4 imports
- `pathlib` — 4 imports
- `datetime` — 3 imports
- `re` — 3 imports
- `node:fs` — 2 imports
- `node:child_process` — 2 imports
- `node:os` — 2 imports
- `node:path` — 2 imports
- `collections` — 2 imports
- `fs` — 2 imports
- `os` — 1 imports
- `subprocess` — 1 imports
- `node:url` — 1 imports
- `pkg` — 1 imports
- `typing` — 1 imports
- `extract` — 1 imports
- `readline` — 1 imports
- `hashlib` — 1 imports

## Docs with frontmatter (63)

- `skills/adaptation-review/SKILL.md` — name=adaptation-review, description=Review the last N days (default 10) of s, allowed-tools=Read, Write, Glob, Task, Bash
- `skills/adaptation-review/agents/regression-reviewer.md` — name=regression-reviewer, description=Review the last N days of dream/token-wa, tools=Read, Glob, Grep, Bash, model=opus
- `skills/anti-sycophancy/SKILL.md` — name=anti-sycophancy, description=Strip validating, hedging, and flatterin
- `skills/api-providers/SKILL.md` — name=api-providers, description=LLM/API provider registry — pass-store k
- `skills/berzerk/SKILL.md` — name=berzerk, description=>
- `skills/blog/SKILL.md` — name=blog, description=Pre-PR. Draft a blog entry and write it 
- `skills/cam/SKILL.md` — name=cam, description=Design a Collector/Adaptor/Monitor (CAM)
- `skills/caveman/SKILL.md` — name=caveman, description=>
- `skills/champion-challenger/SKILL.md` — name=champion-challenger, description=Design and run a champion/challenger sel
- `skills/cli-proxy/SKILL.md` — name=cli-proxy, description=Local OpenAI-compatible LLM endpoint htt
- `skills/codemap/SKILL.md` — name=codemap, description=Generate a deterministic PlantUML map + 
- `skills/coding-standards/SKILL.md` — name=coding-standards, description=Default language-routing, strictness, di, license=MIT
- `skills/counsel/SKILL.md` — name=counsel, description=Run an adversarial counsel session with 
- `skills/craft-defaults/SKILL.md` — name=craft-defaults, description=Default engineering posture for AI agent
- `skills/dart/SKILL.md` — name=dart, description=Frame the system before you act. Run a D
- `skills/decompose-skill/SKILL.md` — name=decompose-skill, description=Split a SKILL.md over 100 lines into foc
- `skills/diagnose/SKILL.md` — name=diagnose, description=Disciplined diagnosis loop for hard bugs
- `skills/director/SKILL.md` — name=director, description=AFK-capable mission driver that reads MI
- `skills/dream-insights/SKILL.md` — name=dream-insights, description=Show the latest dream journal and adapta, allowed-tools=Read, Glob, Bash
- `skills/dream-status/SKILL.md` — name=dream-status, description=Show dream processing state and today's , allowed-tools=Read, Glob, Bash
- `skills/dream/SKILL.md` — name=dream, description=Mine conversation history for Claude's o, allowed-tools=Read, Write, Glob, Task, Bash
- `skills/dream/agents/adapter.md` — name=adapter, description=Read the daily journal and make one syst, tools=Read, Glob, Grep, Edit, Write, Bash, model=opus
- `skills/dream/agents/collector.md` — name=collector, description=Page through a conversation session and , tools=Bash, Read, Glob, Task, model=haiku
- `skills/feedback/SKILL.md` — name=feedback, description=Injects structured user feedback into a 
- `skills/fresh-deploy-friction/SKILL.md` — name=fresh-deploy-friction, description=Spin up a throwaway fresh-user container
- `skills/git-guardrails-claude-code/SKILL.md` — name=git-guardrails-claude-code, description=Set up Claude Code hooks to block danger
- `skills/grill-me/SKILL.md` — name=grill-me, description=Interview the user relentlessly about a 
- `skills/grill-with-docs/SKILL.md` — name=grill-with-docs, description=Grilling session that challenges your pl
- `skills/handoff/SKILL.md` — name=handoff, description=Compact the current conversation into a , argument-hint=What will the next session be used for?
- `skills/hard-merge/SKILL.md` — name=hard-merge, description=Adversarial pre-merge review gate for me
- `skills/improve-codebase-architecture/SKILL.md` — name=improve-codebase-architecture, description=Find deepening opportunities in a codeba
- `skills/install-anti-sycophancy/SKILL.md` — name=install-anti-sycophancy, description=Install a UserPromptSubmit + Stop hook p
- `skills/install-behavioral-rules/SKILL.md` — name=install-behavioral-rules, description=Symlink every harness's user-level confi
- `skills/install-to-trash/SKILL.md` — name=install-to-trash, description=Install a PreToolUse hook that intercept
- `skills/jsonl-db/SKILL.md` — name=jsonl-db, description=Append, query, update, and GC a .jsonl f
- `skills/karpathy-guidelines/SKILL.md` — name=karpathy-guidelines, description=Behavioral guidelines to reduce common L, license=MIT
- `skills/ke-memory/SKILL.md` — name=ke-memory, description=Use the knowledge engine for durable cro
- `skills/ke/SKILL.md` — name=ke, description=Knowledge Engine — one CLI for semantic 
- `skills/migrate-to-shoehorn/SKILL.md` — name=migrate-to-shoehorn, description=Migrate test files from `as` type assert
- `skills/pipeliner/SKILL.md` — name=pipeliner, description=Build/run pipeliner modules (npm pi-pipe
