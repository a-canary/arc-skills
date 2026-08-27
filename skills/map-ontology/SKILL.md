---
name: map-ontology
description: Write or refresh a repo's machine-verifiable ontology — docs/ontology/ topic files with certification stamps (surveyed_at_sha + scope), checked by the deterministic staleness classifier, rendered to one self-contained HTML. Use when asked to "map this repo", build/refresh its ontology, check whether an ontology is stale, or render it for humans.
---

# map-ontology

An ontology is a **hint to verify, never ground truth**. It compresses the
cost of re-surveying reality; it does not replace surveying.

## Claim format (machine-verifiable)

Docs certify claims with backticked tokens that `scripts/ontology-check.ts`
checks against live reality:

- **Paths** — any backticked token that looks like a path (`src/app.ts`,
  `~/vault/user.md`, `/home/a/bin/x`). Must exist. Only backtick real paths;
  prose ratios like `a/b` will false-stale the doc (strict by design).
- **Crontab lines** — `` `cron: <5-field schedule> <command fragment>` ``.
  A non-comment crontab line must match both schedule and fragment.
- **Aliases** — `` `alias: planning` ``. Must resolve in
  `~/repos/arc-agents/config.json` (aliases keys or default_alias).

Everything else in a doc is prose — unverified, reader's risk.

## Doc format

One file per topic in `<repo>/docs/ontology/`, plus `OVERVIEW.md` as the
low-res index. Frontmatter certifies the doc:

```yaml
---
surveyed_at_sha: <full or short sha the doc was surveyed at>
scope: [skills/, bin/]     # paths this doc claims about; OMIT = whole repo (fail-closed)
status: stable | volatile  # informational; volatile docs get re-certified more often
---
```

Keep topic files **2–5 KB** each. OVERVIEW.md stays a low-res index — links,
one-line summaries, no deep claims.

## Freshness rule (deterministic, no LLM)

A doc is FRESH when:

1. every machine-checkable claim holds against live reality, AND
2. `git diff --name-only <surveyed_at_sha>..HEAD -- <scope>` is empty.

`docs/ontology/**` is excluded from the scope diff — a map editing itself
does not go stale (its claims are still re-verified every run). Missing
scope = whole repo. Checker error = stale (fail-closed). Exit 0 fresh /
1 stale.

```sh
bun skills/map-ontology/scripts/ontology-check.ts [repoRoot]
```

`classify()` is exported for the hygiene drift collector — one shared module,
two entry points (CLI + cron collector). Never fork the staleness logic.

## Reader rules (for consumers of an ontology)

1. **Verify-first on use.** A reader that acts on a claim must check it
   against live reality first (the claims are machine-checkable exactly so
   this is cheap). An unverified ontology citation is not evidence.
2. **Stale → refresh before using any claim.** Never read a stale doc as if
   fresh; never "partially trust" it.
3. **Never cite an ontology as ground truth in reports.** Cite the verified
   fact + the source you checked; mention the ontology doc as a pointer at
   most.

## Process

### 1. Survey

Read the repo's actual structure: `ls`, `git log --oneline -20`, crontab
lines referencing the repo, config files it reads/writes. Only certify what
you verified this pass — an uncertified claim is prose, say so if unsure.

### 2. Write docs

`docs/ontology/OVERVIEW.md` + one file per topic (2–5 KB). Stamp every doc:
`surveyed_at_sha: $(git rev-parse HEAD)` **at write time**, explicit `scope:`
paths covering what the doc claims about.

Commit order matters for a fresh first stamp: commit everything *except*
`docs/ontology/` first, then write docs stamped at that HEAD, then commit
the docs. The self-update exclusion means only `docs/ontology/**` appears in
the diff — the check exits 0 immediately.

### 3. Render

```sh
bun skills/map-ontology/scripts/render-html.ts [docsDir] [--out file]
```

One self-contained `ontology.html`: inline CSS, no external assets,
deterministic (same inputs → same bytes). Commit it alongside the docs.

### 4. Check

`ontology-check <repoRoot>` must exit 0 right after a pilot run. Demonstrate
the negative path too: touch a scoped file, expect exit 1, revert.

## Refresh (verify-first, §5b)

On `ontology-check` exit 1:

1. Read the per-doc report — which claims broke, which files changed in scope.
2. **Verify each broken claim against live reality before editing** — the
   classifier says *something* moved, not what the truth is now. Re-survey
   only the broken/changed surface (cheap pass), not the whole repo.
3. Patch the doc(s) to match verified reality.
4. **Re-stamp `surveyed_at_sha: $(git rev-parse HEAD)` after patching.**
5. Re-render HTML, re-run the check → exit 0.

## Findings pass (ticket, don't stack)

While surveying, real overlaps/conflicts/gaps get ticketed via bookie
(`--kind task --type quality` or `deferred` for experiments). **Skip-not-
stack**: before filing, search the ledger for an open row with the same
stable title; if one exists, skip — never file a duplicate.

## Intake gate (for consumers)

Planning consumers run the check at intake:

> Run `ontology-check` against your scope; if stale → verify-first refresh
> per this skill before using any claim.

Present in: this skill's refresh path, `wayfinder` intake, and
`improve-architecture` step 0 (arc-agents).

## Scripts

| Script | Purpose |
|---|---|
| `scripts/ontology-check.ts` | shared staleness classifier (`classify()` + CLI), exit 0/1 |
| `scripts/render-html.ts` | deterministic self-contained HTML renderer |

Both pure bun, no deps, table-driven tests in `scripts/*.test.ts`.
