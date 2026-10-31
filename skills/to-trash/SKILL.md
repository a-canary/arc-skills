---
name: to-trash
description: Reversible single-item trash action — move one path to ~/trash/<unix-ts>__<path>/ with a reason sidecar. Use when you want to delete something now and keep a reversal trail. Single-item companion to trash-retired-files (bulk GC). Repo-agnostic; does not touch the ledger.
---

# to-trash

Reverse before destructive. Single-item deletion with a fingerprint so anything moved out can be moved back.

## Trash root

`~/trash/`, overridable with the `TRASH_ROOT` env var (tests use this).
It must be durable, inside the agent write lane (`~/trash/**` is, move-in only — operator ruling arc-ypp), and the one root `bin/trash-pressure.sh` sweeps:

- **Not `/tmp`** — wiped on reboot, so the only copy dies.
- **Not `<repo>/.trash/`** — `git clean -fdx` deletes it, and every other repo would need a `.gitignore` entry.
- **Not `~/vault/director/trash/`** — invisible to the trash-pressure sweep, and not gitignored in the vault repo.

The root is created mode 700 and must be owned by the invoking user.
See [[trash-retired-files]] for the shared naming convention and retention rules.

## When to use

- You want to remove a single file or directory and keep a paper trail.
- Reversal matters: a sidecar `reason.md` records why and when.
- You are NOT sweeping a whole repo (that's `trash-retired-files` — bulk, ledger-aware).

## Operation

```bash
to-trash <path> --reason "<one-line why>"     # write reason.md sidecar, then move
to-trash <trash-entry> --restore              # move back to the recorded path
to-trash <trash-entry> --restore --root <dir> # restore from a non-default root
```

Handler: `bin/to-trash` in arc-skills — install with `install -m755 bin/to-trash ~/.local/bin/to-trash`, check with `bash bin/test_to_trash.sh`.
It is the same handler `install-to-trash` hooks onto `rm` — same destination, same reversibility — but invoked explicitly with a reason.

## Entry layout

```
<trash-root>/<unix-ts>__<path-relative-to-$HOME, / as -->/
  reason.md   from:, when:, by:, reason:  (written BEFORE the move)
  <name>      the item itself
```

A crash between the two steps leaves a labelled empty entry, never an unlabelled item.

## Guards

- A symlink argument trashes the link itself, never its target.
- Refuses `~/vault` itself and anything under it.
- Refuses `$HOME`, any ancestor of `$HOME`, the trash root, any ancestor of it, and anything already inside it.
- Refuses paths inside `.git/` (and `.git` itself). Stop, talk to a human.
- Refuses paths containing a newline (the sidecar is line-oriented); rename first.
- `--restore` refuses (non-zero, trash copy kept) when anything exists at the original path, and deletes the entry only after the item has verifiably moved back.

## What it does NOT touch

- The ledger. `to-trash` is repo-agnostic; if the deletion has a workflow consequence, write to the ledger separately via `to-ledger`.

## Reversal

`<trash-root>/<entry>/reason.md` records who, when, why, and the original absolute path.
To restore: `to-trash <entry> --restore`.
If the original path has been recreated, move it aside first, then restore.
After 30 days un-touched, the entry is swept by `trash-retired-files` — but only if the source skill recognises the item as GC-eligible.
