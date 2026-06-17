---
name: codemap
description: Generate a deterministic PlantUML map + snapshot report of a project using static analysis (no LLM) — module shapes, seams, dead code, untested code, redundancy, configs, docs. Use when the user wants a fast codebase snapshot, a dependency/architecture diagram, to spot dead or untested or redundant code, to understand an unfamiliar repo, or to diff structure before vs after a change. Lightweight quick-look companion to improve-codebase-architecture.
---

# Codemap

Deterministic codebase snapshot. Static analysis only — **no LLM**, fast, repeatable. Run it before you touch code to orient, and after to see what moved.

Emits three artifacts into `<project>/codemap/` — **git-tracked, commit them**. They're an official structural reflection of the code, not a throwaway cache. Committing makes `git diff codemap/codemap.json` between any two commits a structural delta for free.

- `codemap.puml` — PlantUML component diagram (modules → seams, colored by signal)
- `codemap.md` — report with YAML frontmatter (totals, shapes, seams, dead, untested, redundancy, configs, docs)
- `codemap.json` — raw graph IR; commit it so each re-run diffs against it

## Quick start

```bash
npx tsx scripts/codemap.ts <project-dir>
# then read the report:
cat <project-dir>/codemap/codemap.md
```

No flags, no options — one fast best-quality process. Modules are grouped by import community (deterministic Louvain); output always lands in `<project>/codemap/`.

**Built-in progress.** Commit `codemap/codemap.json` once. Every later run diffs the fresh snapshot against the version committed at `HEAD` (read directly via `git show`, no flags) and writes `codemap.diff.md` — files added/removed, newly-dead/resolved, cycles introduced/broken, seam-weight changes — plus a one-line `Δ vs committed (HEAD)` summary in the log. No baseline committed yet → it tells you to commit one.

## When to use this vs improve-codebase-architecture

- **codemap** — quick, deterministic, before/after a change. "What's the shape? what's dead? what's untested? what moved?" Seconds, no judgment.
- **improve-codebase-architecture** — slow, opinionated, LLM-driven deepening proposals against domain language + ADRs. Use codemap's output as its input.

## Reading the output

Open `codemap.md` first — it's the human view. Open `codemap.puml` in a PlantUML renderer (VS Code PlantUML ext, `plantuml codemap.puml`, or paste into a PlantUML server) for the picture.

Signal colors: **red = dead**, **orange = untested**, **purple = cycle**, **green = test**, blue = clean.

The signals are **heuristics with known false positives** — verify before acting. Definitions, caveats, tuning, and how to extend to other languages: see [SIGNALS.md](SIGNALS.md). Read it before trusting a "dead" or "untested" flag.

## Workflow: snapshot a change

1. Before editing: `npx tsx scripts/codemap.ts .` — skim `codemap.md`, note dead/untested counts and the seams you'll touch. Commit `codemap/` so this is the baseline.
2. Make the change.
3. After: re-run. It auto-writes `codemap.diff.md` comparing the committed `HEAD` snapshot → working tree (files added/removed, newly-dead regressions, cycles introduced/broken, seam-weight changes). Commit again so the next change diffs against this one.

## Notes

- Requires `node` + `npx tsx`. Optional: `madge` for an AST-accurate JS/TS import graph (recommended — `npm i -g madge`). Uses `git ls-files` when available (respects `.gitignore`), else walks and skips `node_modules`/`dist`/etc.
- Best on JS/TS. The import graph uses **madge** (AST-accurate) when installed (`npm i -g madge`) — it reads the syntax tree, so imports written inside comments or strings never leak in as fake edges/cycles. Without madge it falls back to a regex extractor, labelled `graph_source: regex (approximate)` with a warning, since regex can mis-read commented/quoted imports. Either way it resolves monorepo workspace package names (`@scope/pkg`) and tsconfig `paths` aliases, so cross-package imports show as real seams. Python/Go/Rust get coarse file inventory; the import graph is JS/TS-only — see [SIGNALS.md](SIGNALS.md).
- Commit the `codemap/` dir — it's a tracked reflection of the code. Regenerate and re-commit as part of the change so the diff travels with the PR. The progress diff reads the committed baseline via `git show HEAD:./codemap/codemap.json` — no worktree, no re-run.
