---
name: trash-retired-files
description: Safe, reversible file GC. A semantic reason drives scope — what counts as trash, what gets updated, what stays.
---

# trash-retired-files

Reversible garbage collection for codebases. Files go to a trash root, not `/dev/null`.

## Trash root

```
~/vault/director/trash/    # override with TRASH_ROOT
```

One durable root for every repo, inside the agent write lane.
Not `/tmp` (reboot wipes it), not `<repo>/.trash/` (`git clean -fdx` wipes it), not a home-level trash dir (outside the write lane, so workers are blocked).
Every move goes through `bin/to-trash` (see [[to-trash]]), which owns the root, the naming, the sidecar, and the guards.

## Core principle

**`--reason` is the primary input.** It is not a label — it determines:

1. Which files are candidates
2. Which candidates are trash vs need-updating
3. Which docs reference the trashed paths and need to be updated alongside

Without a reason, refuse to run. A sweep without a thesis turns into a regret.

## CLI shape

```bash
to-trash <path> --reason "<why>"      # write reason.md, move, print the entry
to-trash <trash-entry> --restore      # reverse
```

The skill is the procedure; `bin/to-trash` in arc-skills is the single implementation.
Do not hand-roll `mv` into the trash root: the handler is what guarantees the sidecar exists, symlinks are trashed as links, and restore never clobbers.

## Naming convention

Each trashed item gets its own entry directory, named by timestamp + path so concurrent moves and basename collisions (e.g. two `CONTEXT.md` files in different dirs) stay distinguishable and restores stay traceable:

```
<trash-root>/<unix-ts>__<path-relative-to-$HOME>/
  reason.md
  <basename>
```

`<path-relative-to-$HOME>` is the item's absolute path with the `$HOME/` prefix dropped (or the leading `/` dropped when outside `$HOME`), `/` rewritten to `--`, and truncated to its last 200 characters.
Examples:

```
1782317031__repos--game--contexts--encounters--CONTEXT.md/
1782317031__repos--game--contexts--tavern--CONTEXT.md/
1782317031__repos--game--PRD-v1.md/
```

`__` separates the timestamp from the path; `--` separates path components.
The name is for humans; restore reads the authoritative original path from `reason.md`.
If an entry name is already taken, the handler appends `-2`, `-3`, etc. (created with an atomic `mkdir`, so two concurrent moves never share an entry).

**Why not just `<ts>_<basename>`?** Two files with the same basename in
different directories (`contexts/encounters/CONTEXT.md` and
`contexts/tavern/CONTEXT.md`) collided and the second move clobbered the
first — losing recoverable content. Observed in
`000109-hygiene-arc-webui-trash-retired-files` (arc-webui #10 sweep,
2026-06-24).

## Sweep procedure (manual, multi-file)

```
1. Parse the reason into a search pattern.
   "deprecated <module> pattern" → grep for refs across src/, docs/, scripts/

2. Locate candidates.
   grep -rn "<pattern>" . --include="*.{ts,py,md,sh}" \
     | grep -v "node_modules\|\.git\|trash\|archive"

3. Judge each hit:
   - TRASH if: archived dir, stale session/cache file, dead code path
   - UPDATE if: live code reference, doc that needs the new path
   - SKIP   if: protected (LICENSE, .git, lockfiles), in use, historical record

4. Trash each item with `to-trash <path> --reason "<reason>"`.
   Before each, check references and use:
     grep -rln "$(basename <path>)" . | grep -v '^./\.git'
     lsof <path>

5. Update live docs that referenced trashed paths.
   grep for the old path → replace → verify with build/test.
```

## Retention

Default: **30 days** in the trash root. After that, a separate cron (see `schedule-hygiene`) hard-deletes if disk pressure exists.


## Log format

The per-item record is the entry's `reason.md` (`from:`, `when:`, `by:`, `reason:`).
Sweep summaries append one JSONL line to `<trash-root>/.log.jsonl`:

```json
{"ts":"2026-05-22T21:00:00Z","action":"sweep","reason":"deprecated v1 API","trashed":12,"updated":4,"skipped":7}
```

## Guards

- Refuse `--reason ""` or missing reason for a sweep
- Refuse paths inside `.git/`, `node_modules/`, or matching `LICENSE*`
- Check `lsof` on the path before moving
- Never recurse into the trash root itself
- `bin/to-trash` additionally refuses `~/vault`, `$HOME` and its ancestors, the trash root and its ancestors, and newline paths

## Restore

```bash
# 1. Find it
ls ~/vault/director/trash/ | grep <name-fragment>

# 2. Move it back to the path recorded in its reason.md.
#    Refuses (and keeps the trash copy) if something already exists there.
to-trash <entry> --restore

# Example
to-trash 1782317031__repos--game--contexts--encounters--CONTEXT.md --restore

# 3. Revert doc updates if needed
git diff HEAD~ -- '<doc>'
```

## Termination

Drive to `merged` via bookie with `--evidence "trashed <N> files, updated refs in <files>"` and `--pr <branch-or-url>`.

**Zero-diff outcome.** Sweep found nothing retired (all candidates still referenced / below threshold), or the trash already happened at head: merge in place with no PR —

```
update <id> --state merged --no-diff --in-place --evidence "<negative result + where verified>"   # evidence ≤280 chars
```

Never open an empty PR to satisfy the merge guard. `--no-diff` skips the diff_review requirement; for a non-zero diff, emit exactly **one** `diff_review` event per sha (re-emitting 3–5× is ledger noise — pipeliner rows 000229/000256).
