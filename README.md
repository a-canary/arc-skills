# arc-skills

Zero-dependency, curated skills for Claude Code and similar harnesses.

Every skill here earns its slot: clear purpose, distinct value, no overlap. Lifted skills include a `SOURCE.md` with attribution to the original author.

## Layout

```
skills/
├── <skill-name>/
│   ├── SKILL.md      # the skill itself
│   ├── SETUP.md      # (only if the skill needs machine side-effects) opt-in hook/cron install + reversal
│   └── SOURCE.md     # (lifted skills only) attribution + license
```

Single-deep. No nesting, no plugins, no bundled binaries.

Most skills are pure markdown — making them visible *is* the install. A few need a hook or cron entry to work by default; those carry a `SETUP.md` next to their `SKILL.md`. The skill stays fully usable without it — `SETUP.md` only makes its behavior apply *automatically*.

## Categories

**Behavioral guardrails** — keep model output honest and on-task
- `karpathy-guidelines` — surgical changes, no over-engineering
- `caveman` — ultra-terse output mode
- `anti-sycophancy` — strip validating/hedging language
- `berzerk` — relentless autonomous goal-pursuit mode (decide via /counsel, TDD, one thin slice at a time)

**Hygiene** — keep the codebase lean
- `trash-retired-files` — reason-coded reversible GC
- `decompose-skill` — split SKILL.md files > 100 lines
- `profiling-ladder` — pick the right optimization rung (session > memory > skill > pipeline | TS > C > ASM)
- `task-priority` — UX > quality > security > scale > efficiency

**Engineering workflow** (matt-pocock)
- `tdd`, `grill-with-docs`, `grill-me`, `zoom-out`
- `to-prd`, `to-issues`, `triage`, `prototype`, `diagnose`
- `handoff`, `write-a-skill`
- `improve-codebase-architecture`, `counsel`
- `git-guardrails-claude-code`, `setup-pre-commit`, `scaffold-exercises`, `migrate-to-shoehorn`

**Env-setup installers** — write/install hooks instead of bundling runtime behavior
- `install-anti-sycophancy` — writes Stop/UserPromptSubmit hook
- `install-to-trash` — writes PreToolUse hook replacing `rm` with reversible trash-move
- `schedule-hygiene` — writes cron/systemd-timer entries that fire hygiene skills via `claude -p`

**Pre-PR**
- `blog` — drafts an entry in the ledger blog table via arc-agents API from the staged diff so the post is reviewed alongside the code

**Model discovery**
- `select-models` — discovers reachable model providers, validates choices, writes `~/.config/arc-skills.json`

**Session reflection** (supply-chain / self-improvement)
- `dream` — mine conversation history for failure modes, make one system improvement
- `dream-insights` — show latest dream journal without re-running
- `dream-status` — show dream processing state and today's journal entry counts

## Install

1. Drop the `skills/` directory (or any subset) into wherever your harness reads skills from. For Claude Code: `~/.claude/skills/` or a project's `.claude/skills/`.
2. Skills with a `SETUP.md` have opt-in side-effects (hooks, cron). Run each skill interactively to trigger those side-effects — or skip the SETUP.md entirely and use the skill as pure markdown.

Skills without a `SETUP.md` need nothing beyond step 1.

## Curation principles

1. **Zero deps.** A skill is a markdown file + optional small references. No installs.
2. **Distinct value.** If two skills overlap, one of them goes.
3. **Genericized.** No personal infra paths or private system refs in skill bodies.
4. **Attribution.** Lifted skills carry `SOURCE.md` pointing to the original.
5. **Light download, flexible install.** Behavior that must live in the harness ships as an installer skill, not bundled code.

## Doc-drift guard

Skill markdown can drift from the code it documents (wiring claims naming a
model that the agent file disagrees with, install commands that no longer
match the live install, private infra refs in `Genericized` skill bodies). The
self-heal loops (`/dream`, `/token-waste`, recency-gate) scope to the file
they identified and have not caught this drift shape in practice.

`bin/arc-skills-doc-drift.sh` is a grep test that fails on three known
falsified-claim patterns in `skills/*/SKILL.md` and `skills/*/SETUP.md`:

1. `model: minimax` in skill markdown where the matching `agents/*.md` says
   `model: haiku` (the collector.md / SKILL.md wiring-claim drift).
2. `claude --bg` in any SKILL.md (the live install is `claude -p`).
3. `home-lab-1` in any SKILL.md (private infra; curation principle #3).

Run it locally before opening a PR:

```bash
bin/arc-skills-doc-drift.sh
```

Add a new rule when a new drift shape appears — with a one-line comment
naming the commit that introduced the pattern.
