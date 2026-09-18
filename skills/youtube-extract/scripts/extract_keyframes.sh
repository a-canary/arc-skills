#!/usr/bin/env bash
# Find keyframes in a video by detecting "still" (no-cut, no-motion) segments
# and grabbing one frame per segment. Dedupes near-identical frames via PSNR.
#
# Usage: extract_keyframes.sh <video> [outdir]
#   Defaults: outdir = ./keyframes
#   Env: MIN_DWELL=3 SCENE_MEAN=0.04 SCENE_VAR=0.001 DEDUPE_PSNR=40
#   Output: <outdir>/keyframe_NN.jpg + <outdir>/segments.txt (start,end,mid)
set -eu
VIDEO="${1:?usage: extract_keyframes.sh <video> [outdir]}"
OUT="${2:-./keyframes}"
FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$VIDEO" | head -1)
# r_frame_rate is e.g. "30/1" — convert
FPS=$(awk -F/ '/^[0-9]+\/[0-9]+$/{printf "%.3f",$1/$2; next} {print}' <<<"$FPS")
echo "extract_keyframes: $VIDEO  fps=$FPS  out=$OUT" >&2
mkdir -p "$OUT"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# --- Pass 1: per-frame scene score → raw log
ffmpeg -hide_banner -loglevel error -i "$VIDEO" \
  -vf "select='gte(scene,0)',metadata=mode=print:file=$TMP/scores.txt" \
  -an -f null -

# --- Pass 2: bin scores per whole second, compute mean & max
# Output: $TMP/bins.tsv  (sec<TAB>mean<TAB>max)
python3 - "$TMP/scores.txt" "$FPS" > "$TMP/bins.tsv" <<'PY'
import sys, re, math
from collections import defaultdict
log, fps_s = sys.argv[1], float(sys.argv[2])
fps = max(1, int(round(fps_s)))
t, score = None, None
bins = defaultdict(list)
for line in open(log):
    m = re.search(r'pts_time:([0-9.]+)', line)
    if m: t = float(m.group(1)); continue
    m = re.search(r'scene_score=([0-9.]+)', line)
    if m and t is not None:
        bins[int(t)].append(float(m.group(1)))
        t = None
# ensure all seconds represented
if bins:
    last = max(bins)
    for s in range(last + 1):
        bins[s] = bins.get(s, [])
for s in sorted(bins):
    v = bins[s]
    if not v:
        print(f"{s}\t0\t0"); continue
    mean = sum(v) / len(v)
    mx = max(v)
    print(f"{s}\t{mean:.4f}\t{mx:.4f}")
PY

# --- Pass 3: identify dwell-segments
MIN_DWELL=${MIN_DWELL:-3}
SCENE_MEAN=${SCENE_MEAN:-0.04}
SCENE_MAX=${SCENE_MAX:-0.20}   # allow some animation (chart-draw) within a still

python3 - "$TMP/bins.tsv" "$OUT/segments.txt" "$MIN_DWELL" "$SCENE_MEAN" "$SCENE_MAX" <<'PY'
import sys
tsv, out, min_dwell, mean_th, max_th = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
segs, cur = [], None
for line in open(tsv):
    s, mean, mx = line.split('\t')
    s, mean, mx = int(s), float(mean), float(mx)
    is_still = mean < mean_th and mx < max_th
    if is_still:
        if cur is None: cur = [s, s, mean, mx]
        else: cur[1] = s; cur[2] = max(cur[2], mean); cur[3] = max(cur[3], mx)
    else:
        if cur: segs.append(cur); cur = None
if cur: segs.append(cur)
kept = [s for s in segs if (s[1] - s[0] + 1) >= min_dwell]
with open(out, 'w') as f:
    for s in kept:
        mid = (s[0] + s[1]) / 2
        f.write(f"{s[0]}\t{s[1]}\t{mid:.1f}\t{s[2]:.4f}\t{s[3]:.4f}\n")
print(f"extract_keyframes: {len(segs)} raw segments, {len(kept)} after MIN_DWELL={min_dwell}s", file=sys.stderr)
PY

# --- Pass 4: grab middle frame of each segment
N=0
while IFS=$'\t' read -r start end mid mean mx; do
    N=$((N+1))
    ffmpeg -hide_banner -loglevel error -ss "$mid" -i "$VIDEO" \
      -frames:v 1 -q:v 3 "$OUT/keyframe_$(printf '%02d' "$N").jpg"
done < "$OUT/segments.txt"
echo "extract_keyframes: grabbed $N keyframes" >&2

# --- Pass 5: PSNR dedupe consecutive frames (drop near-identical)
DEDUPE_PSNR=${DEDUPE_PSNR:-40}
[ "$N" -le 1 ] && exit 0
LAST=$(ls "$OUT"/keyframe_*.jpg | sort | tail -1)
KEEP="$LAST"
DROPPED=0
prev="$LAST"
while read -r cur; do
    [ "$cur" = "$prev" ] && continue
    PSNR=$(ffmpeg -hide_banner -loglevel error -i "$prev" -i "$cur" \
      -lavfi psnr=stats_file="$TMP/psnr.txt":stats_version=2 -f null - 2>/dev/null \
      && grep -o 'psnr_avg:[^ ]*' "$TMP/psnr.txt" | head -1 | cut -d: -f2)
    if [ "$PSNR" = "inf" ] || awk -v p="${PSNR:-0}" -v t="$DEDUPE_PSNR" 'BEGIN{exit !(p+0>t)}'; then
        rm -f "$cur"; DROPPED=$((DROPPED+1))
    else
        KEEP="$KEEP $cur"; prev="$cur"
    fi
done < <(ls "$OUT"/keyframe_*.jpg | sort | head -n -1)

echo "extract_keyframes: kept $(echo "$KEEP" | wc -w), dropped $DROPPED (PSNR threshold ${DEDUPE_PSNR}dB)" >&2
echo "extract_keyframes: output → $OUT" >&2