#!/usr/bin/env bash
# Self-check for ingest_transcript.sh against a throwaway db (no network: the API points at a dead port).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
d=$(mktemp -d)
trap 'rmdir "$d" 2>/dev/null || true' EXIT
sqlite3 "$d/y.db" "CREATE TABLE videos(video_id TEXT PRIMARY KEY, transcript TEXT, status TEXT);
INSERT INTO videos VALUES('abcdefghijk','hello world','processed'),('otherVideo1','wrong video','processed'),
('zzzzzzzzzzz','','queued'),('failedVid01',NULL,'failed');"
run() { YT_INGEST_DB="$d/y.db" YT_INGEST_URL=http://127.0.0.1:1 "$here/ingest_transcript.sh" "$1" 2>/dev/null; }
rc() { local c=0; run "$1" >/dev/null || c=$?; echo "$c"; }
for u in 'https://www.youtube.com/watch?v=abcdefghijk&t=5s' https://youtu.be/abcdefghijk \
  https://www.youtube.com/embed/abcdefghijk https://www.youtube.com/v/abcdefghijk \
  https://www.youtube.com/shorts/abcdefghijk abcdefghijk \
  'https://www.youtube.com/watch?v=abcdefghijk&rv=otherVideo1' \
  'https://www.youtube.com/watch?v=abcdefghijk&feature=youtu.be/otherVideo1'; do
  [ "$(run "$u")" = "hello world" ] || { echo "FAIL: $u"; exit 1; }
done
[ "$(rc zzzzzzzzzzz)" = 3 ]   # not processed, queue endpoint unreachable
[ "$(rc failedVid01)" = 3 ]   # ingest gave up on it: no pointless queue-and-wait
[ "$(rc 'bad id')" = 1 ]
[ "$(rc https://example.com/page)" = 1 ]
c=0; YT_INGEST_DB="$d/none.db" "$here/ingest_transcript.sh" abcdefghijk >/dev/null 2>&1 || c=$?; [ "$c" = 3 ]
unlink "$d/y.db"
echo ok
