# Signals — definitions, caveats, tuning

Every signal is a cheap static heuristic. Treat as a lead, not a verdict.

## Pipeline stages

`detect → inventory → graph → signals → render`

1. **detect** — ecosystem from marker files (`package.json`, `tsconfig.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`).
2. **inventory** — file list via `git ls-files --cached --others --exclude-standard` (respects `.gitignore`); fallback walk skips `node_modules`/`dist`/`coverage`/`__pycache__`/`.venv`/`target`/`.next`. Each file classified: source / test / config / doc / output / other. LOC counted; `.md` frontmatter parsed.
3. **graph** — per source file, regex-extract `import`/`export…from`/`require`/dynamic `import()` specifiers; resolve relative ones to local files (tries `.ts .tsx .js .jsx .mjs .cjs .py .go .rs`, `index.*`, `__init__.py`, and `.js`→`.ts` rewrite). Bare specifiers → external deps. Exported symbol names extracted best-effort.
4. **signals** — dead, untested, cycles, redundancy (below).
5. **render** — PlantUML + Markdown + JSON IR.

## Signal definitions

**Dead code candidate** — a source file that (a) has ≥1 export, (b) nothing imports, (c) isn't an entrypoint. The export requirement is deliberate: a file with no exports and no inbound is a standalone *script*, not dead library code.
- False positives: dynamic/`require(variable)` loads, plugin registries, CLI command auto-discovery, framework conventions (Next.js pages, route files), reflection. Fixtures that are loaded as data show up here — expected.
- Entrypoints excluded: `package.json` `main`/`module`/`bin`/`exports`; files matching `index|main|cli|server|app|__main__`; anything under `benchmarks?|examples?|demos?|scripts?|bin`; files with a `#!` shebang; all test files.

**Untested source** — an importable unit (has exports, not an entrypoint) that no test file imports *and* has no sibling test file (`foo.ts` ↔ `foo.test.ts`/`foo.spec.ts`/`foo_test.py`).
- Heuristic only — one-hop import from tests + naming. For precision, wire up coverage (`coverage-final.json`/`lcov`) and cross-reference; not yet read automatically.

**Import cycle** — strongly-connected component (size > 1) over the local import graph, via Tarjan's algorithm. Cycles hurt testability and incremental builds.

**Redundancy** — two cheap structural hints, not semantic dedup:
- *Same filename* in multiple dirs (`utils.ts` ×3).
- *Same exported symbol name* from multiple files.
- Noise names filtered (`index`, `default`, `handler`, `main`). A hit is a prompt to look, not proof of duplication.

## Module shapes & seams

- **Module** = top-level dir, or `src/<x>` / `lib/<x>` / `app/<x>` / `packages/<x>` one level deep.
- **Shape** = file count + LOC per module (in `codemap.md` and the diagram node label).
- **Seam** = a cross-module import edge; edge weight = number of imports crossing it. High-weight seams are your real coupling points. In `--detail module` (default) edges are aggregated per module pair; in `--detail file` every file→file edge is drawn.

## Tuning

- Big repo → diagram noisy? Keep `--detail module` (default). Use `--detail file` only on a single module/subdir (`npx tsx codemap.ts ./src/foo`).
- Add `--include-external` to see which third-party deps dominate.
- Output goes to a git-tracked `codemap/` dir by default — commit it so `git diff codemap/codemap.json` between commits is a structural delta. Override with `--out DIR`.
- Commit-to-commit diff: `--vs <ref>` writes `codemap.diff.md` (files +/-, newly-dead, cycles introduced/broken, seam weight changes) for `<ref> → working tree`. It builds the ref snapshot in a temp git worktree, so it works even if `codemap/` wasn't committed at that ref.

## Extending to other languages

Import resolution and export extraction are JS/TS-first. Python/Go/Rust currently get file inventory, LOC, config/doc/output classification, and module shapes, but the dependency graph (and therefore dead/cycle signals) is only fully wired for JS/TS.

To add a language: extend `IMPORT_RE`/`EXPORT_RE` (or add a per-language extractor like `PY_IMPORT_RE`) and teach `resolveLocal` how that language maps a specifier to a file path. Everything downstream (signals, render) is language-agnostic once edges exist.

## Limitations (state these when reporting)

- Regex import extraction, not a full parser — exotic syntax or macro-generated imports can be missed.
- No type information; no call-graph (import-graph only). A file imported but whose exports are never *used* still counts as live.
- Coverage not read yet — "untested" is a naming/import heuristic.
- Single-repo; monorepo workspaces are mapped as their top-level package dirs, not resolved across `workspace:` links.
