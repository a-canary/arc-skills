#!/usr/bin/env bash
# Self-check for ingest_transcript.sh against a throwaway db (no network: the API points at a dead port).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
d=$(mktemp -d)
sqlite3 "$d/y.db" "CREATE TABLE videos(video_id TEXT PRIMARY KEY, transcript TEXT, status TEXT);
INSERT INTO videos VALUES('abcdefghijk','hello world','processed'),('zzzzzzzzzzz','','queued');"
run() { YT_INGEST_DB="$d/y.db" YT_INGEST_URL=http://127.0.0.1:1 "$here/ingest_transcript.sh" "$1" 2>/dev/null; }
[ "$(run 'https://www.youtube.com/watch?v=abcdefghijk&t=5s')" = "hello world" ]
[ "$(run https://youtu.be/abcdefghijk)" = "hello world" ]
rc=0; run zzzzzzzzzzz || rc=$?; [ "$rc" = 3 ]   # not processed, queue endpoint unreachable
rc=0; run "bad id" || rc=$?; [ "$rc" = 1 ]
rc=0; YT_INGEST_DB="$d/none.db" "$here/ingest_transcript.sh" abcdefghijk 2>/dev/null || rc=$?; [ "$rc" = 3 ]
echo ok
