#!/usr/bin/env bash
# yt-dlp wrapper that survives YouTube bot-gating.
# Rungs (first success wins; extra args passed through to yt-dlp):
#   1. vanilla
#   2. alternate player clients (tv, web_safari, ios, ...)
#   3. PO token via bgutil-ytdlp-pot-provider (if listening on 127.0.0.1:4416)
#   4. cookies file if $YTDLP_COOKIES set
#   5. cookies from a logged-in browser profile
# Usage: ytdlp.sh <url> [yt-dlp args...]
set -u
URL="${1:?usage: ytdlp.sh <url> [yt-dlp args...]}"
shift
ERR="$(mktemp)"; trap 'rm -f "$ERR"' EXIT

try() { yt-dlp "$@" 2>"$ERR"; }

run() { # run <label> <yt-dlp args...>
    if try "$@"; then return 0; fi
    echo "ytdlp.sh: rung '$1' failed" >&2
    return 1
}

run vanilla "$URL" "$@" && exit 0
for client in tv web_safari ios tv_embedded web_poison_syn; do
    run "client=$client" --extractor-args "youtube:player_client=$client" "$URL" "$@" && exit 0
done
if curl -fsS -m 1 http://127.0.0.1:4416/ >/dev/null 2>&1; then
    run bgutil --extractor-args "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416" "$URL" "$@" && exit 0
fi
if [ -n "${YTDLP_COOKIES:-}" ] && [ -f "${YTDLP_COOKIES}" ]; then
    run cookies-file --cookies "$YTDLP_COOKIES" "$URL" "$@" && exit 0
fi
for browser in chrome firefox; do
    run "cookies=$browser" --cookies-from-browser "$browser" "$URL" "$@" && exit 0
done

echo "ytdlp.sh: all rungs failed. Last error:" >&2
cat "$ERR" >&2
echo "ytdlp.sh: try updating first: pipx upgrade yt-dlp" >&2
exit 1