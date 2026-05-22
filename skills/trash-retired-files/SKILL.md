---
name: trash-retired-files
description: Safe, reversible file GC. A semantic reason drives scope — what counts as trash, what gets updated, what stays.
---

# trash-retired-files

Reversible garbage collection for codebases. Files go to `~/trash/`, not `/dev/null`.

## Core principle

**`--reason` is the primary input.** It is not a label — it determines:

1. Which files are candidates
2. Which candidates are trash vs need-updating
3. Which docs reference the trashed paths and need to be updated alongside

Without a reason, refuse to run. A sweep without a thesis turns into a regret.

## CLI shape

```bash
to-trash <path> --reason "<why>"        # move, log, mark with timestamp
to-trash <path> --reason "<why>" --dry-run   # preview + list referencing files
to-trash --restore <trashed-name>       # reverse
```

The skill is the procedure; the CLI is a thin convenience. Implementing a `to-trash` script is left to the consumer (see "Reference implementation" below).

## Naming convention

Trashed paths get a timestamp suffix so concurrent moves don't collide and restores stay traceable:

```
~/trash/<unix-ts>_<original-basename>/
```

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

4. Bulk-trash via mv with timestamp suffix; single files via to-trash.

5. Update live docs that referenced trashed paths.
   grep for the old path → replace → verify with build/test.
```

## Retention

Default: **30 days** in `~/trash/`. After that, a separate cron (see `schedule-hygiene`) hard-deletes if disk pressure exists.

## Restore

```bash
# 1. Find it
ls ~/trash/ | grep <name>

# 2. Move it back
mv ~/trash/<ts>_<name> <original-path>

# 3. Revert doc updates if needed
git diff HEAD~ -- '<doc>'
```

## Log format

Append a JSONL record per move to `~/trash/.log.jsonl`:

```json
{"ts":"2026-05-22T20:59:00Z","action":"trash","path":"src/legacy/old.ts","reason":"replaced by src/new.ts","trashed_to":"~/trash/1779389812_old.ts","refs_updated":3}
```

Sweep summaries get their own line:

```json
{"ts":"2026-05-22T21:00:00Z","action":"sweep","reason":"deprecated v1 API","trashed":12,"updated":4,"skipped":7}
```

## Guards

- Refuse `--reason ""` or missing reason
- Refuse paths inside `.git/`, `node_modules/`, or matching `LICENSE*`
- Check `lsof` on the path before moving (skip with `--force`)
- Never recurse into `~/trash/` itself

## Reference implementation

A 50-line `to-trash` in shell:

```bash
#!/usr/bin/env bash
set -euo pipefail
path="$1"; shift
reason=""; dry=false; force=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason) reason="$2"; shift 2;;
    --dry-run) dry=true; shift;;
    --force) force=true; shift;;
    *) echo "unknown flag: $1" >&2; exit 2;;
  esac
done
[[ -z "$reason" ]] && { echo "--reason required" >&2; exit 2; }
[[ -e "$path" ]] || { echo "no such path: $path" >&2; exit 2; }
mkdir -p ~/trash
ts=$(date +%s)
dest=~/trash/${ts}_$(basename "$path")
if $dry; then
  echo "would move: $path -> $dest"
  echo "references:"
  grep -rln "$(basename "$path")" . 2>/dev/null | grep -v "^./\.git\|^./trash" || true
  exit 0
fi
$force || ! lsof "$path" >/dev/null 2>&1 || { echo "in use" >&2; exit 1; }
mv "$path" "$dest"
echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"action\":\"trash\",\"path\":\"$path\",\"reason\":\"$reason\",\"trashed_to\":\"$dest\"}" >> ~/trash/.log.jsonl
echo "trashed: $dest"
```
