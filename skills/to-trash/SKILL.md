---
name: to-trash
description: Reversible single-item trash action — move one path to <repo-root>/.trash/<unix-ts>_<name>/ with a reason sidecar. Use when you want to delete something now and keep a reversal trail. Single-item companion to trash-retired-files (bulk GC). Repo-agnostic; does not touch the ledger.
---

# to-trash

Reverse before destructive. Single-item deletion with a fingerprint so anything moved out can be moved back.

## Trash root (write-lane aware)

`<repo-root>/.trash/` when the path is inside a git repo or worktree, else
`/tmp/trash/`. **Not a home-level trash dir** — the arc write-lane gate
(arc-director `src/policy/check.ts`) rejects it, which blocks every worker.
Both roots above are already in the lane. See [[trash-retired-files]] for the
shared naming convention and retention rules.

## When to use

- You want to remove a single file or directory and keep a paper trail.
- Reversal matters: a sidecar `reason.md` records why and when.
- You are NOT sweeping a whole repo (that's `trash-retired-files` — bulk, ledger-aware).

## Operation

```bash
to-trash <path> --reason "<one-line why>"   # move + write reason.md sidecar
to-trash <path> --restore                  # reverse (move back from the trash root)
```

Handler: `bin/to-trash` in arc-skills — install with
`install -m755 bin/to-trash ~/.local/bin/to-trash`, check with `bin/test_to_trash.sh`.
It is the same handler `install-to-trash` hooks onto `rm` — same destination, same reversibility — but invoked explicitly with a reason.

## What it does NOT touch

- The ledger. `to-trash` is repo-agnostic; if the deletion has a workflow consequence, write to the ledger separately via `to-ledger`.
- Files inside `.git/`. Stop, talk to a human.
- Anything under `~/vault/` or another already-tracked-gitignored tree.

## Reversal

`<trash-root>/<unix-ts>_<name>/reason.md` records who, when, why. To restore: `to-trash <trash-dir-name> --restore`. After 30 days un-touched, the directory is swept by `trash-retired-files` — but only if the source skill recognises the item as GC-eligible.
