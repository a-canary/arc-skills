---
name: youtube-extract
description: Extract info and judgement from a YouTube video — clean transcript, chapter map, screenshots of critical visual moments, and referenced material (repos, whitepapers, links) assessed against the video's claims. Use when asked to summarize, analyze, or mine a YouTube video/talk, or given a youtube.com/youtu.be URL needing more than a title.
---

# youtube-extract

Turn one YouTube URL into verified, durable knowledge. Requires `yt-dlp` + `ffmpeg`.
Work in `$CLAUDE_JOB_DIR/tmp` (fallback `mktemp -d`). `URL="<video>"`.

Always call via `scripts/ytdlp.sh` — the wrapper auto-escalates past bot-gates.

## 0. If YouTube bot-gates the request

Symptom: `Sign in to confirm you're not a bot` / `This video is unavailable` / `requested format not available`.

The wrapper tries rungs in order; first non-gated win wins. Rungs: vanilla → alt `player_client` (`tv`, `web_safari`, `ios`, `tv_embedded`, `web_poison_syn`) → bgutil PO token (if `127.0.0.1:4416` up) → `$YTDLP_COOKIES` file → `--cookies-from-browser chrome|firefox`.

Manual ladder when the wrapper isn't enough:

1. `pipx upgrade yt-dlp` — YouTube flips detection weekly; a stale build loses first.
2. `yt-dlp -v --extractor-args "youtube:player_client=tv" --skip-download --dump-json "$URL"` — different client, different fingerprint, no login.
3. Run [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) locally; pass `--extractor-args "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416"`.
4. `yt-dlp --cookies-from-browser chrome "$URL"` if Chrome is logged in.

If all five rungs fail: video is region/age-gated or PO tokens are required — fall back to `ke research` or human extraction.

## 1. Metadata + links (no download)

```bash
scripts/ytdlp.sh "$URL" --skip-download --dump-json > meta.json
python3 -c "
import json,re; m=json.load(open('meta.json'))
print(m['title'],'|',m['uploader'],'|',m['upload_date'],'|',m['duration_string'])
for c in (m.get('chapters') or []): print(f\"{int(c['start_time'])//60}:{int(c['start_time'])%60:02d}\", c['title'])
print(*sorted(set(re.findall(r'https?://[^\s)\\\"]+', m['description']))), sep='\n')"
```

Classify links: github / arxiv-whitepaper / docs / promo-noise. Keep the first three kinds.

## 2. Transcript

```bash
scripts/ytdlp.sh "$URL" --skip-download --write-auto-subs --sub-langs en --sub-format vtt -o t   # no en subs? check meta.json subtitles keys
python3 ~/.claude/skills/youtube-extract/scripts/clean_vtt.py t.en.vtt > transcript.txt
```

Auto-VTT has rolling duplicate lines + word-timing tags; `clean_vtt.py` dedupes to `[MM:SS] text`.
Read `transcript.txt` (grep-range it if >2k lines; chapters tell you where the meat is).

## 3. Pick critical visual moments

**Default: scene-change keyframes.** Most videos are talking heads / slideshows. Eyeballing the transcript for "this chart" cues misses slides that the speaker dwells on without naming them. Auto-extract dwell-segments instead:

```bash
scripts/ytdlp.sh "$URL" -f "bestvideo[height<=720]" -o video.mp4
scripts/extract_keyframes.sh video.mp4 keyframes
cat keyframes/segments.txt    # start, end, mid, mean_score, max_score per segment
```

What it does: ffmpeg per-frame scene-score → bin by second → keep windows where mean<`SCENE_MEAN` (default 0.04) and max<`SCENE_MAX` (default 0.20) for ≥`MIN_DWELL` seconds (default 3) → grab middle frame per segment → PSNR-dedupe near-identical frames. Talking-head micro-motion scores ~0.05–0.10 (rejected by max-threshold once a slide takes over); cuts/transitions score >0.3 (rejected by mean). Re-shown slides are deduped.

Tunables (env):
- `MIN_DWELL=N` — minimum segment length in seconds (raise to 5 for pure slideshows; lower to 2 for fast-paced screen-shares).
- `SCENE_MEAN=N` — raise to 0.06 to tolerate mild animation (chart draw-on, cursor movement); lower to 0.02 to demand pure stillness.
- `SCENE_MAX=N` — max within-segment frame score (any single high-score frame kills the bin). 0.20 tolerates one weird frame per second.
- `DEDUPE_PSNR=N` — PSNR dB above which consecutive frames are considered duplicates (default 40 = visually identical).

**Manual override:** when the speaker *names* a moment (chapters, transcript cue "look at this chart"), add `HH:MM:SS` to a `manual_segments.txt` file with the same columns, then run `extract_keyframes.sh` after editing segments.txt to inject them — or just use the old per-timestamp ffmpeg path below for one-offs.

## 4. Screenshots

**Auto (preferred):** the keyframes from §3 already live in `keyframes/keyframe_NN.jpg`. Read each via the model's multimodal input; transcribe charts/tables/code into text in the breakdown (the jpg is temp, the text is durable).

**Manual one-off:** for a specific transcript-flagged timestamp:

```bash
scripts/ytdlp.sh "$URL" -f "bestvideo[height<=720]" --download-sections "*HH:MM:SS-HH:MM:SS_END" -o "seg.%(ext)s"
ffmpeg -y -i seg.* -frames:v 1 shot_HHMMSS.jpg 2>/dev/null   # may core-dump AFTER writing — check file exists
rm seg.*
```

## 5. Chase references

For each kept link, ask a named question first ("does the repo implement the claimed X?", "does the paper report the quoted number?") then WebFetch/clone only to answer it. No named question → don't fetch. Note claim-vs-source agreement.

## 6. Judgement

Separate durable/actionable (method, number with provenance, gotcha, repo worth using) from hype/filler. State confidence and whether each key claim was source-verified (step 5) or is the speaker's assertion only. Domain lenses: trading/finance → extract the *method* (signal construction, flow/rebalance mechanics), not the prediction; coding/AI → does the repo/paper actually support the demo.

## 7. Output

Caller asked for a specific output → produce that. Otherwise:

- **Durables → ke**: one `ke add "youtube/<channel>/<slug>"` per standalone finding, body includes claim, verification status, and provenance `URL @ MM:SS`.
- **Full breakdown → tmp file**: `breakdown.md` in the workdir — metadata, chapter map, cleaned key-claims list, screenshot transcriptions, link assessments, judgement. Report the path.
