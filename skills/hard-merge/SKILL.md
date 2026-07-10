---
name: hard-merge
description: Adversarial pre-merge review gate for merge-on-clear — the author drives it and dispatches a freshly SPAWNED reviewer agent for independence (never reviews own work inline). Cheap mechanical checks first (green tests, lint on diff files, CI on head SHA, merge state CLEAN), then shape (git diff line-by-line, codemap diff, nitpick out-of-scope changes and unneeded files), then adversarial reasoning (name assumptions, what-would-make-this-wrong, top risks, principles/rules violated), then a blast-radius gate that escalates to /counsel when the change is not small. Use before merging any PR you own, when the user says "hard-merge", "merge-on-clear", "adversarial review before merge", or "review this before I merge".
---

# hard-merge

Adversarial review before a merge-on-clear. **Assume the diff is wrong; try to prove it; merge only when you fail.**

## Frame

Two roles, never the same agent. **Author** produced the diff and drives this gate. **Reviewer** is a **freshly spawned agent** (Agent/Task tool) that never saw the author's reasoning — the author does NOT play reviewer inline. Independence comes from a separate context, not from the author "putting on a reviewer hat." Author never approves own work; self-judge proves consistency, not correctness. Merge only when the spawned reviewer clears AND the local merge-gate is green. Reviewer/subagent reports are UNTRUSTED — the author verifies every checkable claim against source before acting on a CLEAR.

Dispatch the reviewer with: the PR/diff to review, "hunt for blockers, do not bless — this diff is wrong until you fail to break it", the §1-4 gate below, and "return a CLEAR/BLOCK verdict + findings ranked severe-first, under ~400 tokens, cite `file:line`, paste nothing." **Materialize the diff to a file ONCE** (`gh pr diff <n> > /tmp/pr<n>.diff`) and give every reviewer that one path — do not have each spawned reviewer re-run `gh pr diff` into its own context, and tell them to Read it ranged/per-hunk (`grep -n` the file for the target, Read that offset) rather than whole. With 2-3 disjoint reviewer contexts each reloading the full diff, that whole-diff reload is this gate's top token bleed; one shared on-disk copy, read ranged, pays it once. Confirm the PR head SHA hasn't drifted since dispatch before trusting the verdict.

Default posture: *this diff is wrong until the spawned reviewer fails to break it.*

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

### 4. Blast radius -> escalate to /counsel
- [ ] Estimate blast radius. **Small** = reversible, contained, low-stakes: a single skill/doc/config file, a leaf function with tests, an additive change behind a flag. **Non-small** = anything that can hurt broadly or is hard to undo: schema/migration, auth/security/trust boundary, money path, deploy/infra/CI, a shared lib or interface many callers depend on, data deletion/backfill, public API, or a diff touching many modules at once.
- [ ] **Non-small blast radius -> STOP and run `/counsel`** before merging. One spawned reviewer is not enough independence for a change that can go broadly wrong; get the 5-expert adversarial panel, then execute its verdict. Small radius -> the single spawned reviewer suffices; proceed.

### 5. Verdict
- [ ] Every checkable claim in the author's PR text verified against source — grep the constant, don't trust prose.
- [ ] Findings ranked most-severe first. Blocker -> back to author, not merged with a footnote (red gate = one obligation).
- [ ] Merge ONLY when the spawned reviewer returns CLEAR, its checkable claims verify against source, and (for non-small radius) `/counsel` has cleared it too. The author merges after verifying the verdict — the reviewer advises, it does not merge. Reversible path preferred; export-to-trash before any delete.

## Why this order

Broken build makes reasoning moot — don't spend tokens reasoning about a diff that doesn't typecheck. Assumptions before risks: can't rank what you haven't named. Blast-radius gate sits after reasoning, before verdict: you can only judge how far a change can blow once you've named its risks — and a non-small one needs `/counsel`, not a lone reviewer, before the verdict is even reachable. Verify-against-source last: most expensive, only matters once the diff looks plausible. The reviewer is spawned, not the author in a reviewer hat, because independence is a property of context, not intent — the same head can't blind itself to its own reasoning.
