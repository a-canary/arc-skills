#!/usr/bin/env bash
# extract_keyframes.sh contract: PSNR dedupe compares each frame to the previous KEPT frame,
# so an A/B/A video keeps all three (A returning after B is not a consecutive duplicate).
set -u
D="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
command -v ffmpeg >/dev/null || { echo "SKIP: no ffmpeg"; exit 0; }
c() { echo "color=$1:s=160x120:d=5:r=10"; }
ffmpeg -nostdin -hide_banner -loglevel error -f lavfi -i "$(c red)" -f lavfi -i "$(c blue)" -f lavfi -i "$(c red)" \
  -filter_complex "[0][1][2]concat=n=3:v=1:a=0" "$T/aba.mp4"
bash "$D/extract_keyframes.sh" "$T/aba.mp4" "$T/out" 2>/dev/null
got="$(cd "$T/out" && ls keyframe_*.jpg | tr '\n' ' ')"
[ "$got" = "keyframe_01.jpg keyframe_02.jpg keyframe_03.jpg " ] && echo PASS || { echo "FAIL: kept '$got'"; exit 1; }
