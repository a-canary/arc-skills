#!/usr/bin/env bash
# screen.sh stage-2 verdict parsing against a mock OpenAI-compat server: only an exact
# CLEAN first word may pass; anything else (NOT CLEAN, UNCLEAN, prose, empty) fails closed.
# Usage: bash screen.test.sh   (needs python3, jq, curl; no network beyond 127.0.0.1)
set -u
here=$(cd "$(dirname "$0")" && pwd)
mock=$(mktemp -d); trap 'kill $pid 2>/dev/null; mv "$mock" "$mock.done" 2>/dev/null' EXIT
cat > "$mock/m.py" <<'EOF'
import http.server, json, sys
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        self.rfile.read(int(self.headers.get('content-length', 0)))
        reply = open(sys.argv[2]).read()
        body = json.dumps({'choices': [{'message': {'content': reply}}]}).encode()
        self.send_response(200); self.end_headers(); self.wfile.write(body)
http.server.HTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
EOF
port=$((20000 + RANDOM % 20000))
python3 -I "$mock/m.py" "$port" "$mock/reply" & pid=$!
sleep 0.5
fail=0
check() { # <want rc> <model reply>
  printf '%s' "$2" > "$mock/reply"
  echo "hello there" | SCREEN_PROXY_URL="http://127.0.0.1:$port/v1" bash "$here/screen.sh" >/dev/null
  local rc=$?
  if [ "$rc" = "$1" ]; then echo "ok   rc=$rc  $(printf '%q' "$2")"; else echo "FAIL rc=$rc want $1  $(printf '%q' "$2")"; fail=1; fi
}
check 0 $'CLEAN\nbenign'
check 0 $'**CLEAN**\nbenign'
check 0 $'clean.'
check 1 $'INJECTION\nrole override'
check 1 $'NOT CLEAN: INJECTION\nx'
check 1 $'UNCLEAN'
check 1 $'The text is CLEAN'
check 1 $'\nCLEAN'
check 1 ''
exit $fail
