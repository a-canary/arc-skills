#!/usr/bin/env bash
# Transcript from the local youtube-ingest service (no YouTube request, no bot-gate).
# usage: ingest_transcript.sh <url|video_id>
# exit 0 = transcript on stdout; 2 = not ingested yet, queued (retry in a few minutes);
#      3 = no ingest db, sqlite3 or service, or ingest failed on this video; 1 = no video id in the argument.
#      On 1 or 3 fall back to ytdlp.sh.
# Reads the db read-only: GET /outbox/<consumer> marks rows consumed, so it is never used here.
set -u
DB="${YT_INGEST_DB:-$HOME/lib/youtube-ingest/youtube.db}"
API="${YT_INGEST_URL:-http://127.0.0.1:8098}"
# First match wins, as in the service's extract_video_id: a later "&rv=" or "feature=youtu.be/x" is not the id.
arg=${1:?url or video id}
if [[ $arg =~ [?\&]v=([A-Za-z0-9_-]{11})($|[^A-Za-z0-9_-]) ]] ||
   [[ $arg =~ (youtu\.be|/shorts|/live|/embed|/v)/([A-Za-z0-9_-]{11})($|[^A-Za-z0-9_-]) ]]; then
  id=${BASH_REMATCH[-2]}
elif [[ $arg =~ ^[A-Za-z0-9_-]{11}$ ]]; then id=$arg
else echo "ingest_transcript: no video id in '$arg'" >&2; exit 1; fi
command -v sqlite3 >/dev/null || { echo "ingest_transcript: sqlite3 not installed" >&2; exit 3; }
[ -r "$DB" ] || { echo "ingest_transcript: no ingest db at $DB" >&2; exit 3; }
# $id is 11 chars of [A-Za-z0-9_-] (matched above), so it is safe inside the SQL literal
row=$(sqlite3 -readonly "$DB" "SELECT status FROM videos WHERE video_id='$id'") ||
  { echo "ingest_transcript: db read failed" >&2; exit 3; }
if [ "$row" = processed ]; then
  t=$(sqlite3 -readonly "$DB" "SELECT transcript FROM videos WHERE video_id='$id'")
  [ -n "$t" ] && { printf '%s\n' "$t"; exit 0; }
fi
# The service never retries a failed video on a re-queue (INSERT OR IGNORE), so waiting is pointless.
[ "$row" = failed ] && { echo "ingest_transcript: $id failed in ingest (no transcript)" >&2; exit 3; }
curl -fsS -m 10 -X POST "$API/queue/video" -H 'Content-Type: application/json' \
  -d "{\"consumer\":\"youtube-extract\",\"url\":\"https://www.youtube.com/watch?v=$id\"}" >&2 ||
  { echo "ingest_transcript: queue request failed ($API)" >&2; exit 3; }
echo "ingest_transcript: $id queued, not processed yet" >&2
exit 2
