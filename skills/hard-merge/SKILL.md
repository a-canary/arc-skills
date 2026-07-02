---
name: hard-merge
description: Adversarial pre-merge review gate for merge-on-clear — cheap mechanical checks first (green tests, lint on diff files, CI on head SHA, merge state CLEAN), then shape (git diff line-by-line, codemap diff, nitpick out-of-scope changes and unneeded files), then adversarial reasoning (name assumptions, what-would-make-this-wrong, top risks, principles/rules violated). Use before merging any PR you own, when acting as an independent reviewer, when the user says "hard-merge", "merge-on-clear", "adversarial review before merge", or "review this before I merge".
---

# hard-merge

Adversarial review before a merge-on-clear. **Assume the diff is wrong; try to prove it; merge only when you fail.**

## Frame

Two roles, never the same agent. **Author** produced the diff. **Reviewer** (you) is a different session that never saw the author's reasoning, prompted to hunt blockers — not bless work. Author never approves own work; self-judge proves consistency, not correctness. Merge only when an independent reviewer clears AND the local merge-gate is green. Author/subagent reports are UNTRUSTED — verify every checkable claim against source.

Default posture: *this diff is wrong until I fail to break it.*

## The gate — hard-fail short-circuits, cheapest first

### 1. Mechanical (binary, no judgment)
- [ ] Tests green — and the *right* tests. Baseline: did they fail before the change? A test passing at both HEADs proves nothing.
- [ ] Lint/format/typecheck on the **diff files**, not "repo looked fine." `biome check` = format + lint; a formatter error in your own files hides behind pre-existing warnings.
- [ ] CI conclusion on the **head SHA**, not reviewer-local env (reviewer-local-green masks CI-red when reviewer holds a secret CI lacks). Check-runs 403 -> gate on `mergeStateStatus=CLEAN` + predict CI locally.
- [ ] Merge state terminal, re-polled at merge time: `OPEN, MERGEABLE, CLEAN`, all checks `COMPLETED/SUCCESS`.

### 2. Shape of the change
- [ ] **`git diff` read line-by-line** — every hunk, the actual lines, not the summary.
- [ ] **Codemap/structure diff** — module shape change the PR didn't claim? New seam, new dependency edge, dead code introduced?
- [ ] **Nitpick out-of-scope changes** — files the ticket never mentioned, drive-by reformat, unrelated "while I was here" fix, unrequested version bump. Each is a blocker, not a courtesy.
- [ ] **Nitpick unneeded files** — new file that adds no value or duplicates existing code; scratch/debug/backup files (`*.tmp`, `*.bak`, `*-backup.*`, `k.sh`, `r.sh`); committed build output, logs, dumps, `.env`. Should it be deleted or gitignored instead of merged? Flag it.

### 3. Adversarial reasoning (the expensive part)
- [ ] **Name every assumption** the change makes: input non-null? list sorted? single writer? clock monotonic? Each unstated assumption is a latent bug — an assumption you can't name you can't check.
- [ ] **What-would-make-this-wrong** — for each assumption, the concrete input/state that violates it: empty list, concurrent writer, clock skew, 10k rows, non-ASCII, retry firing twice. Name the breaking case -> it's a finding.
- [ ] **Top risks**, ranked: data loss > silent corruption > crash > wrong output > perf. Worst thing this diff does if my worst assumption holds?
- [ ] **Principles/rules violated** — vs project doctrine (CLAUDE.md, ADRs, coding-standards), not vibes. Red gate footnoted out-of-scope? Trust boundary with validation stripped? New dependency where a few lines would do? Abstraction with one implementation?

### 4. Verdict
- [ ] Every checkable claim in the author's PR text verified against source — grep the constant, don't trust prose.
- [ ] Findings ranked most-severe first. Blocker -> back to author, not merged with a footnote (red gate = one obligation).
- [ ] Clear ONLY when nothing survives verification. Reviewer clears + merges in one act. Reversible path preferred; export-to-trash before any delete.

## Why this order

Broken build makes reasoning moot — don't spend tokens reasoning about a diff that doesn't typecheck. Assumptions before risks: can't rank what you haven't named. Verify-against-source last: most expensive, only matters once the diff looks plausible.
