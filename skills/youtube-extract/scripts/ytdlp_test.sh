#!/usr/bin/env bash
# ytdlp.sh contract: browser-cookie rung is opt-in; non-bot errors fail fast.
set -u
D="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cat >"$T/yt-dlp" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$LOG"; echo "$STUB_ERR" >&2; exit 1
EOF
chmod +x "$T/yt-dlp"
fail=0
case_() { # case_ <name> <stderr> <env...> -- expects checked by caller
  : >"$T/log"
  env PATH="$T:$PATH" LOG="$T/log" STUB_ERR="$2" "${@:3}" bash "$D/ytdlp.sh" https://youtu.be/x >/dev/null 2>&1
}
case_ bot "Sign in to confirm you're not a bot"
grep -q -- --cookies-from-browser "$T/log" && { echo "FAIL: browser cookies used without opt-in"; fail=1; }
case_ optin "Sign in to confirm you're not a bot" YTDLP_BROWSER_COOKIES=1
grep -q -- --cookies-from-browser "$T/log" || { echo "FAIL: opt-in did not reach browser rung"; fail=1; }
case_ gone "ERROR: [youtube] x: Video unavailable"
[ "$(wc -l <"$T/log")" -eq 1 ] || { echo "FAIL: non-bot error retried $(wc -l <"$T/log")x"; fail=1; }
case_ http404 "ERROR: Unable to download webpage: HTTP Error 404: Not Found"
[ "$(wc -l <"$T/log")" -eq 1 ] || { echo "FAIL: 404 retried $(wc -l <"$T/log")x"; fail=1; }
case_ label "Sign in to confirm you're not a bot"
{ [ -s "$T/log" ] && ! grep -qvE '^(--extractor-args [^ ]+ )?https://youtu.be/x$' "$T/log"; } || { echo "FAIL: rung label leaked into yt-dlp args: $(head -1 "$T/log")"; fail=1; }
[ $fail -eq 0 ] && echo PASS
exit $fail
