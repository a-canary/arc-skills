#!/usr/bin/env bash
# extract_keyframes.sh contract: PSNR dedupe compares each frame to the previous KEPT frame.
# Stills red | red | blue | red (separated by motion) -> keyframes 01..04; 02 duplicates 01 and
# is dropped; 04 (red returning after blue) is NOT a consecutive duplicate and is kept.
set -u
D="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
command -v ffmpeg >/dev/null || { echo "SKIP: no ffmpeg"; exit 0; }
c() { echo "color=$1:s=160x120:d=5:r=10"; }
m() { echo "life=s=160x120:r=10:mold=10:ratio=0.5,format=yuv420p,trim=duration=2"; }
ffmpeg -nostdin -hide_banner -loglevel error \
  -f lavfi -i "$(c red)" -f lavfi -i "$(m)" -f lavfi -i "$(c red)" -f lavfi -i "$(m)" \
  -f lavfi -i "$(c blue)" -f lavfi -i "$(m)" -f lavfi -i "$(c red)" \
  -filter_complex "[0]format=yuv420p[a];[1]setsar=1[b];[2]format=yuv420p[c];[3]setsar=1[d];[4]format=yuv420p[e];[5]setsar=1[f];[6]format=yuv420p[g];[a][b][c][d][e][f][g]concat=n=7:v=1:a=0" \
  "$T/v.mp4"
bash "$D/extract_keyframes.sh" "$T/v.mp4" "$T/out" 2>"$T/err" || { echo "FAIL: exit $? — $(tail -1 "$T/err")"; exit 1; }
got="$(cd "$T/out" && ls keyframe_*.jpg | tr '\n' ' ')"
[ "$got" = "keyframe_01.jpg keyframe_03.jpg keyframe_04.jpg " ] && echo PASS || { echo "FAIL: kept '$got' ($(grep -c . "$T/out/segments.txt") segments)"; exit 1; }
