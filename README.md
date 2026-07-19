# arc-skills

Zero-dependency, curated skills for Claude Code and similar harnesses.

Every skill here earns its slot: clear purpose, distinct value, no overlap. Lifted skills include a `SOURCE.md` with attribution to the original author.

**Related repos:**
- [a-canary/arc-agents](https://github.com/a-canary/arc-agents) — SQLite-ledger agent harness; one optional `task-delegation`/`event-bus` binding target for `/director`, never a hard dependency
- [a-canary/webui](https://github.com/a-canary/webui) — developer portal/dashboard; reads `/director`'s `.arc/local-dev-dash/main.html` contract

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
- `dart` — frame the system before acting: DART (Deconstruct/Analyze/Recognize/Test) + systems-thinking lens before debugging, designing, or reviewing
- `caveman` — ultra-terse output mode
- `anti-sycophancy` — strip validating/hedging language
- `berzerk` — relentless autonomous goal-pursuit mode (decide via /counsel, TDD, one thin slice at a time)
- `craft-defaults` — quality/modularity/maintainability over effort; no agent co-author trailer; never edit generated files; one-sentence-per-line markdown; reproduce bugs E2E before fixing; pixel-perfect UI

**Hygiene** — keep the codebase lean
- `trash-retired-files` — reason-coded reversible GC
- `decompose-skill` — split SKILL.md files > 100 lines
- `profiling-ladder` — pick the right optimization rung (session > memory > skill > pipeline | TS > C > ASM)
- `task-priority` — UX > quality > security > scale > efficiency
- `codemap` — deterministic (no-LLM) static-analysis snapshot → PlantUML + report: module shapes, seams, dead/untested/redundant code; diff before vs after a change

**Engineering workflow** (matt-pocock)
- `tdd`, `grill-with-docs`, `grill-me`, `zoom-out`
- `to-prd`, `to-issues`, `triage`, `prototype`, `diagnose`
- `handoff`, `write-a-skill`
- `improve-codebase-architecture`, `counsel`
- `git-guardrails-claude-code`, `setup-pre-commit`, `scaffold-exercises`, `migrate-to-shoehorn`
- `coding-standards` — default language-routing, strictness, diagnostics, and TDD rules for the arc software factory (explicit user/project instructions override)

**Mission-driven orchestration** — autonomous loop from goals to verified outcomes
- `director` — AFK mission driver: reads MISSION.md/AGENTS.md, gap-analysis loop, delegates work, gates on evidence, prove-before-scale; pause/resume; weekly token budget with critical/security bypass
- `task` — isolated thin-vertical-slice unit: workspace (worktree/treehouse), TDD contract, adversarial review, merge-or-draft-PR on clear
- `qa` — user-perspective verification: functional/friction/truthfulness/security dimensions, screenshot evidence, feeds director next tick; critical-failure and security findings trigger budget bypass
- `feedback` — structured feedback injection: optional feature/version/resource/dimension hints, writes to repo's feedback sink, director batches and dispatches /qa at threshold
- `pipeliner` — npm `pi-pipeliner` runner (`defineModule`/`defineChain` + Thompson sampling); the cron runner `director` and `schedule-hygiene` build on

**Env-setup installers** — write/install hooks instead of bundling runtime behavior
- `install-anti-sycophancy` — writes Stop/UserPromptSubmit hook
- `install-to-trash` — writes PreToolUse hook replacing `rm` with reversible trash-move
- `install-behavioral-rules` — symlinks every harness's user-level config (`CLAUDE.md`, `pi.md`, …) to the canonical `AGENTS.md`; idempotent
- `schedule-hygiene` — pointer to the real cron rotation (`hygiene-tick.ts`) that fires hygiene skills via ledger tasks

**Pre-PR**
- `blog` — drafts an entry in the ledger blog table via arc-agents API from the staged diff so the post is reviewed alongside the code

**Model discovery**
- `select-models` — discovers reachable model providers, validates choices, writes `~/.config/arc-skills.json`

**System design** — reusable architecture frameworks
- `cam` — Collector/Adaptor/Monitor judgment-gate framework: read wide, write narrow, measure over time, one append-only ledger
- `champion-challenger` — promote a challenger over the champion only past a pre-registered AND-gate
- `mission-metrics` — define/refine a mission, objectives, metrics, dashboard, and hillclimb loop per project module over the existing substrate

**Session reflection** (supply-chain / self-improvement)
- `dream` — mine conversation history for failure modes, make one system improvement
- `dream-insights` — show latest dream journal without re-running
- `dream-status` — show dream processing state and today's journal entry counts
- `adaptation-review` — read-only nightly audit of recent `/dream` + `/token-waste` self-healing changes; flags silent reverts, thrashing, and AGENTS.md rule-bloat

**Knowledge substrate** — durable memory + git-tracked data layers shared across projects
- `ke` — one CLI for semantic recall, gap-driven research (web→ingest), and persisting learnings to a Qdrant-indexed vault at `~/vault/ke/`
- `ke-memory` — the recall-before/persist-after motion the `ke` CLI exists for, framed as cross-project durable memory
- `jsonl-db` — git-tracked event bus / task store (one JSON object per line, append-only, GC); not for transactional workloads — use SQLite there

**Local LLM runtime**
- `cli-proxy` — OpenAI-compatible endpoint at `http://127.0.0.1:7890/v1` routing to claude/gemini/qwen/kilo/opencode CLIs + minimax API; use whenever code or a pipeline needs an LLM API endpoint

**Domain workflows** — narrow vertical skills for specific external systems
- `vast-cli` — drive the `vastai` CLI correctly: search/create/poll/ssh/stop, with the proxy-unset + PATH-shim + ssh-rotation traps that silently no-op the CLI
- `vast-compute` — read-before-reserving rules for shared vast.ai GPU boxes: mandatory local smoke test, cooperative lease, keep-warm batching
- `vast-instance` — on-box best practices for vast.ai GPU jobs: bandwidth-gate, `*-runtime` images, the verified LFM2.5 pin stack, HF-token guard, stage-verify
- `fresh-deploy-friction` — simulate a brand-new user in a throwaway container, drive a minimal task, convert install/operation snags into committed fixes + PRs in the source repo

## Install

```bash
# global (all skills)
npx skills add a-canary/arc-skills

# project-scoped
npx skills add a-canary/arc-skills --project
```

Skills with a `SETUP.md` have opt-in side-effects (hooks, cron). Run each skill interactively to trigger those — or skip `SETUP.md` entirely and use the skill as pure markdown.

## Curation principles

1. **Zero deps.** A skill is a markdown file + optional small references. No installs.
2. **Distinct value.** If two skills overlap, one of them goes.
3. **Genericized.** No personal infra paths or private system refs in skill bodies.
4. **Attribution.** Lifted skills carry `SOURCE.md` pointing to the original.
5. **Light download, flexible install.** Behavior that must live in the harness ships as an installer skill, not bundled code.

## Doc-drift guard

Skill markdown can drift from the code it documents (wiring claims naming a
model that the agent file disagrees with, install commands that no longer
match the live install, private infra refs violating curation principle #3).
The self-heal loops (`/dream`, `/token-waste`, recency-gate) scope to the file
they identified and have not caught this drift shape in practice.

`bin/arc-skills-doc-drift.sh` is a grep test that fails on four known
falsified-claim patterns in `skills/*/SKILL.md` and `skills/*/SETUP.md`,
plus one on-disk shape check:

1. `model: minimax` in skill markdown where the matching `agents/*.md` says
   `model: haiku` (the collector.md / SKILL.md wiring-claim drift).
2. `claude --bg` in any SKILL.md / SETUP.md (the live install is `claude -p`).
3. `home-lab-1` in any SKILL.md / SETUP.md (private infra; curation principle #3).
4. Embedded git worktree under `.claude/worktrees/`. The `.gitignore` keeps new
   ones untracked but does not catch one already on disk; a clean
   `git status` should never list anything under that path. (Pattern source:
   #17 / 4bdd21d — axi-coding-standard survived a squash-merge as 1.2M of dirt.)

Run it locally before opening a PR:

```bash
bin/arc-skills-doc-drift.sh
```

Add a new rule when a new drift shape appears — with a one-line comment
naming the commit that introduced the pattern.
