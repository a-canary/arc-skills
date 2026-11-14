#!/usr/bin/env bash
# Transcript from the local youtube-ingest service (no YouTube request, no bot-gate).
# usage: ingest_transcript.sh <url|video_id>
# exit 0 = transcript on stdout; 2 = not ingested yet, queued (retry in a few minutes);
#      3 = ingest db or service absent (fall back to ytdlp.sh); 1 = no video id in the argument.
# Reads the db read-only: GET /outbox/<consumer> marks rows consumed, so it is never used here.
set -u
DB="${YT_INGEST_DB:-$HOME/lib/youtube-ingest/youtube.db}"
API="${YT_INGEST_URL:-http://127.0.0.1:8098}"
id=$(sed -E 's#.*(v=|youtu\.be/|shorts/|live/)##; s#[^A-Za-z0-9_-].*##' <<<"${1:?url or video id}")
[[ $id =~ ^[A-Za-z0-9_-]{11}$ ]] || { echo "ingest_transcript: no video id in '$1'" >&2; exit 1; }
[ -r "$DB" ] || { echo "ingest_transcript: no ingest db at $DB" >&2; exit 3; }
# $id is 11 chars of [A-Za-z0-9_-] (checked above), so it is safe inside the SQL literal
t=$(sqlite3 -readonly "$DB" "SELECT transcript FROM videos WHERE video_id='$id' AND status='processed' AND length(transcript)>0")
[ -n "$t" ] && { printf '%s\n' "$t"; exit 0; }
curl -fsS -m 10 -X POST "$API/queue/video" -H 'Content-Type: application/json' \
  -d "{\"consumer\":\"youtube-extract\",\"url\":\"https://www.youtube.com/watch?v=$id\"}" >&2 ||
  { echo "ingest_transcript: queue request failed ($API)" >&2; exit 3; }
echo "ingest_transcript: $id queued, not processed yet" >&2
exit 2
