#!/bin/bash
# blog — pre-PR draft to ledger blog table via arc-agents createBlogPost() API.
# Usage: blog [--base <branch>] [--dry-run] [--skip <reason>] [--serve] [--publish]
#
# Set ARC_AGENTS_ROOT to override auto-detection of the arc-agents install.
# Set ARC_DEMO_ROOT to override default ~/web-demo.
# Set ARC_LEDGER_DB to override default ~/vault/ledger.db.
#
# origin_task_id = $ARC_TASK_ID when running inside a factory worker; NULL otherwise.

set -euo pipefail

# ── Env / auto-detect ─────────────────────────────────────────────────────────

if [[ -n "${ARC_AGENTS_ROOT:-}" ]]; then
  AGENTS_ROOT="$ARC_AGENTS_ROOT"
elif [[ -d "${ARC_WORKTREE:-}/src/ledger" ]]; then
  AGENTS_ROOT="${ARC_WORKTREE}"
else
  AGENTS_ROOT="$HOME/repos/arc-agents"
fi

LEDGER_DB="${ARC_LEDGER_DB:-$HOME/vault/ledger.db}"
ORIGIN_TASK_ID="${ARC_TASK_ID:-}"

DEMO_ROOT="${ARC_DEMO_ROOT:-$HOME/web-demo}"
mkdir -p "$DEMO_ROOT/assets"

# ── CLI flag parsing ───────────────────────────────────────────────────────────

DRY_RUN=false
SKIP_REASON=""
SERVE=false
PUBLISH=false
BASE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=true; shift ;;
    --skip)      SKIP_REASON="$2"; shift 2 ;;
    --serve)     SERVE=true; shift ;;
    --publish)   PUBLISH=true; shift ;;
    --base)      BASE="$2"; shift 2 ;;
    *)           echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# ── Validation ────────────────────────────────────────────────────────────────

LEDGER_API="$AGENTS_ROOT/src/ledger/blog.ts"
if [[ ! -f "$LEDGER_API" ]]; then
  echo "ERROR: arc-agents ledger API not found at $LEDGER_API" >&2
  echo "  Set ARC_AGENTS_ROOT to point to your arc-agents install." >&2
  exit 1
fi

# ── Step 1: Resolve the diff ─────────────────────────────────────────────────

if git diff --cached --quiet; then
  if [[ -z "$BASE" ]]; then
    BASE=$(git rev-parse --abbrev-ref "@{upstream}" 2>/dev/null) || BASE="main"
  fi
  DIFF_OUTPUT=$(git diff "$BASE...HEAD") || DIFF_OUTPUT=""
  DIFF_STAT=$(git diff --stat "$BASE...HEAD") || DIFF_STAT=""
else
  DIFF_OUTPUT=$(git diff --cached)
  DIFF_STAT=$(git diff --cached --stat)
fi

if [[ -z "$DIFF_OUTPUT" ]]; then
  echo "No diff found. Nothing to blog."
  exit 0
fi

SUBJECT=$(git log -1 --format=%s) || SUBJECT=$(git branch --show-current) || SUBJECT="unnamed"
BRANCH=$(git branch --show-current) || BRANCH="unknown"
SHA=$(git rev-parse --short HEAD) || SHA="??????"
REPO=$(basename "$(git rev-parse --show-toplevel)") || REPO="unknown"
DATE=$(date +%Y-%m-%d)
FILES_CHANGED=$(echo "$DIFF_STAT" | grep -c '^ ') || FILES_CHANGED=0

# ── Step 2: Pick ONE visual artifact ─────────────────────────────────────────

ARTIFACT_PATH=""

for img in $(echo "$DIFF_OUTPUT" | grep -E '^\+\+\+ b/.*\.(png|jpg|jpeg|svg|webp|gif)$' | sed 's|^\+\+\+ b/||'); do
  if [[ -f "$img" && -s "$img" ]]; then
    EXT="${img##*.}"
    DEST="$DEMO_ROOT/assets/${BRANCH//\//-}-$(date +%s).$EXT"
    if cp "$img" "$DEST" 2>/dev/null; then
      ARTIFACT_PATH="$DEST"
      break
    fi
  fi
done

if [[ -z "$ARTIFACT_PATH" ]]; then
  for diag in $(echo "$DIFF_OUTPUT" | grep -E '^\+\+\+ b/.*\.(mmd|dot|puml)$' | sed 's|^\+\+\+ b/||'); do
    if [[ -f "$diag" ]]; then
      EXT="${diag##*.}"
      DEST="$DEMO_ROOT/assets/${BRANCH//\//-}-diag.${EXT}"
      if cp "$diag" "$DEST" 2>/dev/null; then
        ARTIFACT_PATH="$DEST"
        break
      fi
    fi
  done
fi

if [[ -z "$ARTIFACT_PATH" ]]; then
  for bin in $(echo "$DIFF_OUTPUT" | grep -E '^\+\+\+ b/bin/' | sed 's|^\+\+\+ b/||'); do
    if [[ -x "$bin" ]] && "$bin" --help >/dev/null 2>&1; then
      DEST="$DEMO_ROOT/assets/${BRANCH//\//-}-help.txt"
      "$bin" --help > "$DEST" 2>&1 || true
      if [[ -s "$DEST" ]]; then
        ARTIFACT_PATH="$DEST"
        break
      fi
    fi
  done
fi

# ── Step 3: Build entry content ───────────────────────────────────────────────

WHY=$(git log -1 --format=%b | head -3 | tr '\n' ' ' | sed 's/^ *//;s/ *$//') || true
if [[ -z "$WHY" ]]; then
  WHY="Changes across $FILES_CHANGED file(s) on branch $BRANCH."
fi

BODY_MD="## What changed

$WHY

\`\`\`
$DIFF_STAT
\`\`\`

<!-- artifact: ${ARTIFACT_PATH:-none} -->
<!-- origin: ${ORIGIN_TASK_ID:-manual} -->
<!-- repo: $REPO | branch: $BRANCH | sha: $SHA -->"

TITLE="$SUBJECT"

json_str() { node -e "console.log(JSON.stringify(process.argv.slice(1).join(' ')))" -- "$@"; }

TITLE_JSON=$(json_str "$TITLE")
BODY_MD_JSON=$(json_str "$BODY_MD")
ORIGIN_JSON=$(json_str "${ORIGIN_TASK_ID}")
ARTIFACT_JSON=$(json_str "${ARTIFACT_PATH}")
REPO_JSON=$(json_str "$REPO")

# ── Step 4: Dry run ─────────────────────────────────────────────────────────

if $DRY_RUN; then
  echo "=== DRY RUN — would insert blog row ==="
  echo "title:  $TITLE"
  echo "project: $REPO"
  echo "origin_task_id: ${ORIGIN_TASK_ID:-null}"
  echo "artifact_path: ${ARTIFACT_PATH:-none}"
  echo "========================================="
  exit 0
fi

# ── Step 5: Write row via createBlogPost() API ───────────────────────────────
#
# bun writes to a temp file, not stdout. No stdout piping = no SIGPIPE from PTY.
# The PTY reader in tmux may close between subshell calls; writing to a temp file
# avoids SIGPIPE on all stdout operations.

if [[ -n "$ARTIFACT_PATH" ]]; then
  ARTIFACT_JSON_VAL="$ARTIFACT_JSON"
else
  ARTIFACT_JSON_VAL="null"
fi
if [[ -n "$ORIGIN_TASK_ID" ]]; then
  ORIGIN_JSON_VAL="$ORIGIN_JSON"
else
  ORIGIN_JSON_VAL="null"
fi

printf '{"project": %s, "title": %s, "body_md": %s, "artifact_path": %s, "origin_task_id": %s}\n' \
  "$REPO_JSON" "$TITLE_JSON" "$BODY_MD_JSON" "$ARTIFACT_JSON_VAL" "$ORIGIN_JSON_VAL" \
  > /tmp/blog-input.json

# shellcheck disable=SC2016
cat > /tmp/blog-write-row.ts <<'TSFILE'
import { Database } from "bun:sqlite";
import { migrate } from "MIGRATE_PATH";
import { createBlogPost } from "BLOG_PATH";

const db = new Database(process.env.LEDGER_DB ?? `${process.env.HOME}/vault/ledger.db`);
db.exec("PRAGMA foreign_keys = ON");
migrate(db);

const raw = require("fs").readFileSync("/tmp/blog-input.json", "utf8");
const input = JSON.parse(raw);

const post = createBlogPost(db, input);
process.stdout.write(JSON.stringify({ id: post.id, artifact_path: post.artifact_path ?? null, origin_task_id: post.origin_task_id ?? null }));
TSFILE

sed -i "s|MIGRATE_PATH|${AGENTS_ROOT}/src/ledger/migrate.ts|g" /tmp/blog-write-row.ts
sed -i "s|BLOG_PATH|${AGENTS_ROOT}/src/ledger/blog.ts|g" /tmp/blog-write-row.ts

LEDGER_DB="$LEDGER_DB" bun /tmp/blog-write-row.ts > /tmp/blog-result.txt

BLOG_ID=$(grep -o '"id":"[^"]*"' /tmp/blog-result.txt | head -1 | sed 's/"id":"//;s/"//') || BLOG_ID="unknown"

rm -f /tmp/blog-write-row.ts /tmp/blog-input.json /tmp/blog-result.txt

echo "Blog entry drafted."
echo "  id:   $BLOG_ID"
echo "  artifact: ${ARTIFACT_PATH:-none}"
echo "  origin:   ${ORIGIN_TASK_ID:-manual}"
echo "View: bun $AGENTS_ROOT/bin/ledger.ts list --project $REPO --state all | grep $BLOG_ID"

# ── Step 6: Local serve ─────────────────────────────────────────────────────

if $SERVE; then
  PIDFILE="$HOME/.cache/arc-skills/blog-server.pid"

  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "Blog server already running (PID $(cat "$PIDFILE"))"
  else
    for PORT in 8087 8088 8089; do
      if ! nc -z localhost "$PORT" 2>/dev/null; then
        break
      fi
    done
    python3 -m http.server "$PORT" --bind 0.0.0.0 -d "$DEMO_ROOT" &
    echo $! > "$PIDFILE"
    echo "Serving blog feed at http://localhost:$PORT/"
  fi
fi

# ── Step 7: Publish ─────────────────────────────────────────────────────────

if $PUBLISH; then
  if [[ -z "${ARC_DEMO_HOST:-}" ]]; then
    echo "WARNING: ARC_DEMO_HOST not set — skipping rsync" >&2
  else
    rsync -av --delete "$DEMO_ROOT"/ "${ARC_DEMO_HOST}"
    echo "Published to $ARC_DEMO_HOST"
  fi
fi