# arc-skills

Zero-dependency, curated skills for Claude Code and similar harnesses.

Every skill here earns its slot: clear purpose, distinct value, no overlap. Lifted skills include a `SOURCE.md` with attribution to the original author.

## Layout

```
skills/
├── <skill-name>/
│   ├── SKILL.md      # the skill itself
│   └── SOURCE.md     # (lifted skills only) attribution + license
```

Single-deep. No nesting, no plugins, no bundled binaries.

## Categories

**Behavioral guardrails** — keep model output honest and on-task
- `karpathy-guidelines` — surgical changes, no over-engineering
- `caveman` — ultra-terse output mode
- `anti-sycophancy` — strip validating/hedging language

**Hygiene** — keep the codebase lean
- `trash-retired-files` — reason-coded reversible GC
- `decompose-skill` — split SKILL.md files > 100 lines
- `profiling-ladder` — pick the right optimization rung (session > memory > skill > pipeline | TS > C > ASM)
- `task-priority` — UX > quality > security > scale > efficiency

**Engineering workflow** (matt-pocock)
- `tdd`, `grill-with-docs`, `grill-me`, `zoom-out`
- `to-prd`, `to-issues`, `triage`, `prototype`, `diagnose`
- `handoff`, `write-a-skill`
- `improve-codebase-architecture`
- `git-guardrails-claude-code`, `setup-pre-commit`, `scaffold-exercises`, `migrate-to-shoehorn`

**Env-setup installers** — write/install hooks instead of bundling runtime behavior
- `install-anti-sycophancy` — writes Stop/UserPromptSubmit hook
- `install-to-trash` — writes PreToolUse hook replacing `rm` with reversible trash-move
- `schedule-hygiene` — writes cron/systemd-timer entries that fire hygiene skills via `claude --bg`

**Pre-PR**
- `blog` — drafts an entry in `~/web-demo/index.html` from the staged diff so the demo artifact is reviewed alongside the code

## Install

Drop the `skills/` directory (or any subset) into wherever your harness reads skills from.

For Claude Code: copy to `~/.claude/skills/` or a project's `.claude/skills/`.

## Curation principles

1. **Zero deps.** A skill is a markdown file + optional small references. No installs.
2. **Distinct value.** If two skills overlap, one of them goes.
3. **Genericized.** No personal infra paths or private system refs in skill bodies.
4. **Attribution.** Lifted skills carry `SOURCE.md` pointing to the original.
5. **Light download, flexible install.** Behavior that must live in the harness ships as an installer skill, not bundled code.

## Slice 2: blog skill writes to ledger blog table (ADR 0007)

The blog skill now writes entries to the ledger blog table via arc-agents
createBlogPost() instead of editing ~/web-demo/index.html. See skills/blog/
for the skill definition and scripts/blog.sh for the implementation.

Usage:
  blog --dry-run    # preview without writing
  blog              # write blog row from staged diff
  ARC_TASK_ID=xxx blog  # in factory workers, origin_task_id is auto-set

Requires: arc-agents (for createBlogPost API), Bun runtime.

