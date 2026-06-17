---
name: codemap
description: Generate a deterministic PlantUML map + snapshot report of a project using static analysis (no LLM) — module shapes, seams, dead code, untested code, redundancy, configs, docs. Use when the user wants a fast codebase snapshot, a dependency/architecture diagram, to spot dead or untested or redundant code, to understand an unfamiliar repo, or to diff structure before vs after a change. Lightweight quick-look companion to improve-codebase-architecture.
---

# Codemap

Deterministic codebase snapshot. Static analysis only — **no LLM**, fast, repeatable. Run it before you touch code to orient, and after to see what moved.

Emits three artifacts into `<project>/codemap/` — **git-tracked, commit them**. They're an official structural reflection of the code, not a throwaway cache. Committing makes `git diff codemap/codemap.json` between any two commits a structural delta for free.

- `codemap.puml` — PlantUML component diagram (modules → seams, colored by signal)
- `codemap.md` — report with YAML frontmatter (totals, shapes, seams, dead, untested, redundancy, configs, docs)
- `codemap.json` — raw graph IR; commit it, or diff any ref with `--vs`

## Quick start

```bash
npx tsx scripts/codemap.ts <project-dir>
# then read the report:
cat <project-dir>/codemap/codemap.md
```

Flags: `--out DIR` (default `<project>/codemap`) · `--detail file|module` (default `module`) · `--include-external` (draw external deps as clouds) · `--vs <ref>` (also write `codemap.diff.md` comparing a git ref → working tree).

Re-running preserves the previous `codemap.json` as `prev.json` and logs `Δ vs prev: dead … untested … cycles …` (the cheap last-run delta; for commit-to-commit use `--vs` or `git diff` on the committed `codemap.json`).

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
3. After: re-run, commit again. To see what moved, either `git diff codemap/codemap.json` (against the committed baseline) or run with `--vs <ref>` to get a written `codemap.diff.md` (files added/removed, newly-dead regressions, cycles introduced/broken, seam weight changes) comparing any ref to the working tree.

## Notes

- Requires `node` + `npx tsx`. Uses `git ls-files` when available (respects `.gitignore`), else walks and skips `node_modules`/`dist`/etc.
- Best on JS/TS (full import resolution + export extraction). Resolves monorepo workspace package names (`@scope/pkg`) and tsconfig `paths` aliases, so cross-package imports show as real seams, not external deps. Python/Go/Rust get coarse file inventory; import-graph resolution is JS/TS-only for now — see [SIGNALS.md](SIGNALS.md).
- Commit the `codemap/` dir — it's a tracked reflection of the code. Regenerate and re-commit as part of the change so the diff travels with the PR. `--vs` uses a throwaway git worktree under the system temp dir (auto-removed).
